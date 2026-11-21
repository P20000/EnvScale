#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Consolidated Host Runtime Deployment Engine
# ==============================================================================
# Predictable 8-Step Release Sequence:
#   1. Acquire exclusive host deployment lock (flock -n on FD 9).
#   2. Validate deployable release manifest & @sha256:... image digests
#      (rejects manifest_kind='example', *.example.json, & synthetic digests).
#   3. Validate 0600 host secrets, ports (1..65535), disk space, kubeconfig,
#      and Docker Compose config before modifying any container.
#   4. Pre-pull all 3 digest-pinned application images (fail before cutover).
#   5. Validate ingress (strict IPv4 + ports + caddy validate + DuckDNS) & ensure
#      stateful data tier (postgres, redis) is healthy.
#   6. Verify RESTORE_VERIFIED pre-deploy backup manifest/checksum/freshness
#      (when schema changes or required) & run versioned Drizzle migrations.
#   7. Promote Caddy with automatic rollback recovery BEFORE promoting
#      rendered.compose.env, then cut over stateless containers (--pull never).
#   8. Execute readiness checks (`verify.sh`); rotate release pointers ONLY on
#      pass, or pass inherited FD 9 to `rollback.sh` if safe on fail.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deployment/scripts/runtime-common.sh
source "${SCRIPT_DIR}/runtime-common.sh"

MANIFEST_PATH=""
SECRETS_FILE="${ENVSCALE_SECRETS_FILE}"
LOCAL_SMOKE="false"
SKIP_INGRESS="false"
PRE_DEPLOY_BACKUP_MANIFEST=""
PRE_DEPLOY_BACKUP_ARTIFACT=""
BACKUP_MAX_AGE_SECONDS=3600
VERIFY_TIMEOUT=60

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    --secrets-file)
      SECRETS_FILE="${2:-}"
      shift 2
      ;;
    --local-smoke)
      LOCAL_SMOKE="true"
      SKIP_INGRESS="true"
      shift
      ;;
    --skip-ingress)
      SKIP_INGRESS="true"
      shift
      ;;
    --pre-deploy-backup-manifest)
      PRE_DEPLOY_BACKUP_MANIFEST="${2:-}"
      shift 2
      ;;
    --pre-deploy-backup-artifact)
      PRE_DEPLOY_BACKUP_ARTIFACT="${2:-}"
      shift 2
      ;;
    --backup-max-age-seconds)
      BACKUP_MAX_AGE_SECONDS="${2:-3600}"
      shift 2
      ;;
    --verify-timeout)
      VERIFY_TIMEOUT="${2:-60}"
      shift 2
      ;;
    *)
      log_error "Unknown argument to host-runtime.sh: $1"
      exit 1
      ;;
  esac
done

if [[ -z "$MANIFEST_PATH" ]]; then
  log_error "Usage: host-runtime.sh --manifest <release-manifest.json> [--secrets-file /etc/envscale/secrets.env] [--pre-deploy-backup-manifest <m.json> --pre-deploy-backup-artifact <db.dump>] [--local-smoke]"
  exit 1
fi
if ! [[ "$VERIFY_TIMEOUT" =~ ^[0-9]+$ ]] || (( VERIFY_TIMEOUT < 5 )); then
  log_error "--verify-timeout must be an integer >= 5 (got: ${VERIFY_TIMEOUT})"
  exit 1
fi
if ! [[ "$BACKUP_MAX_AGE_SECONDS" =~ ^[0-9]+$ ]] || (( BACKUP_MAX_AGE_SECONDS < 1 || BACKUP_MAX_AGE_SECONDS > 86400 )); then
  log_error "--backup-max-age-seconds must be in 1..86400 (got: ${BACKUP_MAX_AGE_SECONDS})"
  exit 1
fi

# 1. Host Concurrency Lock (held on FD 9 and inherited by child rollback if needed)
mkdir -p "$(dirname "$ENVSCALE_LOCK_FILE")" "${ENVSCALE_CONFIG_DIR}" "${ENVSCALE_STATE_DIR}/releases"
chmod 700 "${ENVSCALE_CONFIG_DIR}" "${ENVSCALE_STATE_DIR}" "${ENVSCALE_STATE_DIR}/releases" 2>/dev/null || true

exec 9>"$ENVSCALE_LOCK_FILE"
if ! flock -n 9; then
  log_error "Concurrent deployment/rollback detected (${ENVSCALE_LOCK_FILE} locked). Failing closed."
  exit 1
fi

# 2. Validate Deployable Release Manifest & Extract Digest Vars
log_info "=== [1/7] Validating deployable release manifest ==="
eval "$(python3 "$MANIFEST_VALIDATOR" --manifest "$MANIFEST_PATH" --emit-env)"
log_info "Selected release: ${MANIFEST_RELEASE_ID} (commit=${MANIFEST_COMMIT_SHA:0:12}, migrations=${MANIFEST_LATEST_MIGRATION_TAG})"

# 3. Disk Space, Kubeconfig, Port & Secrets Preflight
log_info "=== [2/7] Running host preflight (disk, kubeconfig, secrets, ports, Compose config) ==="
DOCKER_ROOT_DIR="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo "/var/lib/docker")"
AVAIL_KB="$(df -Pk "${DOCKER_ROOT_DIR}" 2>/dev/null | awk 'NR==2 {print $4}' || df -Pk / | awk 'NR==2 {print $4}')"
if (( AVAIL_KB < 2097152 )); then
  log_error "Insufficient disk space (${AVAIL_KB} KiB free < 2 GiB minimum required)."
  exit 1
fi

KUBECONFIG_SOURCE="${K3S_SOURCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
KUBECONFIG_TARGET="${K3S_KUBECONFIG_HOST_PATH:-${ENVSCALE_CONFIG_DIR}/kubeconfig.yaml}"
stage_kubeconfig_file "$KUBECONFIG_SOURCE" "$KUBECONFIG_TARGET" "$LOCAL_SMOKE"

CANDIDATE_ENV="${ENVSCALE_CONFIG_DIR}/candidate.compose.env"
RENDERED_ENV="${ENVSCALE_CONFIG_DIR}/rendered.compose.env"
REQUIRE_INGRESS="true"
[[ "$SKIP_INGRESS" == "true" ]] && REQUIRE_INGRESS="false"

validate_secrets_and_render_env \
  "$SECRETS_FILE" \
  "$MANIFEST_PATH" \
  "$CANDIDATE_ENV" \
  "$REQUIRE_INGRESS" \
  "$KUBECONFIG_TARGET" \
  "$LOCAL_SMOKE"

docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" config -q
eval "$(emit_rendered_env_subset "$CANDIDATE_ENV" "CAND_" COMPOSE_PROJECT_NAME)"
PROJ_NAME="${CAND_COMPOSE_PROJECT_NAME:-envscale}"
log_info "Secrets, 0600 permissions, port ranges, and Compose v2 configuration validated."

# 4. Pre-Cutover Digest Pull (Running services untouched if pull fails)
log_info "=== [3/7] Pulling exact @sha256 digest images prior to cutover ==="
if ! docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" pull api-server k8s-streamer web; then
  rm -f "$CANDIDATE_ENV"
  append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_PRE_CUTOVER" "$MANIFEST_PATH" \
    "Failed pulling @sha256 application image digests; existing runtime untouched"
  log_error "Image pull failed before cutover. Running containers were NOT modified."
  exit 1
fi

# 5. Pre-Cutover Ingress Rendering, Caddy Validation & DuckDNS Check
TMP_CADDY="${ENVSCALE_CONFIG_DIR}/Caddyfile.staged"
if [[ "$SKIP_INGRESS" != "true" ]]; then
  if ! stage_and_validate_caddy "$CANDIDATE_ENV" "$TMP_CADDY"; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_PRE_CUTOVER" "$MANIFEST_PATH" \
      "Pre-cutover ingress/Caddyfile/DuckDNS validation failed; existing runtime untouched"
    exit 1
  fi
fi

# 6. Stateful Data Tier Readiness
log_info "=== [4/7] Ensuring stateful data tier (postgres, redis) is healthy ==="
docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" up -d --no-build postgres redis

DATA_READY="false"
for _ in $(seq 1 30); do
  PG_H="$(docker inspect --format '{{.State.Health.Status}}' "${PROJ_NAME}-postgres" 2>/dev/null || echo "starting")"
  RD_H="$(docker inspect --format '{{.State.Health.Status}}' "${PROJ_NAME}-redis" 2>/dev/null || echo "starting")"
  if [[ "$PG_H" == "healthy" && "$RD_H" == "healthy" ]]; then
    DATA_READY="true"
    break
  fi
  sleep 2
done
if [[ "$DATA_READY" != "true" ]]; then
  rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
  log_error "Stateful data tier (postgres/redis) failed healthchecks."
  exit 1
fi

# 7. Verified Pre-Deploy Backup Gate & Tracked Drizzle Migration Execution
log_info "=== [5/7] Checking pre-deploy backup proof and applying versioned Drizzle migrations ==="
LAST_GOOD_MANIFEST="${ENVSCALE_STATE_DIR}/releases/last-known-good.manifest.json"
PREV_GOOD_MANIFEST="${ENVSCALE_STATE_DIR}/releases/previous-known-good.manifest.json"
MIGRATIONS_CHANGED="false"
PREV_MIG_HASH=""

if [[ -f "$LAST_GOOD_MANIFEST" ]]; then
  PREV_MIG_HASH="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["compatibility"]["drizzle_migrations_bundle_sha256"])' "$LAST_GOOD_MANIFEST")"
  if [[ "$PREV_MIG_HASH" != "$MANIFEST_MIGRATIONS_SHA256" ]]; then
    MIGRATIONS_CHANGED="true"
  fi
fi

NEED_BACKUP_PROOF="false"
if [[ "$LOCAL_SMOKE" != "true" ]] && [[ "$MIGRATIONS_CHANGED" == "true" || "$MANIFEST_REQUIRES_PRE_DEPLOY_BACKUP" == "true" ]]; then
  NEED_BACKUP_PROOF="true"
elif [[ -n "$PRE_DEPLOY_BACKUP_MANIFEST" || -n "$PRE_DEPLOY_BACKUP_ARTIFACT" ]]; then
  NEED_BACKUP_PROOF="true"
fi

if [[ "$NEED_BACKUP_PROOF" == "true" ]]; then
  if [[ -z "$PRE_DEPLOY_BACKUP_MANIFEST" || -z "$PRE_DEPLOY_BACKUP_ARTIFACT" ]]; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    log_error "Release requires a verified pre-deploy backup, but --pre-deploy-backup-manifest and --pre-deploy-backup-artifact were not both supplied."
    exit 1
  fi
  if ! python3 "$RUNTIME_GUARDS" verify-pre-deploy-backup \
    --manifest "$PRE_DEPLOY_BACKUP_MANIFEST" \
    --artifact "$PRE_DEPLOY_BACKUP_ARTIFACT" \
    --max-age-seconds "$BACKUP_MAX_AGE_SECONDS" \
    --expected-migrations-sha256 "$PREV_MIG_HASH"; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_PRE_CUTOVER" "$MANIFEST_PATH" \
      "Pre-deploy RESTORE_VERIFIED backup proof failed validation"
    exit 1
  fi
  log_info "Pre-deploy RESTORE_VERIFIED backup manifest, SHA-256 checksum, and freshness verified."
fi

if ! docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" run --rm --no-deps --pull never api-server node dist/db/migrate.js; then
  rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
  append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_MIGRATION" "$MANIFEST_PATH" \
    "Drizzle migration runner exited non-zero prior to container cutover"
  log_error "Database migration failed! Running application containers and rendered.compose.env were not replaced."
  exit 1
fi

# 8. Recoverable Caddy Promotion BEFORE Atomic Env Promotion & Container Cutover
log_info "=== [6/7] Promoting ingress config, rendered.compose.env, and stateless containers ==="
if [[ "$SKIP_INGRESS" != "true" ]]; then
  if ! promote_caddy_with_recovery "$TMP_CADDY"; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_INGRESS_CUTOVER" "$MANIFEST_PATH" \
      "Caddy installation/reload failed; previous Caddyfile restored and rendered.compose.env untouched"
    exit 1
  fi
fi

if [[ -f "$RENDERED_ENV" ]]; then
  write_atomic_0600 "$RENDERED_ENV" "${RENDERED_ENV}.prev"
fi
write_atomic_0600 "$CANDIDATE_ENV" "$RENDERED_ENV"
rm -f "$CANDIDATE_ENV"

CUTOVER_OK="true"
if ! docker compose --env-file "$RENDERED_ENV" -f "$COMPOSE_FILE" up -d --no-build --pull never --remove-orphans api-server k8s-streamer web; then
  log_error "docker compose up -d reported container startup/dependency failure during cutover."
  CUTOVER_OK="false"
fi

# 9. Readiness Verification, Pointer Rotation, or Safe Auto-Rollback
log_info "=== [7/7] Executing readiness & smoke verification ==="
if [[ "$CUTOVER_OK" == "true" ]] && "${SCRIPT_DIR}/verify.sh" --manifest "$MANIFEST_PATH" --env-file "$RENDERED_ENV" --timeout "$VERIFY_TIMEOUT"; then
  python3 "$RUNTIME_GUARDS" rotate-release-pointers \
    --target-manifest "$MANIFEST_PATH" \
    --last-good "$LAST_GOOD_MANIFEST" \
    --prev-good "$PREV_GOOD_MANIFEST"

  append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOYED_HEALTHY" "$MANIFEST_PATH" \
    "All container healthchecks, digest pins, DB migrations, and HTTP smoke tests passed"

  if [[ "$LOCAL_SMOKE" != "true" ]]; then
    docker image prune -f >/dev/null 2>&1 || true
  fi
  log_info "=== Deployment of ${MANIFEST_RELEASE_ID} SUCCEEDED ==="
  exit 0
fi

log_error "Verification failed for candidate release ${MANIFEST_RELEASE_ID}! Capturing diagnostics..."
docker compose --env-file "$RENDERED_ENV" -f "$COMPOSE_FILE" ps >&2 || true
docker compose --env-file "$RENDERED_ENV" -f "$COMPOSE_FILE" logs --tail=50 api-server k8s-streamer web >&2 || true

append_release_ledger "$ENVSCALE_STATE_DIR" "DEPLOY_FAILED_VERIFICATION" "$MANIFEST_PATH" \
  "Post-cutover readiness verification failed"

if [[ -f "$LAST_GOOD_MANIFEST" ]]; then
  if [[ "$MIGRATIONS_CHANGED" == "false" || "$MANIFEST_BACKWARD_COMPATIBLE_DB" == "true" ]]; then
    log_warn "Triggering automatic rollback to last known-good release via inherited lock FD 9..."
    ROLLBACK_ARGS=(--from-failed-deploy --lock-fd 9 --secrets-file "$SECRETS_FILE")
    [[ "$LOCAL_SMOKE" == "true" ]] && ROLLBACK_ARGS+=(--local-smoke)
    [[ "$SKIP_INGRESS" == "true" ]] && ROLLBACK_ARGS+=(--skip-ingress)
    "${SCRIPT_DIR}/rollback.sh" "${ROLLBACK_ARGS[@]}" || log_error "Automatic rollback also failed!"
  else
    log_error "Automatic image-only rollback suppressed because non-backward-compatible DB migrations ran. Restore DB backup via db-restore.sh first."
  fi
fi

exit 1
