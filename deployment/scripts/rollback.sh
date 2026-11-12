#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Deterministic Digest-Pinned Application Rollback Engine
# ==============================================================================
# Safety Guarantees:
#   1. Lock Integrity: --from-failed-deploy requires a kernel-verified inherited
#      exclusive flock descriptor (--lock-fd N); env-var spoofing is impossible.
#   2. Fail-Closed DB Inspection: Aborts if PostgreSQL is stopped/unreachable,
#      if querying drizzle.__drizzle_migrations fails, if applied migration
#      SHA-256 hashes/timestamps diverge from target (even at identical count!),
#      or if forward migrations are not proven backward_compatible_db=true.
#   3. Stateful Preservation: Never drops, restarts, or mutates Postgres/Redis.
#   4. Symmetric Pointer Rotation: Atomically rotates last-known-good and
#      previous-known-good so repeated manual rollbacks behave predictably.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deployment/scripts/runtime-common.sh
source "${SCRIPT_DIR}/runtime-common.sh"

TARGET_MANIFEST=""
SECRETS_FILE="${ENVSCALE_SECRETS_FILE}"
FROM_FAILED_DEPLOY="false"
INHERITED_LOCK_FD=""
LOCAL_SMOKE="false"
SKIP_INGRESS="false"
ALLOW_DIVERGENT_DB="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-manifest)
      TARGET_MANIFEST="${2:-}"
      shift 2
      ;;
    --secrets-file)
      SECRETS_FILE="${2:-}"
      shift 2
      ;;
    --from-failed-deploy)
      FROM_FAILED_DEPLOY="true"
      shift
      ;;
    --lock-fd)
      INHERITED_LOCK_FD="${2:-}"
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
    --allow-schema-divergent-rollback)
      ALLOW_DIVERGENT_DB="true"
      shift
      ;;
    *)
      log_error "Unknown argument to rollback.sh: $1"
      exit 1
      ;;
  esac
done

# 1. Verified Inherited Lock Descriptor vs. Exclusive Lock Acquisition
if [[ "$FROM_FAILED_DEPLOY" == "true" ]]; then
  if ! [[ "$INHERITED_LOCK_FD" =~ ^[0-9]+$ ]]; then
    log_error "[LOCK GUARD FAILED] --from-failed-deploy requires --lock-fd <descriptor>."
    exit 1
  fi
  python3 "$RUNTIME_GUARDS" verify-inherited-flock \
    --fd "$INHERITED_LOCK_FD" \
    --lock-file "$ENVSCALE_LOCK_FILE"
  log_info "Verified inherited exclusive flock on descriptor ${INHERITED_LOCK_FD}."
else
  if [[ -n "$INHERITED_LOCK_FD" ]]; then
    log_error "--lock-fd is only valid with --from-failed-deploy."
    exit 1
  fi
  mkdir -p "$(dirname "$ENVSCALE_LOCK_FILE")"
  exec 9>"$ENVSCALE_LOCK_FILE"
  if ! flock -n 9; then
    log_error "Another deployment or rollback holds ${ENVSCALE_LOCK_FILE}. Aborting."
    exit 1
  fi
fi

RELEASES_DIR="${ENVSCALE_STATE_DIR}/releases"
LAST_GOOD="${RELEASES_DIR}/last-known-good.manifest.json"
PREV_GOOD="${RELEASES_DIR}/previous-known-good.manifest.json"
LEDGER_FILE="${RELEASES_DIR}/history.jsonl"

if [[ -z "$TARGET_MANIFEST" ]]; then
  if [[ "$FROM_FAILED_DEPLOY" == "true" ]]; then
    TARGET_MANIFEST="$LAST_GOOD"
  else
    TARGET_MANIFEST="$PREV_GOOD"
  fi
fi

if [[ ! -f "$TARGET_MANIFEST" ]]; then
  log_error "Rollback target manifest not found at ${TARGET_MANIFEST}. Cannot execute rollback."
  exit 1
fi

eval "$(python3 "$MANIFEST_VALIDATOR" --manifest "$TARGET_MANIFEST" --emit-env)"
log_info "Initiating rollback to verified release ${MANIFEST_RELEASE_ID} (commit ${MANIFEST_COMMIT_SHA:0:12})..."

KUBECONFIG_SOURCE="${K3S_SOURCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
KUBECONFIG_TARGET="${K3S_KUBECONFIG_HOST_PATH:-${ENVSCALE_CONFIG_DIR}/kubeconfig.yaml}"
stage_kubeconfig_file "$KUBECONFIG_SOURCE" "$KUBECONFIG_TARGET" "$LOCAL_SMOKE"

CANDIDATE_ENV="${ENVSCALE_CONFIG_DIR}/rollback.compose.env"
RENDERED_ENV="${ENVSCALE_CONFIG_DIR}/rendered.compose.env"
REQUIRE_INGRESS="true"
[[ "$SKIP_INGRESS" == "true" ]] && REQUIRE_INGRESS="false"

validate_secrets_and_render_env \
  "$SECRETS_FILE" \
  "$TARGET_MANIFEST" \
  "$CANDIDATE_ENV" \
  "$REQUIRE_INGRESS" \
  "$KUBECONFIG_TARGET" \
  "$LOCAL_SMOKE"

docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" config -q
eval "$(emit_rendered_env_subset "$CANDIDATE_ENV" "RB_" COMPOSE_PROJECT_NAME POSTGRES_USER POSTGRES_DB)"
RB_COMPOSE_PROJECT_NAME="${RB_COMPOSE_PROJECT_NAME:-envscale}"
RB_POSTGRES_USER="${RB_POSTGRES_USER:-envscale}"
RB_POSTGRES_DB="${RB_POSTGRES_DB:-envscale}"

# 2. Fail-Closed Live PostgreSQL Migration Identity & Compatibility Verification
if [[ "$ALLOW_DIVERGENT_DB" != "true" ]]; then
  PG_RUNNING="$(docker inspect --format '{{.State.Running}}' "${RB_COMPOSE_PROJECT_NAME}-postgres" 2>/dev/null || echo "false")"
  if [[ "$PG_RUNNING" != "true" ]]; then
    rm -f "$CANDIDATE_ENV"
    log_error "[ROLLBACK BLOCKED] PostgreSQL container (${RB_COMPOSE_PROJECT_NAME}-postgres) is not running; cannot establish migration safety."
    exit 1
  fi

  MIG_ERR_FILE="${ENVSCALE_CONFIG_DIR}/rollback.mig_err.$$"
  if ! LIVE_MIG_ROWS="$(docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$RB_POSTGRES_USER" -d "$RB_POSTGRES_DB" -AtF '|' -v ON_ERROR_STOP=1 \
    -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC;' 2>"$MIG_ERR_FILE")"; then
    ERR_DETAIL="$(tr '\n' ' ' <"$MIG_ERR_FILE" || true)"
    rm -f "$CANDIDATE_ENV" "$MIG_ERR_FILE"
    log_error "[ROLLBACK BLOCKED] Failed querying drizzle.__drizzle_migrations (${ERR_DETAIL}). Refusing blind rollback."
    exit 1
  fi
  rm -f "$MIG_ERR_FILE"

  if ! python3 "$RUNTIME_GUARDS" verify-db-migrations \
    --manifest "$TARGET_MANIFEST" \
    --mode rollback \
    --last-good "$LAST_GOOD" \
    --ledger "$LEDGER_FILE" <<<"$LIVE_MIG_ROWS"; then
    rm -f "$CANDIDATE_ENV"
    exit 1
  fi
fi

# 3. Pre-Cutover Ingress Check & Image Digest Pull
TMP_CADDY="${ENVSCALE_CONFIG_DIR}/Caddyfile.rollback.staged"
if [[ "$SKIP_INGRESS" != "true" ]]; then
  if ! stage_and_validate_caddy "$CANDIDATE_ENV" "$TMP_CADDY"; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    append_release_ledger "$ENVSCALE_STATE_DIR" "ROLLBACK_FAILED" "$TARGET_MANIFEST" \
      "Rollback pre-cutover ingress/Caddy validation failed"
    exit 1
  fi
fi

log_info "Pulling target digest-pinned application images..."
if ! docker compose --env-file "$CANDIDATE_ENV" -f "$COMPOSE_FILE" pull api-server k8s-streamer web; then
  rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
  append_release_ledger "$ENVSCALE_STATE_DIR" "ROLLBACK_FAILED" "$TARGET_MANIFEST" \
    "Failed pulling rollback @sha256 image digests"
  exit 1
fi

if [[ "$SKIP_INGRESS" != "true" ]]; then
  if ! promote_caddy_with_recovery "$TMP_CADDY"; then
    rm -f "$CANDIDATE_ENV" "$TMP_CADDY"
    append_release_ledger "$ENVSCALE_STATE_DIR" "ROLLBACK_FAILED" "$TARGET_MANIFEST" \
      "Rollback Caddy promotion failed; previous Caddyfile restored"
    exit 1
  fi
fi

write_atomic_0600 "$CANDIDATE_ENV" "$RENDERED_ENV"
rm -f "$CANDIDATE_ENV"

log_info "Replacing disposable application containers only (postgres & redis untouched)..."
ROLLBACK_UP_OK="true"
if ! docker compose --env-file "$RENDERED_ENV" -f "$COMPOSE_FILE" up -d --no-build --pull never --no-deps api-server k8s-streamer web; then
  ROLLBACK_UP_OK="false"
fi

if [[ "$ROLLBACK_UP_OK" == "true" ]] && "${SCRIPT_DIR}/verify.sh" --manifest "$TARGET_MANIFEST" --env-file "$RENDERED_ENV"; then
  python3 "$RUNTIME_GUARDS" rotate-release-pointers \
    --target-manifest "$TARGET_MANIFEST" \
    --last-good "$LAST_GOOD" \
    --prev-good "$PREV_GOOD"
  append_release_ledger "$ENVSCALE_STATE_DIR" "ROLLED_BACK_HEALTHY" "$TARGET_MANIFEST" \
    "Restored verified application digests (from_failed_deploy=${FROM_FAILED_DEPLOY})"
  log_info "Rollback to ${MANIFEST_RELEASE_ID} succeeded and passed all readiness checks."
  exit 0
else
  append_release_ledger "$ENVSCALE_STATE_DIR" "ROLLBACK_FAILED" "$TARGET_MANIFEST" \
    "Post-rollback verification failed"
  log_error "Rollback verification failed for ${MANIFEST_RELEASE_ID}!"
  exit 1
fi
