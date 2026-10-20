# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests from monorepo root and web package
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages

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
FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
