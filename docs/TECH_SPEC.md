# Heartpatch — Technical Specification

> How the game is built. `CLAUDE.md` holds the rules; this file holds the concrete decisions so parallel sessions don't each invent their own. If you need to deviate, say so in the PR and update this file in the same PR.

## 1. Platforms and targets

- **Primary devices:** iPhone and iPad, Safari, installed as a PWA. Minimum **iOS/iPadOS 17**.
- **Secondary:** desktop Chrome, Safari, Firefox (latest 2 versions).
- **Performance:** 60 fps on iPhone 13 or newer; never below 30 fps on iPad 9th gen. Initial load under 5 s on 4G; total first-load download under **15 MB** (rest lazy-loaded).
- **Memory:** stay under ~400 MB in Safari to avoid tab reloads.

## 2. Repository layout

```
heartpatch/
├─ apps/
│  ├─ client/                 Vite + Babylon.js PWA
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ engine/           Babylon setup, render quality, camera, post-processing
│  │  │  ├─ scenes/           map, homeBase, battle, closeUp, wardrobe
│  │  │  ├─ procedural/       squishy + keeper generators, part library
│  │  │  ├─ ui/               HUD and screens (Babylon GUI or DOM overlay — see §6)
│  │  │  ├─ net/              REST client, WebSocket client, reconnect
│  │  │  ├─ state/            client store (mirrors server state)
│  │  │  └─ audio/
│  │  ├─ public/              icons, manifest, static assets
│  │  └─ tests/e2e/           Playwright
│  └─ server/                 Node 22 + Fastify
│     ├─ src/
│     │  ├─ index.ts          bootstrap
│     │  ├─ config.ts         env parsing (zod)
│     │  ├─ db/               drizzle schema, migrations, seed
│     │  ├─ modules/          auth, maps, tiles, battles, squishies, buildings,
│     │  │                    resources, care, hollowman, wardrobe, milestones,
│     │  │                    boutique, chat, events
│     │  │   └─ <module>/     routes.ts, service.ts, repo.ts, schemas.ts, *.test.ts
│     │  ├─ ws/               WebSocket hub, channels, message handlers
│     │  ├─ jobs/             scheduled jobs (pg-boss)
│     │  └─ lib/              filter, rng, time, errors
│     └─ tests/
├─ packages/
│  └─ shared/
│     ├─ src/
│     │  ├─ data/             species, moves, matrices, buildings, clothing,
│     │  │                    milestones, seasons, spawn tables (TS/JSON)
│     │  ├─ schemas/          zod schemas for data + API + WS messages
│     │  ├─ battle/           deterministic battle engine
│     │  ├─ formulas/         xp, contentment decay, capture chance, prices
│     │  ├─ hex/              axial coords, neighbors, distance, BFS
│     │  └─ rng/              seeded RNG
│     └─ tests/
├─ infra/
│  ├─ docker/                 Dockerfiles
│  ├─ compose/                docker-compose.dev.yml, docker-compose.prod.yml
│  ├─ caddy/Caddyfile
│  └─ scripts/                deploy.sh, backup.sh, restore.sh, server-setup.sh
├─ docs/                      GAME_DESIGN.md, TECH_SPEC.md, DEPLOY.md
└─ .github/workflows/         ci.yml, deploy.yml
```

**Secret data split:** data that must stay hidden (Easter-egg conditions, rare spawn rules, evolution weights, drop tables, secret milestones) lives in `packages/shared/src/data/server/` and is **only imported by the server**. A lint rule or test must fail if the client bundle imports anything from `data/server/`.

## 3. Libraries (pinned choices)

| Concern | Choice |
|---|---|
| 3D engine | `@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/gui` |
| Build | Vite, `vite-plugin-pwa` (Workbox) |
| Server | Fastify 5, `@fastify/websocket`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/helmet`, `@fastify/static` (dev only) |
| DB | Postgres 16, `drizzle-orm`, `drizzle-kit`, `postgres` (driver) |
| Jobs / scheduling | `pg-boss` (Postgres-backed; no Redis needed) |
| Validation | `zod` (shared between client and server) |
| Auth | `argon2` (Argon2id) |
| Text filter | `obscenity` + custom regex for personal info (phone, email, address, URLs) |
| Time zones | `luxon` |
| Logging | `pino` (Fastify built-in) |
| Tests | `vitest`, `@playwright/test` |
| Assets | `@gltf-transform/cli` for glTF optimization and KTX2 textures |
| Live battles (Phase 2) | `colyseus` |

Add anything else only with a one-line justification in the PR.

## 4. Data model conventions

- IDs: `uuid` (v7 preferred, via `uuidv7` package) for all entities.
- Timestamps: `timestamptz`, stored in UTC. Map-local time computed with the map's IANA `time_zone`.
- Almost everything is **scoped by `map_id`** (progress is per map). Accounts, Keeper config and account-bound milestone items are per user.
- Money-like values (Patch Coins, resource counts) are integers. Every change goes through a **ledger table** (`coin_ledger`, `resource_ledger`) with a reason; balances are derived or cached and reconciled in tests.
- Soft-delete is not used; removed players' data is archived by status flags.
- Migrations: `drizzle-kit generate`, committed, applied on deploy. Never edit a merged migration.

**Core tables (Phase 1):** `users`, `sessions`, `recovery_codes`, `keepers`, `maps`, `map_members`, `invite_codes`, `join_requests`, `tiles`, `species_seen`, `squishies`, `buildings`, `inventories`, `resource_ledger`, `gather_jobs`, `battles` (seed, action log, result), `raids`, `hollow_events`, `clothing_owned`, `outfits`, `milestone_progress`, `milestone_rewards`, `coin_ledger`, `boutique_stock`, `quick_messages`, `game_events`.

## 5. API

### REST
- Base path `/api/v1`. JSON only. All bodies and responses validated with zod schemas from `packages/shared/src/schemas`.
- Auth: session cookie `hp_session` (HttpOnly, Secure, SameSite=Lax, 30-day rolling). CSRF: require header `X-Requested-With: heartpatch` on mutating requests (simple and sufficient with SameSite cookies).
- **Commands, not state writes:** e.g. `POST /maps/:mapId/tiles/:tileId/attack`, `POST /maps/:mapId/squishies/:id/care` with `{ action: "pet" }`. The server computes outcomes.
- Errors: `{ error: { code: "TILE_NOT_ADJACENT", message: "Friendly text a kid can read" } }` with proper HTTP status. Codes are a shared enum.
- Rate limits: global per-IP limit; tighter limits on auth, care actions, chat.
- Idempotency: mutating endpoints accept an optional `Idempotency-Key` header; the client sends one for purchases, trades and battle actions so a retry on a flaky phone connection can't double-apply.

### WebSocket
- Endpoint `/ws`, authenticated by the session cookie. One connection per client; the client subscribes to a map channel.
- Message envelope (zod-validated both ways):
  ```ts
  { v: 1, type: "tile.updated", mapId: string, seq: number, at: string, data: {...} }
  ```
- `seq` is a per-map monotonically increasing number. On reconnect the client sends its last `seq`; the server replays missed events from `game_events` or tells the client to refetch full state.
- Server → client events (Phase 1): `tile.updated`, `raid.resolved`, `building.updated`, `squishy.updated`, `hollow.nightfall`, `member.joined`, `member.left`, `chat.quick`, `milestone.earned`.
- Heartbeat ping every 25 s; iOS suspends background tabs, so always resync on `visibilitychange`.

## 6. Client architecture

- **Rendering:** one Babylon `Engine`; scenes swapped (map, home base, battle, close-up, wardrobe). Use WebGPU when `navigator.gpu` is available and stable, else WebGL2.
- **Quality settings:** `engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2))`; FXAA or SMAA post-process; dynamic resolution scaler targeting 60 fps; quality tiers (high/medium/low) auto-picked from a short benchmark and adjustable in settings.
- **UI:** HTML/CSS overlay on top of the canvas for menus, inventory, wardrobe lists and text input (sharper text, native accessibility, iOS keyboard works properly). Babylon GUI only for in-world labels and bubbles.
- **State:** a small typed store (no heavy framework needed); server is the source of truth. Optimistic UI only for cosmetic actions (e.g. equipping clothing), rolled back on server error.
- **Assets:** glTF/GLB, Draco or meshopt compression, KTX2 textures. Procedural squishies and Keepers need few textures; environment props are small GLBs. Lazy-load per scene.
- **Input:** Pointer Events; gestures for pan, pinch, tap, long-press, stroke. Minimum 44×44 pt tap targets. Respect `env(safe-area-inset-*)`.
- **Offline:** the PWA caches the app shell; gameplay needs a connection, and the UI shows a friendly "reconnecting" state.

### Cinematics and tutorial (client)
- **Cinematic player** (`src/cinematics/`): plays a timeline described in data (`packages/shared/src/data/cinematics/*.ts`): shots with duration, camera path keyframes, scene setup, actor animations, caption text and audio cues. Built on Babylon `Animation`/`AnimationGroup`; no video files.
- Preload each shot's assets during the previous shot; target 60 fps, acceptable floor 30. Captions are DOM overlay text. Support skip (after first view or long-press), tap-to-advance captions, and `prefers-reduced-motion` (gentler camera moves).
- **Tutorial UI layer** (`src/tutorial/`): highlights a target (spotlight mask over the canvas or DOM element), shows Sprout's speech bubble and an arrow, and blocks unrelated input during each step.

## 7. Server architecture

- Single Node process serving REST + WebSocket + scheduled jobs (enough for a handful of families). Code is modular so jobs can move to a separate worker later.
- **Modules** follow `routes → service → repo`. Services contain game logic and call `packages/shared` formulas; repos are the only place that touches Drizzle.
- **Transactions:** any command touching multiple rows (capture, trade, purchase, reward) runs in one DB transaction with row locks (`SELECT … FOR UPDATE`) on the affected entities.
- **Game event stream:** every meaningful change writes a `game_events` row (type, mapId, actor, payload). This one stream feeds WebSocket broadcast, milestone progress, Easter-egg triggers and the raid log.
- **Scheduled jobs (pg-boss):**
  - `nightfall` per map at 21:00 map time (Hollow Man, §14 of the design doc)
  - `stranded-decay` (Phase 2)
  - `boutique-rotate` daily per map
  - `invite-expiry`, `session-cleanup`, `chat-retention` daily
  - Jobs are idempotent and keyed by `(job, mapId, date)` so a restart never runs nightfall twice.
- **Tutorial maps:** a tutorial is a normal map row with `kind = 'tutorial'` and one member, created from a hand-authored layout in `data/tutorial/`. It runs the **same** modules (gathering, battles, capture, care, buildings, nightfall) with a `tutorialOverrides` config (fast timers, guaranteed capture, scripted opponent AI, Hollow Man can't take anything). No separate code path for tutorial gameplay.
- **Tutorial step engine:** steps are data (`id, goal, sproutLines, highlightTarget, completeOn: game event type + predicate`). The server advances `users.tutorial_step` when a matching `game_events` row is written, and the client renders the current step. Account-level rewards (Partner species, Seedling Scarf, First Patch milestone) are granted idempotently on completion.
- **Dev time override:** env `HP_DEV_NOW` and an admin endpoint (dev only) to set the game clock for testing seasons and nightfall.

## 8. Determinism and RNG

- `packages/shared/src/rng`: a small seeded PRNG (e.g. `sfc32` or `mulberry32`) with `next()`, `int(min, max)`, `pick()`, `weighted()`.
- Never use `Math.random()` in game logic (lint rule). Seeds are generated server-side with `crypto.randomBytes` and stored with the battle/roll.

## 9. Security and safety

- Argon2id with library defaults (or memory ≥ 19 MiB, iterations ≥ 2).
- Recovery codes: 12 characters, shown once, stored hashed.
- All user-entered text (usernames, nicknames, outfit names, chat in Phase 2) goes through `lib/filter` on the server.
- Helmet security headers; Content-Security-Policy restricting scripts to self.
- No third-party analytics or ads. No email collection. Birth year only.
- Secrets via environment variables only; never committed.

## 10. Configuration (env vars)

| Var | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `3000` | server listens here behind Caddy |
| `DATABASE_URL` | `postgres://heartpatch:…@db:5432/heartpatch` | |
| `SESSION_SECRET` | 64 random bytes, base64 | cookie signing |
| `PUBLIC_ORIGIN` | `https://play.pumpkinpatchgames.com` | CORS, cookies |
| `LOG_LEVEL` | `info` | |
| `HP_DEV_NOW` | `2026-12-20T20:59:00-05:00` | dev/test only |

Parsed and validated by `apps/server/src/config.ts` (zod); the server refuses to start on invalid config. Keep `.env.example` current.

## 11. Infrastructure (AWS)

Small and cheap on purpose: one server for a few families.

- **AWS Lightsail** Linux instance, **Ubuntu 24.04 LTS**, **2 GB RAM plan** (check current Lightsail pricing), region **us-east-2 (Ohio)**.
- **Static IP** attached to the instance.
- **Lightsail firewall:** allow TCP 22 (SSH, ideally restricted to your IP), 80, 443. Nothing else.
- **Automatic daily snapshots** enabled in Lightsail.
- **DNS:** stays at **GoDaddy**. Add an **A record** `play` → Lightsail static IP. The root domain keeps serving the GoDaddy Website Builder homepage, which gets a "Play Heartpatch" button.
- **On the instance (docker compose):**
  - `caddy` — ports 80/443, automatic Let's Encrypt HTTPS for `play.pumpkinpatchgames.com`, serves the built client as static files and proxies `/api` and `/ws` to the server. Gzip/zstd, long cache headers for hashed assets, no-cache for `index.html` and the service worker.
  - `server` — the Node app.
  - `db` — Postgres 16 with a named volume, **not** exposed outside the Docker network.
- **Backups:** nightly `pg_dump` (compressed) via cron on the host, kept 14 days on disk, plus Lightsail snapshots. Optional later: copy dumps to an S3 bucket. `restore.sh` documented and tested.
- **Swap:** add a 2 GB swap file at setup (Node builds and Postgres on small instances).
- **Security on the host:** non-root deploy user, SSH key auth only, `unattended-upgrades`, `fail2ban`.

## 12. CI/CD (GitHub Actions)

- **`ci.yml`** on every PR: install (pnpm cache), lint, typecheck, unit tests, build, Playwright smoke against a dev stack (Postgres service container).
- **`deploy.yml`** on push to `main`:
  1. Build Docker images for server and client (client is a static build copied into the Caddy image or a volume).
  2. Push to **GitHub Container Registry** (`ghcr.io/mattbaldwin/heartpatch-*`).
  3. SSH to Lightsail, `docker compose pull && docker compose up -d`, run migrations, health-check `/api/v1/health`; roll back to the previous image tag on failure.
- **Repository secrets:** `LIGHTSAIL_HOST`, `LIGHTSAIL_USER`, `LIGHTSAIL_SSH_KEY`, plus production env values stored in a `.env` file on the server (not in GitHub).

## 13. Testing and definition of done

- Shared logic (battle, formulas, hex, rng, data validation): unit tests, high coverage.
- Server endpoints: integration tests against a real Postgres (test container or CI service).
- Client: Playwright smoke on an iPhone viewport for the core flow; manual iPhone check noted in the PR.
- A PR is done when: CI is green, acceptance criteria in the issue are checked, design doc / tech spec updated if behavior changed, and client PRs include a "How to test on iPhone" note.

## 14. Observability

- Structured pino logs to stdout; Docker log rotation configured.
- `/api/v1/health` (liveness) and `/api/v1/ready` (DB reachable).
- A small admin page for the map owner (Phase 1: members, join requests, password reset; later: chat review).
