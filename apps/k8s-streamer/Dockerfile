# Build Stage
FROM golang:1.24.13-alpine@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS builder

WORKDIR /app

# Copy dependency manifests
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source code
COPY . .

# Build reproducibly stripped, statically linked binary
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false -ldflags="-w -s" -o streamer ./cmd/server

# Final Runtime Stage
FROM alpine:3.21.10@sha256:87a4361f6c819618a6bafa2ed5228714cb0bb22195d2b49c95eb26799990128a AS runner

# alpine:3.21.10@sha256:87a4361f... ships ca-certificates-bundle-20261020-r0 in its
# immutable base layer; assert presence instead of mutably fetching via apk add.
RUN test -s /etc/ssl/certs/ca-certificates.crt \
  && addgroup -g 10001 -S envscale \
  && adduser -u 10001 -S -G envscale envscale

WORKDIR /app
COPY --chown=10001:10001 --from=builder /app/streamer .

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["./streamer"]
