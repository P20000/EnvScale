#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Out-of-Band SSM SecureString Parameter Seeder (Phase 3)
# ==============================================================================
# Security & Zero-State-Secret Guarantees:
#   1. Keeps ALL production SecureString values completely out of Terraform HCL,
#      variables, plans, outputs, and `foundation/terraform.tfstate`.
#   2. Enforces explicit `KUBECONFIG_ENCRYPTION_KEY` disposition on `--apply`
#      (`generate-fresh-no-historical-ciphertext` vs `preserve-from-secrets-file`)
#      and denylists the public committed `apps/api-server/.env.example` demo key.
#   3. Dedicated MFA-Enforced Foundation Administrator Only:
#      `--apply` allows ONLY `arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/<session>`
#      AND verifies via `aws iam get-role` that `envscale-foundation-admin-role`
#      enforces `Bool aws:MultiFactorAuthPresent = "true"` and `MultiFactorAuthAge <= 3600`.
#   4. Passes values to `aws ssm put-parameter` exclusively via `0600` temp JSON
#      files (`--cli-input-json file://...`) and refuses to overwrite existing
#      SecureStrings without `--rotate-parameter <name> --confirm-rotation ROTATE-PROD-SECRET`.
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMMUTABLE_AWS_ACCOUNT_ID="982534376726"
IMMUTABLE_AWS_REGION="ap-south-1"
IMMUTABLE_SSM_PREFIX="/envscale/prod"
IMMUTABLE_KMS_KEY_ID="alias/aws/ssm"
IMMUTABLE_ADMIN_ROLE_NAME="envscale-foundation-admin-role"
REQUIRED_SEED_TOKEN="SEED-SSM-982534376726"
REQUIRED_ROTATE_TOKEN="ROTATE-PROD-SECRET"

MODE=""
CONFIRM_SEED=""
SECRETS_FILE=""
ROTATE_PARAM=""
CONFIRM_ROTATION=""
KUBE_KEY_DISPOSITION=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Modes (choose one):
  --dry-run                              Generate & validate CSPRNG secrets (including 32-byte
                                         Base64 KUBECONFIG_ENCRYPTION_KEY) in memory and print
                                         redacted parameter plan (ZERO AWS calls).
  --apply                                Seed missing SecureString parameters into AWS SSM
                                         (requires assumed ${IMMUTABLE_ADMIN_ROLE_NAME} with MFA,
                                         --confirm-seed ${REQUIRED_SEED_TOKEN}, --secrets-file,
                                         and --kubeconfig-key-disposition).

Options:
  --secrets-file <path>                  Mode 0600 KEY=VALUE file supplying external tokens
                                         (DUCKDNS_TOKEN required on --apply)
  --kubeconfig-key-disposition <mode>    Required on --apply (unless rotating another parameter):
                                           - generate-fresh-no-historical-ciphertext
                                             (verified safe for Phase 1 backup_20261023_005151.sql,
                                              where public.clusters.kubeconfig IS NULL)
                                           - preserve-from-secrets-file
                                             (requires KUBECONFIG_ENCRYPTION_KEY in --secrets-file)
  --confirm-seed <token>                 Required confirmation token for --apply
  --rotate-parameter <full_ssm_name>     Explicitly rotate a single existing SecureString parameter
  --confirm-rotation <token>             Required token (${REQUIRED_ROTATE_TOKEN}) for rotation
  --help, -h                             Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode (--dry-run or --apply)." >&2; exit 1; }
      MODE="dry-run"
      shift
      ;;
    --apply)
      [[ -n "$MODE" ]] && { echo "[ERROR] Specify only one mode (--dry-run or --apply)." >&2; exit 1; }
      MODE="apply"
      shift
      ;;
    --secrets-file)
      SECRETS_FILE="${2:-}"
      shift 2
      ;;
    --kubeconfig-key-disposition)
      KUBE_KEY_DISPOSITION="${2:-}"
      shift 2
      ;;
    --confirm-seed)
      CONFIRM_SEED="${2:-}"
      shift 2
      ;;
    --rotate-parameter)
      ROTATE_PARAM="${2:-}"
      shift 2
      ;;
    --confirm-rotation)
      CONFIRM_ROTATION="${2:-}"
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
  echo "[ERROR] Missing required mode: specify --dry-run or --apply." >&2
  usage >&2
  exit 1
fi

if [[ -n "$ROTATE_PARAM" && "$CONFIRM_ROTATION" != "$REQUIRED_ROTATE_TOKEN" ]]; then
  echo "[FATAL] --rotate-parameter requires --confirm-rotation ${REQUIRED_ROTATE_TOKEN}" >&2
  exit 1
fi

if [[ -n "$KUBE_KEY_DISPOSITION" ]] && [[ "$KUBE_KEY_DISPOSITION" != "generate-fresh-no-historical-ciphertext" && "$KUBE_KEY_DISPOSITION" != "preserve-from-secrets-file" ]]; then
  echo "[FATAL] Invalid --kubeconfig-key-disposition '${KUBE_KEY_DISPOSITION}' (expected 'generate-fresh-no-historical-ciphertext' or 'preserve-from-secrets-file')." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[FATAL] python3 is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d -t envscale-seed-ssm-XXXXXX)"
chmod 700 "$TMP_DIR"
cleanup() {
  local rc=$?
  [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
  exit "$rc"
}
trap cleanup EXIT INT TERM

if [[ -n "$SECRETS_FILE" ]]; then
  if [[ ! -f "$SECRETS_FILE" || -L "$SECRETS_FILE" ]]; then
    echo "[FATAL] --secrets-file does not exist or is a symlink: ${SECRETS_FILE}" >&2
    exit 1
  fi
  PERM="$(stat -c '%a' "$SECRETS_FILE")"
  if [[ "$PERM" != "600" && "$PERM" != "400" ]]; then
    echo "[FATAL] --secrets-file (${SECRETS_FILE}) has insecure mode ${PERM}; must be 0600 or 0400." >&2
    exit 1
  fi
fi

if [[ "$MODE" == "apply" ]]; then
  if [[ "$CONFIRM_SEED" != "$REQUIRED_SEED_TOKEN" ]]; then
    echo "[FATAL] --apply requires --confirm-seed ${REQUIRED_SEED_TOKEN}" >&2
    exit 1
  fi
  if [[ -z "$SECRETS_FILE" ]]; then
    echo "[FATAL] --apply requires --secrets-file <0600_file> supplying at least DUCKDNS_TOKEN." >&2
    exit 1
  fi
  if [[ -z "$KUBE_KEY_DISPOSITION" ]] && [[ -z "$ROTATE_PARAM" || "$ROTATE_PARAM" == "${IMMUTABLE_SSM_PREFIX}/kubeconfig_encryption_key" ]]; then
    echo "[FATAL] --apply requires explicit --kubeconfig-key-disposition <generate-fresh-no-historical-ciphertext | preserve-from-secrets-file> to prevent accidental key replacement." >&2
    exit 1
  fi
  if ! command -v aws >/dev/null 2>&1; then
    echo "[FATAL] aws CLI is required for --apply" >&2
    exit 1
  fi
fi

# Stage validated cli-input-json payloads inside 0700 TMP_DIR (zero plaintext stdout)
MANIFEST_JSON="${TMP_DIR}/staged_manifest.json"
python3 - "$MODE" "$SECRETS_FILE" "$IMMUTABLE_SSM_PREFIX" "$IMMUTABLE_KMS_KEY_ID" "$TMP_DIR" "$MANIFEST_JSON" "$ROTATE_PARAM" "$KUBE_KEY_DISPOSITION" <<'PYEOF'
import base64
import hashlib
import json
import os
import pathlib
import secrets
import string
import sys

mode, secrets_file, prefix, kms_key_id, tmp_dir_str, manifest_out, rotate_param, kube_disp = sys.argv[1:9]
tmp_dir = pathlib.Path(tmp_dir_str)

# SHA-256 of the public demo KUBECONFIG_ENCRYPTION_KEY in apps/api-server/.env.example
FORBIDDEN_DEMO_KEY_SHA256 = {
    "00ff113e52e35aae8eab01c87b5751f98db415c28189a62dd539aa6bdba509bc",
}

ALLOWED_SECURESTRINGS = [
    f"{prefix}/postgres_password",
    f"{prefix}/redis_password",
    f"{prefix}/jwt_access_secret",
    f"{prefix}/jwt_refresh_secret",
    f"{prefix}/better_auth_secret",
    f"{prefix}/kubeconfig_encryption_key",
    f"{prefix}/duckdns_token",
    f"{prefix}/google_client_secret",
    f"{prefix}/github_client_secret",
]

if rotate_param and rotate_param not in ALLOWED_SECURESTRINGS:
    raise SystemExit(
        f"[FATAL] --rotate-parameter '{rotate_param}' is not a managed EnvScale SecureString "
        f"(allowed: {', '.join(ALLOWED_SECURESTRINGS)})"
    )

overrides: dict[str, str] = {}
if secrets_file:
    for lineno, raw in enumerate(pathlib.Path(secrets_file).read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            raise SystemExit(f"[FATAL] Malformed line {lineno} in secrets file (expected KEY=VALUE)")
        k, v = stripped.split("=", 1)
        k = k.strip()
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
            v = v[1:-1]
        if "\n" in v or "\r" in v:
            raise SystemExit(f"[FATAL] Illegal newline in secret '{k}'")
        if v.startswith("__SET_VIA_SSM") or v in ("changeme", "password", "secret"):
            raise SystemExit(f"[FATAL] Placeholder or weak value rejected for '{k}'")
        overrides[k] = v

if kube_disp == "preserve-from-secrets-file" and "KUBECONFIG_ENCRYPTION_KEY" not in overrides:
    raise SystemExit(
        "[FATAL] --kubeconfig-key-disposition=preserve-from-secrets-file requires "
        "KUBECONFIG_ENCRYPTION_KEY in --secrets-file"
    )
if kube_disp == "generate-fresh-no-historical-ciphertext" and "KUBECONFIG_ENCRYPTION_KEY" in overrides:
    raise SystemExit(
        "[FATAL] --kubeconfig-key-disposition=generate-fresh-no-historical-ciphertext conflicts with "
        "KUBECONFIG_ENCRYPTION_KEY override in --secrets-file (use preserve-from-secrets-file instead)"
    )

alphabet_alnum = string.ascii_letters + string.digits


def gen_alnum(n: int) -> str:
    return "".join(secrets.choice(alphabet_alnum) for _ in range(n))


pg_pass = overrides.get("POSTGRES_PASSWORD") or gen_alnum(32)
redis_pass = overrides.get("REDIS_PASSWORD") or gen_alnum(32)
while redis_pass == pg_pass and "REDIS_PASSWORD" not in overrides:
    redis_pass = gen_alnum(32)

jwt_access = overrides.get("JWT_ACCESS_SECRET") or secrets.token_hex(32)
jwt_refresh = overrides.get("JWT_REFRESH_SECRET") or secrets.token_hex(32)
while jwt_refresh == jwt_access and "JWT_REFRESH_SECRET" not in overrides:
    jwt_refresh = secrets.token_hex(32)

better_auth = overrides.get("BETTER_AUTH_SECRET") or secrets.token_hex(32)
kube_key = overrides.get("KUBECONFIG_ENCRYPTION_KEY") or base64.b64encode(secrets.token_bytes(32)).decode("ascii")

duckdns_tok = overrides.get("DUCKDNS_TOKEN", "")
if mode == "dry-run" and not duckdns_tok:
    duckdns_tok = "dryrun-placeholder-duckdns-token"

google_sec = overrides.get("GOOGLE_CLIENT_SECRET") or "DISABLED"
github_sec = overrides.get("GITHUB_CLIENT_SECRET") or "DISABLED"

if len(pg_pass) < 24:
    raise SystemExit("[FATAL] POSTGRES_PASSWORD must be >= 24 characters")
if len(redis_pass) < 24:
    raise SystemExit("[FATAL] REDIS_PASSWORD must be >= 24 characters")
if pg_pass == redis_pass:
    raise SystemExit("[FATAL] POSTGRES_PASSWORD and REDIS_PASSWORD must be distinct")
if len(jwt_access) < 32 or len(jwt_refresh) < 32 or len(better_auth) < 32:
    raise SystemExit("[FATAL] JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, and BETTER_AUTH_SECRET must be >= 32 chars")
if jwt_access == jwt_refresh:
    raise SystemExit("[FATAL] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct")

if hashlib.sha256(kube_key.encode("utf-8")).hexdigest() in FORBIDDEN_DEMO_KEY_SHA256:
    raise SystemExit(
        "[FATAL] Public demo KUBECONFIG_ENCRYPTION_KEY from apps/api-server/.env.example is forbidden in production!"
    )

try:
    decoded_kube = base64.b64decode(kube_key, validate=True)
except Exception as exc:
    raise SystemExit(f"[FATAL] KUBECONFIG_ENCRYPTION_KEY is not valid strict Base64: {exc}")
if len(decoded_kube) != 32:
    raise SystemExit(
        f"[FATAL] KUBECONFIG_ENCRYPTION_KEY decoded to {len(decoded_kube)} bytes (must be exact 32 bytes for AES-256-GCM)"
    )

if len(duckdns_tok) < 8:
    raise SystemExit("[FATAL] DUCKDNS_TOKEN is missing or shorter than 8 characters")

kube_src_label = "preserved-override" if "KUBECONFIG_ENCRYPTION_KEY" in overrides else "fresh-CSPRNG"
specs = [
    (f"{prefix}/postgres_password", pg_pass, "PostgreSQL 16 role password", f"REDACTED ({len(pg_pass)} chars, CSPRNG)"),
    (f"{prefix}/redis_password", redis_pass, "Redis 7 requirepass secret", f"REDACTED ({len(redis_pass)} chars, CSPRNG)"),
    (f"{prefix}/jwt_access_secret", jwt_access, "EnvScale API/Streamer JWT access secret", f"REDACTED ({len(jwt_access)} chars)"),
    (f"{prefix}/jwt_refresh_secret", jwt_refresh, "EnvScale API JWT refresh secret", f"REDACTED ({len(jwt_refresh)} chars, distinct)"),
    (f"{prefix}/better_auth_secret", better_auth, "BetterAuth session signing secret", f"REDACTED ({len(better_auth)} chars)"),
    (f"{prefix}/kubeconfig_encryption_key", kube_key, "AES-256-GCM 32-byte Base64 kubeconfig vault key", f"REDACTED (Base64 -> exact 32 decoded bytes, {kube_src_label})"),
    (f"{prefix}/duckdns_token", duckdns_tok, "DuckDNS dynamic DNS API token", f"REDACTED ({len(duckdns_tok)} chars)"),
    (f"{prefix}/google_client_secret", google_sec, "Optional Google OAuth client secret (DISABLED if unused)", "DISABLED" if google_sec == "DISABLED" else f"REDACTED ({len(google_sec)} chars)"),
    (f"{prefix}/github_client_secret", github_sec, "Optional GitHub OAuth client secret (DISABLED if unused)", "DISABLED" if github_sec == "DISABLED" else f"REDACTED ({len(github_sec)} chars)"),
]

index_records = []
for idx, (param_name, secret_val, desc, redacted_summary) in enumerate(specs):
    is_rotate_target = bool(rotate_param and rotate_param == param_name)
    payload_file = tmp_dir / f"param_{idx:02d}.json"
    cli_payload = {
        "Name": param_name,
        "Description": desc,
        "Value": secret_val,
        "Type": "SecureString",
        "KeyId": kms_key_id,
        "Tier": "Standard",
        "Overwrite": is_rotate_target,
    }
    if not is_rotate_target:
        cli_payload["Tags"] = [
            {"Key": "Project", "Value": "EnvScale"},
            {"Key": "Environment", "Value": "production"},
            {"Key": "Layer", "Value": "PersistentFoundation"},
            {"Key": "ManagedBy", "Value": "seed-parameters.sh"},
        ]
    fd = os.open(str(payload_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cli_payload, fh)
    index_records.append(
        {
            "name": param_name,
            "payload_file": str(payload_file),
            "rotate": is_rotate_target,
            "redacted": redacted_summary,
        }
    )

pathlib.Path(manifest_out).write_text(json.dumps(index_records, indent=2), encoding="utf-8")
os.chmod(manifest_out, 0o600)
PYEOF

if [[ "$MODE" == "dry-run" ]]; then
  echo "[DRY-RUN] Validated out-of-band SSM SecureString plan for account ${IMMUTABLE_AWS_ACCOUNT_ID} (${IMMUTABLE_AWS_REGION}):"
  echo "[DRY-RUN] Required Admin Role: arn:aws:sts::${IMMUTABLE_AWS_ACCOUNT_ID}:assumed-role/${IMMUTABLE_ADMIN_ROLE_NAME}/<session> (MFA enforced)"
  echo "[DRY-RUN] KMS Encryption Key : ${IMMUTABLE_KMS_KEY_ID} (Standard Tier, \$0.00/mo storage)"
  echo "[DRY-RUN] Terraform State    : ZERO SecureString values in HCL, plans, outputs, or state"
  python3 - "$MANIFEST_JSON" <<'PYEOF'
import json, pathlib, sys
for item in json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")):
    mode_lbl = "OVERWRITE-ROTATE" if item["rotate"] else "PUT-IF-ABSENT"
    print(f"  - {item['name']:<44} [{mode_lbl:<16}] -> {item['redacted']}")
PYEOF
  echo "[DRY-RUN SUCCESS] All 9 SecureString payloads validated in 0700 tmpdir; zero AWS calls executed."
  exit 0
fi

# ------------------------------------------------------------------------------
# Live Seeding Mode (--apply): Dedicated MFA-Enforced Foundation Admin Role ONLY
# ------------------------------------------------------------------------------
echo "[1/3] Verifying dedicated MFA-protected Foundation Admin role (${IMMUTABLE_ADMIN_ROLE_NAME})..."
STS_OUT="${TMP_DIR}/sts.json"
ROLE_OUT="${TMP_DIR}/admin_role.json"
aws sts get-caller-identity --region "$IMMUTABLE_AWS_REGION" --output json >"$STS_OUT"
aws iam get-role --role-name "$IMMUTABLE_ADMIN_ROLE_NAME" --output json >"$ROLE_OUT"
python3 "${SCRIPT_DIR}/legacy_vault_inspector.py" verify-foundation-admin-mfa "$STS_OUT" "$ROLE_OUT"

echo "[2/3] Inspecting existing parameter names under ${IMMUTABLE_SSM_PREFIX}/ (metadata only, no decryption)..."
EXISTING_JSON="${TMP_DIR}/existing_params.json"
aws ssm describe-parameters \
  --region "$IMMUTABLE_AWS_REGION" \
  --parameter-filters "Key=Name,Option=BeginsWith,Values=${IMMUTABLE_SSM_PREFIX}/" \
  --output json >"$EXISTING_JSON"

echo "[3/3] Writing SecureString parameters via 0600 --cli-input-json files..."
python3 - "$MANIFEST_JSON" "$EXISTING_JSON" "$IMMUTABLE_AWS_REGION" "$ROTATE_PARAM" <<'PYEOF'
import json
import os
import pathlib
import subprocess
import sys

items = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
existing_doc = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
region = sys.argv[3]
rotate_param = sys.argv[4]

expected_kms_alias = "alias/aws/ssm"
kms_proc = subprocess.run(
    ["aws", "kms", "describe-key", "--key-id", expected_kms_alias, "--region", region, "--output", "json"],
    capture_output=True,
    text=True,
    check=False,
)
if kms_proc.returncode != 0:
    raise SystemExit(f"[FATAL] Failed resolving KMS key '{expected_kms_alias}' in {region}: {kms_proc.stderr.strip()}")
canonical_km = json.loads(kms_proc.stdout).get("KeyMetadata", {})
canonical_key_arn = canonical_km.get("Arn") or ""
canonical_key_id = canonical_km.get("KeyId") or ""
valid_keys = {expected_kms_alias, canonical_key_arn, canonical_key_id} - {"", None}

existing_by_name = {p["Name"]: p for p in existing_doc.get("Parameters", [])}
existing_names = set(existing_by_name.keys())

if rotate_param and rotate_param not in existing_names:
    raise SystemExit(f"[FATAL] --rotate-parameter target '{rotate_param}' does not exist yet; omit --rotate-parameter for initial seed.")

for item in items:
    name = item["name"]
    pfile = item["payload_file"]
    try:
        if name in existing_by_name:
            p_meta = existing_by_name[name]
            p_type = p_meta.get("Type")
            p_key = p_meta.get("KeyId") or ""
            if p_type != "SecureString":
                raise SystemExit(
                    f"[FATAL] Existing parameter '{name}' has Type='{p_type}' (expected SecureString). "
                    "Seeder refuses to skip insecure or conflicting plain String parameter!"
                )
            if not p_key:
                raise SystemExit(
                    f"[FATAL] Existing parameter '{name}' has missing or empty KeyId. "
                    "Seeder refuses to skip parameter with unknown encryption key!"
                )
            if p_key not in valid_keys:
                raise SystemExit(
                    f"[FATAL] Existing parameter '{name}' has KeyId='{p_key}' "
                    f"(expected '{expected_kms_alias}' or '{canonical_key_arn}'). "
                    "Seeder refuses to skip parameter encrypted with unexpected customer-managed key!"
                )
            tag_proc = subprocess.run(
                ["aws", "ssm", "list-tags-for-resource", "--region", region, "--resource-type", "Parameter", "--resource-id", name],
                capture_output=True,
                text=True,
                check=False,
            )
            if tag_proc.returncode != 0:
                raise SystemExit(
                    f"[FATAL] Failed retrieving tags for existing parameter '{name}' ({tag_proc.stderr.strip()}). "
                    "Tag lookup failure is fatal; refusing to verify parameter ownership!"
                )
            tag_list = json.loads(tag_proc.stdout).get("TagList", [])
            tag_map = {t.get("Key"): t.get("Value") for t in tag_list if isinstance(t, dict)}
            if tag_map.get("Project") != "EnvScale":
                raise SystemExit(
                    f"[FATAL] Existing parameter '{name}' has Project tag '{tag_map.get('Project')}' "
                    "(strictly requires 'EnvScale')! Seeder refuses to adopt untagged or non-EnvScale parameter."
                )

        if rotate_param:
            if name != rotate_param:
                continue
        elif name in existing_names:
            print(f"      [PRESERVED-VERIFIED] {name} already exists (verified Type=SecureString, KeyId={existing_by_name[name].get('KeyId')}, Project=EnvScale).")
            continue

        proc = subprocess.run(
            ["aws", "ssm", "put-parameter", "--region", region, "--cli-input-json", f"file://{pfile}"],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise SystemExit(f"[FATAL] Failed writing {name}: {proc.stderr.strip()}")
        ver = json.loads(proc.stdout).get("Version", "?")
        action = "ROTATED" if item["rotate"] else "SEEDED"
        print(f"      [{action}] {name} (version={ver}, type=SecureString, key=alias/aws/ssm)")
    finally:
        if os.path.exists(pfile):
            os.unlink(pfile)
PYEOF

echo "[SUCCESS] Out-of-band SecureString parameter seeding complete (zero Terraform state exposure)."
