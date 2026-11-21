# Build Stage
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Copy package manifests first so Corepack verifies the SHA-512 pinned pnpm@10.0.0 tarball
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-server/package.json ./apps/api-server/package.json
COPY packages ./packages

RUN corepack enable && corepack install

# Install dependencies
RUN pnpm install --frozen-lockfile --filter envscale-api-server...

# Copy source code
COPY apps/api-server ./apps/api-server

# Build TypeScript
RUN pnpm --filter envscale-api-server build

# Production Runtime Stage
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS runner

WORKDIR /app

ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-server/package.json ./apps/api-server/package.json
COPY packages ./packages

# Verify SHA-512 pinned pnpm@10.0.0 via package.json before installing prod deps
RUN corepack enable && corepack install

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile --filter envscale-api-server...

# Copy compiled server + versioned SQL migrations only (no drizzle-kit/tsx dev tools in prod)
COPY --chown=node:node --from=builder /app/apps/api-server/dist ./apps/api-server/dist
COPY --chown=node:node apps/api-server/src/db/migrations ./apps/api-server/src/db/migrations

WORKDIR /app/apps/api-server

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "dist/index.js"]
