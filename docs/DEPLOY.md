# Deploying Heartpatch

This runbook takes Heartpatch from "nothing in AWS" to "merging to `main` updates `https://play.pumpkinpatchgames.com`". It's written for someone new to AWS: every step says **what** to do and **why**. Plan on about 90 minutes the first time, most of it waiting.

The design is in tech spec §10 (config), §11 (infrastructure) and §12 (CI/CD). The files are in `infra/` and `.github/workflows/deploy.yml`.

## Contents

- [How it fits together](#how-it-fits-together)
- [What this costs](#what-this-costs)
- [Pre-flight checklist](#pre-flight-checklist)
- [1. Create an AWS account](#1-create-an-aws-account)
- [2. Create the Lightsail server](#2-create-the-lightsail-server)
- [3. Log in and run the setup script](#3-log-in-and-run-the-setup-script)
- [4. Point `play.pumpkinpatchgames.com` at the server (GoDaddy)](#4-point-playpumpkinpatchgamescom-at-the-server-godaddy)
- [5. Connect GitHub to the server](#5-connect-github-to-the-server)
- [6. Put the production settings on the server](#6-put-the-production-settings-on-the-server)
- [7. First deploy](#7-first-deploy)
- [8. Day-to-day operations](#8-day-to-day-operations): logs, backups and restore, rollback
- [9. Playtesting](#9-playtesting): seed accounts, a local playtest on your Wi-Fi
- [Troubleshooting](#troubleshooting)
- [Testing the deploy setup locally](#testing-the-deploy-setup-locally)

## How it fits together

```
 iPhone / iPad ──HTTPS──▶ Lightsail server (Ubuntu 24.04, one static IP)
                           │  firewall: only 22 (SSH), 80, 443 in
                           │
                           ├─ caddy   ports 80/443. Gets the HTTPS certificate from
                           │          Let's Encrypt by itself, serves the game files,
                           │          forwards /api and /ws to the server
                           ├─ server  the Node game server (private network only)
                           └─ db      Postgres 16, data in a Docker volume
                                      (private network only)

 GitHub: merge to main ─▶ Actions builds two images ─▶ GitHub Container Registry (GHCR)
                          └─ SSH to the server ─▶ deploy.sh: pull, migrate, switch,
                                                  health check, roll back on failure
```

- **Docker** packages each part with everything it needs, so the server only needs Docker installed. **Docker Compose** starts the three containers together from one file (`/opt/heartpatch/compose.yaml`).
- **Caddy** is the only thing reachable from the internet. The game server and database listen only on Docker's private network.
- **Every deploy is a commit SHA.** Images are tagged with the commit they were built from, and `/api/v1/health` reports it as `version`, so you can always tell what's running.
- **Deploys are safe to fail.** Database migrations run in a throwaway container *before* the switch. If the new version doesn't pass its health checks, `deploy.sh` puts the previous version back.

## What this costs

Check current prices before you start; these change.

| Item | Notes |
|---|---|
| Lightsail instance, 2 GB plan | The main cost. See the [Lightsail pricing page](https://aws.amazon.com/lightsail/pricing/) for the Linux 2 GB plan in Ohio. It includes a monthly data-transfer allowance far beyond what a few families use. New accounts sometimes get a free trial period on some plans. |
| Static IP | Free while attached to a running instance. AWS charges for one that's left unattached, so release it if you ever delete the instance. |
| Automatic snapshots | Billed per GB stored per month; a few dollars at most for a 7-day rotation of a small server. |
| GitHub Container Registry | The images are private. Old versions are pruned automatically (newest 5 kept). Check GitHub's billing page if you're ever warned about package storage. |
| Domain | You already pay GoDaddy for `pumpkinpatchgames.com`; the new `play` record is free. |
| Let's Encrypt (HTTPS) | Free. |

Step 1 sets a budget alarm so a surprise bill can't sneak up on you.

## Pre-flight checklist

Before you start, have:

- [ ] A computer with a terminal (Terminal on a Mac). Steps marked **💻 laptop** run there; **🖥️ server** steps run over SSH on the Lightsail server.
- [ ] A copy of this repo on the laptop (`git clone https://github.com/MattBaldwin/heartpatch.git`), or the two files from GitHub's "Download raw file" button: `infra/scripts/server-setup.sh` and `infra/compose/.env.prod.example`.
- [ ] Your phone with an authenticator app (Google Authenticator, 1Password, Authy…) for AWS MFA.
- [ ] A credit card for AWS.
- [ ] Your GoDaddy login.
- [ ] Admin access to the GitHub repo (Settings tab visible).

**Never paste a secret** (private key, `.env` values, passwords) into a chat, an issue, a PR or a commit. The steps below say exactly where each one goes.

## 1. Create an AWS account

**Why:** Lightsail is part of AWS. The account's first login, the **root user**, can do anything, including closing the account, so it gets the strongest protection.

1. Go to <https://aws.amazon.com/> → **Create an AWS Account**. Use an email address you'll keep for years, and a long unique password (store it in your password manager).
2. Choose a **Personal** account, enter your details and card, verify your phone, and pick the **Basic support (free)** plan.
3. Sign in to the console as the root user.

**Turn on MFA for the root user** (a stolen password alone then can't get in):

4. Top right, click your account name → **Security credentials**.
5. Under **Multi-factor authentication (MFA)** → **Assign MFA device** → name it (e.g. `matt-phone`) → **Authenticator app** → scan the QR code with your phone → enter two consecutive codes → **Add MFA**.

**Set a budget alarm** (AWS bills monthly in arrears; this emails you early):

6. Search the top bar for **Billing and Cost Management** → **Budgets** → **Create budget**.
7. Choose **Use a template** → **Monthly cost budget**. Set the amount a little above the expected Lightsail price (e.g. $25), add your email, **Create budget**. AWS emails you when actual or forecast spend crosses it.

> Optional, good practice: create an IAM user with admin rights for everyday use, and keep the root user for account settings only. It isn't required for this runbook.

## 2. Create the Lightsail server

**Why:** Lightsail is AWS's simple, fixed-price virtual server product: one small Linux machine with predictable billing, which is all a game for a few families needs.

1. Open <https://lightsail.aws.amazon.com/> (or search **Lightsail** in the console).
2. **Create instance**:
   - **Region:** **Ohio (us-east-2)**, zone A is fine. *Why:* central US, low latency for US families. Click **Change AWS Region and Availability Zone** if it shows another region.
   - **Platform:** **Linux/Unix**. **Blueprint:** **OS Only** → **Ubuntu 24.04 LTS**. *Why:* LTS gets security updates until 2029; the setup script is written for it.
   - **SSH key pair:** keep the **default** key for the region. You'll download it in step 3.
   - **Network type:** the default (dual-stack) is fine.
   - **Plan:** the **2 GB RAM** plan. *Why:* Postgres + Node + Caddy fit comfortably, and the setup adds 2 GB of swap as a safety net.
   - **Name:** `heartpatch`. **Create instance**. It's ready in a minute or two.
3. **Attach a static IP.** Instance → **Networking** tab → **Attach static IP** (or **Create static IP**) → name it `heartpatch-ip` → **Create**. Write the address down: it's `STATIC_IP` in the rest of this runbook. *Why:* an instance's default public IP changes if it's stopped; the static one never does, and DNS points at it.
4. **Firewall.** Same **Networking** tab → **IPv4 Firewall**: make sure there are exactly three rules, **SSH (TCP 22)**, **HTTP (TCP 80)** and **HTTPS (TCP 443)**; add HTTPS with **+ Add rule** if it's missing. Do the same under **IPv6 Firewall**. *Why:* 80/443 serve the game (80 only redirects to HTTPS and answers Let's Encrypt's check); 22 is SSH.
   - Leave SSH open to all IPs. GitHub Actions deploys over SSH from a large, changing pool of addresses, so SSH can't be limited to your home IP. It's protected instead by keys only (no passwords), a separate deploy user, and fail2ban (step 3).
5. **Automatic snapshots.** Instance → **Snapshots** tab → turn on **Automatic snapshots**, pick a time (e.g. 10:00 UTC, after the 09:00 automatic-update reboot window and the 08:30 database backup). Lightsail keeps the last 7 daily snapshots. *Why:* a whole-server backup you can restore in a few clicks if the server itself breaks; the nightly database dumps (step 8) are the finer-grained backup.

## 3. Log in and run the setup script

**Why:** a fresh Ubuntu server has no Docker, allows password logins, and has no swap. `infra/scripts/server-setup.sh` fixes all of that in one go, and is safe to run again. It:

- installs updates and turns on **automatic security updates** (with a reboot at 09:00 UTC when a kernel update needs one; the game restarts by itself),
- installs **Docker** with the compose plugin, and **rotates container logs** so they can't fill the disk,
- adds a **2 GB swap file**,
- creates a **`deploy` user** that only GitHub Actions uses, which accepts **one SSH key**, with port forwarding and interactive terminals turned off. It can still run commands, including Docker, which is as powerful as root; that's what deploying needs, so guard that key,
- makes SSH **key-only** (no passwords, no root login),
- turns on the **ufw firewall** (only 22, 80, 443 in; a second layer behind Lightsail's),
- turns on **fail2ban** (bans IPs that keep failing SSH logins),
- creates `/opt/heartpatch` and the **nightly backup** job.

**💻 laptop: download the Lightsail key and log in**

1. Lightsail → top-right account menu → **Account** → **SSH keys** → download the **default key** for Ohio. It saves as something like `LightsailDefaultKey-us-east-2.pem`.
2. Move it somewhere safe and make it private (SSH refuses keys others can read):
   ```sh
   mkdir -p ~/.ssh && mv ~/Downloads/LightsailDefaultKey-us-east-2.pem ~/.ssh/heartpatch-admin.pem
   chmod 600 ~/.ssh/heartpatch-admin.pem
   ```
3. **Create the deploy key** that GitHub Actions will use (no passphrase, because a robot uses it):
   ```sh
   ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f ~/.ssh/heartpatch-deploy
   ```
   This makes `~/.ssh/heartpatch-deploy` (**private**: it goes into GitHub in step 5, nowhere else) and `~/.ssh/heartpatch-deploy.pub` (public: safe to copy to the server).
4. Copy the setup script, the settings template and the public key to the server (run from the repo folder):
   ```sh
   scp -i ~/.ssh/heartpatch-admin.pem infra/scripts/server-setup.sh infra/compose/.env.prod.example \
     ~/.ssh/heartpatch-deploy.pub ubuntu@STATIC_IP:
   ```
   The first time, SSH asks *"Are you sure you want to continue connecting?"*. That's the server introducing itself. Type `yes`. (To be thorough: Lightsail's in-browser **Connect using SSH** button gets you a terminal where `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` prints the fingerprint to compare.)
5. Log in:
   ```sh
   ssh -i ~/.ssh/heartpatch-admin.pem ubuntu@STATIC_IP
   ```

**🖥️ server: run the setup**

6. ```sh
   sudo bash server-setup.sh heartpatch-deploy.pub
   ```
   It takes a few minutes. At the end it prints a line starting with your static IP and `ssh-ed25519 …`: **copy that whole line**; it's the `LIGHTSAIL_KNOWN_HOSTS` secret in step 5. (If it prints `<STATIC_IP>` instead of the address, replace that with your static IP.)
7. Check from a **new** laptop terminal that you can still log in (`ssh -i ~/.ssh/heartpatch-admin.pem ubuntu@STATIC_IP`) before closing the old one. *Why:* the script changed SSH settings; keeping one session open means you can't lock yourself out.

## 4. Point `play.pumpkinpatchgames.com` at the server (GoDaddy)

**Why:** DNS turns the name into the server's address. An **A record** maps one name to one IPv4 address. Only the `play` subdomain changes; `pumpkinpatchgames.com` itself keeps showing your GoDaddy site.

1. GoDaddy → **My Products** → next to `pumpkinpatchgames.com`, **DNS** (or **Manage DNS**).
2. **Add New Record**:
   - **Type:** `A`
   - **Name:** `play`
   - **Value:** `STATIC_IP`
   - **TTL:** `1/2 Hour` (or the lowest offered). *Why:* TTL is how long phones and ISPs cache the answer. Short while setting up, so a mistake fixes quickly; you can raise it to 1 hour later.
3. **Save**. Don't touch the existing records for `@` or `www`.
4. **💻 laptop:** check it (usually works within minutes, can take up to the TTL or an hour):
   ```sh
   dig +short play.pumpkinpatchgames.com
   ```
   It should print exactly `STATIC_IP`. No output yet means wait and retry. (Without `dig`: `nslookup play.pumpkinpatchgames.com`.)

Do this **before the first deploy**: Caddy asks Let's Encrypt for the HTTPS certificate when it starts, and Let's Encrypt checks the name points at this server.

## 5. Connect GitHub to the server

**Why:** the deploy workflow needs to know where the server is, which user to log in as, the private deploy key, and the server's identity (so it can't be tricked into sending your deploy to an impostor). Until all four secrets exist, the workflow builds the images and then **skips the deploy with a notice**; it doesn't fail.

GitHub → the `heartpatch` repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, four times:

| Name | Value |
|---|---|
| `LIGHTSAIL_HOST` | `STATIC_IP` (the address, not the domain name) |
| `LIGHTSAIL_USER` | `deploy` |
| `LIGHTSAIL_SSH_KEY` | the whole **private** key, including the `-----BEGIN` and `-----END` lines. On a Mac: `pbcopy < ~/.ssh/heartpatch-deploy`, then paste |
| `LIGHTSAIL_KNOWN_HOSTS` | the line `server-setup.sh` printed: `STATIC_IP ssh-ed25519 AAAA…` |

Then delete the laptop copy of the private deploy key: `rm ~/.ssh/heartpatch-deploy`. *Why:* GitHub keeps it encrypted, and you log in with your own admin key, so a second copy is only something to lose. If it's ever needed again, make a new key and re-run `server-setup.sh` with the new `.pub`.

**Image access (GHCR).** Nothing to set up. The workflow pushes images to `ghcr.io/mattbaldwin/heartpatch-server` and `-caddy` (private), and during each deploy it logs the server in to GHCR with that run's short-lived token, then logs out. The server keeps the current and previous images locally, which is all a rollback needs. If a deploy ever fails with `denied` while pulling: GitHub → your profile → **Packages** → `heartpatch-server` (and `-caddy`) → **Package settings** → **Manage Actions access** → make sure the `heartpatch` repo is listed.

## 6. Put the production settings on the server

**Why:** passwords and secrets live in one file on the server, `/opt/heartpatch/.env`, readable only by the `deploy` user. They're never in git or GitHub, so a leaked repo or log can't leak them.

**🖥️ server** (logged in as `ubuntu`):

1. Install the template as the deploy user's private file:
   ```sh
   sudo install -o deploy -g deploy -m 600 ~/.env.prod.example /opt/heartpatch/.env
   ```
2. Fill in the two secrets with fresh random values (this runs on the server, so they never leave it):
   ```sh
   sudo -u deploy sed -i \
     -e "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" \
     -e "s/^HP_SIGNUP_CODE=$/HP_SIGNUP_CODE=$(tr -dc a-km-np-z2-9 </dev/urandom | head -c 10)/" \
     /opt/heartpatch/.env
   ```
3. Check it (and note the signup code: your family types it to create accounts):
   ```sh
   sudo -u deploy grep -E '^(POSTGRES_PASSWORD|HP_SIGNUP_CODE|PUBLIC_ORIGIN|HP_TUTORIAL_REQUIRED)=' /opt/heartpatch/.env
   ```
   Every line should have a value. To edit by hand: `sudo -u deploy nano /opt/heartpatch/.env` (Ctrl+O, Enter to save; Ctrl+X to exit).

What each setting means is explained in the file itself. In short:

| Setting | What it is |
|---|---|
| `POSTGRES_PASSWORD` | Database password. Set once: Postgres stores it when the database is first created (see Troubleshooting to change it) |
| `PUBLIC_ORIGIN` | `https://play.pumpkinpatchgames.com` |
| `LOG_LEVEL` | `info` |
| `HP_SIGNUP_CODE` | Needed to create an account (family-only signup). Change it if it leaks |
| `HP_TUTORIAL_REQUIRED` | `false` for now. The tutorial has shipped; whether to flip it to `true` is decided at first deploy (owner) |
| `HEARTPATCH_TAG` | Leave empty: `deploy.sh` writes the running version here |

`NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY=true` and `APP_VERSION` are set by the compose file, so they can't be wrong.

## 7. First deploy

**Why it's automatic:** `.github/workflows/deploy.yml` runs on every push to `main`. It builds the server and Caddy images, pushes them to GHCR tagged with the commit SHA, copies the compose file and scripts to `/opt/heartpatch/incoming/` over SSH, and runs `deploy.sh`, which:

1. pulls the new images,
2. makes sure Postgres is up,
3. runs **migrations in a one-off container** with the new image (the old version keeps serving players meanwhile; if migrations fail, nothing changes),
4. switches the containers to the new version and waits for their health checks,
5. checks `/api/v1/health`, then `/api/v1/ready` once (the database is reachable),
6. on any failure in 4–5, **puts the previous version back** and fails the workflow run so you see a red ❌,
7. checks the site through Caddy over HTTPS (a warning only: on the first deploy the certificate may still be arriving),
8. records the version in `.env` and `releases.log`, and deletes images older than the previous release.

**First deploy and migrations 0017–0020 (tutorial, Patch Coins, milestones, opening cinematic):** nothing to do, but know what the first start does:

- The `milestones` consumer (and the `lore` one) has no saved position, so it starts at seq 0 and replays every existing game event. Play from before milestones counts toward tracks and can grant tiers, titles and coins on that first run. It's safe to repeat: each tier is granted once.
- At boot the server grants First Patch to every account that has already finished the tutorial. It runs on every boot and grants nothing the second time.
- **Migration 0020 (opening cinematic)** adds `users.cinematic_seen_at`, NULL for every existing account. So each existing player sees the roughly 111 s story once at their next login (a long press skips it), and it is marked seen when it ends or is skipped. To suppress it for chosen accounts, run `UPDATE users SET cinematic_seen_at = now() WHERE ...` (e.g. `username = '...'`) on the database.

**Start it:** merge any PR to `main`, or GitHub → **Actions** → **Deploy** → **Run workflow** → `main`.

**Watch it:** Actions → the newest **Deploy** run. `images` (×2) then `deploy`. The `Deploy <sha>` step prints each stage. A green ✅ means the new version passed its health checks.

**Check it:**

- **💻 laptop:**
  ```sh
  curl -s https://play.pumpkinpatchgames.com/api/v1/health
  ```
  shows `"status":"ok"` and `"version"` = the commit SHA you merged.
- **📱 iPhone:** open Safari, go to `play.pumpkinpatchgames.com`. The address bar shows no warning (tap **aA** → **Website Settings**, or the lock, to see the connection is secure). The game screen loads. To install it like an app: **Share** → **Add to Home Screen**.
- **iPad:** same as iPhone.

If a step fails, see [Troubleshooting](#troubleshooting).

## 8. Day-to-day operations

All of these are **🖥️ server** commands. Log in as `ubuntu`, then become the deploy user and go to the stack folder:

```sh
ssh -i ~/.ssh/heartpatch-admin.pem ubuntu@STATIC_IP
sudo -iu deploy
cd /opt/heartpatch
```

(`docker compose` commands must run from `/opt/heartpatch`: that's where `compose.yaml` and `.env` are.)

### Status and logs

```sh
docker compose ps                         # are caddy, server, db up and "healthy"?
docker compose logs --tail 100 server     # recent game-server logs
docker compose logs -f server             # follow live (Ctrl+C to stop)
docker compose logs --since 1h caddy      # web requests and certificate messages
cat releases.log                          # every successful deploy: time and commit
```

Server logs are JSON lines (pino); `level` 50+ are errors. Logs are rotated at 10 MB × 5 files per container, so they never fill the disk.

### Backups and restore

**What's backed up:**

- **Nightly database dump** at 08:30 UTC by `bin/backup.sh` (cron): a compressed `pg_dump` in `/opt/heartpatch/backups/heartpatch-<time>.dump`, checked for readability before it's kept, deleted after 14 days. Log: `backups/backup.log`.
- **Lightsail automatic snapshots** of the whole server, daily, last 7 kept (step 2).

Take a backup right now (e.g. before something risky):

```sh
bin/backup.sh
ls -lh backups/
```

Copy one to your laptop for safekeeping now and then. It holds password hashes, so keep it private. Only the `deploy` user can read `backups/`, so first make a copy `ubuntu` can fetch (**🖥️ server**, as `ubuntu`):

```sh
sudo install -o ubuntu -m 600 /opt/heartpatch/backups/heartpatch-<time>.dump ~/
```

then download it (**💻 laptop**) and delete the server-side copy:

```sh
mkdir -p ~/heartpatch-backups
scp -i ~/.ssh/heartpatch-admin.pem ubuntu@STATIC_IP:heartpatch-<time>.dump ~/heartpatch-backups/
ssh -i ~/.ssh/heartpatch-admin.pem ubuntu@STATIC_IP 'rm ~/heartpatch-*.dump'
```

**Restore a dump** (replaces the live database):

```sh
bin/restore.sh backups/heartpatch-<time>.dump
```

It asks you to type `restore`, then: takes a **safety backup** of the current database, restores the dump into a scratch database while the game keeps running, and only if that worked, stops the server for a few seconds, swaps the databases, applies any newer migrations and checks `/health` and `/ready`. If anything fails, the live database is left (or put back) as it was.

**Restore the whole server** (it won't boot, or was badly misconfigured): Lightsail → **Snapshots** → pick one → **Create new instance** (same plan) → move the static IP to the new instance (**Networking** → detach from old, attach to new). DNS needs no change because the IP is the same. Delete the old instance once the new one works.

### Rolling back

A deploy that fails its health checks rolls itself back. To go back from a release that **passed** the checks but is broken for players:

- **Simplest, the normal way:** on GitHub, revert the bad PR (the PR page has a **Revert** button) and merge the revert. It deploys like any other change.
- **Fastest (about a minute):** on the server, deploy the previous commit directly:
  ```sh
  cat releases.log                    # the line before the last is the previous release
  bin/deploy.sh <previous commit sha>
  ```
  The previous release's images are kept on the server, so this works without GitHub. The next merge to `main` deploys normally again.

Rollbacks don't undo database migrations. That's by design: migrations are written so the previous release still works on the new schema (tech spec §4, "expand, then contract").

### Changing a setting

Edit `.env` (`nano .env`), then recreate the server so it reads the change:

```sh
docker compose up -d server
```

### Operator password reset

For a player with no map owner to reset them (tech spec §9):

```sh
docker compose exec server node dist/ops/reset-password.js <username>
```

## 9. Playtesting

The checklist for testers is [PLAYTEST.md](PLAYTEST.md). This section is where the game runs for a playtest and which accounts to use.

### On the real server

Testers sign up at `https://play.pumpkinpatchgames.com` with the family code (`HP_SIGNUP_CODE`), like any player. There are no seed accounts there: the seed refuses to run with `NODE_ENV=production`, which the compose file sets. Before inviting anyone, decide `HP_TUTORIAL_REQUIRED` (PLAYTEST.md, "Before inviting testers").

The frame-rate badge only exists in dev builds, so the performance checks use a local playtest.

### A local playtest on your Wi-Fi

This runs the dev build on your computer and plays it on an iPhone or iPad on the same Wi-Fi. It shows the frame-rate badge and has the seed accounts.

1. Find your computer's address on the Wi-Fi, like `192.168.1.20` (macOS: System Settings → Wi-Fi → Details).
2. In the repo's `.env`, set `PUBLIC_ORIGIN=http://192.168.1.20:5173` (your address). Live updates check it.
3. Start the database and fill it:

   ```sh
   pnpm db:up && pnpm db:migrate && pnpm db:seed
   ```

4. Start the server and the client, each in its own terminal. `--host` lets other devices on the Wi-Fi reach the client:

   ```sh
   pnpm --filter @heartpatch/server dev
   pnpm --filter @heartpatch/client dev --host
   ```

5. On the iPhone or iPad, open `http://192.168.1.20:5173` in Safari.

### Seed accounts

`pnpm db:seed` (`apps/server/src/db/seed.ts`) makes these accounts in a dev database. All of them use the password `squishy-secret`. Running it again adds only what's missing and never resets anyone's progress.

| Account | What it's for |
|---|---|
| `pumpkinpal` | Skips onboarding: it already has a Keeper, has seen the story and finished the tutorial. It owns **Seed Patch**. |
| `mothmuffin` | Skips onboarding like `pumpkinpal`, and is a member of Seed Patch. Log in on a second device to play together. |
| `newsprout` | A fresh account: no Keeper, no story, no tutorial, no patch. Logging in plays the whole first session. |

`newsprout` is fresh only once. To play onboarding again, sign up a new account with the family code (`heartpatch-dev-family` in `.env.example`), or reset the dev database:

```sh
docker compose -f infra/compose/docker-compose.dev.yml down -v && pnpm db:up && pnpm db:migrate && pnpm db:seed
```

A database seeded before #28 gets the password and the skipped onboarding on the next `pnpm db:seed`; only `newsprout` is new.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Deploy run says **"Deploy skipped: repository secrets not set yet"** | Expected until step 5 is done. The notice lists which secrets are missing. |
| `Permission denied (publickey)` in the deploy job | `LIGHTSAIL_SSH_KEY` isn't the whole private key, or `server-setup.sh` was run with a different `.pub`. Re-run setup with the matching `.pub`. `LIGHTSAIL_USER` must be `deploy`. |
| `Host key verification failed` in the deploy job | `LIGHTSAIL_KNOWN_HOSTS` doesn't match. On the server, `cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub` prints the key; the secret is `STATIC_IP` + space + that. (If you rebuilt the server from scratch, this changes, and that's what it's for.) |
| `Connection timed out` in the deploy job | Lightsail firewall is missing SSH 22, or `LIGHTSAIL_HOST` isn't the static IP. |
| `denied` / `unauthorized` when pulling images | See "Image access (GHCR)" in step 5. |
| `… is empty in /opt/heartpatch/.env` | Step 6 wasn't finished; fill in that setting. |
| `migrations failed` | Nothing was switched; the old version is still serving. The job log shows the error. Fix it in a PR. |
| `rolled back to <sha>, which is healthy` | The new version didn't start or failed `/health` or `/ready`. Players are on the previous version. The job log shows the last 60 lines of server logs. |
| **Warning** `…failed through Caddy` | Usually the certificate on the very first deploy, or DNS. Check `dig +short play.pumpkinpatchgames.com` shows `STATIC_IP`, then `docker compose logs caddy` for `certificate obtained` or an error. Caddy keeps retrying by itself. |
| iPhone says **"This Connection Is Not Private"** | The certificate isn't issued yet. Same checks as above. Port 80 must be open in Lightsail (Let's Encrypt checks over it). |
| Site doesn't load at all | `docker compose ps` on the server. Lightsail firewall has 80 and 443? `dig` shows the right IP? |
| Server keeps restarting | `docker compose logs --tail 100 server`. `Invalid configuration:` lists the bad `.env` setting. |
| Need to change the database password | Postgres stored the first one. Run `docker compose exec db psql -U heartpatch -c "ALTER USER heartpatch PASSWORD 'NEW'"` with a new hex value, put the same value in `.env` as `POSTGRES_PASSWORD`, then `docker compose up -d server`. |
| Disk filling up | `df -h /`, then `docker system df`. Old images are removed by each deploy; `docker image prune` clears dangling ones. |
| Restore says **could not put the previous database back** | Rare: the old data is safe in `heartpatch_before_restore`. Put it back by hand: `docker compose exec db psql -U heartpatch -d postgres -c "ALTER DATABASE heartpatch RENAME TO heartpatch_failed" -c "ALTER DATABASE heartpatch_before_restore RENAME TO heartpatch" -c "ALTER DATABASE heartpatch ALLOW_CONNECTIONS true"`, then `docker compose up -d server`. |
| A deploy run was cancelled or lost its connection mid-deploy | The containers may be on the new version while `.env` still names the old one. Re-run the same deploy so they agree again: `bin/deploy.sh <sha>` with the commit from the run's title (or Actions → Deploy → **Re-run jobs**). |
| A whole-server problem | Restore a Lightsail snapshot (see "Backups and restore"). |

## Testing the deploy setup locally

You don't need AWS to test changes to `infra/`. From the repo root, with Docker running:

```sh
infra/scripts/local-smoke.sh
```

It builds both images, pushes them to a throwaway local registry, and runs the real `deploy.sh` against a temporary stack on your machine, using `localhost` with a certificate from Caddy's own internal CA. It then checks: health, ready and the client through Caddy over HTTPS; migrations ran in the one-off container; cache and security headers; HTTP → HTTPS; that Postgres and the server port aren't reachable from outside; a backup → wipe → restore round trip and 14-day retention; that a release failing its health check rolls back; that a release whose migrations fail never switches; and that only the current and previous images are kept. Everything is removed afterwards (`KEEP=1` leaves it running to poke at). Pull requests that touch the deploy files run the same script in GitHub Actions.

To click around the production build by hand instead:

```sh
cp infra/compose/.env.prod.example infra/compose/.env   # fill in the two secrets
HEARTPATCH_TAG=local docker compose -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.local.yml up -d --build --wait
HEARTPATCH_TAG=local docker compose -f infra/compose/docker-compose.prod.yml \
  -f infra/compose/docker-compose.local.yml run --rm server node dist/db/cli.js migrate
open https://localhost:8443    # accept the certificate warning (local CA)
```
