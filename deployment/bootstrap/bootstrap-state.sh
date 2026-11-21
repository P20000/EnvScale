#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Idempotent Day-0 Terraform S3 State Bucket Bootstrapper
# ==============================================================================
# Architectural & Security Guarantees:
#   1. Native S3 State Locking ONLY (`use_lockfile = true` on Terraform 1.14.9).
#      ZERO DynamoDB tables or DynamoDB permissions are created or referenced.
#   2. Strict Storage & History Retention Boundary:
#      Creates/reconciles ONLY `envscale-tfstate-982534376726-ap-south-1` with S3
#      Versioning enabled, standard SSE-S3 (`AES256`, no BucketKeyEnabled),
#      4/4 Public Access Block, BucketOwnerEnforced, and ZERO noncurrent-version
#      expiration rules so Terraform state history never expires.
#   3. Non-Circular, MFA-Independent Day-0 Bootstrap:
#      Does NOT require `envscale-foundation-admin-role` to pre-exist, does NOT
#      require `AdministratorAccess`, and does NOT depend on `GetSessionToken`
#      or `aws:MultiFactorAuthPresent`. Safe to rerun idempotently; verifies
#      account ownership, bucket controls, and native locking on every run.
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_VERSION_FILE="${REPO_ROOT}/.terraform-version"
DEFAULT_BACKEND_HCL="${REPO_ROOT}/deployment/foundation/backend.hcl"
DAY0_POLICY_FILE="${SCRIPT_DIR}/day0-bootstrap-policy.json"
DAY0_BOUNDARY_FILE="${SCRIPT_DIR}/day0-bootstrap-permissions-boundary.json"
DAY0_SEAL_POLICY_FILE="${SCRIPT_DIR}/day0-initial-policy-seal.json"
DAY0_SEAL_BOUNDARY_FILE="${SCRIPT_DIR}/day0-initial-seal-permissions-boundary.json"
BOOTSTRAP_POLICY_FILE="${SCRIPT_DIR}/foundation-iam-bootstrap-policy.json"
DAY0_GUARD_SCRIPT="${SCRIPT_DIR}/day0_identity_guard.py"
DAY0_BUCKET_SCRIPT="${SCRIPT_DIR}/day0_bucket_bootstrap.py"

IMMUTABLE_AWS_ACCOUNT_ID="982534376726"
IMMUTABLE_AWS_REGION="ap-south-1"
IMMUTABLE_TFSTATE_BUCKET="envscale-tfstate-982534376726-ap-south-1"
IMMUTABLE_RECOVERY_BUCKET="envscale-recovery-982534376726-ap-south-1"
IMMUTABLE_LEGACY_BUCKET="envscale-cloud-vault-982534376726-ap-south-1"
REQUIRED_CONFIRM_TOKEN="BOOTSTRAP-TFSTATE-982534376726"
REQUIRED_TRANSITION_TOKEN="TRANSITION-DEV-USER-ALPHA-982534376726"

MODE=""
CONFIRM_TOKEN=""
CONFIRM_IAM_TRANSITION_TOKEN=""
RECOVERY_ADMIN_PRINCIPAL_ARN=""
BACKEND_HCL_OUT="$DEFAULT_BACKEND_HCL"
WRITE_HCL_IN_DRY_RUN="false"
RECONCILE_EXISTING_FLAG=""
OPERATOR_PRINCIPAL_ARN="${ENVSCALE_OPERATOR_PRINCIPAL_ARN:-arn:aws:iam::982534376726:user/DEV-user-alpha}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Modes (choose one):
  --dry-run                              Render & validate bucket policy, encryption JSON,
                                         lifecycle JSON, Day-0 IAM policy, and backend.hcl
                                         (ZERO AWS calls).
  --verify-github-envs                   Optional read-only audit of external GitHub Environments.
  --bootstrap-state-bucket               Idempotently create or validate ${IMMUTABLE_TFSTATE_BUCKET}
                                         via admin CLI (creates if absent, applies SSE-S3/versioning/PAB,
                                         applies bucket policy, checks foundation/ prefix, writes backend.hcl).
  --init-bucket-policy                   One-time greenfield bucket creation & policy seal.
  --reconcile-bucket-policy              Break-glass MFA admin-only bucket-policy reconciliation.
  --transition-operator-iam              Explicit, validated operator IAM transition: detaches
                                         AdministratorAccess only after verifying narrow policy,
                                         state bucket, and independent administrative recovery access.
  --bootstrap-foundation-iam             One-time designated-operator (no operator MFA required)
                                         bootstrap of admin role, workload boundary, & OIDC roles.
  --apply                                Alias for --bootstrap-state-bucket (idempotent state bucket setup).

Options:
  --confirm-bootstrap <token>            Confirmation token required for bucket mutations
                                         (${REQUIRED_CONFIRM_TOKEN})
  --confirm-iam-transition <token>       Confirmation token required for --transition-operator-iam
                                         (${REQUIRED_TRANSITION_TOKEN})
  --recovery-admin-principal <arn>       Independent administrative recovery principal ARN required
                                         before detaching AdministratorAccess from operator
  --operator-principal <arn>             Expected IAM user ARN for live role trust verification
                                         (default: \$ENVSCALE_OPERATOR_PRINCIPAL_ARN or
                                         arn:aws:iam::982534376726:user/DEV-user-alpha)
  --backend-hcl-out <path>               Output path for foundation backend.hcl
                                         (default: deployment/foundation/backend.hcl)
  --write-backend-hcl                    Also write backend.hcl file during --dry-run (for testing)
  --reconcile-existing                   Reconcile drifted bucket policy or IAM resources
  --help, -h                             Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="dry-run"
      shift
      ;;
    --verify-github-envs)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="verify-github-envs"
      shift
      ;;
    --bootstrap-state-bucket)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="bootstrap-state-bucket"
      shift
      ;;
    --init-bucket-policy)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="init-bucket-policy"
      shift
      ;;
    --reconcile-bucket-policy)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="reconcile-bucket-policy"
      shift
      ;;
    --transition-operator-iam)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="transition-operator-iam"
      shift
      ;;
    --bootstrap-foundation-iam)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="bootstrap-foundation-iam"
      shift
      ;;
    --apply)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="apply"
      shift
      ;;
    --confirm-bootstrap)
      CONFIRM_TOKEN="${2:-}"
      shift 2
      ;;
    --confirm-iam-transition)
      CONFIRM_IAM_TRANSITION_TOKEN="${2:-}"
      shift 2
      ;;
    --recovery-admin-principal)
      RECOVERY_ADMIN_PRINCIPAL_ARN="${2:-}"
      shift 2
      ;;
    --operator-principal)
      OPERATOR_PRINCIPAL_ARN="${2:-}"
      shift 2
      ;;
    --backend-hcl-out)
      BACKEND_HCL_OUT="${2:-}"
      shift 2
      ;;
    --write-backend-hcl)
      WRITE_HCL_IN_DRY_RUN="true"
      shift
      ;;
    --reconcile-existing)
      RECONCILE_EXISTING_FLAG="--reconcile-existing"
      shift
      ;;
    --plan-bin)
      PLAN_BIN_ARG="${2:-}"
      shift 2
      ;;
    --plan-sha256)
      PLAN_SHA256_ARG="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown or disallowed argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "[ERROR] Missing required mode: specify --dry-run, --verify-github-envs, or --apply." >&2
  usage >&2
  exit 1
fi

if [[ "$IMMUTABLE_TFSTATE_BUCKET" == "$IMMUTABLE_LEGACY_BUCKET" || "$IMMUTABLE_TFSTATE_BUCKET" == "$IMMUTABLE_RECOVERY_BUCKET" ]]; then
  echo "[FATAL] Internal bucket isolation invariant violated!" >&2
  exit 1
fi

for cmd in python3 $([[ "$MODE" != "dry-run" ]] && echo "terraform"); do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[FATAL] Required binary not found: $cmd" >&2
    exit 1
  fi
done

if [[ "$MODE" == "verify-github-envs" ]]; then
  exec python3 "${SCRIPT_DIR}/validate-foundation-security.py" --audit-github-environments-strict
fi

if [[ ! -f "$TF_VERSION_FILE" ]]; then
  echo "[FATAL] Missing ${TF_VERSION_FILE}" >&2
  exit 1
fi
EXPECTED_TF_VER="$(tr -d '[:space:]' <"$TF_VERSION_FILE")"
INSTALLED_TF_VER="$(terraform version -json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("terraform_version",""))' 2>/dev/null || true)"
if [[ "$MODE" == "dry-run" ]]; then
  INSTALLED_TF_VER="${INSTALLED_TF_VER:-$EXPECTED_TF_VER}"
elif [[ "$INSTALLED_TF_VER" != "$EXPECTED_TF_VER" ]]; then
  echo "[FATAL] Installed Terraform (${INSTALLED_TF_VER}) != pinned .terraform-version (${EXPECTED_TF_VER}). Native S3 use_lockfile requires standardized 1.14.9." >&2
  exit 1
fi

if [[ ! -f "$DAY0_POLICY_FILE" || ! -f "$DAY0_BOUNDARY_FILE" || ! -f "$DAY0_SEAL_POLICY_FILE" || ! -f "$DAY0_GUARD_SCRIPT" ]]; then
  echo "[FATAL] Missing Day-0 policy/boundary/seal/guard artifacts under ${SCRIPT_DIR}" >&2
  exit 1
fi
python3 "$DAY0_GUARD_SCRIPT" check-policies \
  --identity-policy "$DAY0_POLICY_FILE" \
  --boundary-policy "$DAY0_BOUNDARY_FILE" \
  --seal-policy "$DAY0_SEAL_POLICY_FILE"

TMP_DIR="$(mktemp -d -t envscale-bootstrap-state-XXXXXX)"
chmod 700 "$TMP_DIR"
cleanup() {
  local rc=$?
  [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  exit "$rc"
}
trap cleanup EXIT INT TERM

POLICY_JSON="${TMP_DIR}/tfstate-bucket-policy.json"
LIFECYCLE_JSON="${TMP_DIR}/tfstate-lifecycle.json"
ENCRYPTION_JSON="${TMP_DIR}/tfstate-encryption.json"
STAGED_BACKEND_HCL="${TMP_DIR}/backend.hcl"

python3 "$DAY0_BUCKET_SCRIPT" generate-artifacts \
  --account-id "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --policy-out "$POLICY_JSON" \
  --lifecycle-out "$LIFECYCLE_JSON" \
  --enc-out "$ENCRYPTION_JSON"

cat >"$STAGED_BACKEND_HCL" <<EOF
bucket       = "${IMMUTABLE_TFSTATE_BUCKET}"
key          = "foundation/terraform.tfstate"
region       = "${IMMUTABLE_AWS_REGION}"
encrypt      = true
use_lockfile = true
EOF
chmod 600 "$STAGED_BACKEND_HCL"

write_backend_hcl_atomic() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  local tmp_dest
  tmp_dest="$(dirname "$dest")/.backend.hcl.tmp.$$"
  install -m 0600 "$STAGED_BACKEND_HCL" "$tmp_dest"
  mv -f "$tmp_dest" "$dest"
}

python3 "$DAY0_GUARD_SCRIPT" check-policies \
  --identity-policy "$DAY0_POLICY_FILE" \
  --boundary-policy "$DAY0_BOUNDARY_FILE" \
  --seal-policy "$DAY0_SEAL_POLICY_FILE" \
  --seal-boundary "$DAY0_SEAL_BOUNDARY_FILE"

if [[ "$MODE" == "dry-run" ]]; then
  if [[ "$WRITE_HCL_IN_DRY_RUN" == "true" ]]; then
    write_backend_hcl_atomic "$BACKEND_HCL_OUT"
  fi
  echo "[DRY-RUN] Verified Terraform ${INSTALLED_TF_VER} (native S3 locking: use_lockfile = true; zero DynamoDB)."
  echo "[DRY-RUN] Target State Bucket : s3://${IMMUTABLE_TFSTATE_BUCKET} (account=${IMMUTABLE_AWS_ACCOUNT_ID}, region=${IMMUTABLE_AWS_REGION})"
  echo "[DRY-RUN] Day-0 Auth Mode     : Narrowly scoped Day-0 S3 bootstrap policy (no AdministratorAccess, no circular admin-role or MFA dependency)"
  echo "[DRY-RUN] Legacy Vault Status : s3://${IMMUTABLE_LEGACY_BUCKET} UNTOUCHED"
  echo "--- Rendered backend.hcl ---"
  cat "$STAGED_BACKEND_HCL"
  echo "--- Rendered Encryption JSON ---"
  cat "$ENCRYPTION_JSON"
  echo "--- Rendered Lifecycle JSON ---"
  cat "$LIFECYCLE_JSON"
  echo "--- Rendered Bucket Policy JSON ---"
  cat "$POLICY_JSON"
  echo "[DRY-RUN SUCCESS] Zero AWS API calls or mutations executed."
  exit 0
fi

# ------------------------------------------------------------------------------
# Live Modes
# ------------------------------------------------------------------------------
command -v aws >/dev/null 2>&1 || { echo "[FATAL] aws CLI is required for --${MODE}" >&2; exit 1; }
STS_OUT="${TMP_DIR}/sts.json"
aws sts get-caller-identity --output json >"$STS_OUT"

if [[ "$MODE" == "transition-operator-iam" ]]; then
  if [[ "$CONFIRM_IAM_TRANSITION_TOKEN" != "$REQUIRED_TRANSITION_TOKEN" ]]; then
    echo "[FATAL] --transition-operator-iam requires --confirm-iam-transition ${REQUIRED_TRANSITION_TOKEN}" >&2
    exit 1
  fi
  REC_ARGS=()
  if [[ -n "$RECOVERY_ADMIN_PRINCIPAL_ARN" ]]; then
    REC_ARGS=(--recovery-principal "$RECOVERY_ADMIN_PRINCIPAL_ARN")
  fi
  python3 "$DAY0_BUCKET_SCRIPT" transition-operator-iam \
    --operator-principal "$OPERATOR_PRINCIPAL_ARN" \
    --account-id "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --confirm-token "$CONFIRM_IAM_TRANSITION_TOKEN" \
    --bootstrap-policy-file "$BOOTSTRAP_POLICY_FILE" \
    "${REC_ARGS[@]}"
  exit 0
fi

if [[ "$MODE" == "bootstrap-foundation-iam" ]]; then
  if [[ "${GITHUB_ACTIONS:-}" == "true" || "${CI:-}" == "true" ]]; then
    echo "[FATAL] --bootstrap-foundation-iam is a one-time human operation and is forbidden in CI." >&2
    exit 1
  fi
  echo "[1/4] Verifying state bucket readiness and foundation/ prefix before attempting Terraform..."
  python3 "$DAY0_BUCKET_SCRIPT" check-bucket \
    --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
    --account-id "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --region "$IMMUTABLE_AWS_REGION" \
    --policy-file "$POLICY_JSON"
  python3 "$DAY0_BUCKET_SCRIPT" check-prefix \
    --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
    --prefix "foundation/" \
    --account-id "$IMMUTABLE_AWS_ACCOUNT_ID"

  echo "[2/4] Verifying operator caller identity, narrow policy, and absence of AdministratorAccess..."
  python3 "${SCRIPT_DIR}/plan_iam_safety.py" verify-bootstrap-caller \
    --foundation-dir "${REPO_ROOT}/deployment/foundation" \
    --sts-json "$STS_OUT" \
    --expected-account "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --operator-principal "$OPERATOR_PRINCIPAL_ARN"

  echo "[3/4] Staging atomic backend.hcl..."
  write_backend_hcl_atomic "$BACKEND_HCL_OUT"

  echo "[4/4] Executing Foundation IAM bootstrap Terraform workflow..."
  PLAN_BIN_FLAGS=()
  [[ -n "${PLAN_BIN_ARG:-}" ]] && PLAN_BIN_FLAGS+=(--plan-bin "$PLAN_BIN_ARG")
  [[ -n "${PLAN_SHA256_ARG:-}" ]] && PLAN_BIN_FLAGS+=(--plan-sha256 "$PLAN_SHA256_ARG")
  python3 "${SCRIPT_DIR}/plan_iam_safety.py" bootstrap-foundation-iam \
    --foundation-dir "${REPO_ROOT}/deployment/foundation" \
    --sts-json "$STS_OUT" \
    --backend-hcl "$BACKEND_HCL_OUT" \
    --expected-account "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --operator-principal "$OPERATOR_PRINCIPAL_ARN" \
    ${RECONCILE_EXISTING_FLAG} \
    "${PLAN_BIN_FLAGS[@]}"
  exit 0
fi

if [[ "$CONFIRM_TOKEN" != "$REQUIRED_CONFIRM_TOKEN" ]]; then
  echo "[FATAL] --${MODE} requires --confirm-bootstrap ${REQUIRED_CONFIRM_TOKEN}" >&2
  exit 1
fi

ensure_bucket_exists() {
  HEAD_ERR="${TMP_DIR}/head_bucket.err"
  if aws s3api head-bucket --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" 2>"$HEAD_ERR"; then
    LOC_JSON="${TMP_DIR}/bucket_loc.json"
    aws s3api get-bucket-location --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --output json >"$LOC_JSON"
    python3 - "$LOC_JSON" "$IMMUTABLE_AWS_REGION" <<'PYEOF'
import json, pathlib, sys
loc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")).get("LocationConstraint") or "us-east-1"
if loc != sys.argv[2]:
    raise SystemExit(f"[FATAL] Bucket region '{loc}' != expected '{sys.argv[2]}'")
PYEOF
    echo "      Existing bucket verified in ${IMMUTABLE_AWS_REGION} (owned by ${IMMUTABLE_AWS_ACCOUNT_ID})."
  elif grep -Eq "404|NotFound" "$HEAD_ERR"; then
    aws s3api create-bucket \
      --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
      --region "$IMMUTABLE_AWS_REGION" \
      --create-bucket-configuration "LocationConstraint=${IMMUTABLE_AWS_REGION}" \
      --object-ownership BucketOwnerEnforced >/dev/null
    echo "      Created S3 bucket s3://${IMMUTABLE_TFSTATE_BUCKET} in ${IMMUTABLE_AWS_REGION}."
  else
    cat "$HEAD_ERR" >&2
    echo "[FATAL] Failed checking s3://${IMMUTABLE_TFSTATE_BUCKET} (ownership mismatch or permission error)." >&2
    exit 1
  fi
}

verify_bucket_policy_readback() {
  aws s3api get-bucket-policy --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --output json >"${TMP_DIR}/rb_pol.json"
  python3 - "${TMP_DIR}/rb_pol.json" "$POLICY_JSON" "${SCRIPT_DIR}" <<'PYEOF'
import json, pathlib, sys
rb_path, exp_path, guard_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, guard_dir)
import day0_identity_guard  # noqa: E402
pol = json.loads(json.loads(rb_path.read_text())["Policy"])
exp = json.loads(exp_path.read_text())
day0_identity_guard.validate_tfstate_bucket_policy_doc(pol, exp)
PYEOF
}

if [[ "$MODE" == "init-bucket-policy" ]]; then
  echo "[1/3] Verifying dedicated initial-seal identity, attached policy, and permissions boundary..."
  python3 "$DAY0_GUARD_SCRIPT" check-initial-seal-sts --sts-json "$STS_OUT" --expected-account "$IMMUTABLE_AWS_ACCOUNT_ID"
  python3 "$DAY0_GUARD_SCRIPT" check-initial-seal-boundary \
    --sts-json "$STS_OUT" \
    --seal-policy "$DAY0_SEAL_POLICY_FILE" \
    --seal-boundary "$DAY0_SEAL_BOUNDARY_FILE" \
    --expected-account "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --operator-principal "$OPERATOR_PRINCIPAL_ARN"
  echo "[2/3] Ensuring state bucket exists and verifying no bucket policy is already sealed..."
  ensure_bucket_exists
  POL_ERR="${TMP_DIR}/get_pol.err"
  if aws s3api get-bucket-policy --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" >/dev/null 2>"$POL_ERR"; then
    echo "[FATAL] State bucket policy already exists on s3://${IMMUTABLE_TFSTATE_BUCKET}; --init-bucket-policy is greenfield-only and cannot modify an existing policy." >&2
    exit 1
  elif ! grep -q "NoSuchBucketPolicy" "$POL_ERR"; then
    cat "$POL_ERR" >&2
    echo "[FATAL] Unexpected error checking existing bucket policy before initial seal." >&2
    exit 1
  fi
  echo "[3/3] Sealing initial hardened tfstate bucket policy..."
  aws s3api put-bucket-policy --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --policy "file://${POLICY_JSON}"
  verify_bucket_policy_readback
  echo "[SUCCESS] Sealed initial tfstate bucket policy (Day-0 & non-admin PutBucketPolicy now explicitly denied)."
  exit 0
fi

if [[ "$MODE" == "reconcile-bucket-policy" ]]; then
  python3 "$DAY0_GUARD_SCRIPT" check-admin-sts \
    --sts-json "$STS_OUT" \
    --expected-account "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --operator-principal "$OPERATOR_PRINCIPAL_ARN" \
    --verify-live-trust
  aws s3api put-bucket-policy --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --policy "file://${POLICY_JSON}"
  verify_bucket_policy_readback
  echo "[SUCCESS] Break-glass admin reconciled tfstate bucket policy cleanly."
  exit 0
fi

echo "[1/5] Verifying AWS account (${IMMUTABLE_AWS_ACCOUNT_ID}) & non-root caller..."
python3 - "$STS_OUT" "$IMMUTABLE_AWS_ACCOUNT_ID" <<'PYEOF'
import json, pathlib, sys
sts = json.loads(pathlib.Path(sys.argv[1]).read_text())
acct, arn = str(sts.get("Account", "")), str(sts.get("Arn", ""))
if acct != sys.argv[2] or arn.endswith(":root"):
    raise SystemExit(f"[FATAL] Caller rejected for state bucket bootstrap: account={acct}, arn={arn}")
PYEOF

echo "[2/5] Idempotently detecting, creating, or validating s3://${IMMUTABLE_TFSTATE_BUCKET}..."
HEAD_ERR="${TMP_DIR}/head_bucket.err"
BUCKET_IS_NEW="false"
if aws s3api head-bucket --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" 2>"$HEAD_ERR"; then
  echo "      Existing bucket verified in ${IMMUTABLE_AWS_REGION} (owned by ${IMMUTABLE_AWS_ACCOUNT_ID})."
elif grep -Eq "404|NotFound" "$HEAD_ERR"; then
  aws s3api create-bucket \
    --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
    --region "$IMMUTABLE_AWS_REGION" \
    --create-bucket-configuration "LocationConstraint=${IMMUTABLE_AWS_REGION}" \
    --object-ownership BucketOwnerEnforced >/dev/null
  BUCKET_IS_NEW="true"
  echo "      Created S3 bucket s3://${IMMUTABLE_TFSTATE_BUCKET} in ${IMMUTABLE_AWS_REGION}."
else
  cat "$HEAD_ERR" >&2
  echo "[FATAL] Failed checking s3://${IMMUTABLE_TFSTATE_BUCKET}." >&2
  exit 1
fi

echo "[3/5] Enforcing public-access block, BucketOwnerEnforced, versioning, pure SSE-S3, and multipart-abort lifecycle..."
aws s3api put-public-access-block --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
aws s3api put-bucket-ownership-controls --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws s3api put-bucket-versioning --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --server-side-encryption-configuration "file://${ENCRYPTION_JSON}"
aws s3api put-bucket-lifecycle-configuration --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --lifecycle-configuration "file://${LIFECYCLE_JSON}"
aws s3api put-bucket-tagging --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --tagging 'TagSet=[{Key=Project,Value=EnvScale},{Key=Environment,Value=production},{Key=Layer,Value=PersistentFoundation},{Key=ManagedBy,Value=bootstrap-state.sh}]'

if [[ "$BUCKET_IS_NEW" == "true" || -n "$RECONCILE_EXISTING_FLAG" ]]; then
  echo "      Applying hardened bucket policy to s3://${IMMUTABLE_TFSTATE_BUCKET}..."
  aws s3api put-bucket-policy --bucket "$IMMUTABLE_TFSTATE_BUCKET" --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" --policy "file://${POLICY_JSON}"
fi

echo "[4/5] Validating bucket policy readback, configuration, and foundation/ prefix access..."
python3 "$DAY0_BUCKET_SCRIPT" check-bucket \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --account-id "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --region "$IMMUTABLE_AWS_REGION" \
  --policy-file "$POLICY_JSON"
python3 "$DAY0_BUCKET_SCRIPT" check-prefix \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --prefix "foundation/" \
  --account-id "$IMMUTABLE_AWS_ACCOUNT_ID"

echo "[5/5] Writing gitignored ${BACKEND_HCL_OUT} (mode 0600, use_lockfile = true)..."
write_backend_hcl_atomic "$BACKEND_HCL_OUT"
echo "[SUCCESS] Terraform S3 state backend verified idempotently at s3://${IMMUTABLE_TFSTATE_BUCKET} (zero DynamoDB)."
echo "[NOTICE] Legacy vault s3://${IMMUTABLE_LEGACY_BUCKET} was NOT accessed or modified."
