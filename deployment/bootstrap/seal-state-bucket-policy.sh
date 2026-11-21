#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Failure-Safe S3 State Bucket Policy Sealing
# ==============================================================================
# Performs a controlled, atomic IAM policy-version transition to install and seal
# the hardened bucket policy on s3://envscale-tfstate-982534376726-ap-south-1.
# Guarantees that the canonical policy version (with s3:PutBucketPolicy denied)
# is safely restored and verified even if an unexpected error occurs.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

IMMUTABLE_ACCOUNT_ID="982534376726"
IMMUTABLE_REGION="ap-south-1"
IMMUTABLE_TFSTATE_BUCKET="envscale-tfstate-${IMMUTABLE_ACCOUNT_ID}-${IMMUTABLE_REGION}"
POLICY_ARN="arn:aws:iam::${IMMUTABLE_ACCOUNT_ID}:policy/envscale-foundation-iam-bootstrap-policy"
CANONICAL_POLICY_JSON="${SCRIPT_DIR}/foundation-iam-bootstrap-policy.json"
REQUIRED_TOKEN="BOOTSTRAP-TFSTATE-${IMMUTABLE_ACCOUNT_ID}"

CONFIRM_TOKEN="${1:-}"
if [[ "$CONFIRM_TOKEN" != "$REQUIRED_TOKEN" ]]; then
  echo "[FATAL] Usage: $0 ${REQUIRED_TOKEN}" >&2
  exit 1
fi

echo "[1/6] Capturing original default IAM policy version & inspecting version headroom..."
ORIGINAL_DEF_VER=$(aws iam get-policy --policy-arn "$POLICY_ARN" --query "Policy.DefaultVersionId" --output text)
echo "      Original default version: ${ORIGINAL_DEF_VER}"

VER_COUNT=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query "length(Versions)" --output text)
if [[ "$VER_COUNT" -ge 5 ]]; then
  OLDEST_NON_DEF=$(aws iam list-policy-versions --policy-arn "$POLICY_ARN" --query "Versions[?!IsDefaultVersion].VersionId | [-1]" --output text)
  if [[ -n "$OLDEST_NON_DEF" && "$OLDEST_NON_DEF" != "None" && "$OLDEST_NON_DEF" != "$ORIGINAL_DEF_VER" ]]; then
    echo "      Policy has ${VER_COUNT}/5 versions. Pruning oldest non-default version ${OLDEST_NON_DEF}..."
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$OLDEST_NON_DEF"
  else
    echo "[FATAL] Policy has ${VER_COUNT}/5 versions and cannot prune non-default version safely." >&2
    exit 1
  fi
fi

TMP_DIR=$(mktemp -d "/tmp/envscale-seal.XXXXXX")
TEMP_DOC="${TMP_DIR}/bp_v_temp.json"
TEMP_VER=""

cleanup() {
  local sig="${1:-0}"
  local exit_code=$?
  if [[ "$sig" -ne 0 ]]; then
    exit_code="$sig"
  fi

  echo "[CLEANUP] Ensuring original policy version (${ORIGINAL_DEF_VER}) is default..."
  CURRENT_DEF=$(aws iam get-policy --policy-arn "$POLICY_ARN" --query "Policy.DefaultVersionId" --output text 2>/dev/null || echo "UNKNOWN")
  if [[ "$CURRENT_DEF" != "$ORIGINAL_DEF_VER" && "$CURRENT_DEF" != "UNKNOWN" ]]; then
    aws iam set-default-policy-version --policy-arn "$POLICY_ARN" --version-id "$ORIGINAL_DEF_VER" 2>/dev/null || true
  fi

  VERIFIED_DEF=$(aws iam get-policy --policy-arn "$POLICY_ARN" --query "Policy.DefaultVersionId" --output text 2>/dev/null || echo "UNKNOWN")
  if [[ "$VERIFIED_DEF" != "$ORIGINAL_DEF_VER" ]]; then
    echo "==========================================================================" >&2
    echo "[CRITICAL ALARM] Cleanup failed to restore ${ORIGINAL_DEF_VER}!" >&2
    echo "                 Live default version is '${VERIFIED_DEF}'." >&2
    echo "Immediate manual IAM intervention required:" >&2
    echo "  aws iam set-default-policy-version --policy-arn ${POLICY_ARN} --version-id ${ORIGINAL_DEF_VER}" >&2
    echo "==========================================================================" >&2
    exit 2
  fi
  echo "      Verified canonical version (${ORIGINAL_DEF_VER}) restored as default."

  # Temporary version is deleted ONLY after restoration is verified, and NEVER delete original version
  if [[ -n "$TEMP_VER" && "$TEMP_VER" != "$ORIGINAL_DEF_VER" ]]; then
    echo "      Removing temporary policy version ${TEMP_VER}..."
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$TEMP_VER" 2>/dev/null || true
  fi

  rm -rf "$TMP_DIR"
  exit "$exit_code"
}

trap 'cleanup 0' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

echo "[2/6] Generating temporary bootstrap policy version document..."
python3 - "$CANONICAL_POLICY_JSON" "$TEMP_DOC" <<'PYEOF'
import json, pathlib, sys
doc = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
for st in doc.get("Statement") or []:
    if st.get("Sid") == "DenyBootstrapDestructiveStateAndBucketPolicyChanges":
        st["Action"] = [a for a in st.get("Action", []) if a != "s3:PutBucketPolicy"]
pathlib.Path(sys.argv[2]).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
PYEOF

echo "[3/6] Publishing temporary policy version and setting as default..."
CREATE_OUT=$(aws iam create-policy-version --policy-arn "$POLICY_ARN" --policy-document "file://${TEMP_DOC}" --set-as-default --output json)
TEMP_VER=$(python3 -c 'import json, sys; print(json.loads(sys.argv[1])["PolicyVersion"]["VersionId"])' "$CREATE_OUT")
echo "      Temporary version ${TEMP_VER} is now active default."

echo "[4/6] Executing idempotent bucket policy application..."
bash "${SCRIPT_DIR}/bootstrap-state.sh" --bootstrap-state-bucket --confirm-bootstrap "$REQUIRED_TOKEN" --reconcile-existing

echo "[5/6] Verifying live S3 state bucket policy readback and equality..."
python3 "${SCRIPT_DIR}/day0_bucket_bootstrap.py" check-bucket \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --account-id "$IMMUTABLE_ACCOUNT_ID" \
  --region "$IMMUTABLE_REGION" \
  --policy-file <(python3 "${SCRIPT_DIR}/day0_bucket_bootstrap.py" generate-artifacts --account-id "$IMMUTABLE_ACCOUNT_ID" --bucket "$IMMUTABLE_TFSTATE_BUCKET" --policy-out "${TMP_DIR}/p.json" --lifecycle-out "${TMP_DIR}/l.json" --enc-out "${TMP_DIR}/e.json" && cat "${TMP_DIR}/p.json")

python3 "${SCRIPT_DIR}/day0_bucket_bootstrap.py" check-prefix \
  --bucket "$IMMUTABLE_TFSTATE_BUCKET" \
  --prefix "foundation/" \
  --account-id "$IMMUTABLE_ACCOUNT_ID"

echo "[6/6] S3 bucket policy successfully applied and verified."
