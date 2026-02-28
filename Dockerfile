# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml .npmrc ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN pnpm build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Install runtime dependencies only
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy config files
COPY ecosystem.config.js ./
COPY memory/ ./memory/

# Create data and logs directories
RUN mkdir -p data logs

# Set environment
ENV NODE_ENV=production

# Expose no ports (agent connects outbound to Telegram/WhatsApp)

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('fs').existsSync('/app/data/superclaw.db') ? process.exit(0) : process.exit(1)"

# Run
CMD ["node", "dist/index.js"]
