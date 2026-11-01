#!/usr/bin/env bash
# Deploys one image tag on the server, following tech spec §12:
#   pull → migrate in a one-off container → switch → /health → /ready once,
# and rolls back to the previous tag if any step after the switch fails.
#
# Usage (as the deploy user, on the server):
#   /opt/heartpatch/bin/deploy.sh <tag>
#
# GitHub Actions uploads the new compose file and scripts to
# /opt/heartpatch/incoming/ and runs incoming/deploy.sh <commit sha>. Run by
# hand with an older tag to roll back (docs/DEPLOY.md, "Rolling back").
#
# Environment (for testing; the defaults are right on the server):
#   HP_DIR   stack folder holding compose.yaml and .env (default /opt/heartpatch)
set -euo pipefail

HP_DIR=${HP_DIR:-/opt/heartpatch}
HEALTH_URL=http://127.0.0.1:3000/api/v1/health
READY_URL=http://127.0.0.1:3000/api/v1/ready

log() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() {
  log "ERROR: $*" >&2
  exit 1
}

tag=${1:-}
[[ $tag =~ ^[A-Za-z0-9._-]{1,128}$ ]] || fail "usage: deploy.sh <image tag>"

cd "$HP_DIR"
HP_DIR=$(pwd -P)
[[ -f .env ]] || fail "$HP_DIR/.env is missing (docs/DEPLOY.md step 6)"

# One deploy at a time (a push and a manual rollback could otherwise overlap).
exec 9>"$HP_DIR/.deploy.lock"
flock -n 9 || fail "another deploy or a restore is running; try again when it finishes"

# Reads KEY=value from .env without sourcing it (values may hold shell characters).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

# The evolution roll salt is made here on the first deploy and kept for good:
# changing it changes every evolution roll. Only its name is ever logged.
if [[ -z $(env_value HP_EVOLUTION_SALT) ]]; then
  tmp=$(mktemp "$HP_DIR/.env.XXXXXX")
  grep -v '^HP_EVOLUTION_SALT=' .env >"$tmp" || true
  printf 'HP_EVOLUTION_SALT=%s\n' "$(openssl rand -hex 32)" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
  log "generated HP_EVOLUTION_SALT"
fi

# The push nudges' VAPID pair (#726, owner answer 4) is made here on the
# first deploy and kept for good, like the salt: changing it ends every
# phone's nudge subscription. OpenSSL's P-256 key in SEC1 DER is 121 bytes:
# a 7-byte header, the 32-byte private scalar, the curve, then the 65-byte
# uncompressed public point at the end. Both halves go in base64url, as
# `web-push` makes them. The keys stay in memory and .env; only their names
# are logged. Half a pair is never overwritten: the server refuses it.
base64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
vapid_public=$(env_value HP_VAPID_PUBLIC_KEY)
vapid_private=$(env_value HP_VAPID_PRIVATE_KEY)
if [[ -z $vapid_public && -z $vapid_private ]]; then
  der=$(openssl ecparam -name prime256v1 -genkey -noout -outform DER | base64 -w0)
  header=$(printf '%s' "$der" | base64 -d | head -c 7 | od -An -tx1 | tr -d ' \n')
  size=$(printf '%s' "$der" | base64 -d | wc -c)
  [[ $header == 30770201010420 && $size -eq 121 ]] || fail "openssl made a VAPID key in an unexpected shape"
  vapid_private=$(printf '%s' "$der" | base64 -d | head -c 39 | tail -c 32 | base64url)
  vapid_public=$(printf '%s' "$der" | base64 -d | tail -c 65 | base64url)
  unset der
  [[ $vapid_public =~ ^B[A-Za-z0-9_-]{86}$ && $vapid_private =~ ^[A-Za-z0-9_-]{43}$ ]] ||
    fail "openssl made a VAPID key in an unexpected shape"
  tmp=$(mktemp "$HP_DIR/.env.XXXXXX")
  grep -v -e '^HP_VAPID_PUBLIC_KEY=' -e '^HP_VAPID_PRIVATE_KEY=' .env >"$tmp" || true
  printf 'HP_VAPID_PUBLIC_KEY=%s\nHP_VAPID_PRIVATE_KEY=%s\n' "$vapid_public" "$vapid_private" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" .env
  log "generated HP_VAPID_PUBLIC_KEY and HP_VAPID_PRIVATE_KEY"
elif [[ -z $vapid_public || -z $vapid_private ]]; then
  fail "only one of HP_VAPID_PUBLIC_KEY and HP_VAPID_PRIVATE_KEY is set in $HP_DIR/.env (restore both from the .env backup)"
fi
unset vapid_public vapid_private

for key in POSTGRES_PASSWORD HP_SIGNUP_CODE PUBLIC_ORIGIN HP_EVOLUTION_SALT HP_VAPID_PUBLIC_KEY HP_VAPID_PRIVATE_KEY; do
  [[ -n $(env_value "$key") ]] || fail "$key is empty in $HP_DIR/.env (see .env.prod.example)"
done

# A HP_LONG_NIGHT line in .env beats the compose default (on), so an old
# `HP_LONG_NIGHT=off` line can keep the Long Night off. That is also the owner's
# deliberate no-release off switch (#758), so this only warns: it never edits
# .env or fails the deploy. Empty counts as unset, as in compose's `:-on`.
long_night=$(env_value HP_LONG_NIGHT)
if [[ -n $long_night && $long_night != on ]]; then
  log "WARNING: $HP_DIR/.env sets HP_LONG_NIGHT=$long_night, so the Long Night is not on for everyone in production. The compose default is on; delete that line from $HP_DIR/.env to use it."
fi
unset long_night

previous_tag=$(env_value HEARTPATCH_TAG)
site=$(env_value HP_SITE_ADDRESS)
site=${site:-play.pumpkinpatchgames.com}

# The tag is passed through the environment, which wins over .env for compose
# interpolation, and is written to .env only once the deploy has succeeded.
compose() { HEARTPATCH_TAG=$deploy_tag docker compose "$@"; }
deploy_tag=$tag

# Install the uploaded compose file and scripts, keeping the current ones so a
# rollback runs the previous release with the config it shipped with.
# Only when this script *is* the uploaded one: a manual `bin/deploy.sh <old tag>`
# must never pick up a newer compose file left behind by a failed upload.
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
staged=false
if [[ $script_dir == "$HP_DIR/incoming" ]]; then
  rm -rf .rollback && mkdir .rollback
  [[ -f compose.yaml ]] && cp -p compose.yaml .rollback/
  [[ -d bin ]] && cp -pR bin .rollback/
  mkdir -p bin
  cp incoming/docker-compose.prod.yml compose.yaml
  # `install` writes a new file rather than rewriting one a shell may be running.
  for script in incoming/*.sh; do install -m 755 "$script" bin/; done
  rm -rf incoming
  staged=true
fi

restore_config() {
  if [[ $staged == true ]]; then
    [[ -f .rollback/compose.yaml ]] && cp -p .rollback/compose.yaml compose.yaml
    [[ -d .rollback/bin ]] && rm -rf bin && cp -pR .rollback/bin bin
  fi
}

# Runs a URL check inside the server container (the image has Node, not curl).
server_fetch() {
  compose exec -T server node -e "
    fetch('$1').then(async (r) => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1); },
      (e) => { console.log(String(e)); process.exit(1); });"
}

wait_healthy() {
  local i
  for i in $(seq 1 15); do
    server_fetch "$HEALTH_URL" && return 0
    log "waiting for /api/v1/health ($i/15)"
    sleep 2
  done
  return 1
}

show_logs() { compose logs --no-color --tail 60 server caddy >&2 || true; }

rollback() {
  log "FAILED: $1"
  show_logs
  restore_config
  if [[ -z $previous_tag ]]; then
    fail "first deploy failed, so there is no previous release to roll back to"
  fi
  log "rolling back to $previous_tag"
  deploy_tag=$previous_tag
  if compose up -d --wait --wait-timeout 180 --remove-orphans && wait_healthy; then
    fail "deploy of $tag failed; rolled back to $previous_tag, which is healthy"
  fi
  show_logs
  fail "deploy of $tag failed AND rollback to $previous_tag is unhealthy: see docs/DEPLOY.md, Troubleshooting"
}

log "deploying $tag (currently ${previous_tag:-nothing})"

log "pulling images"
if ! compose pull --quiet; then
  # A manual rollback on the server has no registry login, but the previous
  # release's images are kept locally; use them if they're all here.
  missing_images=false
  for image in $(compose config --images); do
    docker image inspect "$image" >/dev/null 2>&1 || missing_images=true
  done
  if [[ $missing_images == true ]]; then
    restore_config
    fail "could not pull images for $tag; nothing changed"
  fi
  log "pull failed, but every image for $tag is already on this server; using those"
fi

log "starting the database"
if ! compose up -d --wait --wait-timeout 120 db; then
  restore_config
  fail "database did not become healthy; nothing changed"
fi

# Migrations must be safe while the previous release still runs (tech spec §4),
# because a rollback runs the previous image against the migrated schema.
log "running migrations with $tag"
if ! compose run --rm --no-deps -T server node dist/db/cli.js migrate; then
  restore_config
  fail "migrations failed; still running ${previous_tag:-nothing}. Each migration step and each player's crowded-tile pack-up (#295) commits on its own, so nothing is half-written; re-running migrate picks up where it stopped"
fi

log "switching to $tag"
compose up -d --wait --wait-timeout 180 --remove-orphans || rollback "containers did not become healthy"

log "checking /api/v1/health"
wait_healthy || rollback "/api/v1/health did not pass"

log "checking /api/v1/ready (once)"
server_fetch "$READY_URL" || rollback "/api/v1/ready failed (is DATABASE_URL right?)"

# Through Caddy, as a phone would see it. Only a warning: on the very first
# deploy the certificate may still be on its way, or DNS may not point here yet.
insecure=()
[[ $site == localhost ]] && insecure=(--insecure) # Caddy's internal CA, local testing only
public_ok=false
for _ in $(seq 1 12); do
  if curl -fsS --max-time 5 "${insecure[@]}" --resolve "$site:443:127.0.0.1" \
    "https://$site/api/v1/health" >/dev/null 2>&1; then
    public_ok=true
    break
  fi
  sleep 5
done
if [[ $public_ok == true ]]; then
  log "https://$site/api/v1/health is OK through Caddy"
else
  log "WARNING: https://$site/api/v1/health failed through Caddy. Check DNS and 'docker compose logs caddy' (docs/DEPLOY.md, Troubleshooting)"
fi

# Record the release: .env now names it, so plain `docker compose` commands
# (logs, exec, backups) use the running tag.
tmp=$(mktemp "$HP_DIR/.env.XXXXXX")
grep -v '^HEARTPATCH_TAG=' .env >"$tmp" || true
printf 'HEARTPATCH_TAG=%s\n' "$tag" >>"$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tag" >>releases.log
rm -rf .rollback

# Keep the images for this release and the previous one (for a quick rollback);
# remove older Heartpatch images and dangling layers to save disk.
# Only this stack's own server and Caddy repositories are touched.
keep="$tag ${previous_tag:-}"
for repository in $(compose config --images | grep -E -- '-(server|caddy):' | sed 's/:[^:]*$//'); do
  docker image ls "$repository" --format '{{.Tag}}' | while read -r old_tag; do
    [[ " $keep " == *" $old_tag "* ]] || docker image rm "$repository:$old_tag" >/dev/null 2>&1 || true
  done
done
docker image prune -f >/dev/null

log "deployed $tag"
