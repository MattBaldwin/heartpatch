#!/usr/bin/env bash
# Restores a backup from backup.sh, replacing the live database.
#
# Usage (as the deploy user, on the server):
#   /opt/heartpatch/bin/restore.sh /opt/heartpatch/backups/heartpatch-<time>.dump
#
# What it does:
#   1. Checks the dump is readable, and waits out any running deploy.
#   2. Takes a fresh safety backup of the current database (backup.sh).
#   3. Restores the dump into a scratch database, `heartpatch_restore`, in one
#      transaction. The live database is untouched and players keep playing;
#      if this fails, nothing has changed.
#   4. Stops the game server and swaps the databases by renaming them.
#   5. Applies any migrations the dump predates, starts the server, and checks
#      /api/v1/health and /api/v1/ready.
# Players can't play during steps 4–5 (usually a few seconds).
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
sql() { db psql -U heartpatch -d postgres -v ON_ERROR_STOP=1 -qtAc "$1"; }

log "checking $dump"
db pg_restore --list <"$dump" >/dev/null || fail "$dump is not a readable backup"

if [[ ${RESTORE_CONFIRM:-} != yes ]]; then
  printf 'This REPLACES the live database with %s.\nType "restore" to continue: ' "$dump"
  read -r answer
  [[ $answer == restore ]] || fail "cancelled; nothing changed"
fi

# The same lock as deploy.sh, so a deploy can't switch images mid-restore.
exec 9>"$HP_DIR/.deploy.lock"
flock -w 600 9 || fail "a deploy has been running for 10 minutes; try again later"

log "taking a safety backup of the current database first"
"$script_dir/backup.sh"

log "restoring into a scratch database (the live one keeps running)"
db dropdb -U heartpatch --if-exists --force heartpatch_restore
db createdb -U heartpatch -O heartpatch heartpatch_restore
if ! db pg_restore -U heartpatch -d heartpatch_restore --no-owner --exit-on-error --single-transaction <"$dump"; then
  db dropdb -U heartpatch --if-exists --force heartpatch_restore || true
  fail "restore failed; the live database was not touched"
fi

log "stopping the game server and swapping in the restored database"
previous=heartpatch_before_restore
sql "DROP DATABASE IF EXISTS $previous WITH (FORCE)"
docker compose stop server

# A rename fails while anyone is connected (a psql left open, the nightly
# backup). Refuse new connections, then end the existing ones, so nothing can
# sneak in between. `connections` turns them back on for a database.
connections() { sql "ALTER DATABASE $1 ALLOW_CONNECTIONS $2"; }
end_sessions() {
  sql "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity
       WHERE datname IN ('heartpatch', 'heartpatch_restore') AND pid <> pg_backend_pid()" >/dev/null
}

# If the swap fails, the live database is unchanged: start the server again and say so.
if ! connections heartpatch false || ! end_sessions || ! sql "ALTER DATABASE heartpatch RENAME TO $previous"; then
  connections heartpatch true || true
  docker compose up -d --wait --wait-timeout 120 server || true
  fail "could not swap the databases; the live database is unchanged and the server is running again. The restored copy is in heartpatch_restore"
fi
if ! sql "ALTER DATABASE heartpatch_restore RENAME TO heartpatch"; then
  sql "ALTER DATABASE $previous RENAME TO heartpatch" || true
  connections heartpatch true || true
  docker compose up -d --wait --wait-timeout 120 server || true
  fail "could not swap the databases; the live database is back in place and the server is running again"
fi

undo() {
  log "ERROR: $1. Putting the previous database back" >&2
  docker compose stop server || true
  connections heartpatch false || true
  end_sessions || true
  sql "DROP DATABASE IF EXISTS heartpatch_restore WITH (FORCE)" || true
  sql "ALTER DATABASE heartpatch RENAME TO heartpatch_restore" || true
  sql "ALTER DATABASE $previous RENAME TO heartpatch" ||
    fail "could not put the previous database back: the server is stopped and the data is in the '$previous' database. See docs/DEPLOY.md, Troubleshooting"
  connections heartpatch true || true
  docker compose up -d --wait --wait-timeout 120 server || true
  fail "$1; the previous database is back in place and nothing changed"
}

fetch() {
  docker compose exec -T server node -e "
    fetch('$1').then(async (r) => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); },
      (e) => { console.log(String(e)); process.exit(1); });"
}

# An older dump may predate the running release's schema: bring it up to date.
log "applying any newer migrations"
docker compose run --rm --no-deps -T server node dist/db/cli.js migrate ||
  undo "migrations failed on the restored database"

log "starting the game server"
docker compose up -d --wait --wait-timeout 120 server || undo "the server did not become healthy"
fetch http://127.0.0.1:3000/api/v1/health || undo "/api/v1/health failed after restore"
fetch http://127.0.0.1:3000/api/v1/ready || undo "/api/v1/ready failed after restore"

# The safety backup holds the same data, so the old copy isn't kept twice.
sql "DROP DATABASE $previous WITH (FORCE)"

count() { db psql -U heartpatch -d heartpatch -tAc "$1"; }
tables=$(count "select count(*) from information_schema.tables where table_schema = 'public'")
migrations=$(count "select count(*) from drizzle.__drizzle_migrations")
log "restored $dump: $tables tables, $migrations migrations applied"
