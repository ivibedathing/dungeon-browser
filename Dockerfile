# Dungeon Browser co-op server + static client, in one image.
# The server serves the zero-build client and the WebSocket on one origin (Phase 4.5),
# so a single container can host the whole game behind a TLS-terminating proxy.
FROM node:20-slim

# Only the two server-only deps (ws, pg) are installed — the client is zero-build.
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Server code + the static client it serves (js/css/html). Tests and docs don't ship
# (see .dockerignore).
COPY server ./server
COPY js ./js
COPY css ./css
COPY index.html verify.html ./
COPY assets ./assets

# Run as the unprivileged user the base image already provides.
USER node

ENV PORT=8080
EXPOSE 8080
# METRICS live on the same http listener at /metrics and /healthz.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.js"]
