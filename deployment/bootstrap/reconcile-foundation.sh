#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Repeatable Foundation Reconciliation & Readiness Entry Point
# ==============================================================================
# Read-only inspection by default; reuses an unexpired RAM MFA session at
# /dev/shm/envscale-admin-sts.json or /dev/shm/envscale-runtime-sts.json without
# re-prompting or persisting temporary credentials.
#
# All bootstrap mutations require --apply-bootstrap + --confirm-plan-sha256 and
# execute strictly through bootstrap-state.sh --bootstrap-foundation-iam.
# Foundation deployments execute strictly through .github/workflows/foundation.yml.
# ==============================================================================

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_ENTRY="${SCRIPT_DIR}/foundation_reconcile_lib.py"

for arg in "$@"; do
  case "$arg" in
    --apply-bootstrap)
      if [[ "${GITHUB_ACTIONS:-}" == "true" || "${CI:-}" == "true" ]]; then
        echo "[FATAL] --apply-bootstrap is forbidden inside CI / GitHub Actions." >&2
        exit 1
      fi
      ;;
  esac
done

exec python3 "${PY_ENTRY}" "$@"

