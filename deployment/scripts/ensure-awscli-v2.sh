#!/usr/bin/env bash
# Idempotently ensure AWS CLI v2 is installed in /usr/local/bin (Ubuntu 22.04 apt ships v1).
set -euo pipefail

BIN_DIR="${AWSCLI_BIN_DIR:-/usr/local/bin}"
INSTALL_DIR="${AWSCLI_INSTALL_DIR:-/usr/local/aws-cli}"
case ":$PATH:" in *":${BIN_DIR}:"*) ;; *) PATH="${PATH}:${BIN_DIR}";; esac
export PATH

_is_v2_bin() {
  local bin_path="$1"
  [[ -x "$bin_path" ]] && "$bin_path" --version 2>&1 | grep -Eq '^aws-cli/2\.'
}

if _is_v2_bin "${BIN_DIR}/aws"; then
  exit 0
fi
if EXISTING_AWS="$(command -v aws 2>/dev/null || true)" && [[ -n "$EXISTING_AWS" ]] && _is_v2_bin "$EXISTING_AWS"; then
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "[FATAL] curl is required to install AWS CLI v2." >&2; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_SLUG="x86_64" ;;
  aarch64|arm64) ARCH_SLUG="aarch64" ;;
  *) echo "[FATAL] Unsupported CPU architecture for AWS CLI v2 bundle: ${ARCH}" >&2; exit 1 ;;
esac

BUNDLE_URL="${AWSCLI_BUNDLE_URL:-https://awscli.amazonaws.com/awscli-exe-linux-${ARCH_SLUG}.zip}"
TMP_DIR="$(mktemp -d /tmp/envscale_awscli_v2_XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "[INFO] Upgrading host AWS CLI to v2 from ${BUNDLE_URL}..." >&2
curl -fsSL --retry 3 --max-time 120 "$BUNDLE_URL" -o "${TMP_DIR}/awscliv2.zip" || {
  echo "[FATAL] Failed downloading AWS CLI v2 bundle from ${BUNDLE_URL}." >&2
  exit 1
}

if command -v unzip >/dev/null 2>&1; then
  unzip -q "${TMP_DIR}/awscliv2.zip" -d "$TMP_DIR"
else
  python3 - "${TMP_DIR}/awscliv2.zip" "$TMP_DIR" <<'PYEOF'
import os, pathlib, sys, zipfile
zip_path, dest_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as zf:
    zf.extractall(dest_dir)
    for info in zf.infolist():
        mode = (info.external_attr >> 16) & 0o777
        if mode:
            target = pathlib.Path(dest_dir) / info.filename
            if target.exists() and not target.is_symlink():
                os.chmod(target, mode)
PYEOF
fi

mkdir -p "$BIN_DIR" "$(dirname "$INSTALL_DIR")"
"${TMP_DIR}/aws/install" --bin-dir "$BIN_DIR" --install-dir "$INSTALL_DIR" --update >/dev/null || {
  echo "[FATAL] AWS CLI v2 installer failed (--bin-dir ${BIN_DIR})." >&2
  exit 1
}

if ! _is_v2_bin "${BIN_DIR}/aws"; then
  VER_OUT="$("${BIN_DIR}/aws" --version 2>&1 || true)"
  echo "[FATAL] Expected aws-cli/2.x at ${BIN_DIR}/aws after install, got '${VER_OUT}'." >&2
  exit 1
fi

