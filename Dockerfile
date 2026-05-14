# =========================
# Stage 1 — Builder Stage
# =========================

FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy dependency files first
COPY package*.json ./

# Install production dependencies
RUN npm install --production

# Copy application source code
COPY . .

# =============================
# Stage 2 — Production Runtime
# =============================

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy app from builder stage
COPY --from=builder /app .

# Expose application port
EXPOSE 8000

# Start server
CMD ["node", "server.js"]
