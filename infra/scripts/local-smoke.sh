#!/usr/bin/env bash
# LOCAL / CI TEST ONLY. Runs the real production path on this machine and
# checks it end to end, so deploy changes are proven before they reach the
# server:
#   1. builds both images and pushes them to a throwaway local registry
#   2. deploys with deploy.sh, exactly as GitHub Actions does on the server
#      (pull, one-off migration container, switch, /health, /ready once)
#   3. checks the site through Caddy (HTTPS from Caddy's internal CA for
#      `localhost`): API, client, cache and security headers, closed ports
#   4. backup → wipe → restore → verify, with backup.sh and restore.sh
#   5. a release that fails its health check rolls back to the previous one
#   6. a release whose migrations fail never switches
#   7. a manual rollback works from the images kept on the server
# Everything it creates (containers, volumes, registry, temp folder) is
# removed at the end. Needs Docker, curl and free ports 80, 443 and 5555.
#
# Usage, from the repo root:
#   infra/scripts/local-smoke.sh
#   KEEP=1 infra/scripts/local-smoke.sh        # leave the stack running to poke at
# DOCKER_BUILD_FLAGS adds flags to both `docker build`s (e.g. a --build-context).
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
registry_port=5555
registry=localhost:$registry_port
prefix=$registry/heartpatch-smoke
project=heartpatch-smoke
HP_DIR=$(mktemp -d)
export HP_DIR
read -r -a build_flags <<<"${DOCKER_BUILD_FLAGS:-}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
pass() { printf '  ok: %s\n' "$*"; }
fail() {
  printf '  FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ ${KEEP:-} == 1 ]]; then
    printf '\nKEEP=1: stack left running. Stack folder: %s\n' "$HP_DIR"
    printf 'Stop it with: (cd %s && docker compose down -v) && docker rm -f %s-registry\n' "$HP_DIR" "$project"
    return
  fi
  step "cleaning up"
  (cd "$HP_DIR" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
  docker rm -f "$project-registry" >/dev/null 2>&1 || true
  rm -rf "$HP_DIR"
}
trap cleanup EXIT

compose() { (cd "$HP_DIR" && docker compose "$@"); }
psql_value() { compose exec -T db psql -U heartpatch -d heartpatch -tAc "$1"; }
https() { curl -fsS --insecure --max-time 10 "$@"; }
# Puts a release in the "incoming" folder, as the deploy workflow does over SSH.
stage() {
  mkdir -p "$HP_DIR/incoming"
  cp "$repo/infra/compose/docker-compose.prod.yml" "$repo"/infra/scripts/{deploy,backup,restore}.sh "$HP_DIR/incoming/"
}
current_version() { https https://localhost/api/v1/health | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }

step "starting a throwaway registry on $registry"
docker rm -f "$project-registry" >/dev/null 2>&1 || true
docker run -d --name "$project-registry" -p "127.0.0.1:$registry_port:5000" registry:2 >/dev/null

step "building images"
docker build "${build_flags[@]}" -f "$repo/infra/docker/server.Dockerfile" \
  --build-arg APP_VERSION=good-1 -t "$prefix-server:good-1" "$repo"
docker build "${build_flags[@]}" -f "$repo/infra/docker/caddy.Dockerfile" \
  -t "$prefix-caddy:good-1" "$repo"
# Release 2: starts, but never answers /health (rollback test).
printf 'FROM %s\nCMD ["node", "-e", "setInterval(() => {}, 1000)"]\n' "$prefix-server:good-1" |
  docker build -q -t "$prefix-server:no-health" - >/dev/null
# Release 3: its migrations fail (must never switch).
printf 'FROM %s\nUSER root\nRUN echo "process.exit(1)" > dist/db/cli.js\nUSER node\n' "$prefix-server:good-1" |
  docker build -q -t "$prefix-server:bad-migration" - >/dev/null
# Release 4: a good release again (tests the second successful deploy + pruning).
docker tag "$prefix-server:good-1" "$prefix-server:good-2"
for tag in no-health bad-migration good-2; do docker tag "$prefix-caddy:good-1" "$prefix-caddy:$tag"; done
for tag in good-1 no-health bad-migration good-2; do
  docker push -q "$prefix-server:$tag" >/dev/null
  docker push -q "$prefix-caddy:$tag" >/dev/null
done
# Deploys must pull from the registry, like the server does.
for tag in good-1 no-health bad-migration good-2; do
  docker image rm "$prefix-server:$tag" "$prefix-caddy:$tag" >/dev/null
done

step "writing a production-style .env in $HP_DIR"
sed \
  -e "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" \
  -e "s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 64 | tr -d '\n')|" \
  -e "s/^HP_SIGNUP_CODE=$/HP_SIGNUP_CODE=$(tr -dc a-km-np-z2-9 </dev/urandom | head -c 10)/" \
  -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=https://localhost|" \
  "$repo/infra/compose/.env.prod.example" >"$HP_DIR/.env"
cat >>"$HP_DIR/.env" <<ENV
COMPOSE_PROJECT_NAME=$project
HEARTPATCH_IMAGE_PREFIX=$prefix
HP_SITE_ADDRESS=localhost
ENV
chmod 600 "$HP_DIR/.env"

step "first deploy: good-1"
stage
"$HP_DIR/incoming/deploy.sh" good-1 || fail "first deploy failed"
[[ $(current_version) == good-1 ]] || fail "health reports $(current_version), not good-1"
pass "/api/v1/health through Caddy reports version good-1"
grep -qx 'HEARTPATCH_TAG=good-1' "$HP_DIR/.env" || fail ".env does not record good-1"
pass ".env records HEARTPATCH_TAG=good-1"
[[ $(stat -c %a "$HP_DIR/.env") == 600 ]] || fail ".env is not mode 600"
pass ".env is still mode 600"

step "checking the site through Caddy"
https https://localhost/api/v1/ready | grep -q '"status":"ready"' || fail "/api/v1/ready"
pass "/api/v1/ready is ready"
migrations=$(psql_value 'select count(*) from drizzle.__drizzle_migrations')
[[ $migrations -gt 0 ]] || fail "no migrations recorded"
pass "the one-off container applied $migrations migration(s)"

headers=$(https -D - -o /dev/null https://localhost/)
html=$(https https://localhost/)
grep -q '<canvas id="game"' <<<"$html" || fail "index.html is not the client"
pass "client index.html is served"
grep -qi '^cache-control: no-cache' <<<"$headers" || fail "index.html is cacheable"
pass "index.html is no-cache"
for header in strict-transport-security content-security-policy x-content-type-options \
  x-frame-options referrer-policy permissions-policy; do
  grep -qi "^$header:" <<<"$headers" || fail "missing $header"
done
pass "security headers present"
grep -qi '^server:' <<<"$headers" && fail "Server header leaks"
pass "no Server header"

asset=$(grep -o '/assets/[^"]*\.js' <<<"$html" | head -n 1)
[[ -n $asset ]] || fail "no hashed JS asset in index.html"
asset_headers=$(https -D - -o /dev/null -H 'Accept-Encoding: zstd, gzip' "https://localhost$asset")
grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$asset_headers" ||
  fail "hashed asset is not long-cached"
pass "hashed assets are cached for a year (immutable)"
grep -qiE '^content-encoding: (zstd|gzip)' <<<"$asset_headers" || fail "asset is not compressed"
pass "assets are compressed ($(grep -i '^content-encoding' <<<"$asset_headers" | tr -d '\r'))"
status=$(curl -s --insecure -o /dev/null -w '%{http_code}' https://localhost/assets/missing-abc123.js)
[[ $status == 404 ]] || fail "missing asset returned $status, not 404"
pass "a missing asset is a 404, not the app shell"
https https://localhost/some/client/route | grep -q '<canvas id="game"' || fail "SPA fallback"
pass "client routes fall back to index.html"
status=$(curl -s -o /dev/null -w '%{http_code}' http://localhost/)
[[ $status == 308 || $status == 301 ]] || fail "HTTP returned $status, not a redirect"
pass "HTTP redirects to HTTPS ($status)"

curl -s --max-time 3 -o /dev/null http://127.0.0.1:3000/ && fail "server port 3000 is reachable from the host"
pass "server port 3000 is not published"
(exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null && fail "Postgres 5432 is reachable from the host"
pass "Postgres 5432 is not published"
[[ $(compose ps --format '{{.Service}} {{.Health}}' | sort | tr '\n' ' ') == "caddy healthy db healthy server healthy " ]] ||
  fail "not every service is healthy: $(compose ps)"
pass "caddy, server and db are healthy"

step "backup → wipe → restore"
compose run --rm --no-deps -T -e NODE_ENV=development server node dist/db/cli.js seed >/dev/null
users_before=$(psql_value 'select count(*) from users')
tiles_before=$(psql_value 'select count(*) from tiles')
[[ $users_before -gt 0 ]] || fail "seed created no users"
pass "test data: $users_before users, $tiles_before tiles"
"$HP_DIR/bin/backup.sh"
dump=$(find "$HP_DIR/backups" -name 'heartpatch-*.dump' | sort | tail -n 1)
[[ -s $dump ]] || fail "no backup written"
[[ $(stat -c %a "$dump") == 600 ]] || fail "backup is not mode 600"
pass "backup written, mode 600: $(basename "$dump")"
# Retention: a 15-day-old dump goes, today's stays.
touch -d '15 days ago' "$HP_DIR/backups/heartpatch-20000101T000000Z.dump"
sleep 1
"$HP_DIR/bin/backup.sh" >/dev/null
[[ ! -e $HP_DIR/backups/heartpatch-20000101T000000Z.dump && -e $dump ]] || fail "14-day retention"
pass "dumps older than 14 days are deleted"

psql_value 'truncate users, maps cascade' >/dev/null
[[ $(psql_value 'select count(*) from users') == 0 ]] || fail "wipe"
pass "wiped users and maps"
# Someone left a psql session open: the swap must still work.
compose exec -T db psql -U heartpatch -d heartpatch -c 'select pg_sleep(600)' >/dev/null 2>&1 &
held=0
for _ in $(seq 1 20); do
  held=$(psql_value "select count(*) from pg_stat_activity where datname = 'heartpatch' and query like '%pg_sleep(600)%' and pid <> pg_backend_pid()")
  [[ $held -ge 1 ]] && break
  sleep 0.5
done
[[ $held -ge 1 ]] || fail "could not hold a session open for the restore test"
RESTORE_CONFIRM=yes "$HP_DIR/bin/restore.sh" "$dump"
wait || true
[[ $(psql_value 'select count(*) from users') == "$users_before" ]] || fail "users not restored"
[[ $(psql_value 'select count(*) from tiles') == "$tiles_before" ]] || fail "tiles not restored"
pass "restored $users_before users and $tiles_before tiles, with another session connected"
https https://localhost/api/v1/ready | grep -q '"status":"ready"' || fail "not ready after restore"
pass "server is ready after the restore"
leftover=$(compose exec -T db psql -U heartpatch -d postgres -tAc \
  "select count(*) from pg_database where datname in ('heartpatch_restore', 'heartpatch_before_restore')")
[[ $leftover == 0 ]] || fail "scratch databases left behind"
pass "no scratch databases left behind"

step "a release that fails /health rolls back"
stage
if "$HP_DIR/incoming/deploy.sh" no-health; then fail "deploy of no-health succeeded"; fi
[[ $(current_version) == good-1 ]] || fail "running $(current_version) after rollback, not good-1"
grep -qx 'HEARTPATCH_TAG=good-1' "$HP_DIR/.env" || fail ".env changed by a failed deploy"
pass "rolled back: good-1 is serving and still recorded in .env"

step "a release whose migrations fail never switches"
stage
if "$HP_DIR/incoming/deploy.sh" bad-migration; then fail "deploy of bad-migration succeeded"; fi
[[ $(current_version) == good-1 ]] || fail "running $(current_version), not good-1"
pass "still serving good-1"

step "second good deploy: good-2"
# An unrelated image whose name looks similar must survive the pruning.
unrelated=$project-unrelated-server:keep
docker tag "$prefix-caddy:good-1" "$unrelated"
stage
"$HP_DIR/incoming/deploy.sh" good-2 || fail "deploy of good-2 failed"
[[ $(current_version) == good-2 ]] || fail "health reports $(current_version), not good-2"
pass "serving good-2"
[[ $(psql_value 'select count(*) from users') == "$users_before" ]] || fail "data lost across deploys"
pass "data survived the deploys"
images=$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -F "$prefix-server" | sort | tr '\n' ' ')
[[ $images == "$prefix-server:good-1 $prefix-server:good-2 " ]] ||
  fail "expected only good-1 and good-2 images to be kept, found: $images"
pass "kept only the current and previous images"
docker image inspect "$unrelated" >/dev/null 2>&1 || fail "pruning removed an unrelated image"
docker image rm "$unrelated" >/dev/null
pass "left other images alone"
tail -n 2 "$HP_DIR/releases.log" | grep -q good-2 || fail "releases.log"
pass "releases.log records the deploys"

step "manual rollback on the server, with no registry access"
docker stop "$project-registry" >/dev/null
# A failed upload can leave a newer compose file behind; a manual run must ignore it.
mkdir -p "$HP_DIR/incoming"
printf '# stale upload\n' >"$HP_DIR/incoming/docker-compose.prod.yml"
"$HP_DIR/bin/deploy.sh" good-1 || fail "manual rollback to good-1 failed"
grep -q 'stale upload' "$HP_DIR/compose.yaml" && fail "manual deploy installed a stale upload"
pass "a manual deploy ignores a stale incoming/ folder"
[[ $(current_version) == good-1 ]] || fail "health reports $(current_version), not good-1"
pass "bin/deploy.sh good-1 used the images kept on the server"

step "all checks passed"
