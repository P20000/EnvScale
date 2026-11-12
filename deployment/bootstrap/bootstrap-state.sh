#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Out-of-Band Terraform S3 State Bucket Bootstrapper (Phase 3)
# ==============================================================================
# Architectural & Security Guarantees:
#   1. Native S3 State Locking ONLY (`use_lockfile = true` on Terraform 1.14.9).
#      ZERO DynamoDB tables or DynamoDB permissions are created or referenced.
#   2. Strict Storage & History Retention Boundary:
#      Creates ONLY `envscale-tfstate-982534376726-ap-south-1` with S3 Versioning
#      enabled, standard SSE-S3 (`AES256`, no invalid BucketKeyEnabled), and ZERO
#      noncurrent-version expiration rules so Terraform state history never expires.
#   3. Dedicated MFA-Enforced Foundation Administrator Only:
#      `--apply` allows ONLY `arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/<session>`
#      AND verifies via `aws iam get-role` that `envscale-foundation-admin-role`
#      enforces `Bool aws:MultiFactorAuthPresent = "true"` and `MultiFactorAuthAge <= 3600`
#      in its IAM trust policy (rejecting raw IAM users, GitHub OIDC, and EC2 roles).
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_VERSION_FILE="${REPO_ROOT}/.terraform-version"
DEFAULT_BACKEND_HCL="${REPO_ROOT}/deployment/foundation/backend.hcl"

IMMUTABLE_AWS_ACCOUNT_ID="982534376726"
IMMUTABLE_AWS_REGION="ap-south-1"
IMMUTABLE_TFSTATE_BUCKET="envscale-tfstate-982534376726-ap-south-1"
IMMUTABLE_RECOVERY_BUCKET="envscale-recovery-982534376726-ap-south-1"
IMMUTABLE_LEGACY_BUCKET="envscale-cloud-vault-982534376726-ap-south-1"
IMMUTABLE_ADMIN_ROLE_NAME="envscale-foundation-admin-role"
IMMUTABLE_GITHUB_REPO="P20000/EnvScale"
REQUIRED_CONFIRM_TOKEN="BOOTSTRAP-TFSTATE-982534376726"

MODE=""
CONFIRM_TOKEN=""
BACKEND_HCL_OUT="$DEFAULT_BACKEND_HCL"
WRITE_HCL_IN_DRY_RUN="false"

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Modes (choose one):
  --dry-run                              Render & validate bucket policy, encryption JSON,
                                         lifecycle JSON, and backend.hcl (ZERO AWS calls).
  --verify-github-envs                   Read-only audit of external GitHub Environments
                                         (production & recovery branch + reviewer rules).
  --apply                                Create/verify ${IMMUTABLE_TFSTATE_BUCKET} in AWS
                                         (requires assumed ${IMMUTABLE_ADMIN_ROLE_NAME} with MFA
                                         and --confirm-bootstrap ${REQUIRED_CONFIRM_TOKEN}).

Options:
  --confirm-bootstrap <token>            Confirmation token required for --apply
  --backend-hcl-out <path>               Output path for foundation backend.hcl
                                         (default: deployment/foundation/backend.hcl)
  --write-backend-hcl                    Also write backend.hcl file during --dry-run (for testing)
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
    --apply)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode." >&2; exit 1; }
      MODE="apply"
      shift
      ;;
    --confirm-bootstrap)
      CONFIRM_TOKEN="${2:-}"
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

for cmd in python3 terraform; do
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
INSTALLED_TF_VER="$(terraform version -json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["terraform_version"])')"
if [[ "$INSTALLED_TF_VER" != "$EXPECTED_TF_VER" ]]; then
  echo "[FATAL] Installed Terraform (${INSTALLED_TF_VER}) != pinned .terraform-version (${EXPECTED_TF_VER}). Native S3 use_lockfile requires standardized 1.14.9." >&2
  exit 1
fi

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

python3 - "$IMMUTABLE_AWS_ACCOUNT_ID" "$IMMUTABLE_TFSTATE_BUCKET" "$POLICY_JSON" "$LIFECYCLE_JSON" "$ENCRYPTION_JSON" <<'PYEOF'
import json
import pathlib
import sys

account_id, bucket_name, policy_out, lifecycle_out, enc_out = sys.argv[1:6]
bucket_arn = f"arn:aws:s3:::{bucket_name}"

bucket_policy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "DenyInsecureTransport",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [bucket_arn, f"{bucket_arn}/*"],
            "Condition": {"Bool": {"aws:SecureTransport": "false"}},
        },
        {
            "Sid": "DenyForeignAccountPrincipals",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [bucket_arn, f"{bucket_arn}/*"],
            "Condition": {
                "Null": {"aws:PrincipalAccount": "false"},
                "StringNotEquals": {"aws:PrincipalAccount": account_id},
            },
        },
        {
            "Sid": "DenyBucketAndStateVersionDestruction",
            "Effect": "Deny",
            "Principal": "*",
            "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion"],
            "Resource": [bucket_arn, f"{bucket_arn}/*"],
        },
        {
            "Sid": "DenyTfstateObjectDeletionWhileAllowingNativeTflockRelease",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:DeleteObject",
            "Resource": f"{bucket_arn}/*.tfstate",
        },
    ],
}

# Preserve ALL noncurrent .tfstate versions indefinitely; only clean up orphaned multipart uploads.
lifecycle_cfg = {
    "Rules": [
        {
            "ID": "abort-incomplete-multipart-uploads",
            "Status": "Enabled",
            "Filter": {"Prefix": ""},
            "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
        },
    ]
}

# Pure SSE-S3 (AES256); BucketKeyEnabled is an SSE-KMS setting and is intentionally omitted.
encryption_cfg = {
    "Rules": [
        {
            "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"},
        }
    ]
}

pathlib.Path(policy_out).write_text(json.dumps(bucket_policy, indent=2) + "\n", encoding="utf-8")
pathlib.Path(lifecycle_out).write_text(json.dumps(lifecycle_cfg, indent=2) + "\n", encoding="utf-8")
pathlib.Path(enc_out).write_text(json.dumps(encryption_cfg, indent=2) + "\n", encoding="utf-8")
PYEOF

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

if [[ "$MODE" == "dry-run" ]]; then
  if [[ "$WRITE_HCL_IN_DRY_RUN" == "true" ]]; then
    write_backend_hcl_atomic "$BACKEND_HCL_OUT"
  fi
  echo "[DRY-RUN] Verified Terraform ${INSTALLED_TF_VER} (native S3 locking: use_lockfile = true; zero DynamoDB)."
  echo "[DRY-RUN] Target State Bucket : s3://${IMMUTABLE_TFSTATE_BUCKET} (account=${IMMUTABLE_AWS_ACCOUNT_ID}, region=${IMMUTABLE_AWS_REGION})"
  echo "[DRY-RUN] Required Admin Role : arn:aws:sts::${IMMUTABLE_AWS_ACCOUNT_ID}:assumed-role/${IMMUTABLE_ADMIN_ROLE_NAME}/<session> (MFA enforced)"
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
# Live Bootstrap Mode (--apply): Dedicated MFA-Enforced Foundation Admin Role ONLY
# ------------------------------------------------------------------------------
if [[ "$CONFIRM_TOKEN" != "$REQUIRED_CONFIRM_TOKEN" ]]; then
  echo "[FATAL] --apply requires --confirm-bootstrap ${REQUIRED_CONFIRM_TOKEN}" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "[FATAL] aws CLI is required for --apply" >&2
  exit 1
fi

echo "[0/5] Preflight Audit: Verifying external GitHub environment protection rules fail-closed..."
python3 "${SCRIPT_DIR}/validate-foundation-security.py" --audit-github-environments-strict

echo "[1/5] Verifying dedicated MFA-protected Foundation Admin role (${IMMUTABLE_ADMIN_ROLE_NAME})..."
STS_OUT="${TMP_DIR}/sts.json"
ROLE_OUT="${TMP_DIR}/admin_role.json"
aws sts get-caller-identity --output json >"$STS_OUT"
aws iam get-role --role-name "$IMMUTABLE_ADMIN_ROLE_NAME" --output json >"$ROLE_OUT"
python3 "${SCRIPT_DIR}/legacy_vault_inspector.py" verify-foundation-admin-mfa "$STS_OUT" "$ROLE_OUT"

echo "[2/5] Creating or verifying S3 state bucket s3://${IMMUTABLE_TFSTATE_BUCKET}..."
HEAD_ERR="${TMP_DIR}/head_bucket.err"
if aws s3api head-bucket \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" 2>"$HEAD_ERR"; then
  LOC_JSON="${TMP_DIR}/bucket_loc.json"
  aws s3api get-bucket-location \
    --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
    --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
    --output json >"$LOC_JSON"
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
  echo "[FATAL] Failed checking s3://${IMMUTABLE_TFSTATE_BUCKET} (possible ownership mismatch or permission error)." >&2
  exit 1
fi

echo "[3/5] Enforcing public-access block, BucketOwnerEnforced, versioning, pure SSE-S3, and multipart-abort lifecycle..."
aws s3api put-public-access-block \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

aws s3api put-bucket-ownership-controls \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

aws s3api put-bucket-versioning \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --server-side-encryption-configuration "file://${ENCRYPTION_JSON}"

aws s3api put-bucket-lifecycle-configuration \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --lifecycle-configuration "file://${LIFECYCLE_JSON}"

aws s3api put-bucket-tagging \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --tagging 'TagSet=[{Key=Project,Value=EnvScale},{Key=Environment,Value=production},{Key=Layer,Value=PersistentFoundation},{Key=ManagedBy,Value=bootstrap-state.sh}]'

echo "[4/5] Applying TLS-only & state-deletion-guard bucket policy..."
aws s3api put-bucket-policy \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --expected-bucket-owner "$IMMUTABLE_AWS_ACCOUNT_ID" \
  --policy "file://${POLICY_JSON}"

echo "[5/5] Writing gitignored ${BACKEND_HCL_OUT} (mode 0600, use_lockfile = true)..."
write_backend_hcl_atomic "$BACKEND_HCL_OUT"

echo "[SUCCESS] Terraform S3 state backend bootstrapped at s3://${IMMUTABLE_TFSTATE_BUCKET} (zero DynamoDB)."
echo "[NOTICE] Legacy vault s3://${IMMUTABLE_LEGACY_BUCKET} was NOT accessed or modified."
