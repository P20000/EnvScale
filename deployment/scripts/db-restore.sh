#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Host PostgreSQL Restore & Reconstruction Verification Engine
# ==============================================================================
# Restores a PostgreSQL custom-format dump (.dump) into the live Docker Compose
# Postgres container, validates schema/tables/migrations/row counts, restarts
# stateless application services, and optionally runs verify.sh.
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deployment/scripts/runtime-common.sh
source "${SCRIPT_DIR}/runtime-common.sh"

S3_URI=""
BUCKET=""
KEY=""
LOCAL_FILE=""
AWS_REGION="${AWS_REGION:-ap-south-1}"
ENV_FILE="${ENVSCALE_CONFIG_DIR}/rendered.compose.env"
MANIFEST_PATH="${ENVSCALE_STATE_DIR}/releases/last-known-good.manifest.json"
EXPECTED_SHA256=""
VERIFY_TIMEOUT=60
SKIP_VERIFY="false"
LOCAL_SMOKE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --s3-uri)
      S3_URI="${2:-}"
      shift 2
      ;;
    --bucket)
      BUCKET="${2:-}"
      shift 2
      ;;
    --key)
      KEY="${2:-}"
      shift 2
      ;;
    --file)
      LOCAL_FILE="${2:-}"
      shift 2
      ;;
    --region)
      AWS_REGION="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --manifest)
      MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    --expected-sha256)
      EXPECTED_SHA256="$(tr '[:upper:]' '[:lower:]' <<<"${2:-}")"
      shift 2
      ;;
    --verify-timeout)
      VERIFY_TIMEOUT="${2:-60}"
      shift 2
      ;;
    --skip-verify)
      SKIP_VERIFY="true"
      shift
      ;;
    --local-smoke)
      LOCAL_SMOKE="true"
      shift
      ;;
    *)
      log_error "Unknown argument to db-restore.sh: $1"
      exit 1
      ;;
  esac
done

SRC_MODES=0
[[ -n "$S3_URI" ]] && ((SRC_MODES += 1))
[[ -n "$BUCKET" || -n "$KEY" ]] && ((SRC_MODES += 1))
[[ -n "$LOCAL_FILE" ]] && ((SRC_MODES += 1))

if (( SRC_MODES != 1 )); then
  log_error "Specify exactly one source: --s3-uri <s3://...>, --bucket <bkt> --key <key>, or --file <path>"
  exit 1
fi

if [[ -n "$S3_URI" ]]; then
  if [[ "$S3_URI" != s3://*/* ]]; then
    log_error "Invalid --s3-uri: ${S3_URI}"
    exit 1
  fi
  NO_SCHEME="${S3_URI#s3://}"
  BUCKET="${NO_SCHEME%%/*}"
  KEY="${NO_SCHEME#*/}"
fi

if [[ -n "$BUCKET" || -n "$KEY" ]]; then
  if [[ -z "$BUCKET" || "$KEY" != backups/postgres/*.dump ]]; then
    log_error "S3 restore target must use --bucket and a backups/postgres/*.dump --key (got s3://${BUCKET}/${KEY})"
    exit 1
  fi
  S3_URI="s3://${BUCKET}/${KEY}"
fi

if [[ -n "$EXPECTED_SHA256" ]] && ! [[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  log_error "--expected-sha256 must be a 64-char hex digest"
  exit 1
fi

if ! [[ "$VERIFY_TIMEOUT" =~ ^[0-9]+$ ]] || (( VERIFY_TIMEOUT < 5 )); then
  log_error "--verify-timeout must be an integer >= 5 (got: ${VERIFY_TIMEOUT})"
  exit 1
fi

if [[ "$LOCAL_SMOKE" != "true" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    log_error "Rendered Compose env file missing: ${ENV_FILE}"
    exit 1
  fi
  if [[ "$SKIP_VERIFY" != "true" && ! -f "$MANIFEST_PATH" ]]; then
    log_error "Release manifest missing: ${MANIFEST_PATH}"
    exit 1
  fi
fi

mkdir -p "$(dirname "$ENVSCALE_LOCK_FILE")" "${ENVSCALE_CONFIG_DIR}" "${ENVSCALE_STATE_DIR}/releases"
chmod 700 "${ENVSCALE_CONFIG_DIR}" "${ENVSCALE_STATE_DIR}" "${ENVSCALE_STATE_DIR}/releases" 2>/dev/null || true

exec 9>"$ENVSCALE_LOCK_FILE"
if ! flock -n 9; then
  log_error "Concurrent deployment/restore holds ${ENVSCALE_LOCK_FILE}. Aborting."
  exit 1
fi

RESTORE_COMPOSE_PROJECT_NAME="envscale"
RESTORE_POSTGRES_USER="envscale"
RESTORE_POSTGRES_DB="envscale"
if [[ -f "$ENV_FILE" ]]; then
  eval "$(emit_rendered_env_subset "$ENV_FILE" "RESTORE_" COMPOSE_PROJECT_NAME POSTGRES_USER POSTGRES_DB)"
  RESTORE_COMPOSE_PROJECT_NAME="${RESTORE_COMPOSE_PROJECT_NAME:-envscale}"
  RESTORE_POSTGRES_USER="${RESTORE_POSTGRES_USER:-envscale}"
  RESTORE_POSTGRES_DB="${RESTORE_POSTGRES_DB:-envscale}"
fi
PG_CONTAINER="${RESTORE_COMPOSE_PROJECT_NAME}-postgres"

TMP_DUMP="$(mktemp /tmp/envscale_pg_restore_XXXXXX.dump)"
TMP_TOC="${TMP_DUMP}.toc"
trap 'rm -f "$TMP_DUMP" "$TMP_TOC"' EXIT INT TERM

if [[ -n "$S3_URI" ]]; then
  SOURCE_LABEL="$S3_URI"
  if [[ -z "$EXPECTED_SHA256" ]]; then
    HEAD_JSON="$(aws s3api head-object --bucket "$BUCKET" --key "$KEY" --region "$AWS_REGION" --checksum-mode ENABLED --output json)" || {
      log_error "Failed inspecting S3 object metadata for ${S3_URI}"
      exit 1
    }
    EXPECTED_SHA256="$(python3 - "$HEAD_JSON" <<'PYEOF'
import base64, binascii, json, sys
doc = json.loads(sys.argv[1] or "{}")
chk_b64 = str(doc.get("ChecksumSHA256") or "").strip()
native_hex = ""
if chk_b64:
    if "-" in chk_b64:
        raise SystemExit("Composite multipart ChecksumSHA256 is not accepted.")
    try:
        raw = base64.b64decode(chk_b64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise SystemExit(f"Malformed Base64 ChecksumSHA256: {exc}")
    if len(raw) != 32 or base64.b64encode(raw).decode("ascii") != chk_b64:
        raise SystemExit("Invalid 32-byte ChecksumSHA256 digest length.")
    native_hex = raw.hex().lower()
meta = doc.get("Metadata") if isinstance(doc.get("Metadata"), dict) else {}
meta_sha = str(meta.get("sha256") or meta.get("SHA256") or "").strip().lower()
if native_hex and meta_sha and meta_sha != native_hex:
    raise SystemExit(f"Metadata.sha256 ({meta_sha}) disagrees with native ChecksumSHA256 ({native_hex}).")
if native_hex:
    print(native_hex)
elif len(meta_sha) == 64 and all(c in "0123456789abcdef" for c in meta_sha):
    print(meta_sha)
PYEOF
    )" || {
      log_error "S3 checksum metadata validation failed for ${S3_URI}"
      exit 1
    }
  fi
  log_info "Downloading PostgreSQL dump from ${S3_URI}..."
  if ! aws s3 cp "$S3_URI" "$TMP_DUMP" --region "$AWS_REGION"; then
    log_error "Failed downloading backup from ${S3_URI}"
    exit 1
  fi
else
  SOURCE_LABEL="$LOCAL_FILE"
  if [[ -L "$LOCAL_FILE" || ! -f "$LOCAL_FILE" ]]; then
    log_error "Backup file missing or symlinked: ${LOCAL_FILE}"
    exit 1
  fi
  cp -f "$LOCAL_FILE" "$TMP_DUMP"
fi

if [[ ! -s "$TMP_DUMP" ]]; then
  log_error "PostgreSQL dump is missing or empty (0 bytes): ${SOURCE_LABEL}"
  exit 1
fi
DUMP_SIZE="$(stat -c '%s' "$TMP_DUMP")"
DUMP_SHA256="$(sha256sum "$TMP_DUMP" | awk '{print $1}')"
if [[ -n "$EXPECTED_SHA256" && "$DUMP_SHA256" != "$EXPECTED_SHA256" ]]; then
  log_error "Dump SHA-256 mismatch: actual=${DUMP_SHA256} expected=${EXPECTED_SHA256}"
  exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null || echo false)" != "true" ]]; then
  log_error "PostgreSQL container '${PG_CONTAINER}' is not running."
  exit 1
fi
if ! docker exec "$PG_CONTAINER" pg_isready -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" >/dev/null 2>&1; then
  log_error "PostgreSQL database '${RESTORE_POSTGRES_DB}' failed pg_isready."
  exit 1
fi

log_info "Validating archive contents with pg_restore --list (size=${DUMP_SIZE}, sha256=${DUMP_SHA256:0:12})..."
if ! docker exec -i "$PG_CONTAINER" pg_restore --list < "$TMP_DUMP" > "$TMP_TOC"; then
  log_error "pg_restore --list failed; archive is corrupt or invalid."
  exit 1
fi
TOC_ENTRIES="$((grep -Ev '^[[:space:]]*(;|$)' "$TMP_TOC" || true) | wc -l | tr -d '[:space:]')"
if [[ -z "$TOC_ENTRIES" ]] || (( TOC_ENTRIES <= 0 )); then
  log_error "pg_restore --list found zero archive entries in ${SOURCE_LABEL}"
  exit 1
fi

APP_CONTAINERS_MANAGED="false"
if [[ -f "$ENV_FILE" && "$LOCAL_SMOKE" != "true" ]]; then
  APP_CONTAINERS_MANAGED="true"
  log_info "Stopping stateless application containers before restore..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api-server k8s-streamer web >/dev/null 2>&1 || true
fi

log_info "Terminating active DB connections to '${RESTORE_POSTGRES_DB}' and restoring archive..."
docker exec -i "$PG_CONTAINER" psql -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" -v ON_ERROR_STOP=1 >/dev/null <<'SQLEOF'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid();
SQLEOF

if ! docker exec -i "$PG_CONTAINER" pg_restore \
  --clean --if-exists --no-owner --no-privileges --exit-on-error \
  -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" < "$TMP_DUMP"; then
  log_error "pg_restore failed while restoring ${SOURCE_LABEL}"
  if [[ "$APP_CONTAINERS_MANAGED" == "true" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --pull never api-server k8s-streamer web >/dev/null 2>&1 || true
  fi
  exit 1
fi

TBL_COUNT="$(docker exec -i "$PG_CONTAINER" psql -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" -At -v ON_ERROR_STOP=1 <<'SQLEOF'
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'users','refresh_tokens','sessions','accounts','verifications','jwks',
    'workspaces','workspace_members','clusters','health_snapshots','alert_policies','incidents'
  );
SQLEOF
)"
TBL_COUNT="$(tr -d '[:space:]' <<<"$TBL_COUNT")"
if ! [[ "$TBL_COUNT" =~ ^[0-9]+$ ]] || (( TBL_COUNT != 12 )); then
  log_error "Post-restore schema validation failed: expected 12 canonical public tables, found ${TBL_COUNT:-0}"
  exit 1
fi

MIG_COUNT="$(docker exec "$PG_CONTAINER" psql -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM drizzle.__drizzle_migrations;" </dev/null)"
MIG_COUNT="$(tr -d '[:space:]' <<<"$MIG_COUNT")"
if ! [[ "$MIG_COUNT" =~ ^[0-9]+$ ]] || (( MIG_COUNT <= 0 )); then
  log_error "Post-restore migration validation failed: expected > 0 records in drizzle.__drizzle_migrations, found ${MIG_COUNT:-0}"
  exit 1
fi

ROW_COUNTS_JSON="$(docker exec -i "$PG_CONTAINER" psql -U "$RESTORE_POSTGRES_USER" -d "$RESTORE_POSTGRES_DB" -At -v ON_ERROR_STOP=1 <<'SQLEOF'
SELECT json_build_object(
  'users', (SELECT count(*) FROM public.users),
  'workspaces', (SELECT count(*) FROM public.workspaces),
  'clusters', (SELECT count(*) FROM public.clusters),
  'alert_policies', (SELECT count(*) FROM public.alert_policies),
  'incidents', (SELECT count(*) FROM public.incidents)
)::text;
SQLEOF
)"
ROW_COUNTS_JSON="$(tr -d '[:space:]' <<<"$ROW_COUNTS_JSON")"
[[ -z "$ROW_COUNTS_JSON" ]] && ROW_COUNTS_JSON="{}"

if [[ "$APP_CONTAINERS_MANAGED" == "true" ]]; then
  log_info "Running idempotent Drizzle migrations & restarting application containers..."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm --no-deps --pull never api-server node dist/db/migrate.js
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --pull never api-server k8s-streamer web
fi

VERIFY_PASSED="false"
if [[ "$SKIP_VERIFY" != "true" && "$LOCAL_SMOKE" != "true" ]]; then
  "${SCRIPT_DIR}/verify.sh" --manifest "$MANIFEST_PATH" --env-file "$ENV_FILE" --timeout "$VERIFY_TIMEOUT"
  VERIFY_PASSED="true"
fi

if [[ -f "$MANIFEST_PATH" ]]; then
  append_release_ledger "$ENVSCALE_STATE_DIR" "DB_RESTORED" "$MANIFEST_PATH" \
    "Restored PostgreSQL backup ${SOURCE_LABEL} (tables=${TBL_COUNT}/12, migrations=${MIG_COUNT})"
fi

python3 - "$SOURCE_LABEL" "$DUMP_SIZE" "$DUMP_SHA256" "$TOC_ENTRIES" "$TBL_COUNT" "${MIG_COUNT:-0}" "$ROW_COUNTS_JSON" "$VERIFY_PASSED" <<'PYEOF'
import json, sys
src, size_s, sha, toc_s, tbl_s, mig_s, rows_s, ver_s = sys.argv[1:9]
payload = {
    "source": src,
    "size": int(size_s),
    "sha256": sha,
    "toc_entries": int(toc_s),
    "canonical_tables": int(tbl_s),
    "migrations": int(mig_s),
    "row_counts": json.loads(rows_s) if rows_s else {},
    "verify_passed": ver_s == "true",
}
print("ENVSCALE_RESTORE_RESULT=" + json.dumps(payload, separators=(",", ":")))
PYEOF

