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
│  │  │  ├─ engine/           Babylon setup, camera, frame scheduler, quality/ (governor, tiers)
│  │  │  ├─ scenes/           dev test scene (each feature folder owns its own scene)
│  │  │  ├─ procedural/       squishy + keeper generators, part library
│  │  │  ├─ ui/               DOM helpers and the auth, lobby, keeper and wardrobe screens (see §6)
│  │  │  ├─ net/              REST client, WebSocket client, reconnect
│  │  │  ├─ pwa/              install prompt, offline shell, update flow
│  │  │  ├─ map/ territory/ home/ inventory/ catalog/ care/ close-up/ battle/ raids/ hollow/ tutorial/
│  │  │  │                    feature folders: one per screen or system, each with its API
│  │  │  │                    client, scene (map, home base, battle, close-up), DOM view,
│  │  │  │                    CSS and tests; client state sits beside its feature (map-state.ts)
│  │  │  └─ audio/            sound (#25): gesture unlock, settings, cues; lazy engine,
│  │  │                       procedural SFX and music loops; dev gallery /sounds.html
│  │  ├─ public/              icons, manifest, static assets
│  │  └─ tests/e2e/           Playwright
│  └─ server/                 Node 22 + Fastify
│     ├─ src/
│     │  ├─ index.ts          bootstrap
│     │  ├─ config.ts         env parsing (zod)
│     │  ├─ db/               drizzle schema, migrations, seed
│     │  ├─ modules/          auth, health, keepers, maps, tutorial, battles, spawns,
│     │  │                    territory, gathering, inventory, buildings, care, raids,
│     │  │                    hollow, wardrobe, chat, coins, boutique, lore,
│     │  │                    milestones, jobs (squishy jobs; pg-boss is src/jobs/)
│     │  │   └─ <module>/     routes.ts, service.ts, repo.ts, schemas.ts, *.test.ts
│     │  ├─ ws/               WebSocket hub, channels, message handlers
│     │  ├─ jobs/             pg-boss: boss, event consumers, nightfall, limits
│     │  ├─ ops/              operator scripts (reset-password, signup-code)
│     │  └─ lib/              filter, rng, time, errors, idempotency, zod
│     └─ tests/
├─ packages/
│  └─ shared/
│     ├─ src/
│     │  ├─ data/             species, moves, matrices, buildings, clothing, recipes,
│     │  │                    seasons, care, hollow, raids, spawn tables (TS/JSON);
│     │  │                    server/ holds the secret data (below)
│     │  ├─ schemas/          zod schemas for data + API + WS messages (events.ts is the event registry)
│     │  ├─ battle/           deterministic battle engine
│     │  ├─ care/ gathering/ home/ hollow/ territory/ spawns/ wardrobe/ tutorial/
│     │  │                    pure rules and formulas for each system (xp, contentment,
│     │  │                    capture chance, fuel nights, spawn windows)
│     │  ├─ hex/ mapgen/      axial coords, neighbors, distance, BFS; seeded map generator
│     │  └─ rng/              seeded RNG
│     ├─ scripts/sim/         balance simulator (`pnpm sim`, #12); progression model (`pnpm sim:progression`); map-fill model (`pnpm sim:map-fill`)
│     └─ tests/
├─ infra/
│  ├─ docker/                 Dockerfiles
│  ├─ compose/                docker-compose.dev.yml, docker-compose.prod.yml
│  ├─ caddy/Caddyfile
│  └─ scripts/                deploy.sh, backup.sh, restore.sh, server-setup.sh, local-smoke.sh
├─ docs/                      GAME_DESIGN.md, TECH_SPEC.md, STYLE_GUIDE.md, DECISIONS.md,
│                             DEPLOY.md, COORDINATOR.md
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

**Core tables (Phase 1).** Built means it is in `apps/server/src/db/schema.ts`; the issue is the one that added it. Names are exact: briefs use them as written.

| Table | Holds | Issue |
|---|---|---|
| `users` (with `time_zone`), `sessions`, `recovery_codes` | accounts and login | #2, #3 |
| `maps`, `map_members`, `tiles`, `squishies`, `game_events` | the core spine | #2 |
| `invite_codes`, `join_requests` | joining a map | #4 |
| `event_consumers` | each consumer's `last_seq` per map (§7) | #47 |
| `battles` (seed, action log, result), `idempotency_keys` | battles; stored replies to retried requests | #13 |
| `battles.rewards` (jsonb, nullable, migration 0015) | what a finished battle granted and the share it paid | #97 |
| `battles.terrain`, `battles.time_of_day` (text, nullable, migration 0022) | where a battle happens: the terrain id its arena is drawn as and the patch's time of day (`day`, `dusk`, `night`) when it started; null for battles from before | battle rebuild Fix PR |
| `map_members.starter_squishy_id` (uuid, nullable, migration 0016) | the squishy a member picked as their starter; the "already picked" marker, kept on rejoin | #99 |
| `users.partner_species_id` (text, nullable, migration 0017) | the tutorial Partner's species (a starter); the starter pick pre-selects it | #24 |
| `lore_found` (migration 0017) | lore pages each player has found, one row per page (design doc §16) | #24 |
| `keepers` | each account's Keeper | #42 |
| `keepers.hairstyle` (text, nullable, migration 0023) | the hairstyle the player picked; null for the base's own style (every Keeper saved before styles could be picked) | Keeper hair styles PR |
| `inventories`, `resource_ledger`, `gather_jobs`, `crafts` | bag, every change to it, gathers and crafts | #17 |
| `species_seen` | the catalog, per map | #14 |
| `buildings` | home-base buildings, and Hearthfires on owned land (#202: one a tile, `buildings_one_fire_per_tile_key`), Hearthfire `fuelled_through` | #18 |
| `tile_attacks.lost_fire_refund`, `tile_tending.lost_fire_refund`, `packed_home_fires` (migration 0027) | what a fire on land that changed hands gave back (the Challenge report and the welcome-back card read it); one row per player whose home fires packed up when fires moved to land (owner decision 2026-10-07), for the one-time morning note | #202 |
| `tile_attacks`, `tile_defenders` | the tile battle attempt log; squishies on watch | #15 |
| `clothing_owned`, `outfits`, `squishy_accessories` | wardrobe, saved outfits, the piece a squishy wears | #43 |
| `care_log`, `squishy_evolutions` | one row per care action (day counts, coin cap, `coins`); what each squishy became | #19 |
| `raids` | the raid log, one row per finished challenge on a player's land (`seen_at`) | #16 |
| `hollow_events`, `hollow_rescues` | one row per map per night; one row per rescue expedition | #21 |
| `milestone_progress`, `milestone_rewards`, `keepers.title_id` (migration 0019) | each account's progress per milestone track (hundredths of a step; `kinds` for "kinds of" tracks), written by the `milestones` consumer; one row per tier earned, unique per `(user, milestone, tier)`, whose uuid v5 id is the `ref_id` of its coins and piece (`seen_at` once celebrated); the title worn on the profile card | #44 |
| `coin_ledger`, `coin_balances` (migration 0018) | every Patch Coin change, unique per `(source, ref_id)`, with the account day for the daily caps; each account's cached balance (its row lock serialises credits and purchases) | #45 |
| `boutique_stock` | not built: the racks are worked out on read from the player's id and their account-local date (`boutiqueStock`), so there's nothing to store or rotate | #45 |
| `squishies.team_slot`, `work_tile_id`, `work_since`, `work_started_at` (migration 0021) | squishy jobs (owner decisions 2026-10-04): the battle team slot, and a gatherer's work tile and timestamps (finished cycles worked out on read). Guards stay in `tile_defenders`, beds in `habitat_building_id` | jobs Fix PR |
| `tile_tending` (migration 0025) | land that misses you (owner decision 2026-10-06, design review Q2): when an outer tile's owner last tended it (a claim or Visit), and when, which night and from whom it last went wild (the per-night cap; `wild_at` counts as land changing hands for work and gathers). Fading is worked out on read | regrowth Fix PR |
| `squishies.training_building_id`, `training_since` (migration 0024) | Training Grounds (owner decision 2026-10-06): the Training Grounds a squishy practices at (`ON DELETE SET NULL`) and when its current count of XP started (XP worked out on read). One job at a time is kept by the commands, as for guards | upgrades Fix PR |
| `quick_messages` | Phase 1 quick messages: a preset, emoji or sticker id per row, never typed text; each map keeps its latest `feedLimit` | #23 |

`game_events` is the stream in §7. A rescue's Heartdust goes into `inventories` through `resource_ledger` (reason `rescue`); `hollow_rescues.heartdust` records what it paid.

## 5. API

### REST
- Base path `/api/v1`. JSON only. All bodies and responses validated with zod schemas from `packages/shared/src/schemas`.
- Auth: session cookie `hp_session` (HttpOnly, Secure, SameSite=Lax, 30-day rolling). CSRF: require header `X-Requested-With: heartpatch` on mutating requests (simple and sufficient with SameSite cookies).
- **Starter pick:** `POST /maps/:mapId/starter { speciesId }` grants the pick (#99). `MapDetail.needsStarter` (`GET /maps/:mapId`) is true until the player has picked. Patches only; the Tutorial Glade is `NOT_FOUND`.
- **Patch Coins and the Boutique (#45):** `GET /coins` (the account's balance), `GET /boutique` (today's racks: prices, "owned", the balance, `restocksAt`), `POST /boutique/buy { itemId }` (send an `Idempotency-Key`; replies with the racks and the wardrobe). Account-level, like the wardrobe. A purchase writes no game event. Other modules pay coins only through `creditCoins(tx, { source, refId, … })` in their own transaction.
- **Keeper milestones (#44):** `GET /milestones` (tracks with progress, earned titles, the worn title, and `news` not celebrated yet; a secret track is `{ hidden: true }` until earned), `POST /milestones/seen { ids }`, `POST /milestones/title { titleId | null }`. Account-level. `MapMember.title` shows a member's worn title to the others.
- **Tutorial (#47, #24):** `GET /tutorial` (status, current step and map, `required`), `POST /tutorial/start`, `/tutorial/replay`, `/tutorial/skip`, `/tutorial/acknowledge { stepId }` and `/tutorial/nightfall` (the Glade's scripted night, only on its step). Account-level. `GET /lore` returns the lore pages the player has found, never one they haven't. `MapDetail.preselectSpeciesId` (`GET /maps/:mapId`) is the Partner's species once the tutorial's befriend step has stored it, so the starter pick starts on it; null before that.
- **Opening cinematic (#46):** `GET /cinematic`, `POST /cinematic/seen` → `{ cinematic: { seenAt } }` (`seenAt` is an ISO time, or null until seen); account-level, idempotent (coalesce: the first time stays).
- **Building upgrades (owner decision 2026-10-06):** `POST /maps/:mapId/buildings/:buildingId/upgrade` pays the next level's cost and raises the level in one transaction (`building.upgraded`); send an `Idempotency-Key`.
- **Recipe book (2026-10-05):** `GET /recipe-book` → `{ unlocked }` (`RecipeBookResponseSchema`), the page keys (`recipe:<id>`, `building:<id>`) the account has opened. Account-level, derived from `resource_ledger` (no table of its own). `POST /maps/:mapId/crafts` and `POST /maps/:mapId/buildings` refuse a sealed page with `FORBIDDEN` before spending anything.
- **Dev routes** (`HP_DEV_SQUISHY_GRANTS`, dev and test only): `POST /dev/coins { amount }`, `POST /tutorial/dev/step { stepId }`, and the "finish now" routes `POST /maps/:mapId/dev/gathers/ready`, `/dev/crafts/ready` and `/dev/work/ready`.
- **Land that misses you (owner decision 2026-10-06):** `GET /maps/:mapId/territory/tending` and `POST /maps/:mapId/territory/visit` → `{ tending }` (`LandTendingResponseSchema`): my fading land, what went wild lately, and when land next starts to miss me. Visit tends all my land. Only the owner sees their own; others see a tile only once it has gone wild (`tile.rewilded`).
- **Settling (owner decision 2026-10-06):** `POST /maps/:mapId/settle` → `SettleResponse` (the bag as `GET /maps/:mapId/inventory`, plus `landed: { kind, items }[]`, `trained: { squishyId, name, xp }[]` (Training Grounds XP) and `nextAt`). Finished crafts, the player's gathers and their gatherers' cycles (capped) go into the bag with the events and ledger rows a collect writes; there is no player-facing Collect. A POST, so reads stay free of side effects (the one exception is the one-time home-ring top-up on the map view and home reads, owner decision 2026-10-06); no `Idempotency-Key` (a repeat banks nothing new). The client calls it when a map opens, when the app comes back, when the Bag or job board opens, and at `nextAt`. The collect routes stay for older bundles.
- **Squishy jobs (owner decisions 2026-10-04):** `GET /maps/:mapId/jobs` (`JobsView`), `POST /maps/:mapId/squishies/:squishyId/job { job: "team" | "resting" | "training" } | { job: "gatherer", q, r }`, `POST /maps/:mapId/team { squishyIds }`, `POST /maps/:mapId/work/collect` (kept for older bundles: players settle instead; send an `Idempotency-Key` on the last three). Commands, like the rest of the API (POST, not PUT). Battles read the picked team at their start only.
- **Full list:** every route with its request and reply is in `apps/server/README.md`.
- **Read-model additions:** `PublicTile.workers` (squishy jobs: how many of the owner's gatherers work the tile, never which); `PublicTile.guardianHint: { count, difficulty } | null` on neutral tiles (#98, worked out on read, never species or levels); `PlayerBattle.rewards` (#97, null while running, after no contest, on a defender's replay and for older battles); `PlayerBattle.terrain` and `PlayerBattle.timeOfDay` (battle rebuild: where it happens, set by the server when it starts; the home terrain by day for older battles, DECISIONS "Battle presentation rebuild").
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
- `seq` is a per-map monotonically increasing number. On reconnect the client sends its last `seq`; the server replays missed events from `game_events` or tells the client to refetch full state. A REST snapshot says which `seq` it is up to date with (`MapView.seq`, read in the same transaction as the state), and the client subscribes from it.
- Server → client events. The registry in `packages/shared/src/schemas/events.ts` is the source of truth: every type has an internal and a public schema, and `apps/server/src/ws/public-views.ts` builds broadcasts from it, so an unregistered type is never sent. Each issue registers the types it writes:

  | Issue | Types |
  |---|---|
  | #4 | `map.created`, `map.updated`, `member.joined`, `member.left`, `member.removed` |
  | #47 | `tutorial.acknowledged`, `tutorial.advanced` (tutorial maps only) |
  | #13 | `battle.started`, `battle.ended` |
  | #14 | `squishy.captured` |
  | #17 | `gather.started`, `resource.gathered`, `item.crafted` |
  | #15 | `tile.attacked`, `tile.captured`, `defenders.changed` |
  | #16 | `raid.resolved` |
  | #18 | `building.placed`, `building.moved`, `building.removed`, `building.fueled`, `squishy.housed` |
  | #19 | `squishy.cared`, `squishy.leveled`, `squishy.evolved` |
  | #20 | `squishy.updated` (a new nickname) |
  | #21 | `hollow.nightfall`, `squishy.hollowed`, `squishy.rescued` (the last two only to the squishy's owner) |
  | #43 | `clothing.found`, `outfit.changed` |
  | #23 | `chat.quick` (a quick message id, never text) |
  | regrowth Fix PR | `tile.rewilded` (whose tiles went back to neutral at a nightfall, and which; the guards that went home stay internal) |
  | jobs Fix PR | `squishy.assigned` (whose, and the work tiles left and reached; which squishy and job stay internal), `team.picked` (only to the player), `work.collected` (who; how much stays internal) |

  Milestones (#44) write no event: they're account-level, and the client looks for `news` (`GET /milestones`) after the player's own play arrives live. A `milestone.earned` event can replace that look later. A tile's change is sent as `tile.attacked` or `tile.captured`; there is no `tile.updated`.
- Heartbeat ping every 25 s; iOS suspends background tabs, so always resync on `visibilitychange`.
- Protocol messages use the reserved `ws.` type prefix: `ws.ready`, `ws.subscribed`, `ws.cursor` (seqs up to here that aren't for this player are skipped, so they're not a gap), `ws.resync` (refetch full state), `ws.error` (shared error codes) and `ws.pong`. Client → server: `subscribe { mapId, afterSeq }`, `unsubscribe`, `ping`. Details: `apps/server/README.md` → "Live sync".

## 6. Client architecture

- **Rendering:** one Babylon `Engine`; scenes swapped (map, home base, battle, close-up, wardrobe). **WebGL2 is the default renderer for Phase 1** (owner decision, docs/DECISIONS.md). WebGPU is opt-in behind a setting until it's proven on real devices; when enabled, it falls back to WebGL2 automatically, including on device loss. Scene code must work on both.
  - **Testing caveat:** Playwright WebKit in CI runs without WebGPU, so CI exercises the WebGL2 path; the WebGPU path is verified on real devices.
  - **Shaders:** write Phase 1 custom shaders for WebGL2 (GLSL ES 3.0, or Babylon node materials). Add WGSL versions only when the WebGPU path is enabled, so Babylon never has to load its glslang/twgsl WASM converters, which would count against the 15 MB first-load budget.
  - **Memory and heat:** no MSAA on any tier (FXAA only), and no half-float HDR pipeline unless a feature needs it. A 4× MSAA RGBA16F pipeline at DPR 2 costs about 250 MB of GPU memory on a 10th-gen iPad before any content. Render only when something changes, or cap at 30 fps while idle, so a static map doesn't drain battery or throttle. Babylon has no built-in render-on-demand: keep a dirty flag inside `runRenderLoop`, set by camera matrix changes, running animations and store updates.
- **Quality settings:** `engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, 2))`; FXAA post-process (Babylon core has no SMAA; add one only if FXAA isn't good enough), and create the engine with `antialias: false` so the default framebuffer has no MSAA; dynamic resolution scaler targeting 60 fps, paused while the scene is idle so idle frames aren't mistaken for slow ones; quality tiers (high/medium/low) managed by a continuous governor (`engine/quality/governor.ts`, #6), a pure reducer over frame times: it cuts the render scale when frames run slow (never below the tier's floor), steps the tier down only when pinned at the floor, and raises both again when there is headroom, never above the tier the player started on. It undoes a cut that didn't help, which is how it copes with a 30 fps cap (iOS Low Power Mode). There is no startup benchmark: it starts on **high** unless the player chose a tier (the settings screen is not built yet; `?quality=` works for testing), and the governor steps down if the device can't keep up; spend the headroom on squishy quality (clearcoat, bloom, close-up depth of field) first.
- **UI:** HTML/CSS overlay on top of the canvas for menus, inventory, wardrobe lists and text input (sharper text, native accessibility, iOS keyboard works properly). Babylon GUI only for in-world labels and bubbles.
- **State:** a small typed store (no heavy framework needed); server is the source of truth. Optimistic UI only for cosmetic actions (e.g. equipping clothing), rolled back on server error.
- **Assets:** glTF/GLB, Draco or meshopt compression, KTX2 textures. Procedural squishies and Keepers need few textures; environment props are small GLBs. Lazy-load per scene.
- **Input:** Pointer Events; gestures for pan, pinch, tap, long-press, stroke. Minimum 44×44 pt tap targets. Respect `env(safe-area-inset-*)`.
- **Offline:** the PWA caches the app shell; gameplay needs a connection, and the UI shows a friendly "reconnecting" state.

### Battles (client)
- **Stage** (`src/battle/arena*.ts`, DECISIONS "Battle presentation rebuild"): a diorama of the battle's terrain (`PlayerBattle.terrain`) at its time of day (`timeOfDay`), built from the map's terrain looks and prop builders (`TERRAIN_LOOKS`, `buildProp`) on a mottled disc, under a vertex-coloured sky dome with the sun's glow, vinyl clouds, far hills and depth fog; a warm key light from behind the other side with a violet fill (the stage's sun re-aimed), a 1024² PCF shadow map for the fighters (none on the low tier), stretched contact shadows and drifting motes. Composition per terrain and the mood per time of day are data (`arena-config.ts`); the layout is pure and seeded from the battle id (`arena-layout.ts`). Built once with the scene; only the motes move after that.
- **Choreography** (`src/battle/choreography.ts`, pure): the steps of `battle-playback.ts` become plans (acts, effects, squish cues, a camera beat, the hit-stop), and a fighter's pose is a pure function of its act, its feeling and the time. Fighters hang from rigs (`SquishyField`'s `parent`), so moving one never re-uploads its buffers. Effects are pooled thin-instanced unlit meshes with buffers sized up front (`effects.ts`; the particles are pure, `element-fx.ts`). The camera director (`camera-director.ts`, pure) fits both fighters into the safe region the HUD reports (under its pills, above its sheet) with a vertical lens shift, leans towards whoever a step is about, pushes in and shakes lightly on a hit.
- **Clock** (`battle-clock.ts`): every timer and pose reads the battle clock. Dev builds take `?battle-slowmo=8` (slower), `?battle-clock=manual` (stepped from `window.__heartpatch.battleDev()`, for captures: `apps/client/tooling/battle-shots/shoot.mjs`) and `?battle-arena=forest/dusk` (the picture only; the server still says where a battle happens).
- **Reduced motion** (`prefers-reduced-motion`): no shake, flash, hit-stop, push-in, roll or twirls; no idle bob or breathing; dashes become a short lunge; effects stay, thinner, without speed lines or rays; the motes hold still.

### Cinematics and tutorial (client)
- **Cinematic player** (`src/cinematics/`): plays a timeline described in data (`packages/shared/src/data/cinematics/*.ts`): shots with duration, camera path keyframes, scene setup, actor animations, caption text and audio cues. A pure timeline evaluated as a function of time (seekable for tap-to-advance, testable without a renderer), drawn on the shared stage; no video files. Every shot's actors are built and warmed up front, and the player is a lazy-loaded chunk (DECISIONS "The opening cinematic (#46)").
- Target 60 fps, acceptable floor 30. Captions are DOM overlay text. Support skip (after first view or long-press), tap-to-advance captions, and `prefers-reduced-motion` (gentler camera moves).
- **Tutorial UI layer** (`src/tutorial/`): highlights a target (spotlight mask over the canvas or DOM element), shows Sprout's speech bubble and an arrow, and blocks unrelated input while Sprout talks or spotlights a target. It waits its turn behind any open sheet (DECISIONS "Sprout waits its turn").

## 7. Server architecture

- Single Node process serving REST + WebSocket + scheduled jobs (enough for a handful of families). Code is modular so jobs can move to a separate worker later.
- **Modules** follow `routes → service → repo`. Services contain game logic and call `packages/shared` formulas; repos are the only place that touches Drizzle.
- **Transactions:** any command touching multiple rows (capture, trade, purchase, reward) runs in one DB transaction with row locks (`SELECT … FOR UPDATE`) on the affected entities.
- **Game event stream:** every meaningful change writes a `game_events` row (type, mapId, actor, payload). This one stream feeds WebSocket broadcast, milestone progress, Easter-egg triggers and the raid log.
  - **Same transaction:** the event row is written in the **same DB transaction** as the state change it describes. If the change rolls back, so does the event. Broadcast to WebSocket clients only **after commit**.
  - **Per-map `seq` without gaps:** allocate `seq` with `UPDATE maps SET event_seq = event_seq + 1 WHERE id = $1 RETURNING event_seq` inside that transaction, as its **last write**. Don't use a Postgres sequence: sequences skip numbers on rollback, and a reconnecting client would think it missed an event. The row lock (held until commit) makes commit order match `seq` order. Taking it last keeps the busy `maps` row locked briefly and gives a fixed lock order (entity rows first, `maps` last), which avoids deadlocks (below).
  - **Lock order:** every transaction takes row locks in this order, skipping what it doesn't need. Several rows of one kind are always locked in id order with `ORDER BY id` (a plan's row order is no promise; a bare multi-row `UPDATE` or a foreign-key cascade locks in scan order, so lock first). A row the transaction inserts itself doesn't count.
    1. `event_consumers` (consumer transactions only)
    2. a member row locked to check it (`lockMember`: territory, raids)
    3. the seats lock (the owner's `map_members` row), then a join request
    4. `users`, then `outfits`
    5. the battle
    6. tiles, then `tile_defenders`
    7. `gather_jobs`
    8. buildings, then a craft
    9. the Hollow's rows (the night's `hollow_events`, a `hollow_rescues` row)
    10. squishies
    11. inventory rows (item id order), then `species_seen`, then the account's `milestone_progress` rows (by player, then track) and `milestone_rewards` (#44)
    12. the account's `coin_balances` row (`creditCoins`, `spendCoins`; #45)
    13. `maps`, last (`appendGameEvent`). A capture's found clothing (`rollFoundDrop`, #84) inserts its `clothing_owned` row and appends `clothing.found` after step 12, so that event is the battle finish's first `maps` append; `battle.ended` follows it
    - Commands that join or leave a map write the member row after `users` (approve's `upsertMember`, depart's `archiveMember`); nothing that takes `lockMember` then takes seats or `users`, so that's safe. The starter pick takes `users` before its `lockMember` too, so Sprout's first-pick gift is granted once per account; an owner's member row is the seats row, so an owner's pick takes the seats lock first (step 3, then `users`), as approve does.
    - **Posting guards** (`setDefenders`) writes `tile_defenders` after the squishy locks. That's safe because the tile row lock (step 6) serialises everyone who writes a tile's defenders.
    - **Land going wild** (nightfall, `modules/territory/tending.ts`) fills missing `tile_tending` rows on their own first (inserts that take their key-share locks on the tiles in id order first), then locks the chosen tiles (step 6, id order) and their `tile_tending` rows (with the tiles, tile id order; `tended_at` re-read), writes them, deletes their `tile_defenders`, locks the gatherers on them (step 10, id order) and banks their work (step 11, `leaveWork`), then `maps`. **Visit** locks the player's outer tiles (step 6, id order, `for no key update`) before their `tile_tending` rows. A capture writes the tile's row after its tile lock. `tile_tending` has no foreign key to `maps`, so a capture's write takes no lock on `maps` before the battle's squishies.
    - **Settling** (`modules/settle`) takes the member row (step 2, `lockMember`: one settle at a time per player), then the work and gather tiles (step 6, id order), the player's `gather_jobs` (step 7, id order), the craft (step 8), the gatherers (step 10, id order), every inventory row it grants (step 11, `lockGrantRows`), and only then the gathers' clothing rolls (each appends `clothing.found`) and its events, `maps` last. **Starting a craft** locks the player's uncollected craft (step 8) before every inventory row it banks or spends (one `lockGrantRows`). **Starting a gather** that banks the node's finished gather (its own or a previous owner's) takes the tile, then that gather (step 7), then its owner's inventory rows, then `maps`. `settle.test.ts` checks each side.
    - **Squishy jobs** take the member row (step 2, `lockMember`: one job change at a time per player), then the tiles the squishies stand on or work plus a new work tile (step 6, id order), the squishies (step 10, id order), the inventory rows banked work goes into (step 11), and `maps` last. A collect takes the work tiles before the squishies, so a capture can't land mid-collect. Banking (`leaveWork`) runs inside posting a guard, housing and nightfall after their squishy locks and before their events; nightfall's taken gatherer adds step 11 after its squishies. Banked items are locked per owner in item-id order before any grant (`lockGrantRows`), so two gatherers on different resources can't take them in squishy order. `jobs.test.ts` checks the jobs commands' sides (member → tile → squishy → inventory → `maps`, and two gatherers' items); the banking inside posting, housing and nightfall runs the same helper after those commands' own squishy locks.
    - **Training Grounds and upgrades (owner decision 2026-10-06).** Assigning a trainee takes the member row, then the Training Grounds' tile with the other tiles (step 6, id order; taking a building down locks every home tile first, so the two can't race), then the squishy (step 10). Settling locks trainees with the gatherers (step 10, one id-ordered lock). Landing training XP (`landTraining`, inside settle, job changes, posting, nightfall and a take-down) runs `applyXp` after the squishy locks, so a trainee's evolution writes `species_seen` (step 11) and its events last. Taking a Training Grounds down locks the building (step 8), then its trainees (step 10, id order); a habitat's residents and a Training Grounds' trainees are never the same building's. An upgrade locks the building (step 8), then for Training Grounds its trainees (step 10, id order), then the inventory rows it spends (step 11); trainees' XP lands at the old level (`applyXp`, so an evolution's `species_seen` follows the inventory rows), then the level rises, then `maps`. Taking a Training Grounds down grants its refund (step 11) before its trainees' XP lands.
    - **Home-ring top-up** (`seedHomeRingNodes`, buildings module; owner decision 2026-10-06) runs when the map view or a home is read and a home ring lacks a `homeRingNodes` node (only patches made before the seasonal nodes). One transaction: every home tile on the map `FOR NO KEY UPDATE` in id order (step 6, the same lock building placement and moves take), then it plans again under that lock (so a second reader or a retry adds and moves nothing twice), then the buildings it moves out of a ring tile's middle to a side spot on the same tile (step 8, id order), then each missing node only where the tile has none, then one `building.moved` per moved building (`maps` last).
    - **Fires on land (#202).** Building on an owned outer tile locks the player's home tiles and the target tile in one id-ordered lock (step 6), then the buildings (step 8). **Fuel all fires** locks the player's fires (step 8, id order), then the inventory rows it spends (step 11), then `maps` (one `building.fueled` per fire). **Losing land** takes its fires down inside the command that loses it, after that command's tile locks: a capture (in the battle's finish, after its squishy locks), land going wild (before `leaveWork`, whose inventory lock covers the refund too) and leaving a patch lock the fires (step 8, id order), delete them, then grant the full refund (step 11, `lockGrantRows`) and append `building.removed` (`lost`) last. The boot pass that packs up home fires and moves misplaced ring buildings (`relayoutHomes`) runs one transaction per player: their home tiles (step 6), the buildings (step 8, id order), the refund (step 11), the `packed_home_fires` note, then `maps`. `lock-order.test.ts` checks the three new id-ordered locks (`lockHomeTilesAnd`, `lockFires`, `lockOnTiles`).
    - **Guards in the dark (owner decision 2026-10-07).** Nightfall first locks every tile someone stands watch on (step 6, id order, `lockPostTiles`), then claims the night's row and locks the squishies (`nightSquishies`), so a guard it takes leaves its post (`leavePosts`, deleting its `tile_defenders` row) under its tile's lock, as posting writes it. `lock-order.test.ts` checks the id order.
    - **Chat prune** locks `quick_messages` rows with `FOR UPDATE SKIP LOCKED`. They sit outside the order above and are locked before `maps` (the send's last write). A skipped prune never waits, so it can't deadlock; the next send catches up.
    - **Patch Coins** are paid inside the transactions that earn them (a battle's finish, care, and #44's milestones) after whichever of these locks the path takes (squishy, inventory, `species_seen`, milestone) and before their events. Battle and care take no milestone locks. A purchase locks only the balance row. Care's `users` lock (step 4) comes first, as before. `lock-order.test.ts` checks both sides for care and battles.
    - **Milestones (#44)** take only step 1 (the consumer's position), step 11's milestone rows and step 12, and never `maps` (they write no event). Within one event: the `milestone_progress` rows (by player, then track), then **every** `milestone_rewards` row it grants (by player, track, tier; The First Patch included), and only then the pieces and coins (`grantMilestoneTiers`). The First Patch, granted from `GET /milestones` or the boot backfill, takes its `milestone_rewards` row then `coin_balances`. `lock-order.test.ts` checks each side.
    - **Lore (`lore_found`)** is written by the `lore` consumer: one insert that ignores a page already found. It takes no row locks, so after `event_consumers` (step 1) it only inserts, and it writes no event, so it never takes `maps`.
    - **One known exception:** a capture try locks the Heart Charm's inventory row before the team's squishies (XP when it ends the battle). It's safe only because no command locks a squishy and then a Heart Charm row (care never spends one); see DECISIONS "Lock order (Fix PR)".
    - A consumer transaction applies **one event** and takes `maps` at most once, at its end: a batch would hold `maps` from one event's append while the next event's handler locks squishies or tiles, the reverse of every command's order.
  - **Ordering on the wire:** post-commit broadcasts can still leave Node out of order. The client buffers briefly and applies events in `seq` order. Only a gap that persists past a short timeout triggers a replay request.
  - **Delivery guarantee:** if the process crashes between commit and broadcast, live delivery of that event is lost, but the row is committed, so clients pick it up on reconnect or `visibilitychange` resync. That is acceptable for this game; there is no separate outbox relay.
  - Index `(map_id, seq)` unique. Pruning old `game_events` only limits **WS replay** (older gaps refetch full state). Consumers that need history (raid log, milestone progress, Easter-egg state) keep their own tables and don't rely on old `game_events` rows.
  - **Event consumers (milestones, tutorial steps, Easter eggs, raid log):** these never run inside the command's transaction and never depend on live broadcast. Each consumer records its position in `event_consumers (consumer, map_id, last_seq)` and processes events **in `seq` order** from `game_events`. Because `seq` is gap-free and commits happen in `seq` order (the `maps` row lock), "everything after `last_seq`" is exact. To make "a crash only delays processing, never loses it" true:
    - **Wake-up inside the transaction:** the command enqueues the consumer job with pg-boss `send` using the command's own transaction, so the wake-up commits or rolls back with the event. A periodic catch-up job also wakes any consumer whose `last_seq` is behind `maps.event_seq`.
    - **One worker per `(consumer, map_id)`:** the consumer queue uses pg-boss's `short` policy with a `singletonKey` (one queued job per map; not `stately`, whose one-active-per-key index errors on every fetch while a map's job runs), and the worker holds `SELECT … FOR UPDATE` on the `event_consumers` row while processing, so events are applied in order exactly once per consumer. The worker keeps processing until it reaches `maps.event_seq`, so a wake-up dropped by de-duplication is never lost.
    - **Idempotent handlers**, with `last_seq` advanced in the same transaction as the handler's writes.
    - **Pruning:** never prune `game_events` below the lowest `last_seq` of any consumer for that map.
  - **Public vs internal payloads:** a `game_events` row's `payload` is internal and may hold server-only detail. WebSocket broadcast sends a **public view** built per event type (and per recipient where needed), never the raw payload.
- **Scheduled jobs (pg-boss):**
  - `nightfall` per map at 21:00 map time (Hollow Man, §14 of the design doc). A `nightfall.sweep` every minute (and at boot) finds maps whose latest nightfall hasn't run, in each map's own time zone, and enqueues one `nightfall` job per map and night (`singletonKey: mapId/night`); the night's `hollow_events` row (unique per map and night) is the idempotency guard (#21). After the Hollow Man, the same job lets long-untended land go wild (land that misses you, owner decision 2026-10-06) in its own transaction; its guard is the per-player, per-night cap counted from `tile_tending.wild_night`, so a retry tops up to the cap and never past it
    - **Hearthfire fuel is a date, not a counter:** each Hearthfire stores `fuelled_through` (the last map-local night its fuel covers). `tonight` means the **next nightfall that hasn't run yet** for that map (after 21:00, that's tomorrow's). Adding *n* nights of Emberwood sets `fuelled_through = max(fuelled_through, tonight − 1) + n`, capped at `tonight − 1 + max_nights`. At nightfall the fire protects tonight if `fuelled_through ≥ tonight`. "Nights left" is shown as `fuelled_through − tonight + 1` (minimum 0). Nothing is decremented, so a retried or duplicate nightfall run can't burn fuel twice.
  - `stranded-decay` (Phase 2)
  - No `boutique-rotate` job: the Boutique's racks are worked out on read from the account's local date, so they change at midnight in the account's time zone with nothing to run (#45)
  - `invite-expiry`, `session-cleanup` daily: **not built (Phase 2)**. Expired invites and sessions are refused when read, so nothing needs sweeping yet. The jobs that run are `nightfall.sweep` and the consumer catch-up. `chat-retention` daily arrives with Phase 2 chat (Phase 1 quick messages keep each map's latest `feedLimit` on every send instead, #23)
  - Jobs are idempotent and keyed by `(job, scopeId, date)` (scope is the map, or the account for per-account jobs) so a restart never runs nightfall twice.
- **Tutorial maps:** a tutorial is a normal map row with `kind = 'tutorial'` and one member, created from a hand-authored layout in `data/tutorial/`. It runs the **same** modules (gathering, battles, capture, care, buildings, nightfall) with a `tutorialOverrides` config (fast timers, guaranteed capture, scripted opponent AI, Hollow Man can't take anything). No separate code path for tutorial gameplay.
- **Tutorial step engine:** steps are data (`id, goal, sproutLines, highlightTarget, completeOn: game event type + predicate`). The tutorial event consumer (see event consumers above) advances `users.tutorial_step` when it processes a matching `game_events` row, and the client renders the current step. Account-level rewards (Partner species, Seedling Scarf, First Patch milestone) are granted idempotently on completion.
- **Dev time override:** env `HP_DEV_NOW` and an admin endpoint (dev only) to set the game clock for testing seasons and nightfall.

## 8. Determinism and RNG

- `packages/shared/src/rng`: a small seeded PRNG (e.g. `sfc32` or `mulberry32`) with `next()`, `int(min, max)`, `pick()`, `weighted()`.
- Never use `Math.random()` in game logic (lint rule). In `packages/shared`, lint also bans transcendental `Math.*`, `**`, comparator-less sorts and `localeCompare`; client procedural code (`apps/client/src/procedural/`) bans `Math.random` too, so every player sees the same squishy. Seeds are generated server-side with `crypto.randomBytes` and stored with the battle/roll.
- **Server-side secrecy:** RNG state and seeds stay on the server while a battle is in progress. The client gets a **public view** of battle state that can't be used to predict misses, damage variance or capture rolls. The seed may be revealed after the battle ends (for replays).
- **No rerolls:** wild spawns and guardians are fixed per tile and time window (seeded server-side from the map seed, tile and window, or stored), so restarting a battle can't reroll what appears. A wild squishy's level follows the player's Partner (`SPAWN_RULES.partnerOffset`); which species it is never depends on who's looking. The **map seed is never revealed** to clients, since it would predict every spawn; individual battle seeds may be revealed after the battle. **How:** new seeds come only from `newSeed()` (`apps/server/src/lib/rng.ts`, 128 bits from `crypto.randomBytes`); child seeds come from `deriveSeed(parent, ...labels)` (`packages/shared/src/rng`), e.g. a tile's spawn seed is `deriveSeed(mapSeed, 'spawn', q, r, windowId)`. A **spawn window** is a block of map-local wall-clock time whose length is its own tunable that divides 24 **[DEFAULT: 4 h]**. Its id is the map-local date plus the 0-based block index, `block = floor(local hour / window hours)` computed in `maps.time_zone`, written like `2026-10-31/5` (20:00–23:59). Daylight-saving days may have one uneven block (5 or 3 real hours); ids stay unique and ordered. `spawnWindowFor(instant, timeZone, hours)` (`apps/server/src/lib/time.ts`, since shared code doesn't use `Intl`; the block maths is the shared `spawnWindowAt`) returns the window (its `id` is the string above; `spawnWindowId` returns just the id), with daylight-saving tests; the window length is `SPAWN_RULES.windowHours` (server data). **Seeds that may be revealed** (battle seeds, for replays) come from `newSeed()` and are stored with the battle. `deriveSeed` is a fast non-cryptographic hash that can be partly inverted, so **never reveal a seed derived from a secret parent** (it would leak sibling spawn seeds). If a revealable seed must ever be derived, derive it server-side with HMAC-SHA256. Never invent another seed format. Starting a tile battle consumes an attempt and starts the tile cooldown, and abandoning counts as a loss (wild encounters and rescues don't use attempts).
- **Cross-engine determinism:** plain float `+ − × ÷` is identical on V8 (Node) and JavaScriptCore (Safari), so float multipliers are fine; apply `Math.floor`/`Math.round` at defined steps. Banned in outcome maths: transcendental `Math.*` (`pow`, `exp`, `log`, trig), `Math.random`, and sorts without a total-order comparator. Curves that need powers (e.g. XP) use lookup tables or integer loops.
- **Content versioning:** every battle records a content version (a hash of the data tables it used) and its resolved turn log alongside the seed and actions, so replays and explanations survive re-tuning.

## 9. Security and safety

- Argon2id with library defaults (or memory ≥ 19 MiB, iterations ≥ 2).
- Recovery codes: 12 characters, shown once, stored hashed. **One active code per user**; resetting with it marks it used and shows a fresh one. The `recovery_codes` table keeps used codes for audit.
- **Operator password reset:** a built server script for players with no map owner, or whose game maps have different owners, run on the host as `docker compose exec server node dist/ops/reset-password.js <username>` (the production image has no pnpm or dev tooling). Never exposed over HTTP. A reset (operator or map owner) also revokes the user's existing sessions and shows a new recovery code.
- **Family signup codes (#195):** 12 characters, shown once, stored as SHA-256 in `signup_codes` (looked up by hash, since sign-up has no username to find the row by). A patch owner may have 3 live codes, the operator any number (`ops/signup-code.js`). Signing up spends a use in the account's own transaction. A patch invite typed at sign-up also files that patch's join request in the same transaction; the owner's approval waits until the new player has a Keeper (and the tutorial, where required).
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
| `PUBLIC_ORIGIN` | `https://play.pumpkinpatchgames.com` | CORS, cookies |
| `LOG_LEVEL` | `info` | |
| `APP_VERSION` | `2026.10.02-abc123` | set by deploy (image tag); reported by `/api/v1/health` |
| `TRUST_PROXY` | `true` | `true` behind Caddy so `request.ip` is the player's IP (per-IP rate limits) |
| `HP_DEV_NOW` | `2026-12-20T20:59:00-05:00` | dev/test only |
| `HP_DEV_SIGNUP_LIMIT_PER_IP` | `500` | dev/test only; raises the per-IP signup limit for e2e (Playwright sets it) |
| `HP_DEV_MAP_CREATE_LIMIT_PER_IP` | `500` | dev/test only; raises the per-IP patch-making limit for e2e (Playwright sets it) |
| `HP_DEV_SQUISHY_GRANTS` | `true` | dev/test only; registers routes that hand a player a squishy and start a battle against a chosen wild squishy (#13), until spawns (#14) and the tutorial's starter exist (Playwright sets it) |
| `HP_DEV_DROP_CHANCE` | `100` | dev/test only; every found-clothing drop table's chance, in percent (#43), so a gather finds something |
| `HP_SEED_ALLOW_REMOTE` | `true` | `pnpm db:seed` only; lets the seed write to a database whose host isn't local (localhost, 127.0.0.1, ::1 or the compose service `db`). Refused in production |
| `HP_SIGNUP_CODE` | random string | bootstrap signup code, kept for one release after #195 (family codes and patch invites now sign families up); checked with a constant-time comparison under the auth rate limit |
| `HP_TUTORIAL_REQUIRED` | `false` | defaults to `false` when unset; when `false`, new accounts can create/join maps without finishing the tutorial. Production sets `true` (owner decision 2026-10-04, `infra/compose/.env.prod.example`) |
| `HP_KEEPER_REQUIRED` | `true` | defaults to `true`; creating or joining a map needs a Keeper (#42), so other players always see who's who. `false` only for testing |

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

- **`ci.yml`** on every PR. Since PR #100 it has three parts:
  - **`fast`:** format, lint, typecheck, migration check, unit and DB tests, coverage, build and the db scripts.
  - **`e2e`:** a matrix of `iphone-webkit` / `ipad-webkit` × group 1–5. The groups are spec-file lists balanced by measured duration (`E2E_GROUPS` in `apps/client/playwright.config.ts`, picked by `HP_E2E_GROUP`), not Playwright's `--shard`, which splits by test count and piled every heavy WebGL spec into one shard. Group 5 is every spec not listed, so a new spec always runs; the config fails the run if a listed spec is missing or the group count doesn't match. Each leg takes about 5–7 min and has its own Postgres service container.
  - **`check`:** an aggregator that is green only when `fast` and every `e2e` leg are. It stays the one status to gate on.
  - Build sessions can't edit `.github/workflows`; the coordinator makes CI changes.
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

All sound is synthesised in the browser with Web Audio. There are no audio files (DECISIONS "Audio (#25)"). Real recordings can replace a cue later; they would go in `ASSETS.md`.

- **Sounds:** oscillators, filters and noise, with pitch bends and vowel-like filters for squishy voices. Species voice parameters live in species data (size sets pitch, feeling sets contour).
- **Music:** day, night and Halloween loops are note data (`music-score.ts`), rendered once on an `OfflineAudioContext` and played as a looping buffer. Loops cross-fade.
- **Mix:** music, SFX and UI buses into a master gain and a limiter. Music dips under key moments (his visit, a new friend, an evolution, a win). Up to 10 voices at once; repeats within 50 ms are dropped; each play varies pitch and volume a little.
- **Settings:** per device, in `localStorage` (read in try/catch). A slider and an On/Off switch each for Music and Sounds. Music drives the music bus; Sounds drives SFX and UI.
- **iOS:** nothing is made or played before the first tap. Create, prime and resume the `AudioContext` inside that gesture, then load the engine chunk. Resume on `visibilitychange` and when `statechange` reports `interrupted`. Set `navigator.audioSession.type = "ambient"` where supported (iOS 16.4+) so the silent switch mutes the game and other apps keep playing.
- **Sound gallery:** the dev-only `/sounds.html` page plays every cue and loop, so a human can judge quality by ear.
- **Budget:** the engine is lazy-loaded after the first tap and counts toward the 15 MB first load (about 11 KB).
