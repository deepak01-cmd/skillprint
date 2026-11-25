@echo off
cd /d "%~dp0"
docker compose stop
echo Stopped. Your data is kept. Run run.bat to start again.
pause
