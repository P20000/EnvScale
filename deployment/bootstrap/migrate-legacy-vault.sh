#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Historical S3 Vault Backup Validator & Phase-3 Archiver
# ==============================================================================
# Security & Integrity Guarantees:
#   1. Enforces immutable Phase 1 approval contract (phase1-approved-backup.json):
#      AWS account 982534376726, S3 VersionId hBlNyXzLVfUE5UuHGZ.XkUIUp.RnNxCg,
#      byte size 28,383, and SHA-256 34911494ae4a634505e17956b4ec58c000a65d583f02c04715be34ad03f6a2a7.
#      Aborts immediately if the current S3 object head or version differs.
#   2. Enforces exact internal recovery bucket (envscale-recovery-982534376726-ap-south-1)
#      with zero CLI/env expected-bucket overrides, verifies STS caller identity,
#      and passes --expected-bucket-owner 982534376726 on EVERY S3 API call.
#   3. Restores BOTH the source SQL and the round-trip S3 database.dump (including
#      existing-object 412 retries) into separate airgapped PostgreSQL 16.15
#      containers (--network none) and compares full column schemas, row counts,
#      and deterministic per-table row-content digests before accepting.
#   4. NEVER touches backups/postgres/latest-valid.json.
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPROVAL_PIN_FILE="${SCRIPT_DIR}/phase1-approved-backup.json"
INSPECTOR="${SCRIPT_DIR}/legacy_vault_inspector.py"

# Immutable internal pins (no CLI or environment overrides permitted)
IMMUTABLE_AWS_ACCOUNT_ID="982534376726"
IMMUTABLE_AWS_REGION="ap-south-1"
IMMUTABLE_LEGACY_BUCKET="envscale-cloud-vault-982534376726-ap-south-1"
IMMUTABLE_LEGACY_KEY="database/backup_20261023_005151.sql"
IMMUTABLE_SOURCE_VERSION_ID="hBlNyXzLVfUE5UuHGZ.XkUIUp.RnNxCg"
IMMUTABLE_EXPECTED_SHA256="34911494ae4a634505e17956b4ec58c000a65d583f02c04715be34ad03f6a2a7"
IMMUTABLE_EXPECTED_RECOVERY_BUCKET="envscale-recovery-982534376726-ap-south-1"
PG_IMAGE="postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"

MODE=""
RECOVERY_BUCKET=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --validate-local             Read-only AWS verification + airgapped PG16 restore check
  --upload                     Validate locally, archive to recovery bucket, and restore-verify S3 dump
  --recovery-bucket <bucket>   Target recovery bucket (required for --upload; must equal ${IMMUTABLE_EXPECTED_RECOVERY_BUCKET})
  --help, -h                   Show this help message
EOF
}

validate_recovery_bucket_guard() {
  local rec="$1"
  if [[ -z "$rec" ]]; then
    echo "[FATAL] --upload requires --recovery-bucket ${IMMUTABLE_EXPECTED_RECOVERY_BUCKET}" >&2
    return 1
  fi
  if [[ "$rec" == "$IMMUTABLE_LEGACY_BUCKET" || "$rec" == *cloud-vault* || "$rec" == *tfstate* ]]; then
    echo "[FATAL] Recovery bucket '${rec}' matches a forbidden legacy-vault or tfstate bucket!" >&2
    return 1
  fi
  if [[ "$rec" != "$IMMUTABLE_EXPECTED_RECOVERY_BUCKET" ]]; then
    echo "[FATAL] Recovery bucket '${rec}' != immutable account recovery bucket '${IMMUTABLE_EXPECTED_RECOVERY_BUCKET}'." >&2
    return 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate-local) [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }; MODE="validate-local"; shift ;;
    --upload) [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }; MODE="upload"; shift ;;
    --recovery-bucket) RECOVERY_BUCKET="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[ERROR] Unknown or disallowed argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "[ERROR] Missing required mode: --validate-local or --upload" >&2
  usage >&2
  exit 1
fi

if [[ "$MODE" == "upload" ]]; then
  validate_recovery_bucket_guard "$RECOVERY_BUCKET"
fi

for cmd in aws docker sha256sum python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[ERROR] Missing required tool: $cmd" >&2
    exit 1
  fi
done

python3 "$INSPECTOR" verify-approval-pin "$APPROVAL_PIN_FILE"

TMP_WORKDIR="$(mktemp -d -t envscale-legacy-verify-XXXXXX)"
chmod 700 "$TMP_WORKDIR"
CONTAINER_SQL="envscale-legacy-sql-$$"
CONTAINER_DUMP="envscale-legacy-dump-$$"

cleanup() {
  local exit_code=$?
  for cname in "$CONTAINER_SQL" "$CONTAINER_DUMP"; do
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -Fxq "$cname"; then
      docker rm -f "$cname" >/dev/null 2>&1 || true
    fi
  done
  if [[ -n "${TMP_WORKDIR:-}" && -d "$TMP_WORKDIR" ]]; then
    rm -rf "$TMP_WORKDIR"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

start_airgapped_pg() {
  local cname="$1"
  local dbname="$2"
  local pg_pass
  pg_pass="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"

  docker run -d \
    --name "$cname" \
    --network none \
    --tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m \
    -e "POSTGRES_USER=envscale" \
    -e "POSTGRES_PASSWORD=${pg_pass}" \
    -e "POSTGRES_DB=postgres" \
    "$PG_IMAGE" >/dev/null

  local ready="false"
  for _ in $(seq 1 30); do
    if docker exec "$cname" pg_isready -U envscale -d postgres >/dev/null 2>&1; then
      ready="true"
      break
    fi
    sleep 1
  done
  if [[ "$ready" != "true" ]]; then
    echo "[FATAL] Disposable PostgreSQL 16 container (${cname}) failed readiness check." >&2
    return 1
  fi

  docker exec "$cname" psql -U envscale -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE ${dbname};" >/dev/null
}

extract_pg_baseline() {
  local cname="$1"
  local dbname="$2"
  local out_prefix="$3"

  docker exec -i "$cname" psql -q -U envscale -d "$dbname" -AtF $'\t' -v ON_ERROR_STOP=1 <<'SQLEOF' >"${out_prefix}.rows.tsv"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT
  schemaname,
  tablename,
  (xpath('/row/cnt/text()', query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint AS row_count
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  AND schemaname NOT LIKE 'pg_toast%'
  AND schemaname NOT LIKE 'pg_temp%'
ORDER BY schemaname, tablename;
COMMIT;
SQLEOF

  docker exec -i "$cname" psql -q -U envscale -d "$dbname" -AtF $'\t' -v ON_ERROR_STOP=1 <<'SQLEOF' >"${out_prefix}.cols.tsv"
SELECT
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_schema NOT LIKE 'pg_toast%'
  AND table_schema NOT LIKE 'pg_temp%'
ORDER BY table_schema, table_name, ordinal_position;
SQLEOF

  docker exec -i "$cname" psql -q -U envscale -d "$dbname" -AtF $'\t' -v ON_ERROR_STOP=1 <<'SQLEOF' >"${out_prefix}.hashes.tsv"
CREATE TEMP TABLE _envscale_tbl_hashes (schemaname text, tablename text, content_md5 text);
DO $$
DECLARE
  r record;
  d text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      AND schemaname NOT LIKE 'pg_toast%'
      AND schemaname NOT LIKE 'pg_temp%'
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format(
      'SELECT COALESCE(md5(string_agg(row_md5, '','' ORDER BY row_md5)), ''empty'') FROM (SELECT md5(to_jsonb(t)::text) AS row_md5 FROM %I.%I AS t) s',
      r.schemaname, r.tablename
    ) INTO d;
    INSERT INTO _envscale_tbl_hashes VALUES (r.schemaname, r.tablename, d);
  END LOOP;
END $$;
SELECT schemaname, tablename, content_md5 FROM _envscale_tbl_hashes ORDER BY schemaname, tablename;
SQLEOF
}

echo "[1/6] Verifying AWS caller identity & bucket ownership for account ${IMMUTABLE_AWS_ACCOUNT_ID}..."
STS_JSON="${TMP_WORKDIR}/sts_identity.json"
aws sts get-caller-identity --output json >"$STS_JSON"
if [[ "$MODE" == "upload" ]]; then
  ROLE_JSON="${TMP_WORKDIR}/admin_role.json"
  aws iam get-role --role-name "envscale-foundation-admin-role" --output json >"$ROLE_JSON"
  python3 "$INSPECTOR" verify-foundation-admin-mfa "$STS_JSON" "$ROLE_JSON"
else
  python3 "$INSPECTOR" verify-aws-identity "$STS_JSON"
fi

aws s3api head-bucket \
  --bucket "$IMMUTABLE_LEGACY_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" >/dev/null

if [[ "$MODE" == "upload" ]]; then
  aws s3api head-bucket \
    --bucket "$RECOVERY_BUCKET" \
    --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" >/dev/null
  REC_LOC_JSON="${TMP_WORKDIR}/recovery_location.json"
  aws s3api get-bucket-location \
    --bucket "$RECOVERY_BUCKET" \
    --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --output json >"$REC_LOC_JSON"
  python3 "$INSPECTOR" verify-bucket-location "$REC_LOC_JSON" "$RECOVERY_BUCKET"
  echo "      Recovery Bucket   : s3://${RECOVERY_BUCKET} (owner=${IMMUTABLE_AWS_ACCOUNT_ID}, region=${IMMUTABLE_AWS_REGION})"
fi

echo "[2/6] Downloading & verifying Phase 1-approved historical SQL artifact (VersionId=${IMMUTABLE_SOURCE_VERSION_ID})..."
SQL_FILE="${TMP_WORKDIR}/historical.sql"
HEAD_JSON="${TMP_WORKDIR}/s3_head.json"
GET_JSON="${TMP_WORKDIR}/s3_get.json"

aws s3api head-object \
  --bucket "$IMMUTABLE_LEGACY_BUCKET" \
  --key "$IMMUTABLE_LEGACY_KEY" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --output json >"$HEAD_JSON"

aws s3api get-object \
  --bucket "$IMMUTABLE_LEGACY_BUCKET" \
  --key "$IMMUTABLE_LEGACY_KEY" \
  --version-id "$IMMUTABLE_SOURCE_VERSION_ID" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --output json "$SQL_FILE" >"$GET_JSON"
chmod 600 "$SQL_FILE" "$HEAD_JSON" "$GET_JSON"

read -r ARCHIVE_TS_UTC ARCHIVE_TS_SOURCE S3_LAST_MOD_UTC KEY_CONV_UTC BYTE_SIZE SHA256_HEX < <(
  python3 "$INSPECTOR" verify-source-object "$HEAD_JSON" "$GET_JSON" "$SQL_FILE"
)

echo "      Byte Size         : ${BYTE_SIZE} bytes (matches Phase 1 pin)"
echo "      S3 VersionId      : ${IMMUTABLE_SOURCE_VERSION_ID} (matches Phase 1 pin)"
echo "      S3 LastModified   : ${S3_LAST_MOD_UTC}"
echo "      Key IST -> UTC    : ${KEY_CONV_UTC} (Asia/Kolkata converted)"
echo "      SHA-256           : ${SHA256_HEX} (matches Phase 1 pin)"
echo "      Archive Timestamp : ${ARCHIVE_TS_UTC} (from ${ARCHIVE_TS_SOURCE})"

echo "[3/6] Inspecting plain-SQL structural integrity (redacting all row payloads)..."
python3 "$INSPECTOR" inspect-sql "$SQL_FILE"

echo "[4/6] Restoring plain-SQL dump into airgapped PostgreSQL 16.15 container #1 (--network none)..."
start_airgapped_pg "$CONTAINER_SQL" "envscale_verify_sql"

PSQL_ERR="${TMP_WORKDIR}/psql_err.log"
if ! docker exec -i "$CONTAINER_SQL" psql \
  -U envscale \
  -d envscale_verify_sql \
  -v ON_ERROR_STOP=1 \
  --quiet <"$SQL_FILE" >/dev/null 2>"$PSQL_ERR"; then
  echo "[FATAL] Plain-SQL restore failed in PostgreSQL 16!" >&2
  grep -E '^(ERROR|LINE [0-9]+):' "$PSQL_ERR" | head -n 10 >&2 || true
  exit 1
fi
echo "      SQL Restore Status: 0 (CLEAN)"
KUBE_AUDIT="$(docker exec -i "$CONTAINER_SQL" psql -q -U envscale -d envscale_verify_sql -AtF $'\t' -v ON_ERROR_STOP=1 -c "SELECT count(*), count(*) FILTER (WHERE kubeconfig IS NOT NULL AND btrim(kubeconfig) <> ''), COALESCE(string_agg(COALESCE(metadata->>'connectionMode', 'unknown'), ',' ORDER BY id::text), 'none') FROM public.clusters;")"
IFS=$'\t' read -r CLUSTERS_TOTAL CLUSTERS_CIPHERTEXT CLUSTERS_MODES <<<"$KUBE_AUDIT"
echo "      Kubeconfig Audit  : ${CLUSTERS_CIPHERTEXT}/${CLUSTERS_TOTAL} clusters hold encrypted kubeconfig ciphertext (modes=${CLUSTERS_MODES})"

echo "[5/6] Extracting schema, row-count, and row-content digests + custom-format (-Fc) conversion..."
LOCAL_BASE="${TMP_WORKDIR}/local_sql"
extract_pg_baseline "$CONTAINER_SQL" "envscale_verify_sql" "$LOCAL_BASE"

DUMP_FILE="${TMP_WORKDIR}/converted.dump"
TOC_FILE="${TMP_WORKDIR}/converted.toc"
docker exec "$CONTAINER_SQL" pg_dump \
  -U envscale \
  -d envscale_verify_sql \
  -Fc -Z 6 --no-owner --no-privileges >"$DUMP_FILE"
chmod 600 "$DUMP_FILE"

DUMP_BYTES="$(stat -c%s "$DUMP_FILE")"
if (( DUMP_BYTES <= 0 )); then
  echo "[FATAL] Converted custom-format dump is 0 bytes!" >&2
  exit 1
fi

if ! docker exec -i "$CONTAINER_SQL" pg_restore --list <"$DUMP_FILE" >"$TOC_FILE"; then
  echo "[FATAL] pg_restore --list failed to inspect converted custom-format dump!" >&2
  exit 1
fi
TOC_COUNT="$(grep -Ec '^[0-9]+;' "$TOC_FILE" || true)"
if (( TOC_COUNT <= 0 )); then
  echo "[FATAL] pg_restore TOC contains zero entries!" >&2
  exit 1
fi
DUMP_SHA256="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
echo "      Converted -Fc Size: ${DUMP_BYTES} bytes (TOC entries: ${TOC_COUNT})"
echo "      Converted SHA-256 : ${DUMP_SHA256}"

echo "[6/6] Building restore-verified historical manifest..."
MANIFEST_FILE="${TMP_WORKDIR}/historical-verified.manifest.json"
python3 "$INSPECTOR" build-manifest \
  "${LOCAL_BASE}.rows.tsv" \
  "${LOCAL_BASE}.cols.tsv" \
  "${LOCAL_BASE}.hashes.tsv" \
  "$MANIFEST_FILE" \
  "$S3_LAST_MOD_UTC" \
  "$DUMP_BYTES" \
  "$DUMP_SHA256" \
  "$TOC_COUNT" \
  "$ARCHIVE_TS_UTC" \
  "$ARCHIVE_TS_SOURCE"

if [[ "$MODE" == "validate-local" ]]; then
  echo "[SUCCESS] Local read-only validation complete. Phase 1 artifact verified; zero S3 writes executed."
  exit 0
fi

# ------------------------------------------------------------------------------
# Phase 3+ Only: No-Overwrite S3 Upload + Full Isolated Restore Verification
# ------------------------------------------------------------------------------
ARCHIVE_PREFIX="backups/historical/${ARCHIVE_TS_UTC}-${IMMUTABLE_EXPECTED_SHA256}"
echo "[UPLOAD] Archiving verified historical assets to s3://${RECOVERY_BUCKET}/${ARCHIVE_PREFIX}/..."

LAST_PUT_STATE=""
put_no_overwrite() {
  local local_file="$1" target_key="$2" content_type="$3"
  local err_out="${TMP_WORKDIR}/put_err.txt"
  for attempt in 1 2 3; do
    if aws s3api put-object \
      --bucket "$RECOVERY_BUCKET" \
      --key "$target_key" \
      --body "$local_file" \
      --content-type "$content_type" \
      --server-side-encryption AES256 \
      --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
      --if-none-match "*" >/dev/null 2>"$err_out"; then
      LAST_PUT_STATE="UPLOADED"
      return 0
    fi
    if grep -Eq "PreconditionFailed|412" "$err_out"; then
      echo "      [SKIP-VERIFY] Existing object at s3://${RECOVERY_BUCKET}/${target_key}; running full restore check."
      LAST_PUT_STATE="EXISTING_412"
      return 0
    fi
    if grep -Eq "ConditionalRequestConflict|409" "$err_out" && [[ "$attempt" -lt 3 ]]; then
      sleep "$attempt"
      continue
    fi
    cat "$err_out" >&2
    return 1
  done
  return 1
}

put_no_overwrite "$SQL_FILE" "${ARCHIVE_PREFIX}/original.sql" "application/sql"
put_no_overwrite "$DUMP_FILE" "${ARCHIVE_PREFIX}/database.dump" "application/octet-stream"
DUMP_PUT_STATE="$LAST_PUT_STATE"

# Download S3 database.dump and perform a FULL isolated PostgreSQL 16 restore
# into a fresh second container BEFORE accepting or binding manifest metadata.
DL_DUMP="${TMP_WORKDIR}/roundtrip_database.dump"
aws s3api get-object \
  --bucket "$RECOVERY_BUCKET" \
  --key "${ARCHIVE_PREFIX}/database.dump" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  "$DL_DUMP" >/dev/null
chmod 600 "$DL_DUMP"

S3_DUMP_SHA="$(sha256sum "$DL_DUMP" | awk '{print $1}')"
S3_DUMP_BYTES="$(stat -c%s "$DL_DUMP")"
if [[ "$DUMP_PUT_STATE" == "UPLOADED" && "$S3_DUMP_SHA" != "$DUMP_SHA256" ]]; then
  echo "[FATAL] Newly uploaded database.dump SHA-256 mismatch (${S3_DUMP_SHA} != ${DUMP_SHA256})!" >&2
  exit 1
fi

S3_TOC_OUT="${TMP_WORKDIR}/roundtrip.toc"
if ! docker exec -i "$CONTAINER_SQL" pg_restore --list <"$DL_DUMP" >"$S3_TOC_OUT"; then
  echo "[FATAL] S3 database.dump failed pg_restore --list inspection!" >&2
  exit 1
fi
S3_TOC_COUNT="$(grep -Ec '^[0-9]+;' "$S3_TOC_OUT" || true)"
if (( S3_TOC_COUNT <= 0 )); then
  echo "[FATAL] S3 database.dump TOC contains zero entries!" >&2
  exit 1
fi

echo "      Restoring downloaded S3 database.dump into fresh airgapped PostgreSQL 16.15 container #2..."
start_airgapped_pg "$CONTAINER_DUMP" "envscale_verify_s3_dump"
if ! docker exec -i "$CONTAINER_DUMP" pg_restore \
  -U envscale \
  -d envscale_verify_s3_dump \
  --exit-on-error \
  --no-owner \
  --no-privileges <"$DL_DUMP" >/dev/null; then
  echo "[FATAL] Isolated PostgreSQL 16 pg_restore failed on S3 database.dump!" >&2
  exit 1
fi

S3_DUMP_BASE="${TMP_WORKDIR}/s3_dump"
extract_pg_baseline "$CONTAINER_DUMP" "envscale_verify_s3_dump" "$S3_DUMP_BASE"
python3 "$INSPECTOR" compare-dump-restore \
  "${LOCAL_BASE}.rows.tsv" "${LOCAL_BASE}.cols.tsv" "${LOCAL_BASE}.hashes.tsv" \
  "${S3_DUMP_BASE}.rows.tsv" "${S3_DUMP_BASE}.cols.tsv" "${S3_DUMP_BASE}.hashes.tsv"
echo "      [VERIFIED] Restored S3 database.dump matches Phase 1 schema, row counts, and row-data digests."

if [[ "$DUMP_PUT_STATE" == "EXISTING_412" ]]; then
  python3 - "$MANIFEST_FILE" "$S3_DUMP_BYTES" "$S3_DUMP_SHA" "$S3_TOC_COUNT" <<'PYEOF'
import json, pathlib, sys
mp = pathlib.Path(sys.argv[1])
m = json.loads(mp.read_text(encoding="utf-8"))
m["converted_dump"] = {
    "format": "pg_custom_fc",
    "byte_size": int(sys.argv[2]),
    "sha256": sys.argv[3],
    "toc_entries": int(sys.argv[4]),
}
mp.write_text(json.dumps(m, indent=2), encoding="utf-8")
PYEOF
fi

MANIFEST_SHA256="$(sha256sum "$MANIFEST_FILE" | awk '{print $1}')"
put_no_overwrite "$MANIFEST_FILE" "${ARCHIVE_PREFIX}/historical-verified.manifest.json" "application/json"
MANIFEST_PUT_STATE="$LAST_PUT_STATE"

DL_SQL="${TMP_WORKDIR}/roundtrip_original.sql"
DL_MAN="${TMP_WORKDIR}/roundtrip_manifest.json"
aws s3api get-object \
  --bucket "$RECOVERY_BUCKET" \
  --key "${ARCHIVE_PREFIX}/original.sql" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  "$DL_SQL" >/dev/null
aws s3api get-object \
  --bucket "$RECOVERY_BUCKET" \
  --key "${ARCHIVE_PREFIX}/historical-verified.manifest.json" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  "$DL_MAN" >/dev/null
chmod 600 "$DL_SQL" "$DL_MAN"

S3_SQL_SHA="$(sha256sum "$DL_SQL" | awk '{print $1}')"
S3_MAN_SHA="$(sha256sum "$DL_MAN" | awk '{print $1}')"
if [[ "$MANIFEST_PUT_STATE" == "UPLOADED" && "$S3_MAN_SHA" != "$MANIFEST_SHA256" ]]; then
  echo "[FATAL] Newly uploaded manifest SHA-256 mismatch (${S3_MAN_SHA} != ${MANIFEST_SHA256})!" >&2
  exit 1
fi

python3 "$INSPECTOR" verify-roundtrip-manifest \
  "$DL_MAN" "$MANIFEST_FILE" "$S3_SQL_SHA" "$S3_DUMP_SHA" "$S3_DUMP_BYTES" "$S3_TOC_COUNT"

echo "      [VERIFIED] original.sql SHA-256 matches Phase 1 pin (${S3_SQL_SHA})"
echo "      [VERIFIED] database.dump isolated restore & SHA-256 match (${S3_DUMP_SHA}, toc=${S3_TOC_COUNT})"
echo "      [VERIFIED] historical-verified.manifest.json verified (${S3_MAN_SHA})"
echo "[SUCCESS] Historical backup archived and all 3 objects verified at s3://${RECOVERY_BUCKET}/${ARCHIVE_PREFIX}/"
echo "[NOTICE] backups/postgres/latest-valid.json was intentionally NOT modified."
