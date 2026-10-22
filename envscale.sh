#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Unified CLI Wrapper & Remote Deployment Engine
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CENTER="$SCRIPT_DIR/scripts/test-center"

# Remote EC2 Host Operations (native bash, no Python/GUI dependencies)
if [ -d "/opt/envscale" ] && [ "$SCRIPT_DIR" = "/opt/envscale" ]; then
    ROOT_DIR="/opt/envscale"
    COMPOSE_FILE="$ROOT_DIR/deployment/docker-compose.prod.yml"

    if [ "$1" = "rollback" ]; then
        echo "[INFO] === Initiating EnvScale Application Rollback ==="
        if [ ! -f "$ROOT_DIR/.env.prev" ]; then
            echo "[ERROR] No previous stable environment (.env.prev) found to rollback to!" >&2
            exit 1
        fi
        cp -f "$ROOT_DIR/.env.prev" "$ROOT_DIR/.env"
        chmod 600 "$ROOT_DIR/.env"
        echo "[INFO] Restored previous configuration from .env.prev"
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" up -d --remove-orphans
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" restart api-server k8s-streamer
        sudo systemctl reload caddy || sudo systemctl restart caddy
        echo "[SUCCESS] Rollback complete. Previous stable release restored."
        exit 0
    fi

    if [ "$1" = "deploy" ]; then
        echo "[INFO] === Executing EnvScale Deployment on EC2 Production Host ==="

        # 1. Load existing .env if present into environment without overriding explicit env vars
        if [ -f "$ROOT_DIR/.env" ]; then
            while IFS='=' read -r key val || [ -n "$key" ]; do
                [[ "$key" =~ ^[[:space:]]*# ]] && continue
                [ -z "$key" ] && continue
                key=$(echo "$key" | xargs)
                val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
                if [ -z "${!key}" ]; then
                    export "$key"="$val"
                fi
            done < "$ROOT_DIR/.env"
        fi

        # 2. Strict Secret Validation (No empty secrets, no demo fallbacks)
        REQUIRED_SECRETS=(
            "DATABASE_URL"
            "REDIS_URL"
            "JWT_ACCESS_SECRET"
            "JWT_REFRESH_SECRET"
            "KUBECONFIG_ENCRYPTION_KEY"
            "BETTER_AUTH_SECRET"
            "DUCKDNS_DOMAIN"
            "DUCKDNS_TOKEN"
        )
        MISSING_SECRETS=()
        for sec in "${REQUIRED_SECRETS[@]}"; do
            val="${!sec}"
            if [ -z "$val" ] || [[ "$val" == replace-with* ]] || [[ "$val" == demo-college* ]]; then
                MISSING_SECRETS+=("$sec")
            fi
        done

        if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
            echo "[FATAL] Deployment halted: Required secret(s) missing or placeholder in .env: ${MISSING_SECRETS[*]}" >&2
            echo "[FATAL] Empty values or insecure fallbacks are prohibited by system guardrails." >&2
            exit 1
        fi

        # 3. Detect current public IP
        CURRENT_IP=$(curl -s --max-time 5 http://checkip.amazonaws.com || curl -s --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 || true)
        CURRENT_IP="${CURRENT_IP:-127.0.0.1}"
        DOMAIN="${DUCKDNS_DOMAIN}"
        FULL_DOMAIN="${DOMAIN}.duckdns.org"

        # 4. Backup current working .env before modifying
        if [ -f "$ROOT_DIR/.env" ]; then
            cp -f "$ROOT_DIR/.env" "$ROOT_DIR/.env.prev"
            chmod 600 "$ROOT_DIR/.env.prev"
        fi

        # 5. Generate secure atomic .env (chmod 600)
        echo "[INFO] Generating secure production environment configuration..."
        (
            umask 077
            cat <<EOF > "$ROOT_DIR/.env.tmp"
NODE_ENV=production
PORT=3000
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
API_SERVER_IMAGE=${API_SERVER_IMAGE:-ghcr.io/p20000/envscale-api-server:${RELEASE_SHA:-latest}}
STREAMER_IMAGE=${STREAMER_IMAGE:-ghcr.io/p20000/envscale-k8s-streamer:${RELEASE_SHA:-latest}}
WEB_IMAGE=${WEB_IMAGE:-ghcr.io/p20000/envscale-web:${RELEASE_SHA:-latest}}
DUCKDNS_DOMAIN=${DOMAIN}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=https://${FULL_DOMAIN}
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
KUBECONFIG_ENCRYPTION_KEY=${KUBECONFIG_ENCRYPTION_KEY}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
CORS_ORIGIN=https://${FULL_DOMAIN},https://${CURRENT_IP}.sslip.io,http://${CURRENT_IP},http://localhost:3000,http://localhost:5173
EOF
            chmod 600 "$ROOT_DIR/.env.tmp"
            mv -f "$ROOT_DIR/.env.tmp" "$ROOT_DIR/.env"
        )
        echo "[SUCCESS] .env generated with restricted permissions (0600)."

        # 6. Synchronize DuckDNS Dynamic Record
        echo "[INFO] Routing DuckDNS record: ${FULL_DOMAIN} -> ${CURRENT_IP}..."
        DNS_RESP=$(curl -s --max-time 10 "https://www.duckdns.org/update?domains=${DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${CURRENT_IP}" || echo "FAILED")
        if [[ "$DNS_RESP" =~ "OK" ]]; then
            echo "[SUCCESS] DuckDNS updated successfully: ${FULL_DOMAIN} -> ${CURRENT_IP}"
        else
            echo "[WARN] DuckDNS API response: $DNS_RESP (Verify DUCKDNS_TOKEN)"
        fi

        # 7. Configure Caddy Reverse Proxy & Auto-HTTPS
        echo "[INFO] Updating Caddy reverse proxy for ${FULL_DOMAIN} and ${CURRENT_IP}.sslip.io..."
        sudo bash -c "cat <<EOF > /etc/caddy/Caddyfile
http://${CURRENT_IP} {
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}

${CURRENT_IP}.sslip.io {
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}

${FULL_DOMAIN} {
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}
EOF"
        sudo systemctl reload caddy || sudo systemctl restart caddy

        # 8. K3s Kubeconfig Permissions
        [ -f /etc/rancher/k3s/k3s.yaml ] && sudo chmod 644 /etc/rancher/k3s/k3s.yaml || true

        # 9. Pull and Start Containers
        echo "[INFO] Pulling and deploying container services..."
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" pull || true
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" up -d --remove-orphans

        # 10. Apply Schema Migrations
        echo "[INFO] Applying database migrations..."
        cat apps/api-server/src/db/migrations/*.sql 2>/dev/null | docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" exec -T postgres psql -U envscale -d envscale 2>/dev/null || true

        # 11. Restart application services to bind database cleanly
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" restart api-server k8s-streamer

        # 12. Host Health Self-Verification Loop
        echo "[INFO] Verifying container health status..."
        HEALTHY=false
        for attempt in $(seq 1 10); do
            sleep 2
            if curl -sf http://127.0.0.1:8080/healthz >/dev/null && curl -sf http://127.0.0.1:3001/health >/dev/null && curl -sf http://127.0.0.1:3000/ >/dev/null; then
                HEALTHY=true
                break
            fi
            echo "[INFO] Waiting for services to become healthy (attempt $attempt/10)..."
        done

        if [ "$HEALTHY" != "true" ]; then
            echo "[ERROR] Health check failed on local container endpoints! Triggering automatic rollback..." >&2
            "$0" rollback
            exit 1
        fi

        echo "[SUCCESS] === EnvScale Deployment Complete! ==="
        docker compose --env-file "$ROOT_DIR/.env" -f "$COMPOSE_FILE" ps
        exit 0
    fi
fi

# Otherwise delegate to local Test Center
if [ ! -f "$TEST_CENTER" ]; then
    echo "[Error] Test Center script not found at $TEST_CENTER" >&2
    exit 1
fi

exec "$TEST_CENTER" --cli "$@"
