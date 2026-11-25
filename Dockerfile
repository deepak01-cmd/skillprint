# Role & Skill Intelligence Platform
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app ./
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=10 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrate, load sample data on first run, import ./data job files, then start
CMD ["node", "node_modules/tsx/dist/cli.mjs", "scripts/start.ts"]
