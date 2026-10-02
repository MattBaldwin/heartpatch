#!/usr/bin/env bash
# Restores a backup from backup.sh, replacing the live database.
#
# Usage (as the deploy user, on the server):
#   /opt/heartpatch/bin/restore.sh /opt/heartpatch/backups/heartpatch-<time>.dump
#
# What it does:
#   1. Checks the dump is readable.
#   2. Takes a fresh safety backup of the current database (backup.sh).
#   3. Stops the game server so nothing writes during the restore.
#   4. Drops and recreates the database and restores the dump in one transaction.
#   5. Applies any migrations the dump predates.
#   6. Starts the server and checks /api/v1/health and /api/v1/ready.
# Players can't play during steps 3–6 (usually under a minute).
#
# Environment (for testing; the defaults are right on the server):
#   HP_DIR          stack folder holding compose.yaml and .env (default /opt/heartpatch)
#   RESTORE_CONFIRM set to "yes" to skip the "type restore" prompt
set -euo pipefail

HP_DIR=${HP_DIR:-/opt/heartpatch}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

log() { printf '%s restore: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() {
  log "ERROR: $*" >&2
  exit 1
}

dump=${1:-}
[[ -n $dump ]] || fail "usage: restore.sh <backup .dump file>   (list them: ls -lh $HP_DIR/backups)"
dump=$(cd "$(dirname "$dump")" && pwd)/$(basename "$dump")
[[ -f $dump ]] || fail "no such file: $dump"

cd "$HP_DIR"
db() { docker compose exec -T db "$@"; }

log "checking $dump"
db pg_restore --list <"$dump" >/dev/null || fail "$dump is not a readable backup"

if [[ ${RESTORE_CONFIRM:-} != yes ]]; then
  printf 'This REPLACES the live database with %s.\nType "restore" to continue: ' "$dump"
  read -r answer
  [[ $answer == restore ]] || fail "cancelled; nothing changed"
fi

log "taking a safety backup of the current database first"
"$script_dir/backup.sh"

log "stopping the game server"
docker compose stop server

log "replacing the database"
db dropdb -U heartpatch --if-exists --force heartpatch
db createdb -U heartpatch -O heartpatch heartpatch
if ! db pg_restore -U heartpatch -d heartpatch --no-owner --exit-on-error --single-transaction <"$dump"; then
  fail "restore failed, so the database is empty and the server is stopped. Restore the safety backup above (the newest file in $HP_DIR/backups) with this script"
fi

# An older dump may predate the running release's schema: bring it up to date.
log "applying any newer migrations"
docker compose run --rm --no-deps -T server node dist/db/cli.js migrate

log "starting the game server"
docker compose up -d --wait --wait-timeout 120 server

fetch() {
  docker compose exec -T server node -e "
    fetch('$1').then(async (r) => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); },
      (e) => { console.log(String(e)); process.exit(1); });"
}
fetch http://127.0.0.1:3000/api/v1/health || fail "/api/v1/health failed after restore"
fetch http://127.0.0.1:3000/api/v1/ready || fail "/api/v1/ready failed after restore"

tables=$(db psql -U heartpatch -d heartpatch -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
migrations=$(db psql -U heartpatch -d heartpatch -tAc \
  "select count(*) from drizzle.__drizzle_migrations")
log "restored $dump: $tables tables, $migrations migrations applied"
