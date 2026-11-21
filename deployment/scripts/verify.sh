#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Post-Deployment & Post-Rollback Readiness Verifier
# ==============================================================================
# Verifies:
#   1. All 5 Compose containers (postgres, redis, api-server, k8s-streamer, web)
#      are running and report Docker Health.Status == "healthy".
#   2. Running application containers match the exact @sha256:... digests in
#      the target release manifest (both Config.Image and RepoDigests).
#   3. PostgreSQL Drizzle migration hashes/timestamps match target manifest
#      compatibility.drizzle_migrations AND all 12 canonical public tables exist.
#   4. HTTP liveness (/health, /healthz, web /healthz & /), Redis Pub/Sub
#      connection status, and JWT 401 auth guards pass.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deployment/scripts/runtime-common.sh
source "${SCRIPT_DIR}/runtime-common.sh"

MANIFEST_PATH=""
ENV_FILE=""
TIMEOUT_SEC=60
PUBLIC_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SEC="${2:-60}"
      shift 2
      ;;
    --public-url)
      PUBLIC_URL="${2:-}"
      shift 2
      ;;
    *)
      log_error "Unknown argument to verify.sh: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$MANIFEST_PATH" || -z "$ENV_FILE" ]]; then
  log_error "Usage: verify.sh --manifest <manifest.json> --env-file <compose.env> [--timeout 60] [--public-url https://...]"
  exit 1
fi
if ! [[ "$TIMEOUT_SEC" =~ ^[0-9]+$ ]] || (( TIMEOUT_SEC < 1 )); then
  log_error "--timeout must be a positive integer (got: ${TIMEOUT_SEC})"
  exit 1
fi

eval "$(python3 "$MANIFEST_VALIDATOR" --manifest "$MANIFEST_PATH" --emit-env)"
eval "$(emit_rendered_env_subset "$ENV_FILE" "VERIFY_" COMPOSE_PROJECT_NAME API_HOST_PORT STREAMER_HOST_PORT WEB_HOST_PORT POSTGRES_USER POSTGRES_DB)"

VERIFY_COMPOSE_PROJECT_NAME="${VERIFY_COMPOSE_PROJECT_NAME:-envscale}"
VERIFY_API_HOST_PORT="${VERIFY_API_HOST_PORT:-3001}"
VERIFY_STREAMER_HOST_PORT="${VERIFY_STREAMER_HOST_PORT:-8080}"
VERIFY_WEB_HOST_PORT="${VERIFY_WEB_HOST_PORT:-3000}"
VERIFY_POSTGRES_USER="${VERIFY_POSTGRES_USER:-envscale}"
VERIFY_POSTGRES_DB="${VERIFY_POSTGRES_DB:-envscale}"

SERVICES=("postgres" "redis" "api-server" "k8s-streamer" "web")

log_info "Waiting up to ${TIMEOUT_SEC}s for all 5 containers in project '${VERIFY_COMPOSE_PROJECT_NAME}' to report healthy..."
DEADLINE=$((SECONDS + TIMEOUT_SEC))
ALL_HEALTHY="false"

while (( SECONDS < DEADLINE )); do
  PENDING=()
  for svc in "${SERVICES[@]}"; do
    cname="${VERIFY_COMPOSE_PROJECT_NAME}-${svc}"
    state="$(docker inspect --format '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cname" 2>/dev/null || echo "missing:missing")"
    if [[ "$state" != "running:healthy" ]]; then
      PENDING+=("${svc}(${state})")
    fi
  done

  if [[ ${#PENDING[@]} -eq 0 ]]; then
    ALL_HEALTHY="true"
    break
  fi
  sleep 2
done

if [[ "$ALL_HEALTHY" != "true" ]]; then
  log_error "Timed out waiting for container healthchecks. Unready services: ${PENDING[*]}"
  exit 1
fi
log_info "All 5 containers report running:healthy."

log_info "Verifying running container @sha256 image digests match release ${MANIFEST_RELEASE_ID}..."
check_container_digest() {
  local svc="$1"
  local expected_ref="$2"
  local cname="${VERIFY_COMPOSE_PROJECT_NAME}-${svc}"
  local expected_digest="${expected_ref#*@}"

  local cfg_img image_id repo_digests
  cfg_img="$(docker inspect --format '{{.Config.Image}}' "$cname")"
  image_id="$(docker inspect --format '{{.Image}}' "$cname")"
  repo_digests="$(docker image inspect --format '{{json .RepoDigests}}' "$image_id")"

  if [[ "$cfg_img" != "$expected_ref" ]]; then
    log_error "${cname} Config.Image (${cfg_img}) != expected (${expected_ref})"
    return 1
  fi
  if ! grep -Fq "$expected_digest" <<<"$repo_digests"; then
    log_error "${cname} image RepoDigests (${repo_digests}) does not contain ${expected_digest}"
    return 1
  fi
}

check_container_digest "api-server" "$API_SERVER_IMAGE"
check_container_digest "k8s-streamer" "$STREAMER_IMAGE"
check_container_digest "web" "$WEB_IMAGE"
log_info "Container @sha256 image-digest verification passed for api-server, k8s-streamer, and web."

log_info "Verifying PostgreSQL Drizzle migration hashes/timestamps and 12 canonical public tables..."
MIG_ROWS="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$VERIFY_POSTGRES_USER" -d "$VERIFY_POSTGRES_DB" -AtF '|' -v ON_ERROR_STOP=1 \
  -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC;')"

python3 "$RUNTIME_GUARDS" verify-db-migrations \
  --manifest "$MANIFEST_PATH" \
  --mode verify <<<"$MIG_ROWS"

TBL_COUNT="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$VERIFY_POSTGRES_USER" -d "$VERIFY_POSTGRES_DB" -At -v ON_ERROR_STOP=1 <<'SQLEOF'
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'users','refresh_tokens','sessions','accounts','verifications','jwks',
    'workspaces','workspace_members','clusters','health_snapshots','alert_policies','incidents'
  );
SQLEOF
)"

if (( TBL_COUNT != 12 )); then
  log_error "Expected 12 canonical public tables, found ${TBL_COUNT}"
  exit 1
fi
MIG_APPLIED_COUNT="$(grep -Ec '.' <<<"$MIG_ROWS" || true)"
log_info "Database check passed (verified_migration_hashes=${MIG_APPLIED_COUNT}, canonical_tables=${TBL_COUNT}/12)."

log_info "Running HTTP readiness, Redis Pub/Sub connectivity, and JWT auth guard smoke checks..."
API_HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:${VERIFY_API_HOST_PORT}/health")"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d.get("status")=="ok"' "$API_HEALTH"

STREAMER_HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:${VERIFY_STREAMER_HOST_PORT}/healthz")"
python3 - "$STREAMER_HEALTH" <<'PYEOF'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get("status") != "ok":
    raise SystemExit(f"k8s-streamer status not ok: {payload}")
if payload.get("redisStatus") != "connected":
    raise SystemExit(f"k8s-streamer Redis Pub/Sub not connected: {payload}")
PYEOF

API_UNAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${VERIFY_API_HOST_PORT}/api/v1/workspaces")"
if [[ "$API_UNAUTH_CODE" != "401" ]]; then
  log_error "Expected HTTP 401 on unauthenticated /api/v1/workspaces, got ${API_UNAUTH_CODE}"
  exit 1
fi

STREAMER_UNAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${VERIFY_STREAMER_HOST_PORT}/api/v1/clusters")"
if [[ "$STREAMER_UNAUTH_CODE" != "401" ]]; then
  log_error "Expected HTTP 401 on unauthenticated /api/v1/clusters, got ${STREAMER_UNAUTH_CODE}"
  exit 1
fi

WEB_HEALTH="$(curl -fsS --max-time 5 "http://127.0.0.1:${VERIFY_WEB_HOST_PORT}/healthz")"
if [[ "${WEB_HEALTH}" != "ok" ]]; then
  log_error "Expected 'ok' on web /healthz, got '${WEB_HEALTH}'"
  exit 1
fi

WEB_HTML="$(curl -fsS --max-time 5 "http://127.0.0.1:${VERIFY_WEB_HOST_PORT}/")"
if ! grep -Fq 'id="root"' <<<"$WEB_HTML"; then
  log_error "Frontend index HTML missing root mount node"
  exit 1
fi

if [[ -n "$PUBLIC_URL" ]]; then
  curl -fsS --max-time 10 "${PUBLIC_URL%/}/api/health" >/dev/null
  curl -fsS --max-time 10 "${PUBLIC_URL%/}/healthz" >/dev/null
  log_info "External ingress smoke check passed (${PUBLIC_URL})."
fi

log_info "Release ${MANIFEST_RELEASE_ID} passed all readiness and smoke checks."
