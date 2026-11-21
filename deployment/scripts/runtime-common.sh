#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Shared Host Runtime Helpers & Secret/Config Preflight
# ==============================================================================

set -euo pipefail
umask 077

RUNTIME_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${RUNTIME_SCRIPT_DIR}/../.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/deployment/docker-compose.prod.yml}"
CADDY_TEMPLATE="${CADDY_TEMPLATE:-${REPO_ROOT}/deployment/Caddyfile.tpl}"
MANIFEST_VALIDATOR="${RUNTIME_SCRIPT_DIR}/validate-release-manifest.py"
RUNTIME_GUARDS="${RUNTIME_SCRIPT_DIR}/runtime-guards.py"

ENVSCALE_CONFIG_DIR="${ENVSCALE_CONFIG_DIR:-/etc/envscale}"
ENVSCALE_STATE_DIR="${ENVSCALE_STATE_DIR:-/var/lib/envscale}"
ENVSCALE_SECRETS_FILE="${ENVSCALE_SECRETS_FILE:-${ENVSCALE_CONFIG_DIR}/secrets.env}"
ENVSCALE_LOCK_FILE="${ENVSCALE_LOCK_FILE:-/var/lock/envscale-deploy.lock}"
ENVSCALE_CADDYFILE_PATH="${ENVSCALE_CADDYFILE_PATH:-/etc/caddy/Caddyfile}"

log_info() {
  printf '[%s] [INFO]  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

log_warn() {
  printf '[%s] [WARN]  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_error() {
  printf '[%s] [ERROR] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

check_secret_file_permissions() {
  local secret_file="$1"
  local local_smoke="${2:-false}"

  if [[ -L "$secret_file" ]]; then
    log_error "Refusing symbolic link for secrets file at ${secret_file}"
    return 1
  fi
  if [[ ! -f "$secret_file" ]]; then
    log_error "Secrets file missing at ${secret_file}"
    return 1
  fi

  local mode owner_uid current_uid
  mode="$(stat -c '%a' "$secret_file")"
  owner_uid="$(stat -c '%u' "$secret_file")"
  current_uid="$(id -u)"

  if [[ "$mode" != "600" && "$mode" != "400" ]]; then
    log_error "Secrets file ${secret_file} has insecure mode ${mode} (must be 0600 or 0400)"
    return 1
  fi

  if [[ "$local_smoke" != "true" && "$owner_uid" != "0" && "$owner_uid" != "$current_uid" ]]; then
    log_error "Secrets file ${secret_file} owned by UID ${owner_uid} (expected root 0 or current UID ${current_uid})"
    return 1
  fi
}

# Validates required secrets & host ports (never printing secret values) and
# atomically writes a 0600 Compose environment file combining pinned image refs + secrets.
validate_secrets_and_render_env() {
  local secrets_file="$1"
  local manifest_file="$2"
  local output_env_file="$3"
  local require_ingress="${4:-true}"
  local kubeconfig_host_path="$5"
  local local_smoke="${6:-false}"

  check_secret_file_permissions "$secrets_file" "$local_smoke"

  python3 - "$secrets_file" "$manifest_file" "$output_env_file" "$require_ingress" "$kubeconfig_host_path" "$local_smoke" <<'PYEOF'
import base64
import json
import os
import pathlib
import re
import sys
import tempfile
import urllib.parse

secrets_path, manifest_path, out_path, req_ingress_str, kube_path, smoke_str = sys.argv[1:7]
require_ingress = req_ingress_str.lower() == "true"
local_smoke = smoke_str.lower() == "true"

PLACEHOLDER_PATTERNS = (
    "changeme",
    "replace_me",
    "replace-with",
    "your_",
    "example",
    "placeholder",
    "dummy",
    "todo",
)

def parse_dotenv(path: str) -> dict[str, str]:
    env_map: dict[str, str] = {}
    for lineno, raw in enumerate(pathlib.Path(path).read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            raise SystemExit(f"[SECRET PREFLIGHT FAILED] Malformed assignment on line {lineno} of {path}")
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and ((val[0] == val[-1] == '"') or (val[0] == val[-1] == "'")):
            val = val[1:-1]
        if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", key):
            raise SystemExit(f"[SECRET PREFLIGHT FAILED] Invalid variable name '{key}' on line {lineno}")
        env_map[key] = val
    return env_map

cfg = parse_dotenv(secrets_path)

def require_secret(name: str, min_len: int = 1) -> str:
    val = cfg.get(name, "").strip()
    if not val:
        raise SystemExit(f"[SECRET PREFLIGHT FAILED] Missing or empty required secret: {name}")
    if len(val) < min_len:
        raise SystemExit(f"[SECRET PREFLIGHT FAILED] {name} length ({len(val)}) < minimum {min_len}")
    lower = val.lower()
    for token in PLACEHOLDER_PATTERNS:
        if token in lower and not (local_smoke and name in ("BETTER_AUTH_URL", "CORS_ORIGIN")):
            raise SystemExit(f"[SECRET PREFLIGHT FAILED] {name} contains prohibited placeholder token '{token}'")
    return val

def require_valid_port(name: str, default: str) -> str:
    raw = (cfg.get(name) or os.environ.get(name, default)).strip()
    if not re.fullmatch(r"[0-9]+", raw):
        raise SystemExit(f"[SECRET PREFLIGHT FAILED] {name} must be a numeric TCP port in 1..65535 (got {raw!r})")
    port_num = int(raw)
    if port_num < 1 or port_num > 65535:
        raise SystemExit(f"[SECRET PREFLIGHT FAILED] {name} out of range 1..65535 (got {port_num})")
    return str(port_num)

api_port = require_valid_port("API_HOST_PORT", "3001")
streamer_port = require_valid_port("STREAMER_HOST_PORT", "8080")
web_port = require_valid_port("WEB_HOST_PORT", "3000")
if len({api_port, streamer_port, web_port}) != 3:
    raise SystemExit(
        f"[SECRET PREFLIGHT FAILED] API_HOST_PORT ({api_port}), STREAMER_HOST_PORT ({streamer_port}), "
        f"and WEB_HOST_PORT ({web_port}) must be distinct"
    )

pg_user = cfg.get("POSTGRES_USER", "envscale").strip() or "envscale"
pg_db = cfg.get("POSTGRES_DB", "envscale").strip() or "envscale"
pg_pass = require_secret("POSTGRES_PASSWORD", min_len=16)
redis_pass = require_secret("REDIS_PASSWORD", min_len=16)
jwt_access = require_secret("JWT_ACCESS_SECRET", min_len=32)
jwt_refresh = require_secret("JWT_REFRESH_SECRET", min_len=32)
if jwt_access == jwt_refresh:
    raise SystemExit("[SECRET PREFLIGHT FAILED] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct")

better_auth_secret = require_secret("BETTER_AUTH_SECRET", min_len=32)
better_auth_url = require_secret("BETTER_AUTH_URL", min_len=8)
cors_origin = require_secret("CORS_ORIGIN", min_len=8)
if "*" in [o.strip() for o in cors_origin.split(",")]:
    raise SystemExit("[SECRET PREFLIGHT FAILED] Wildcard '*' in CORS_ORIGIN is prohibited in production")

enc_key = require_secret("KUBECONFIG_ENCRYPTION_KEY", min_len=40)
try:
    decoded_key = base64.b64decode(enc_key, validate=True)
except Exception:
    raise SystemExit("[SECRET PREFLIGHT FAILED] KUBECONFIG_ENCRYPTION_KEY is not valid Base64")
if len(decoded_key) != 32:
    raise SystemExit(
        f"[SECRET PREFLIGHT FAILED] KUBECONFIG_ENCRYPTION_KEY decoded to {len(decoded_key)} bytes (must be 32 bytes for AES-256-GCM)"
    )

if require_ingress:
    dom = require_secret("DUCKDNS_DOMAIN", min_len=2)
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", dom):
        raise SystemExit("[SECRET PREFLIGHT FAILED] DUCKDNS_DOMAIN must match RFC label [a-z0-9-]")
    require_secret("DUCKDNS_TOKEN", min_len=8)

db_url = cfg.get("DATABASE_URL", "").strip()
if not db_url:
    enc_user = urllib.parse.quote(pg_user, safe="")
    enc_pw = urllib.parse.quote(pg_pass, safe="")
    enc_db = urllib.parse.quote(pg_db, safe="")
    db_url = f"postgresql://{enc_user}:{enc_pw}@postgres:5432/{enc_db}"

redis_url = cfg.get("REDIS_URL", "").strip()
if not redis_url:
    enc_rpw = urllib.parse.quote(redis_pass, safe="")
    redis_url = f"redis://:{enc_rpw}@redis:6379/0"

manifest = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8"))

rendered = {
    "COMPOSE_PROJECT_NAME": cfg.get("COMPOSE_PROJECT_NAME") or os.environ.get("COMPOSE_PROJECT_NAME", "envscale"),
    "POSTGRES_VOLUME_NAME": cfg.get("POSTGRES_VOLUME_NAME") or os.environ.get("POSTGRES_VOLUME_NAME", "envscale_postgres_data"),
    "REDIS_VOLUME_NAME": cfg.get("REDIS_VOLUME_NAME") or os.environ.get("REDIS_VOLUME_NAME", "envscale_redis_data"),
    "IMAGE_PULL_POLICY": "missing" if local_smoke else "always",
    "STREAMER_UID_GID": f"{os.getuid()}:{os.getgid()}" if local_smoke else cfg.get("STREAMER_UID_GID", "10001:10001"),
    "API_HOST_PORT": api_port,
    "STREAMER_HOST_PORT": streamer_port,
    "WEB_HOST_PORT": web_port,
    "K3S_KUBECONFIG_HOST_PATH": kube_path,
    "API_SERVER_IMAGE": manifest["images"]["api_server"]["pinned_ref"],
    "STREAMER_IMAGE": manifest["images"]["k8s_streamer"]["pinned_ref"],
    "WEB_IMAGE": manifest["images"]["web"]["pinned_ref"],
    "POSTGRES_USER": pg_user,
    "POSTGRES_PASSWORD": pg_pass,
    "POSTGRES_DB": pg_db,
    "REDIS_PASSWORD": redis_pass,
    "DATABASE_URL": db_url,
    "REDIS_URL": redis_url,
    "JWT_ACCESS_SECRET": jwt_access,
    "JWT_REFRESH_SECRET": jwt_refresh,
    "BETTER_AUTH_SECRET": better_auth_secret,
    "BETTER_AUTH_URL": better_auth_url,
    "KUBECONFIG_ENCRYPTION_KEY": enc_key,
    "CORS_ORIGIN": cors_origin,
    "DUCKDNS_DOMAIN": cfg.get("DUCKDNS_DOMAIN", ""),
    "DUCKDNS_TOKEN": cfg.get("DUCKDNS_TOKEN", ""),
    "GOOGLE_CLIENT_ID": cfg.get("GOOGLE_CLIENT_ID", ""),
    "GOOGLE_CLIENT_SECRET": cfg.get("GOOGLE_CLIENT_SECRET", ""),
    "GITHUB_CLIENT_ID": cfg.get("GITHUB_CLIENT_ID", ""),
    "GITHUB_CLIENT_SECRET": cfg.get("GITHUB_CLIENT_SECRET", ""),
}

out_file = pathlib.Path(out_path)
out_file.parent.mkdir(parents=True, exist_ok=True)
fd, tmp_name = tempfile.mkstemp(prefix=".rendered.compose.", dir=str(out_file.parent))
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for k, v in rendered.items():
            if "\n" in v or "\r" in v:
                raise SystemExit(f"[SECRET PREFLIGHT FAILED] Illegal newline in variable {k}")
            escaped = v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
            handle.write(f'{k}="{escaped}"\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_name, out_file)
except BaseException:
    if os.path.exists(tmp_name):
        os.unlink(tmp_name)
    raise
PYEOF
}

emit_rendered_env_subset() {
  local env_file="$1"
  local prefix="$2"
  shift 2

  python3 - "$env_file" "$prefix" "$@" <<'PYEOF'
import pathlib
import shlex
import sys

env_path, prefix = sys.argv[1], sys.argv[2]
keys = sys.argv[3:]

parsed: dict[str, str] = {}
for raw_line in pathlib.Path(env_path).read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    v = v.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        inner = v[1:-1]
        out: list[str] = []
        i = 0
        while i < len(inner):
            if inner[i] == "\\" and i + 1 < len(inner) and inner[i + 1] in ('\\', '"', '$'):
                out.append(inner[i + 1])
                i += 2
            else:
                out.append(inner[i])
                i += 1
        v = "".join(out)
    parsed[k] = v

for key in keys:
    print(f"{prefix}{key}={shlex.quote(parsed.get(key, ''))}")
PYEOF
}

write_atomic_0600() {
  local src_file="$1"
  local dst_file="$2"

  python3 - "$src_file" "$dst_file" <<'PYEOF'
import os
import pathlib
import sys
import tempfile

src = pathlib.Path(sys.argv[1]).read_bytes()
dst = pathlib.Path(sys.argv[2])
dst.parent.mkdir(parents=True, exist_ok=True)
fd, tmp_name = tempfile.mkstemp(prefix=f".{dst.name}.", dir=str(dst.parent))
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(src)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_name, dst)
except BaseException:
    if os.path.exists(tmp_name):
        os.unlink(tmp_name)
    raise
PYEOF
}

stage_and_validate_caddy() {
  local env_file="$1"
  local staged_out="$2"

  if ! command -v caddy >/dev/null 2>&1; then
    log_error "Caddy binary not found on PATH while ingress is enabled"
    return 1
  fi

  eval "$(emit_rendered_env_subset "$env_file" "ING_" DUCKDNS_DOMAIN DUCKDNS_TOKEN API_HOST_PORT STREAMER_HOST_PORT WEB_HOST_PORT)"

  local imds_token public_ip=""
  imds_token="$(curl -fsS --max-time 3 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)"
  if [[ -n "$imds_token" ]]; then
    public_ip="$(curl -fsS --max-time 3 -H "X-aws-ec2-metadata-token: ${imds_token}" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
  fi
  [[ -z "$public_ip" ]] && public_ip="$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]' || true)"

  python3 "$RUNTIME_GUARDS" render-caddyfile \
    --template "$CADDY_TEMPLATE" \
    --output "$staged_out" \
    --public-ip "$public_ip" \
    --domain "$ING_DUCKDNS_DOMAIN" \
    --api-port "$ING_API_HOST_PORT" \
    --streamer-port "$ING_STREAMER_HOST_PORT" \
    --web-port "$ING_WEB_HOST_PORT"

  if ! caddy validate --config "$staged_out" --adapter caddyfile >/dev/null; then
    rm -f "$staged_out"
    log_error "Staged Caddyfile failed caddy validate"
    return 1
  fi

  local dns_resp
  dns_resp="$(curl -fsS --max-time 10 --config - <<CURLEOF || echo "FAILED"
url = "https://www.duckdns.org/update?domains=${ING_DUCKDNS_DOMAIN}&token=${ING_DUCKDNS_TOKEN}&ip=${public_ip}"
CURLEOF
)"
  if [[ "$dns_resp" != OK* ]]; then
    rm -f "$staged_out"
    log_error "DuckDNS pre-cutover update failed (${dns_resp})"
    return 1
  fi
}

_install_caddy_target() {
  local src="$1" dst="$2"
  local dst_dir
  dst_dir="$(dirname "$dst")"
  if [[ "$(id -u)" -eq 0 ]]; then
    mkdir -p "$dst_dir"
    install -m 0644 "$src" "$dst"
  else
    sudo mkdir -p "$dst_dir"
    sudo install -m 0644 "$src" "$dst"
  fi
}

_reload_caddy_daemon() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl reload caddy || systemctl restart caddy
  else
    sudo systemctl reload caddy || sudo systemctl restart caddy
  fi
}

promote_caddy_with_recovery() {
  local staged_caddy="$1"
  local target_caddy="$ENVSCALE_CADDYFILE_PATH"
  local backup_caddy="${ENVSCALE_CONFIG_DIR}/Caddyfile.prev.bak"
  local had_prev="false"

  if [[ -f "$target_caddy" ]]; then
    cp -f "$target_caddy" "$backup_caddy"
    chmod 600 "$backup_caddy"
    had_prev="true"
  fi

  if _install_caddy_target "$staged_caddy" "$target_caddy" && _reload_caddy_daemon; then
    rm -f "$staged_caddy"
    return 0
  fi

  log_error "Caddy install/reload failed during cutover! Restoring previous Caddy configuration..."
  if [[ "$had_prev" == "true" ]]; then
    _install_caddy_target "$backup_caddy" "$target_caddy" || true
    _reload_caddy_daemon || true
  else
    if [[ "$(id -u)" -eq 0 ]]; then rm -f "$target_caddy"; else sudo rm -f "$target_caddy" || true; fi
  fi
  rm -f "$staged_caddy"
  return 1
}

stage_kubeconfig_file() {
  local source_kubeconfig="$1"
  local target_kubeconfig="$2"
  local local_smoke="$3"

  if [[ -L "$target_kubeconfig" ]]; then
    log_error "Refusing symbolic link at kubeconfig target ${target_kubeconfig}"
    return 1
  fi

  mkdir -p "$(dirname "$target_kubeconfig")"

  if [[ "$local_smoke" == "true" ]]; then
    if [[ ! -f "$target_kubeconfig" ]]; then
      (umask 077 && : > "$target_kubeconfig")
    fi
    chmod 600 "$target_kubeconfig"
    return 0
  fi

  if [[ -L "$source_kubeconfig" || ! -s "$source_kubeconfig" ]]; then
    log_error "Source K3s kubeconfig missing, empty, or symlinked at ${source_kubeconfig}"
    return 1
  fi

  local tmp_kube="${target_kubeconfig}.tmp.$$"
  if [[ "$(id -u)" -eq 0 ]]; then
    install -m 0640 -o 0 -g 10001 /dev/null "$tmp_kube"
    sed 's|https://127.0.0.1:6443|https://host.docker.internal:6443|g' "$source_kubeconfig" > "$tmp_kube"
    chown 0:10001 "$tmp_kube"
    chmod 0640 "$tmp_kube"
    mv -f "$tmp_kube" "$target_kubeconfig"
  else
    sudo install -m 0640 -o 0 -g 10001 /dev/null "$tmp_kube"
    sudo sh -c 'sed "s|https://127.0.0.1:6443|https://host.docker.internal:6443|g" "$1" > "$2"' _ "$source_kubeconfig" "$tmp_kube"
    sudo chown 0:10001 "$tmp_kube"
    sudo chmod 0640 "$tmp_kube"
    sudo mv -f "$tmp_kube" "$target_kubeconfig"
  fi
}

append_release_ledger() {
  local state_dir="$1"
  local event_status="$2"
  local manifest_file="$3"
  local detail="$4"

  mkdir -p "${state_dir}/releases"
  chmod 700 "${state_dir}" "${state_dir}/releases" 2>/dev/null || true

  python3 - "${state_dir}/releases/history.jsonl" "$event_status" "$manifest_file" "$detail" <<'PYEOF'
import datetime as dt
import json
import os
import pathlib
import sys

ledger_path, status, manifest_path, detail = sys.argv[1:5]
manifest = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8"))
compat = manifest["compatibility"]
record = {
    "recorded_at_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "status": status,
    "release_id": manifest["release_id"],
    "commit_sha": manifest["git"]["commit_sha"],
    "images": {k: v["pinned_ref"] for k, v in manifest["images"].items()},
    "drizzle_migrations_bundle_sha256": compat["drizzle_migrations_bundle_sha256"],
    "drizzle_journal_entries": compat["drizzle_journal_entries"],
    "drizzle_migrations": compat["drizzle_migrations"],
    "backward_compatible_db": compat["backward_compatible_db"],
    "detail": detail,
}
fd = os.open(ledger_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
with os.fdopen(fd, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record) + "\n")
    handle.flush()
    os.fsync(handle.fileno())
PYEOF
}
