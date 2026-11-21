# Build Stage
FROM node:22.23.4-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Copy package manifests first so Corepack verifies the SHA-512 pinned pnpm@10.0.0 tarball
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages

RUN corepack enable && corepack install

# Install dependencies
RUN pnpm install --frozen-lockfile --filter web...

# Copy web source
COPY apps/web ./apps/web

# Build static assets
ARG VITE_API_BASE_URL=""
ARG VITE_STREAMER_BASE_URL=""
ARG VITE_WS_URL=""

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_STREAMER_BASE_URL=$VITE_STREAMER_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN pnpm --filter web build

# Runtime Stage
FROM nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runner

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
