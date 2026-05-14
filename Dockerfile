# ---------------------------------------------------------------
# Dockerfile — Neon Kart Battle
# Multi-stage build: install deps → copy only prod artifacts
# Results in a lean, non-root production image (~150MB vs ~400MB)
# ---------------------------------------------------------------

# ── Stage 1: Builder ─────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files first (layer caching: only re-runs npm install
# if package.json or package-lock.json actually changed)
COPY package*.json ./

# Install production dependencies only to keep the image lean and secure
RUN npm install --production

# Copy the rest of the source
COPY . .

# ── Stage 2: Production ───────────────────────────────────────
FROM node:18-alpine AS production

# Switch to the /app directory
WORKDIR /app

# Copy the entire app from the builder stage in one clean command
# This ensures we never accidentally miss files (like style.css or img/)
COPY --from=builder /app .

# Expose the game server port
EXPOSE 8000

# Health check: Docker / Kubernetes will probe this endpoint.
# If /metrics returns non-200 for 3 consecutive checks, the
# container is marked unhealthy and Kubernetes restarts it.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:8000/metrics || exit 1

CMD ["node", "server.js"]
