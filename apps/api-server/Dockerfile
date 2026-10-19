# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-server/package.json ./apps/api-server/package.json
COPY packages ./packages

# Install dependencies
RUN pnpm install --frozen-lockfile --filter envscale-api-server...

# Copy source code
COPY apps/api-server ./apps/api-server

# Build TypeScript
RUN pnpm --filter envscale-api-server build

# Production Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-server/package.json ./apps/api-server/package.json
COPY packages ./packages

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile --filter envscale-api-server...

# Copy built code
COPY --from=builder /app/apps/api-server/dist ./apps/api-server/dist
COPY apps/api-server/drizzle.config.ts ./apps/api-server/
COPY apps/api-server/src/db ./apps/api-server/src/db

# Install drizzle-kit globally for db migrations
RUN npm install -g drizzle-kit tsx

WORKDIR /app/apps/api-server

EXPOSE 3000

CMD ["node", "dist/index.js"]
