#!/usr/bin/env bash
# Nightly Postgres backup (tech spec §11): a compressed pg_dump of the
# `heartpatch` database, checked before it's kept, with 14 days retained.
#
# Usage (as the deploy user, on the server):
#   /opt/heartpatch/bin/backup.sh
#
# server-setup.sh installs it as a nightly cron job (/etc/cron.d/heartpatch-backup):
#   30 8 * * * deploy /opt/heartpatch/bin/backup.sh >> /opt/heartpatch/backups/backup.log 2>&1
# (08:30 UTC is the middle of the night in the US.) To install it by hand, put
# that line in /etc/cron.d/heartpatch-backup with `sudo nano`.
#
# Restore with restore.sh (docs/DEPLOY.md, "Backups and restore").
#
# Environment (for testing; the defaults are right on the server):
#   HP_DIR      stack folder holding compose.yaml and .env (default /opt/heartpatch)
#   BACKUP_DIR  where dumps go (default $HP_DIR/backups)
#   KEEP_DAYS   days of dumps to keep (default 14)
set -euo pipefail

HP_DIR=${HP_DIR:-/opt/heartpatch}
BACKUP_DIR=${BACKUP_DIR:-$HP_DIR/backups}
KEEP_DAYS=${KEEP_DAYS:-14}

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Dumps hold password hashes: readable by the deploy user only.
umask 077
mkdir -p "$BACKUP_DIR"
cd "$HP_DIR"

exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || {
  log "another backup is running"
  exit 1
}

out="$BACKUP_DIR/heartpatch-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$out.partial"
trap 'rm -f "$partial"' EXIT

# Custom format: compressed, and restore.sh can rebuild the database from it in
# one transaction.
docker compose exec -T db pg_dump -U heartpatch -d heartpatch --format=custom --compress=9 >"$partial"

# A dump that pg_restore can't read is worse than none: check before keeping it.
docker compose exec -T db pg_restore --list <"$partial" >/dev/null

mv "$partial" "$out"
log "wrote $out ($(du -h "$out" | cut -f1))"

# Keep KEEP_DAYS days of dumps.
find "$BACKUP_DIR" -maxdepth 1 -name 'heartpatch-*.dump' -mtime "+$((KEEP_DAYS - 1))" -print -delete |
  while read -r old; do log "deleted $old"; done
