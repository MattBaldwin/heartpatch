#!/usr/bin/env bash
# One-time (and safe to re-run) setup for a fresh Ubuntu 24.04 Lightsail
# instance (tech spec §11). docs/DEPLOY.md step 3 walks through it.
#
# Usage, as the default `ubuntu` user:
#   sudo bash server-setup.sh heartpatch-deploy.pub
#
# The argument is the PUBLIC half of the GitHub Actions deploy key (a file, or
# the key text itself). It may be left out on a re-run once the key is set.
#
# What it does:
#   - installs security updates and turns on automatic ones (unattended-upgrades)
#   - installs Docker Engine with the compose plugin, and rotates its logs
#   - adds a 2 GB swap file (small instances run out of memory otherwise)
#   - creates the `deploy` user that GitHub Actions logs in as (key only)
#   - SSH: keys only, no passwords, no root login
#   - firewall (ufw): only 22, 80 and 443 in
#   - fail2ban: bans IPs that keep failing SSH logins
#   - /opt/heartpatch for the stack, and the nightly backup cron job
set -euo pipefail

DEPLOY_USER=${DEPLOY_USER:-deploy}
HP_DIR=${HP_DIR:-/opt/heartpatch}
# 0 skips swap (only for testing in a container, where swap files can't work).
SWAP_SIZE=${SWAP_SIZE:-2G}

log() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || fail "run with sudo: sudo bash $0 <deploy key .pub>"
# shellcheck source=/dev/null
. /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 ]] ||
  printf 'WARNING: written for Ubuntu 24.04; this is %s %s\n' "${ID:-?}" "${VERSION_ID:-?}" >&2

deploy_key=""
if [[ -n ${1:-} ]]; then
  if [[ -f $1 ]]; then deploy_key=$(<"$1"); else deploy_key=$1; fi
  [[ $deploy_key =~ ^ssh-(ed25519|rsa)\ [A-Za-z0-9+/=]+(\ .*)?$ ]] ||
    fail "that doesn't look like a public key (it should start with ssh-ed25519). Never pass the private key"
fi

export DEBIAN_FRONTEND=noninteractive

log "Installing updates and base packages"
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg ufw fail2ban unattended-upgrades cron

log "Turning on automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
# Kernel updates need a reboot; do it at 09:00 UTC (night in the US). Docker
# and every container come back by themselves (restart: unless-stopped).
cat >/etc/apt/apt.conf.d/52heartpatch-upgrades <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "09:00";
CONF
systemctl enable --now unattended-upgrades apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true

log "Installing Docker Engine and the compose plugin"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# Rotate logs for every container, including ones compose doesn't configure.
daemon_json='{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}'
if [[ ! -f /etc/docker/daemon.json || $(</etc/docker/daemon.json) != "$daemon_json" ]]; then
  printf '%s\n' "$daemon_json" >/etc/docker/daemon.json
  systemctl restart docker
fi

if [[ $SWAP_SIZE != 0 ]]; then
  log "Adding a $SWAP_SIZE swap file"
  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    [[ -f /swapfile ]] || fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
  fi
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  # Prefer RAM; swap is the safety net, not working memory.
  echo 'vm.swappiness=10' >/etc/sysctl.d/60-heartpatch-swap.conf
  sysctl -q -p /etc/sysctl.d/60-heartpatch-swap.conf
fi

log "Creating the '$DEPLOY_USER' user for GitHub Actions"
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
# The docker group can run containers: needed to deploy. It's root-equivalent,
# which is why this user accepts one SSH key and nothing else.
usermod -aG docker "$DEPLOY_USER"
passwd -l "$DEPLOY_USER" >/dev/null
deploy_home=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$deploy_home/.ssh"
if [[ -n $deploy_key ]]; then
  # `restrict`: no port forwarding, agent or X11 forwarding, or terminal for this key.
  printf 'restrict %s\n' "$deploy_key" >"$deploy_home/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$deploy_home/.ssh/authorized_keys"
  chmod 600 "$deploy_home/.ssh/authorized_keys"
elif [[ ! -s $deploy_home/.ssh/authorized_keys ]]; then
  printf 'WARNING: no deploy key given; GitHub Actions cannot log in yet. Re-run with the .pub file.\n' >&2
fi

log "Creating $HP_DIR"
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HP_DIR" "$HP_DIR/bin"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HP_DIR/backups"

log "Installing the nightly backup (08:30 UTC)"
cat >/etc/cron.d/heartpatch-backup <<CRON
# Nightly Postgres backup (infra/scripts/backup.sh). Logs: $HP_DIR/backups/backup.log
30 8 * * * $DEPLOY_USER [ -x $HP_DIR/bin/backup.sh ] && $HP_DIR/bin/backup.sh >> $HP_DIR/backups/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/heartpatch-backup

log "SSH: keys only, no root login"
# sshd uses the FIRST value it reads, and Ubuntu's 50-cloud-init.conf may allow
# passwords, so this file sorts first.
cat >/etc/ssh/sshd_config.d/00-heartpatch.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
CONF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl restart ssh

log "Firewall: allow SSH, HTTP and HTTPS only"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status verbose

log "fail2ban: ban IPs that keep failing SSH logins"
cat >/etc/fail2ban/jail.d/heartpatch.local <<'CONF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CONF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban

log "Done"
host_key=$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)
public_ip=$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null || true)
cat <<DONE

Docker:  $(docker --version)
Compose: $(docker compose version)
Swap:    $(swapon --show=SIZE --noheadings | head -n 1 || true)

Next (docs/DEPLOY.md step 5): add this line as the GitHub secret LIGHTSAIL_KNOWN_HOSTS.
It's this server's identity, so GitHub Actions can tell it's talking to the real server.
${public_ip:-<STATIC_IP>} $host_key

Server fingerprint (for checking the first time you SSH in from your own computer):
$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub)
DONE
