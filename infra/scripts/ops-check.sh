#!/usr/bin/env bash
# Runs a read-only ops check (a dry run) against a throwaway copy of the
# newest nightly backup, and prints only its totals line. GitHub
# Actions' live-data-check workflow runs it on the server; see docs/DEPLOY.md,
# "Dry runs on live data".
#
# The live database is never touched: the dump is restored into a scratch
# Postgres container on its own internal Docker network, which the live stack
# isn't on and which has no way out. The check runs from an image built from
# the branch under test, on that network only, with the scratch database set
# read-only. Everything is removed afterwards, whether the check passed or not.
#
# Usage (as the deploy user, on the server):
#   ops-check.sh preflight             is there a fresh dump and room for a copy?
#   ops-check.sh run <check> <image>   restore, migrate, check, print the results
#   ops-check.sh cleanup               remove anything a stopped run left behind
# <image> is heartpatch-ops-check:<tag>, loaded beforehand with `docker load`.
# `run` prints a `backup: <dump> (<age>)` line, then the check's allowed lines,
# on stdout; progress goes to stderr.
#
# Environment (for testing; the defaults are right on the server):
#   HP_DIR              stack folder holding compose.yaml and .env (default /opt/heartpatch)
#   BACKUP_DIR          where backup.sh writes dumps (default $HP_DIR/backups)
#   OPS_CHECK_PG_IMAGE  scratch Postgres image (default: the stack's own db image)
#   MAX_DUMP_AGE_HOURS  refuse an older newest dump (default 48)
set -euo pipefail

HP_DIR=${HP_DIR:-/opt/heartpatch}
BACKUP_DIR=${BACKUP_DIR:-$HP_DIR/backups}
MAX_DUMP_AGE_HOURS=${MAX_DUMP_AGE_HOURS:-48}
# TUNE: room kept free on the Docker disk beyond the copy itself.
MIN_FREE_MB=1536
# TUNE: a restored database takes a few times its compressed dump.
DUMP_EXPANSION=6

# Every name this script creates. Nothing else is ever removed.
NAME=heartpatch-ops-check
DB_CONTAINER=$NAME-db
RUN_CONTAINER=$NAME-run
NETWORK=$NAME
SCRATCH_DB=heartpatch_scratch

log() { printf '%s ops-check: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
fail() {
  log "ERROR: $*"
  exit 1
}

cd "$HP_DIR"

# The newest dump from backup.sh (its names sort by time). `.partial` files,
# still being written, don't match.
newest_dump() {
  local dumps=("$BACKUP_DIR"/heartpatch-*.dump)
  [[ -f ${dumps[0]} ]] || fail "no backups in $BACKUP_DIR yet (backup.sh runs nightly at 08:30 UTC)"
  printf '%s\n' "${dumps[@]}" | sort | tail -n 1
}

dump_age_hours() { echo $((($(date +%s) - $(stat -c %Y "$1")) / 3600)); }

# Free space where Docker keeps containers and volumes, and what a copy needs.
check_room() {
  local dump=$1 root free_mb need_mb
  root=$(docker info --format '{{.DockerRootDir}}')
  free_mb=$(df -Pm "$root" | awk 'NR == 2 { print $4 }')
  need_mb=$((($(stat -c %s "$dump") * DUMP_EXPANSION) / 1048576 + MIN_FREE_MB))
  ((free_mb >= need_mb)) || fail "only ${free_mb} MB free for Docker; a dry run needs ${need_mb} MB. Nothing was started"
  log "${free_mb} MB free for Docker, a dry run needs about ${need_mb} MB"
}

remove_all() {
  docker rm -f -v "$RUN_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  local images
  mapfile -t images < <(docker image ls "$NAME" --format '{{.Repository}}:{{.Tag}}')
  ((${#images[@]} == 0)) || docker image rm -f "${images[@]}" >/dev/null 2>&1 || true
}

# The same lock as deploy.sh and restore.sh: no deploy or restore while a dry
# run is going on, and only one dry run at a time.
take_lock() {
  exec 9>"$HP_DIR/.deploy.lock"
  flock -w 600 9 || fail "a deploy or restore has been running for 10 minutes; try again later"
}

# What each check runs (its script, then its arguments), and the only lines of
# its output that may leave the server. Lines are matched whole, so an id, a
# name or a log line can't slip out.
check_command() {
  case $1 in
    # --totals: the totals line only, no per-player lines (no ids at all).
    tile-uses-check) echo dist/ops/tile-uses-check.js --totals ;;
    *) fail "unknown check '$1' (allowed: tile-uses-check)" ;;
  esac
}
check_filter() {
  case $1 in
    tile-uses-check)
      grep -E -x \
        -e 'tile-use dry run: [0-9]+ players scanned, [0-9]+ would change: [0-9]+ moved, [0-9]+ packed, [0-9]+ gatherers stopped\.' || true
      ;;
  esac
}
# The line a check must print when it finishes.
check_summary() {
  case $1 in
    tile-uses-check) echo '^tile-use dry run: ' ;;
  esac
}

preflight() {
  local dump age
  dump=$(newest_dump)
  age=$(dump_age_hours "$dump")
  ((age <= MAX_DUMP_AGE_HOURS)) ||
    fail "the newest backup, $(basename "$dump"), is ${age} hours old; check backups/backup.log"
  check_room "$dump"
  log "newest backup: $(basename "$dump") (${age} hours old)"
}

run() {
  local check=$1 image=$2 command script dump pg_image password url work status
  command=$(check_command "$check")
  read -r -a command <<<"$command"
  script=${command[0]}
  [[ $image =~ ^$NAME:[A-Za-z0-9._-]{1,128}$ ]] || fail "image must be $NAME:<tag>, got '$image'"
  docker image inspect "$image" >/dev/null 2>&1 || fail "$image is not loaded on this server"
  docker run --rm --network none "$image" test -f "$script" ||
    fail "this branch has no $script; is it the branch that adds $check?"

  take_lock
  # Raw output stays in here, readable by the deploy user only, and goes with it.
  umask 077
  work=$(mktemp -d)
  # Whatever happens from here on, the scratch copy and the image are removed.
  # shellcheck disable=SC2064 # $work is fixed now, on purpose.
  trap "remove_all; rm -rf '$work'" EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # The runner went away mid-run: stop and clean up rather than carry on unseen.
  trap 'exit 141' PIPE

  # A run the runner lost (cancelled, timed out) is cleaned up here at the latest.
  docker rm -f -v "$RUN_CONTAINER" "$DB_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true

  preflight
  dump=$(newest_dump)
  printf 'backup: %s (%s hours old)\n' "$(basename "$dump")" "$(dump_age_hours "$dump")"

  pg_image=${OPS_CHECK_PG_IMAGE:-$(docker compose config --images | grep -m 1 -E '^postgres:' || true)}
  [[ -n $pg_image ]] || fail "couldn't find the stack's Postgres image in compose.yaml"
  # Made up for this run and never shown: the scratch database is reachable
  # only on its own network anyway.
  password=$(openssl rand -hex 24)
  url="postgres://heartpatch:$password@$DB_CONTAINER:5432/$SCRATCH_DB"

  log "starting a scratch Postgres ($pg_image) on its own internal network"
  docker network create --internal "$NETWORK" >/dev/null
  # Capped so the live game keeps its CPU and memory. No durability: it's thrown away.
  docker run -d --rm --name "$DB_CONTAINER" --network "$NETWORK" \
    --memory 512m --cpus 1 --shm-size 128m --security-opt no-new-privileges:true \
    -e POSTGRES_USER=heartpatch -e POSTGRES_DB="$SCRATCH_DB" -e POSTGRES_PASSWORD="$password" \
    "$pg_image" -c fsync=off -c full_page_writes=off -c synchronous_commit=off >/dev/null
  local ready=false
  for _ in $(seq 1 60); do
    if docker exec "$DB_CONTAINER" pg_isready -q -U heartpatch -d "$SCRATCH_DB" -h 127.0.0.1; then
      ready=true
      break
    fi
    sleep 1
  done
  [[ $ready == true ]] || fail "the scratch Postgres did not start"

  log "restoring $(basename "$dump") into the scratch database"
  docker exec -i "$DB_CONTAINER" pg_restore -U heartpatch -d "$SCRATCH_DB" \
    --no-owner --no-acl --exit-on-error --single-transaction <"$dump" ||
    fail "the restore failed"

  # The check runs from its branch's image: bring the copy up to that branch's schema.
  # (`timeout` stops a stuck one; the EXIT trap then removes its container.)
  check_container() {
    timeout 600 docker run --rm --name "$RUN_CONTAINER" --network "$NETWORK" \
      --memory 512m --cpus 1 --read-only --tmpfs /tmp --cap-drop ALL \
      --security-opt no-new-privileges:true \
      -e NODE_ENV=production -e LOG_LEVEL=warn -e DATABASE_URL="$url" \
      "$image" "$@"
  }
  log "applying the branch's migrations to the copy"
  check_container node dist/db/cli.js migrate >"$work/migrate.log" 2>&1 ||
    fail "the branch's migrations failed on the copy (its log stays on the server and is deleted)"

  # From here on the copy refuses every write, so the check can't change it.
  docker exec "$DB_CONTAINER" psql -U heartpatch -d postgres -v ON_ERROR_STOP=1 -qc \
    "ALTER DATABASE $SCRATCH_DB SET default_transaction_read_only = on" >/dev/null

  log "running $check"
  status=0
  check_container node "${command[@]}" >"$work/out" 2>"$work/err" || status=$?

  local kept dropped
  kept=$(check_filter "$check" <"$work/out")
  dropped=$(($(wc -l <"$work/out") - $(printf '%s' "$kept" | grep -c '^' || true)))
  [[ -z $kept ]] || printf '%s\n' "$kept"
  log "$check exited $status; $dropped other output lines (logs) stayed on the server and were deleted"
  ((status == 0)) || fail "$check failed"
  grep -q -E "$(check_summary "$check")" <<<"$kept" || fail "$check printed no summary line"
  log "done; the scratch copy is being removed"
}

case ${1:-} in
  preflight) preflight ;;
  run)
    [[ $# -eq 3 ]] || fail "usage: ops-check.sh run <check> <image>"
    run "$2" "$3"
    ;;
  cleanup)
    take_lock
    remove_all
    log "removed any scratch containers, network and check images"
    ;;
  *) fail "usage: ops-check.sh preflight | run <check> <image> | cleanup" ;;
esac
