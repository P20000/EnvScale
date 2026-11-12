#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Unified CLI & Host Runtime Entrypoint
# ==============================================================================
# - On EC2 Runtime Host (/opt/envscale): dispatches 'deploy', 'rollback', and
#   'verify' directly to the digest-pinned host runtime scripts under
#   deployment/scripts/ (zero floating tags, zero ignored SQL errors).
# - On Developer Workstations: delegates CLI invocations to scripts/test-center.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CENTER="${SCRIPT_DIR}/scripts/test-center"
RUNTIME_SCRIPTS="${SCRIPT_DIR}/deployment/scripts"

if [[ -d "/opt/envscale" && "$SCRIPT_DIR" == "/opt/envscale" ]]; then
  cmd="${1:-}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "$cmd" in
    deploy)
      exec "${RUNTIME_SCRIPTS}/host-runtime.sh" "$@"
      ;;
    rollback)
      exec "${RUNTIME_SCRIPTS}/rollback.sh" "$@"
      ;;
    verify)
      exec "${RUNTIME_SCRIPTS}/verify.sh" "$@"
      ;;
    *)
      echo "Usage on EC2 host: ./envscale.sh <deploy|rollback|verify> [options]" >&2
      exit 1
      ;;
  esac
fi

if [[ ! -f "$TEST_CENTER" ]]; then
  echo "[ERROR] Test Center CLI not found at ${TEST_CENTER}" >&2
  exit 1
fi

exec "$TEST_CENTER" --cli "$@"
