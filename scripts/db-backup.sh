#!/usr/bin/env bash
# ============================================================================
# VIN-14: Automated Database Backup & Recovery Utility
# ============================================================================
# Usage:
#   ./scripts/db-backup.sh --backup              Create a timestamped compressed backup
#   ./scripts/db-backup.sh --restore <file>       Restore from a backup file (.sql.gz)
#   ./scripts/db-backup.sh --list                 List all available backups
#   ./scripts/db-backup.sh --help                 Show usage information
#
# Environment:
#   Reads DATABASE_URL from .env or falls back to individual Postgres env vars:
#     POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB
# ============================================================================

set -euo pipefail

# ── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Resolve project root (one level up from scripts/) ────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"

# ── Load .env if present ─────────────────────────────────────────────────────
if [[ -f "${PROJECT_ROOT}/apps/api-server/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/apps/api-server/.env"
  set +a
fi

# ── Parse DATABASE_URL or fall back to individual vars ───────────────────────
parse_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    # Format: postgresql://user:password@host:port/dbname
    local url="${DATABASE_URL}"

    # Strip protocol
    local rest="${url#*://}"

    # Extract user:password
    local userpass="${rest%%@*}"
    PGUSER="${userpass%%:*}"
    PGPASSWORD="${userpass#*:}"

    # Extract host:port/dbname
    local hostportdb="${rest#*@}"
    local hostport="${hostportdb%%/*}"
    PGHOST="${hostport%%:*}"
    PGPORT="${hostport#*:}"
    PGDATABASE="${hostportdb#*/}"
  else
    PGUSER="${POSTGRES_USER:-envscale}"
    PGPASSWORD="${POSTGRES_PASSWORD:-envscale_password}"
    PGHOST="${POSTGRES_HOST:-localhost}"
    PGPORT="${POSTGRES_PORT:-5432}"
    PGDATABASE="${POSTGRES_DB:-envscale}"
  fi

  export PGUSER PGPASSWORD PGHOST PGPORT PGDATABASE
}

# ── Verify pg_dump / pg_restore are available ────────────────────────────────
check_dependencies() {
  for cmd in pg_dump pg_restore gzip gunzip; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "Required command '${cmd}' not found. Please install PostgreSQL client tools."
      exit 1
    fi
  done
}

# ── BACKUP ───────────────────────────────────────────────────────────────────
do_backup() {
  parse_database_url
  check_dependencies

  mkdir -p "$BACKUP_DIR"

  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local filename="envscale_backup_${timestamp}.sql.gz"
  local filepath="${BACKUP_DIR}/${filename}"

  log_info "Starting PostgreSQL backup..."
  log_info "  Host:     ${PGHOST}:${PGPORT}"
  log_info "  Database: ${PGDATABASE}"
  log_info "  User:     ${PGUSER}"
  log_info "  Output:   ${filepath}"

  if pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --verbose 2>/dev/null \
    | gzip > "$filepath"; then

    # Validate non-zero file size
    local size
    size="$(stat -c%s "$filepath" 2>/dev/null || stat -f%z "$filepath" 2>/dev/null || echo 0)"
    if [[ "$size" -eq 0 ]]; then
      log_error "Backup file is empty (0 bytes). Backup may have failed."
      rm -f "$filepath"
      exit 1
    fi

    local human_size
    human_size="$(du -h "$filepath" | cut -f1)"
    log_success "Backup completed successfully!"
    log_success "  File: ${filename}"
    log_success "  Size: ${human_size}"
  else
    log_error "pg_dump failed. Check database connectivity and credentials."
    rm -f "$filepath"
    exit 1
  fi
}

# ── RESTORE ──────────────────────────────────────────────────────────────────
do_restore() {
  local backup_file="${1:-}"

  if [[ -z "$backup_file" ]]; then
    log_error "Usage: $0 --restore <backup-file.sql.gz>"
    exit 1
  fi

  if [[ ! -f "$backup_file" ]]; then
    # Try looking in the backups directory
    if [[ -f "${BACKUP_DIR}/${backup_file}" ]]; then
      backup_file="${BACKUP_DIR}/${backup_file}"
    else
      log_error "Backup file not found: ${backup_file}"
      exit 1
    fi
  fi

  parse_database_url
  check_dependencies

  log_info "Starting PostgreSQL restore..."
  log_info "  Source:   ${backup_file}"
  log_info "  Host:     ${PGHOST}:${PGPORT}"
  log_info "  Database: ${PGDATABASE}"
  log_warn "This will overwrite existing data in '${PGDATABASE}'. Press Ctrl+C to abort."
  sleep 3

  if gunzip -c "$backup_file" | pg_restore \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --verbose 2>/dev/null; then

    log_success "Restore completed successfully!"
  else
    log_error "pg_restore encountered errors. Some tables may not have been restored cleanly."
    exit 1
  fi
}

# ── LIST ─────────────────────────────────────────────────────────────────────
do_list() {
  if [[ ! -d "$BACKUP_DIR" ]] || [[ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]]; then
    log_warn "No backups found in ${BACKUP_DIR}"
    return 0
  fi

  log_info "Available backups in ${BACKUP_DIR}:"
  echo ""
  printf "  %-45s %10s %s\n" "FILENAME" "SIZE" "MODIFIED"
  printf "  %-45s %10s %s\n" "────────────────────────────────────────────" "─────────" "────────────────────"

  for f in "${BACKUP_DIR}"/envscale_backup_*.sql.gz; do
    [[ -f "$f" ]] || continue
    local name size modified
    name="$(basename "$f")"
    size="$(du -h "$f" | cut -f1)"
    modified="$(date -r "$f" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c '%y' "$f" 2>/dev/null | cut -d. -f1)"
    printf "  %-45s %10s %s\n" "$name" "$size" "$modified"
  done
  echo ""
}

# ── HELP ─────────────────────────────────────────────────────────────────────
do_help() {
  cat <<EOF

${CYAN}EnvScale — Database Backup & Recovery Utility${NC}

${YELLOW}Usage:${NC}
  $(basename "$0") --backup                Create a timestamped compressed backup
  $(basename "$0") --restore <file>        Restore from a backup file (.sql.gz)
  $(basename "$0") --list                  List all available backups
  $(basename "$0") --help                  Show this help message

${YELLOW}Environment:${NC}
  Reads DATABASE_URL from apps/api-server/.env, or falls back to:
    POSTGRES_USER       (default: envscale)
    POSTGRES_PASSWORD   (default: envscale_password)
    POSTGRES_HOST       (default: localhost)
    POSTGRES_PORT       (default: 5432)
    POSTGRES_DB         (default: envscale)

${YELLOW}Backup Directory:${NC}
  ${BACKUP_DIR}

${YELLOW}Examples:${NC}
  ./scripts/db-backup.sh --backup
  ./scripts/db-backup.sh --restore envscale_backup_20260823_143000.sql.gz
  ./scripts/db-backup.sh --list

EOF
}

# ── Main entry point ─────────────────────────────────────────────────────────
main() {
  local action="${1:-}"

  case "$action" in
    --backup)  do_backup ;;
    --restore) shift; do_restore "$@" ;;
    --list)    do_list ;;
    --help|-h) do_help ;;
    *)
      log_error "Unknown action: '${action}'"
      do_help
      exit 1
      ;;
  esac
}

main "$@"
