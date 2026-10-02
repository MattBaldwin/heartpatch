# Heartpatch — Technical Specification

> How the game is built. `CLAUDE.md` holds the rules; this file holds the concrete decisions so parallel sessions don't each invent their own. If you need to deviate, say so in the PR and update this file in the same PR.

## 1. Platforms and targets

- **Primary devices:** iPhone and iPad, Safari, installed as a PWA. Minimum **iOS/iPadOS 17**.
- **Secondary:** desktop Chrome, Safari, Firefox (latest 2 versions).
- **Playtest devices:** iPhone 14 and newer; iPads from the last ~4 years (lowest ≈ iPad 10th gen, A14). These run iOS/iPadOS 26, where Safari enables WebGPU by default.
- **Performance:** 60 fps on iPhone 13 or newer; never below 30 fps on iPad 9th gen (kept as a safety margin below the playtest devices). Initial load under 5 s on 4G; total first-load download under **15 MB** (rest lazy-loaded).
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

**Secret data split:** data that must stay hidden (Easter-egg conditions, rare spawn rules, evolution weights, drop tables, secret milestones, **secret species and secret evolution forms**, including their names and visuals) lives in `packages/shared/src/data/server/` and is **only imported by the server**. A lint rule or test must fail if the client bundle imports anything from `data/server/`.

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
- Almost everything is **scoped by `map_id`** (progress is per map). **Per user (account-level):** accounts, Keeper config, the wardrobe and clothing, **Patch Coins** (`coin_ledger` is keyed by user), milestones and titles, and tutorial progress. Daily earning caps are enforced per account.
- Money-like values (Patch Coins, resource counts) are integers. Every change goes through a **ledger table** (`coin_ledger`, `resource_ledger`) with a reason; balances are derived or cached and reconciled in tests.
- Soft-delete is not used; removed players' data is archived by status flags.
- Migrations: `drizzle-kit generate`, committed, applied on deploy. Never edit a merged migration.

**Core spine (designed up front in issue #2):** `users`, `sessions`, `maps` (including `event_seq`), `map_members`, `tiles`, `squishies`, `game_events`. These are the tables most others reference, so they are designed once rather than piecemeal by parallel branches. **Feature tables** (wardrobe, ledgers, milestones, battles, etc.) arrive in their own issue's migration. **Migration workflow for parallel branches:**
  1. Generate migrations freely while developing (integration tests need a schema).
  2. Before merging, delete the branch's generated migration SQL and its `meta/` journal and snapshot entries, merge the latest `main`, and regenerate once.
  3. If `main` gains a migration between hand-off and merge, the coordinator regenerates again.
  4. CI fails if `drizzle-kit generate` would produce a diff, and runs `drizzle-kit check`.
  5. Migrations must be safe while the previous release is still running (expand, then contract in a later release), because a rollback runs the previous image against the already-migrated schema.

**Core tables (Phase 1):** `users` (with `time_zone`), `sessions`, `event_consumers`, `recovery_codes`, `keepers`, `maps`, `map_members`, `invite_codes`, `join_requests`, `tiles`, `species_seen`, `squishies`, `buildings`, `inventories`, `resource_ledger`, `gather_jobs`, `battles` (seed, action log, result), `raids`, `hollow_events`, `clothing_owned`, `outfits`, `milestone_progress`, `milestone_rewards`, `coin_ledger`, `boutique_stock`, `quick_messages`, `game_events`.

## 5. API

### REST
- Base path `/api/v1`. JSON only. All bodies and responses validated with zod schemas from `packages/shared/src/schemas`.
- Auth: session cookie `hp_session` (HttpOnly, Secure, SameSite=Lax, 30-day rolling). CSRF: require header `X-Requested-With: heartpatch` on mutating requests (simple and sufficient with SameSite cookies).
- **Commands, not state writes:** e.g. `POST /maps/:mapId/tiles/:tileId/attack`, `POST /maps/:mapId/squishies/:id/care` with `{ action: "pet" }`. The server computes outcomes.
- Errors: `{ error: { code: "TILE_NOT_ADJACENT", message: "Friendly text a kid can read" } }` with proper HTTP status. Codes are a shared enum.
- Rate limits: global per-IP limit; tighter limits on auth, care actions and chat, including Phase 1 quick messages and emoji (`chat.quick`). In Phase 1 these limits stand in for owner mute.
- Idempotency: mutating endpoints accept an optional `Idempotency-Key` header; the client sends one for purchases, trades and battle actions so a retry on a flaky phone connection can't double-apply.

### WebSocket
- Endpoint `/ws`, authenticated by the session cookie. One connection per client; the client subscribes to a map channel.
- Message envelope (zod-validated both ways):
  ```ts
  { v: 1, type: "tile.updated", mapId: string, seq: number, at: string, data: {...} }
  ```
- `seq` is a per-map monotonically increasing number. On reconnect the client sends its last `seq`; the server replays missed events from `game_events` or tells the client to refetch full state.
- Server → client events (Phase 1): `map.created`, `map.updated`, `member.joined`, `member.left`, `member.removed` (registered by #4), plus `tile.updated`, `raid.resolved`, `building.updated`, `squishy.updated`, `hollow.nightfall`, `chat.quick`, `milestone.earned` (each registered by the issue that writes it). The registry in `packages/shared/src/schemas/events.ts` is the source of truth: every type has an internal and a public schema, and `apps/server/src/ws/public-views.ts` builds broadcasts from it, so an unregistered type is never sent.
- Heartbeat ping every 25 s; iOS suspends background tabs, so always resync on `visibilitychange`.
- Protocol messages use the reserved `ws.` type prefix: `ws.ready`, `ws.subscribed`, `ws.cursor` (seqs up to here that aren't for this player are skipped, so they're not a gap), `ws.resync` (refetch full state), `ws.error` (shared error codes) and `ws.pong`. Client → server: `subscribe { mapId, afterSeq }`, `unsubscribe`, `ping`. Details: `apps/server/README.md` → "Live sync".

## 6. Client architecture

- **Rendering:** one Babylon `Engine`; scenes swapped (map, home base, battle, close-up, wardrobe). **WebGL2 is the default renderer for Phase 1** (owner decision, docs/DECISIONS.md). WebGPU is opt-in behind a setting until it's proven on real devices; when enabled, it falls back to WebGL2 automatically, including on device loss. Scene code must work on both.
  - **Testing caveat:** Playwright WebKit in CI runs without WebGPU, so CI exercises the WebGL2 path; the WebGPU path is verified on real devices.
  - **Shaders:** write Phase 1 custom shaders for WebGL2 (GLSL ES 3.0, or Babylon node materials). Add WGSL versions only when the WebGPU path is enabled, so Babylon never has to load its glslang/twgsl WASM converters, which would count against the 15 MB first-load budget.
  - **Memory and heat:** no MSAA on any tier (FXAA only), and no half-float HDR pipeline unless a feature needs it. A 4× MSAA RGBA16F pipeline at DPR 2 costs about 250 MB of GPU memory on a 10th-gen iPad before any content. Render only when something changes, or cap at 30 fps while idle, so a static map doesn't drain battery or throttle. Babylon has no built-in render-on-demand: keep a dirty flag inside `runRenderLoop`, set by camera matrix changes, running animations and store updates.
- **Quality settings:** `engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2))`; FXAA post-process (Babylon core has no SMAA; add one only if FXAA isn't good enough), and create the engine with `antialias: false` so the default framebuffer has no MSAA; dynamic resolution scaler targeting 60 fps, paused while the scene is idle so idle frames aren't mistaken for slow ones; quality tiers (high/medium/low) auto-picked from a short benchmark and adjustable in settings. **Default tier is high** on the playtest devices; spend the headroom on squishy quality (clearcoat, bloom, close-up depth of field) first.
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
  - **Same transaction:** the event row is written in the **same DB transaction** as the state change it describes. If the change rolls back, so does the event. Broadcast to WebSocket clients only **after commit**.
  - **Per-map `seq` without gaps:** allocate `seq` with `UPDATE maps SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq` inside that transaction, as its **last write**. Don't use a Postgres sequence: sequences skip numbers on rollback, and a reconnecting client would think it missed an event. The row lock (held until commit) makes commit order match `seq` order. Taking it last keeps the busy `maps` row locked briefly and gives a fixed lock order (entity rows first, `maps` last), which avoids deadlocks.
  - **Ordering on the wire:** post-commit broadcasts can still leave Node out of order. The client buffers briefly and applies events in `seq` order. Only a gap that persists past a short timeout triggers a replay request.
  - **Delivery guarantee:** if the process crashes between commit and broadcast, live delivery of that event is lost, but the row is committed, so clients pick it up on reconnect or `visibilitychange` resync. That is acceptable for this game; there is no separate outbox relay.
  - Index `(map_id, seq)` unique. Pruning old `game_events` only limits **WS replay** (older gaps refetch full state). Consumers that need history (raid log, milestone progress, Easter-egg state) keep their own tables and don't rely on old `game_events` rows.
  - **Event consumers (milestones, tutorial steps, Easter eggs, raid log):** these never run inside the command's transaction and never depend on live broadcast. Each consumer records its position in `event_consumers (consumer, map_id, last_seq)` and processes events **in `seq` order** from `game_events`. Because `seq` is gap-free and commits happen in `seq` order (the `maps` row lock), "everything after `last_seq`" is exact. To make "a crash only delays processing, never loses it" true:
    - **Wake-up inside the transaction:** the command enqueues the consumer job with pg-boss `send` using the command's own transaction, so the wake-up commits or rolls back with the event. A periodic catch-up job also wakes any consumer whose `last_seq` is behind `maps.event_seq`.
    - **One worker per `(consumer, map_id)`:** the consumer queue uses pg-boss's `singleton` (or `stately`) policy with a `singletonKey`, and the worker holds `SELECT … FOR UPDATE` on the `event_consumers` row while processing, so events are applied in order exactly once per consumer. The worker keeps processing until it reaches `maps.event_seq`, so a wake-up dropped by de-duplication is never lost.
    - **Idempotent handlers**, with `last_seq` advanced in the same transaction as the handler's writes.
    - **Pruning:** never prune `game_events` below the lowest `last_seq` of any consumer for that map.
  - **Public vs internal payloads:** a `game_events` row's `payload` is internal and may hold server-only detail. WebSocket broadcast sends a **public view** built per event type (and per recipient where needed), never the raw payload.
- **Scheduled jobs (pg-boss):**
  - `nightfall` per map at 21:00 map time (Hollow Man, §14 of the design doc)
    - **Hearthfire fuel is a date, not a counter:** each Hearthfire stores `fuelled_through` (the last map-local night its fuel covers). `tonight` means the **next nightfall that hasn't run yet** for that map (after 21:00, that's tomorrow's). Adding *n* nights of Emberwood sets `fuelled_through = max(fuelled_through, tonight − 1) + n`, capped at `tonight − 1 + max_nights`. At nightfall the fire protects tonight if `fuelled_through ≥ tonight`. "Nights left" is shown as `fuelled_through − tonight + 1` (minimum 0). Nothing is decremented, so a retried or duplicate nightfall run can't burn fuel twice.
  - `stranded-decay` (Phase 2)
  - `boutique-rotate` daily per account (coins and wardrobe are account-level), at midnight in the account's time zone
  - `invite-expiry`, `session-cleanup`, `chat-retention` daily
  - Jobs are idempotent and keyed by `(job, scopeId, date)` (scope is the map, or the account for per-account jobs like `boutique-rotate`) so a restart never runs nightfall twice.
- **Tutorial maps:** a tutorial is a normal map row with `kind = 'tutorial'` and one member, created from a hand-authored layout in `data/tutorial/`. It runs the **same** modules (gathering, battles, capture, care, buildings, nightfall) with a `tutorialOverrides` config (fast timers, guaranteed capture, scripted opponent AI, Hollow Man can't take anything). No separate code path for tutorial gameplay.
- **Tutorial step engine:** steps are data (`id, goal, sproutLines, highlightTarget, completeOn: game event type + predicate`). The tutorial event consumer (see event consumers above) advances `users.tutorial_step` when it processes a matching `game_events` row, and the client renders the current step. Account-level rewards (Partner species, Seedling Scarf, First Patch milestone) are granted idempotently on completion.
- **Dev time override:** env `HP_DEV_NOW` and an admin endpoint (dev only) to set the game clock for testing seasons and nightfall.

## 8. Determinism and RNG

- `packages/shared/src/rng`: a small seeded PRNG (e.g. `sfc32` or `mulberry32`) with `next()`, `int(min, max)`, `pick()`, `weighted()`.
- Never use `Math.random()` in game logic (lint rule). In `packages/shared`, lint also bans transcendental `Math.*`, `**`, comparator-less sorts and `localeCompare`; client procedural code (`apps/client/src/procedural/`) bans `Math.random` too, so every player sees the same squishy. Seeds are generated server-side with `crypto.randomBytes` and stored with the battle/roll.
- **Server-side secrecy:** RNG state and seeds stay on the server while a battle is in progress. The client gets a **public view** of battle state that can't be used to predict misses, damage variance or capture rolls. The seed may be revealed after the battle ends (for replays).
- **No rerolls:** wild spawns and guardians are fixed per tile and time window (seeded server-side from the map seed, tile and window, or stored), so restarting a battle can't reroll what appears. The **map seed is never revealed** to clients, since it would predict every spawn; individual battle seeds may be revealed after the battle. **How:** new seeds come only from `newSeed()` (`apps/server/src/lib/rng.ts`, 128 bits from `crypto.randomBytes`); child seeds come from `deriveSeed(parent, ...labels)` (`packages/shared/src/rng`), e.g. a tile's spawn seed is `deriveSeed(mapSeed, 'spawn', q, r, windowId)`. A **spawn window** is a block of map-local wall-clock time whose length is its own tunable that divides 24 **[DEFAULT: 4 h]**. Its id is the map-local date plus the 0-based block index, `block = floor(local hour / window hours)` computed in `maps.time_zone`, written like `2026-10-31/5` (20:00–23:59). Daylight-saving days may have one uneven block (5 or 3 real hours); ids stay unique and ordered. The first issue that uses windows adds a shared `spawnWindowId(instant, timeZone)` helper with tests. **Seeds that may be revealed** (battle seeds, for replays) come from `newSeed()` and are stored with the battle. `deriveSeed` is a fast non-cryptographic hash that can be partly inverted, so **never reveal a seed derived from a secret parent** (it would leak sibling spawn seeds). If a revealable seed must ever be derived, derive it server-side with HMAC-SHA256. Never invent another seed format. Starting a tile battle consumes an attempt and starts the tile cooldown, and abandoning counts as a loss (wild encounters and rescues don't use attempts).
- **Cross-engine determinism:** plain float `+ − × ÷` is identical on V8 (Node) and JavaScriptCore (Safari), so float multipliers are fine; apply `Math.floor`/`Math.round` at defined steps. Banned in outcome maths: transcendental `Math.*` (`pow`, `exp`, `log`, trig), `Math.random`, and sorts without a total-order comparator. Curves that need powers (e.g. XP) use lookup tables or integer loops.
- **Content versioning:** every battle records a content version (a hash of the data tables it used) and its resolved turn log alongside the seed and actions, so replays and explanations survive re-tuning.

## 9. Security and safety

- Argon2id with library defaults (or memory ≥ 19 MiB, iterations ≥ 2).
- Recovery codes: 12 characters, shown once, stored hashed. **One active code per user**; resetting with it marks it used and shows a fresh one. The `recovery_codes` table keeps used codes for audit.
- **Operator password reset:** a built server script for players with no map owner, or whose game maps have different owners, run on the host as `docker compose exec server node dist/ops/reset-password.js <username>` (the production image has no pnpm or dev tooling). Never exposed over HTTP. A reset (operator or map owner) also revokes the user's existing sessions and shows a new recovery code.
- All user-entered text (usernames, nicknames, outfit names, chat in Phase 2) goes through `lib/filter` on the server.
- Helmet security headers; Content-Security-Policy restricting scripts to self.
- No third-party analytics or ads. No email collection. Birth year only.
- Secrets via environment variables only; never committed.

## 10. Configuration (env vars)

| Var | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | defaults to `production`; `pnpm dev` sets `development` |
| `PORT` | `3000` | server listens here behind Caddy |
| `DATABASE_URL` | `postgres://heartpatch:…@db:5432/heartpatch` | |
| `SESSION_SECRET` | 64 random bytes, base64 | cookie signing |
| `PUBLIC_ORIGIN` | `https://play.pumpkinpatchgames.com` | CORS, cookies |
| `LOG_LEVEL` | `info` | |
| `APP_VERSION` | `2026.10.02-abc123` | set by deploy (image tag); reported by `/api/v1/health` |
| `TRUST_PROXY` | `true` | `true` behind Caddy so `request.ip` is the player's IP (per-IP rate limits) |
| `HP_DEV_NOW` | `2026-12-20T20:59:00-05:00` | dev/test only |
| `HP_SIGNUP_CODE` | random string | required to create an account (family-only signup, Phase 1); checked with a constant-time comparison under the auth rate limit |
| `HP_TUTORIAL_REQUIRED` | `false` | defaults to `false` when unset; when `false`, new accounts can create/join maps without finishing the tutorial. Flip to `true` once the tutorial (#24) ships |

Parsed and validated by `apps/server/src/config.ts` (zod); the server refuses to start on invalid config. Keep `.env.example` current.

## 11. Infrastructure (AWS)

Small and cheap on purpose: one server for a few families.

- **AWS Lightsail** Linux instance, **Ubuntu 24.04 LTS**, **2 GB RAM plan** (check current Lightsail pricing), region **us-east-2 (Ohio)**.
- **Static IP** attached to the instance.
- **Lightsail firewall:** allow TCP 22 (SSH; open to all because GitHub-hosted runners deploy from changing IPs, protected by key-only auth and fail2ban), 80, 443. Nothing else.
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
  3. SSH to Lightsail, `docker compose pull`, run migrations with the new image (one-off container) **before** switching, then `docker compose up -d`. Health-check `/api/v1/health` and roll back to the previous image tag on failure. Then make a **one-off** `/api/v1/ready` check; if it fails, roll back the image the same way and report the failure (a broken `DATABASE_URL` or failed migration). Ongoing container health checks use `/health` only.
- **Repository secrets:** `LIGHTSAIL_HOST`, `LIGHTSAIL_USER`, `LIGHTSAIL_SSH_KEY`, `LIGHTSAIL_KNOWN_HOSTS` (the server's pinned SSH host key), plus production env values stored in a `.env` file on the server (not in GitHub).

## 13. Testing and definition of done

- Shared logic (battle, formulas, hex, rng, data validation): unit tests, high coverage.
- Server endpoints: integration tests against a real Postgres (test container or CI service).
- Client: Playwright smoke on an iPhone viewport for the core flow; manual iPhone check noted in the PR.
- A PR is done when: CI is green, acceptance criteria in the issue are checked, design doc / tech spec updated if behavior changed, and client PRs include a "How to test on iPhone" note.

## 14. Observability

- Structured pino logs to stdout; Docker log rotation configured.
- `/api/v1/health` (liveness: process is up) and `/api/v1/ready` (readiness: DB reachable). Ongoing container health checks use **`/health` only**, so a brief database hiccup can't restart a healthy container. `/ready` is checked once per deploy (§12).
- A small admin page for the map owner (Phase 1: members, join requests, password reset; later: chat review).

## 15. Audio

- **Sources:** CC0 assets only (e.g. Kenney, Freesound filtered to CC0, OpenGameArt filtered to CC0), each logged in `ASSETS.md` with source URL and license, plus **procedural synthesis** (Web Audio API) for squishy voices.
- **Formats:** AAC (`.m4a`) for music and SFX (short SFX as mono AAC, 44.1 kHz). Both MP3 and AAC add encoder padding at the start of a file (about 2112 samples for AAC). What makes loops gapless is playing from decoded Web Audio buffers with explicit `loopStart`/`loopEnd`, measured per file and verified in Safari and Chrome.
- **Loudness:** normalise music to about −16 LUFS integrated and match SFX loudness by category; true-peak ceiling −1 dBTP.
- **Mix:** buses for music, SFX, UI and ambience, each with its own volume setting; a limiter on the master bus; music ducks under key moments (capture, evolution, Hollow Man arrival).
- **Variation:** each SFX has 2–4 variants plus small random pitch/volume variation per play, to avoid repetition fatigue.
- **Procedural voices:** layered oscillators with envelopes, pitch bends and formant (vowel-like) filters; per-species voice parameters live in species data (size → pitch, feeling → contour).
- **iOS:** unlock the `AudioContext` on the first user gesture; resume it on `visibilitychange` and when `statechange` reports `interrupted` (phone calls, Siri). Set `navigator.audioSession.type = "ambient"` where supported (iOS 16.4+) so game audio mixes with other apps and respects the silent switch.
- **Sound gallery:** a dev-only page that plays every sound and loop, so a human can judge quality by ear.
- **Budget:** audio counts toward the 15 MB first load; lazy-load music per scene.

