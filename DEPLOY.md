# Putting Skillprint online (for testers)

This runs Skillprint on a cloud server, so your team can use it at an `https://` address. Your laptop doesn't need to be on.

Setup takes about 30 minutes. It runs three parts, all started for you:
- the app;
- its PostgreSQL database;
- Caddy, which sets up HTTPS and renews its certificate automatically.

## 1. Get a server

Create a virtual machine with **Ubuntu 24.04** (or 22.04) at any cloud provider: DigitalOcean, Hetzner, AWS Lightsail, Azure, Google Cloud and so on.

| Use | Memory | Disk |
|---|---|---|
| Without the AI model | 4 GB | 40 GB |
| With a 3B AI model | 8 GB | 50 GB |
| With a 7B AI model | 16 GB | 60 GB |

In the provider's firewall or network settings, allow incoming **22** (SSH), **80** and **443**. Note the server's **public IP address**.

## 2. Copy the app to the server

On your Windows laptop, open PowerShell in the folder that holds `role-skill-platform.zip` (the zip you received). Replace `203.0.113.5` with your server's IP, and `root` with the user your provider gives you (often `root`, `ubuntu` or `azureuser`):

```bash
scp role-skill-platform.zip root@203.0.113.5:~
```

Then sign in to the server:

```bash
ssh root@203.0.113.5
```

On the server, unpack the zip:

```bash
sudo apt-get update && sudo apt-get install -y unzip && unzip role-skill-platform.zip && cd role-skill-platform
```

## 3. Run the setup

```bash
sudo bash deploy/setup.sh
```

It asks one question:

- **Domain.**
  - Press **Enter** to use a free address made from your IP, such as `203-0-113-5.sslip.io`. It works straight away.
  - Or type your own domain, such as `skillprint.yourcompany.com`. First create a DNS **A record** for it that points to the server's IP.

Then it does the rest:
- installs Docker;
- creates `.env` with strong random passwords;
- builds and starts everything (the first time takes 5–10 minutes);
- loads the sample data and the O*NET reference data;
- sets up daily backups.

At the end it prints:
- **the address**, for example `https://203-0-113-5.sslip.io`;
- **a private password** for the demo accounts, which replaces `demo1234`. It's also saved in `deploy/demo-password.txt`.

The sign-in page doesn't list the demo accounts on a server.

## 4. Share with a tester

Send your tester the address and **a login**, privately.

- **Quickest:** a demo account such as `hr@cloudnova.demo`, with the private password from step 3.
- **Better:** their own account. Sign in as an HR admin, open **People → Users & access**, and create a user for them with their own password.

## Optional: AI through OpenRouter (no model file, small server is enough)

Instead of a model file, the app can use an OpenRouter account, including its free models. On the server, open the settings file:

```bash
sudo nano .env
```

Add these two lines, using your own key from openrouter.ai → Keys:

```
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
```

Save (Ctrl+O, Enter, Ctrl+X), then restart the app:

```bash
sudo docker compose -f docker-compose.prod.yml up -d app
```

Things to know:
- **Data leaves the server.** Draft requests (role title, similar roles, skill names, sample job-posting text) go to OpenRouter and the model provider it routes to. Some free providers keep prompts.
- **Free models have daily limits.** When a limit is hit, the draft is made from the app's own data and says why.
- **The model is chosen for you.** Optionally pick one with `AI_MODEL=` (an OpenRouter model id). If it's withdrawn, another free model is used automatically.

## Optional: the AI model

Copy the `.gguf` file into the `models` folder on the server, then restart the app. From your laptop:

```bash
scp qwen2.5-7b-instruct-q4_k_m.gguf root@203.0.113.5:~/role-skill-platform/models/
```

Then, on the server:

```bash
cd ~/role-skill-platform && sudo docker compose -f docker-compose.prod.yml restart app
```

Without a model, the app still drafts role frameworks, built from its own data. The time limit for one AI draft is 10 minutes (`AI_TIMEOUT_MS` in `.env`).

## Everyday commands (on the server, in the app folder)

| What | Command |
|---|---|
| See if it's running | `sudo docker compose -f docker-compose.prod.yml ps` |
| See the app's messages | `sudo docker compose -f docker-compose.prod.yml logs -f app` |
| Restart | `sudo docker compose -f docker-compose.prod.yml restart` |
| Stop | `sudo docker compose -f docker-compose.prod.yml down` (data is kept) |
| Back up now | `sudo bash deploy/backup.sh` |
| New demo password | `sudo docker compose -f docker-compose.prod.yml exec app npm run demo:password -- "new-password-16-chars"` |

## Installing a new version

Copy the new zip to the server and unpack it **into a new folder**. Then copy across these from the old folder:
- `.env`
- `data`
- `models`
- `backups`
- `deploy/demo-password.txt`

Then, in the new folder:

```bash
sudo bash deploy/update.sh
```

It backs up first. The database lives in a Docker volume, so it carries over, and new database changes are applied when the app starts.

## Backups and restore

Backups run every night at 02:30 into `backups/` and are kept for 14 days. Copy them off the server now and then.

To restore one (this replaces the current data):

```bash
gunzip -c backups/skillprint-YYYYMMDD-HHMM.sql.gz | sudo docker compose -f docker-compose.prod.yml exec -T db psql -U rsip -d rsip
```

## If something goes wrong

**No HTTPS, or a certificate error**
- Ports 80 and 443 must be open in the provider's firewall.
- With your own domain, its A record must point to the server.
- See Caddy's messages with: `sudo docker compose -f docker-compose.prod.yml logs caddy`

**The page doesn't load right after setup**
The first start loads data for a few minutes. Watch its progress with `logs -f app` (see the table above).

**Out of memory while building**
Use a server with at least 4 GB, or add swap space:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

## Good to know

- Your laptop's data doesn't move to the server. The server starts with the sample companies and everything else in a new version.
- Keep `.env` private: it holds the database password and the session secret.
- The database isn't reachable from the internet; only the app can talk to it.
- Repeated wrong passwords lock an account for a while, which protects the server from password guessing.
