# @heartpatch/server

Fastify 5 app serving REST (`/api/v1`) and live sync over WebSocket (`/ws`). Read `docs/TECH_SPEC.md` §5 and §7 first.

## Module shape

Every feature lives in `src/modules/<name>/` and copies `modules/health`:

| File | Job |
|---|---|
| `routes.ts` | HTTP only: zod schemas from `@heartpatch/shared`, call the service, send the result |
| `service.ts` | Game logic; calls `@heartpatch/shared` formulas; throws `AppError` with a shared code |
| `repo.ts` | The **only** place that touches Drizzle (lint-enforced) |
| `*.test.ts` | Tests via `buildApp()` + `app.inject()` |

Register the module's routes in `src/app.ts` under the `/api/v1` prefix. `buildApp({ config, db, clock })` takes the database and the clock (and readiness checks); modules build their repos from `db` inside `buildApp`, so it doesn't grow one option per repo. Tests pass a scratch `db` and a movable `clock`.

## Transactions across repos

Repo factories take an `Executor` (`Database | Transaction`, from `db/client.ts`). A command that writes through several repos runs them in **one** transaction. Services can't import `db/client` (lint), so a repo exposes `transaction`, which wraps `withTransaction` and hands back the repo on the transaction plus the `tx` for other modules' repos:

```ts
await mapsRepo.transaction(async (maps, tx) => {
  await maps.lockSeats(mapId);          // SELECT … FOR NO KEY UPDATE first
  await createAuthRepo(tx).resetPassword(...); // another module's repo, same transaction
  await maps.appendEvent({ mapId, type: 'member.joined', actorUserId, payload }); // last write
});
```

Services own the transaction (they decide the rules); repos stay plain queries. A repo method that opens its own `db.transaction` (e.g. `AuthRepo.resetPassword`) nests as a savepoint when built from `tx`. `modules/maps/service.ts` is the worked example, including lock order.

## Clock

Take time from the clock (`lib/time.ts`), never `new Date()` in services. `createClock(config)` is the real time, or with `HP_DEV_NOW` (development/test only; refused in production) a clock that starts at that instant and keeps ticking. `localDate(at, zone)` gives a map-local or account-local `YYYY-MM-DD`; `canonicalTimeZone` validates IANA zones.

## Patterns

- **Schemas:** declare `params`, `querystring`, `body` and **every response status you send** with zod (`fastify.withTypeProvider<ZodTypeProvider>()`). Responses are checked and unknown keys stripped on the way out, which keeps secret fields out of replies. A status without a schema is not stripped.
- **Query params:** use `queryInt`, `queryBool` and `queryArray` from `@heartpatch/shared`, not `z.coerce` (`?n=` would become `0`, and a single `?tag=a` arrives as a string).
- **Errors:** `throw new AppError('NOT_FOUND', 'kid-readable message')`. The error handler sends `{ error: { code, message } }` with the right status and never leaks internals, even on routes that declare schemas for error statuses.
- **Handlers:** return the value from a sync handler, or use an `async` handler when you need `reply.code(x).send(...)` (a sync `return reply.send()` doesn't typecheck with the type provider).
- **Logging:** `request.log` / `app.log` (pino). `console` is lint-banned here.
- **Randomness:** never `Math.random()`. Seeds come from `crypto.randomBytes` and feed the shared seeded RNG.

## Auth

Accounts live in `src/modules/auth` (issue #3). The session is the `hp_session` cookie (HttpOnly, SameSite=Lax, Secure in production, 30-day rolling expiry); only a SHA-256 hash of its token is stored in `sessions.token_hash`.

| Endpoint | Does |
|---|---|
| `POST /api/v1/auth/signup` | Family code + username + password + birth year + time zone → 201 `{ user, recoveryCode }`, logged in |
| `POST /api/v1/auth/login` | → `{ user }`, logged in |
| `POST /api/v1/auth/logout` | → 204, ends this device's session |
| `POST /api/v1/auth/recover` | Username + recovery code + new password → `{ user, recoveryCode }`; revokes every session, logs this device in, rotates the code |
| `GET /api/v1/me` | → `{ user }`, or `{ user: null }` when logged out (never 401) |

Signup, login and recover are rate limited per IP and per username (`modules/auth/limits.ts`).

**The contract for other modules** (keep it this small):

- `buildApp` creates `authHooks` (`createAuthHooks` in `modules/auth/hooks.ts`) inside its `if (db)` block. Register modules that need a logged-in player in that block, pass `authHooks.requireAuth` into your module's routes factory and use it as the route's `preHandler`; it responds `UNAUTHENTICATED` when logged out. `authHooks.loadUser` is the same without the 401.
- In the handler, `requireUser(request)` returns the logged-in `PublicUser` (`{ id, username }`) and throws `UNAUTHENTICATED` if there isn't one.
- **CSRF:** every non-GET request under `/api/v1` must send `X-Requested-With: heartpatch`, or it gets `FORBIDDEN` (tech spec §5). The guard runs for every module; nothing to add per route.
- Password resets by a map owner (#4) go through `AuthRepo.resetPassword`, which revokes sessions and rotates the recovery code in one transaction.

## Maps

Maps (players say "patches") live in `src/modules/maps` (issue #4; design doc §3, decisions B and D). Every route needs a logged-in player; non-members get `NOT_FOUND` so maps can't be probed, and members get `FORBIDDEN` for owner-only actions.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps` | → `{ maps, requests }`: my maps and my unanswered join requests |
| `POST /api/v1/maps` | Name + IANA zone → 201 `{ map }`. Generates the map once (`generateMap` for `max_players` seats, secret seed), stores every tile, gives the owner home slot 0, makes the first invite code, appends `map.created` — one transaction |
| `GET /api/v1/maps/:mapId` | → `{ map }` (members; `admin` with the code and pending requests for the owner) |
| `GET /api/v1/maps/:mapId/view` | → `MapView`: map, members, public tiles (no seed, no guardian strength) and `seq`, all from one read-only `repeatable read` snapshot (`repo.snapshot`), so the view holds every event up to `seq` and none after |
| `POST /api/v1/maps/join` | `{ code }` → 201 `{ request }` (200 with the existing one if already pending) |
| `POST /api/v1/maps/:mapId/invite` | Owner: a fresh code (7 days); the old one stops working |
| `POST /api/v1/maps/:mapId/invite/revoke` | Owner: → 204, no live code |
| `POST /api/v1/maps/:mapId/requests/:requestId/approve` | Owner: → 204. Under the seats lock: checks a free seat, gives the next free home slot, appends `member.joined` |
| `POST /api/v1/maps/:mapId/requests/:requestId/deny` | Owner: → 204 |
| `POST /api/v1/maps/:mapId/members/:userId/remove` | Owner: → 204. Archives the member, frees their tiles and home slot, appends `member.removed` |
| `POST /api/v1/maps/:mapId/leave` | Member (not the owner): → 204, `member.left` |
| `POST /api/v1/maps/:mapId/pvp-mode` | Owner: `{ pvpMode: on \| gentle \| off }`, appends `map.updated` when it changes |
| `POST /api/v1/maps/:mapId/members/:userId/reset-password` | Owner: → `{ user, temporaryPassword, recoveryCode }` (`no-store`), only if every multiplayer map the member is in is this owner's (decision D) |

**Seats:** `MAP_MAX_PLAYERS` (4). Commands that add or remove members take the per-map seats lock first (`lockSeats`: the owner's `map_members` row, `FOR NO KEY UPDATE`), so two approvals racing for the last seat can't both win; a partial unique index on `(map_id, home_slot)` for active members backs it up. **Tutorial gate:** with `HP_TUTORIAL_REQUIRED=true`, creating a map or asking to join needs `users.tutorial_completed_at`. Rate limits are in `modules/maps/limits.ts`.

**Text filter:** run every piece of player-typed text through `assertAllowedText(text, 'name' | 'message')` from `lib/filter.ts` before storing it (tech spec §9). It throws `VALIDATION_FAILED` with a kid-readable message. `checkText` returns the verdict without throwing.

**Operator reset** (tech spec §9): `docker compose exec server node dist/ops/reset-password.js <username>` (locally `pnpm --filter @heartpatch/server ops:reset-password <username>`) sets a temporary password, revokes sessions and prints a new recovery code. Never exposed over HTTP.

## Battles

PvE battles (design doc §6; tech spec §8; DECISIONS "Battle engine (#11)") live in `src/modules/battles` (issue #13). The client sends intents; the service runs the shared engine (`applyBattleAction`) with content built from `serverBattleData(GAME_DATA, SERVER_GAME_DATA)`, so secret species can battle and the content hash covers every row that can change an outcome. The player is always side `a`; the AI side picks inside the reducer with the battle's own RNG.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/battles/current` | → `{ battle }`: the player's active battle on this map to resume, or null |
| `POST /api/v1/maps/:mapId/battles` | Optional `{ tile: { q, r } }`. Picks a fight with the wild squishy on that tile, or the nearest one in reach (`findWildEncounter`, from `modules/spawns`; `NOT_FOUND` when nobody's around) → 201 `{ battle }`, or 200 with the battle already going |
| `GET /api/v1/battles/:battleId` | → `{ battle }` (the player's own, else `NOT_FOUND`) |
| `POST /api/v1/battles/:battleId/actions` | `{ action: move \| swap \| replace \| forfeit \| capture, turn }` → `{ battle }` after the whole step (the AI's answer included). `turn` must be the view's turn, so a stale submit is refused (`CONFLICT`) instead of landing on the next turn. Send an `Idempotency-Key` (see below) so a retry replays the reply |
| `POST /api/v1/maps/:mapId/dev/squishies` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): `{ speciesId?, level? }` → 201 `{ squishy }`. Any species the server knows, secret ones included |
| `POST /api/v1/maps/:mapId/dev/battles` | **Dev/test only**: `{ opponent?: { speciesId?, level? } }` → a wild battle against that squishy, through the same `startAgainst` spawns will call |

**What players get** is `PlayerBattle` (`packages/shared/src/schemas/battle.ts`): `view` is `clientBattleView(state)`, checked against `ClientBattleViewSchema` on the way out, so the RNG state never leaves; `seed` is null while the battle is active and revealed once it ends (tech spec §8); `speciesDefs` and `moveDefs` carry rows outside the public tables (a secret species the player just met) so the client can draw and name every squishy.

**Storage** (`battles`): seed (from `newSeed()`), `setup.sides`, the `actions` list, the current `state` (RNG included, server-only), and once over the `result` and resolved `log`, so a battle stays explainable after re-tuning. Setup + actions replays to the stored state (`battles.test.ts` checks it). One active battle per player per map (partial unique index); starting again resumes it, which is what makes "refresh mid-battle" work.

**Rules of the service:**
- The team is the player's active squishies on the map, strongest first, up to `rules.teamSize` (team picking is a later feature). No squishy → `CONFLICT` "You need a squishy friend first!".
- `BattleRuleError` from the engine (an unknown move, a swap to an empty slot, acting in the wrong phase) becomes `CONFLICT` with a kid-readable message; the client refetches the battle on `CONFLICT`.
- **Content re-tuned mid-battle:** if the stored `content_hash` isn't today's, the battle ends as `no-contest` on the next read or action: nothing is won or lost, no XP, `battle.ended` with `reason: 'no-contest'`. Wild battles cost no attempt; a kind that does (tile guardians, #15) refunds it in `endNoContest`.
- **Capture (#14):** `{ type: 'capture' }` offers a Heart Charm to the wild squishy (wild battles only, `CAPTURABLE_BATTLE_KINDS`). In one transaction: one `heart-charm` through the `items` port (#17's `consumeItems`; `CONFLICT` when out, nothing changes), the engine's capture turn (one roll on the battle RNG; `sure` on tutorial maps), and on a catch the new `squishies` row, `species_seen.first_caught_at`, `battle.ended` (`reason: 'captured'`) and `squishy.captured`. Starting a battle records the opponent's species as seen.
- **Tutorial maps:** `gameplayOverrides(map.kind)` scripts the opponent's AI policy and level (tech spec §7).
- **XP:** on a finished battle the player's squishies get the engine's base battle XP (`squishies.xp`), under a row lock, in the same transaction as the result and the `battle.ended` event. Care and habitat multipliers (#19) and levelling (the XP curve) come with their issues.
- Events: `battle.started` and `battle.ended` (shared registry); `wsHub.publish` after commit.

### Idempotency keys

`lib/idempotency.ts` implements the `Idempotency-Key` header (tech spec §5) for any mutating route; battle actions use it. A route opts in with `preHandler: [requireAuth, idempotency.preHandler]` and `onSend: idempotency.onSend`, where `idempotency = registerIdempotency(plugin, { store, clock })` is built once per routes plugin (it decorates the plugin's requests). Keys are per player (`idempotency_keys (user_id, key)`): the first request claims the key and `onSend` stores its status and body (errors too, except 5xx, which release the key); the same key, route and body again gets the stored reply with `Idempotent-Replayed: true`; the same key with another route or body gets `CONFLICT`; a key whose first request is still running gets `CONFLICT`, unless that claim is older than `PENDING_TTL_MS` (the process died), which this request takes over. Rows are meant to live `KEY_TTL_MS`; the cleanup job is a follow-up.

## Wild squishies and the catalog

`src/modules/spawns` (issue #14; design doc §4, §15; tech spec §8; DECISIONS "Wild squishies and capture (#14)").

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/wild` | → `{ wild: { tiles } }`: tiles in the player's reach with a wild squishy they haven't befriended, this spawn window only. No species |
| `GET /api/v1/maps/:mapId/catalog` | → `{ catalog: { entries, speciesDefs } }`: `species_seen` for the player, plus the rows of secret species they've met |

**No rerolls.** A tile's squishy for a window is `resolveWildSpawn` (shared, pure) over the secret `SPAWN_TABLES` and `SPAWN_RULES` with the seed `deriveSeed(mapSeed, 'spawn', q, r, windowId)`; nothing is stored until someone battles it, and the seed is never sent anywhere. Battle seeds still come from `newSeed()`. The window is `spawnWindowFor(now, maps.time_zone, SPAWN_RULES.windowHours)` (`lib/time.ts`), so it follows `HP_DEV_NOW`. Season-tagged tables and seasonal species only spawn while their season is on, by the window's map-local date.

**Reach** is the player's land and the tiles next to it; `findWildEncounter` (the battles port) takes a picked tile or the nearest spawn, skipping any the player befriended this window (`battles.spawn_window`). `species_seen` rows are written by the battles service on its own transactions (`createSpawnsRepo(tx)`).

## Live sync (`/ws`)

`src/ws/` pushes game events to players in real time (tech spec §5 and §7). Messages are the zod schemas in `packages/shared/src/schemas/ws.ts`.

**Publishing, for modules that write game events.** `buildApp` passes `wsHub.publish` into the module's service (see `createMapsService({ publish })`); call it **after** your transaction commits:

```ts
await mapsRepo.transaction(async (maps) => {
  // …change entity rows, then last:
  await maps.appendEvent({ mapId, type: 'member.joined', actorUserId, payload });
});
void publish?.(mapId); // after commit; never rejects
```

`publish(mapId)` takes no events. It only says "this map has new committed events"; the hub reads them from `game_events` on its own connection, so it can only ever send committed rows. Calling it inside the transaction is therefore harmless but useless: the new event isn't visible yet, so it goes out on the next publish or heartbeat (up to 25 s late). Always call it after commit.

**Public views (default deny).** `game_events.payload` is internal and is never sent. `PUBLIC_VIEWS` (`src/ws/public-views.ts`) has one view per type in the shared event registry (`packages/shared/src/schemas/events.ts`): it parses the stored payload with the type's `internal` schema and sends only what its `public` schema declares. So adding an event type means adding it (both schemas) to the registry; nothing else. A view is `definePublicView({ schema, build })`:

- `build(event, recipient)` returns the view for one player, or `null` to send them nothing. A type that needs per-recipient views overrides its registry entry in `PUBLIC_VIEWS`.
- `schema` must be a `z.object`. The result is parsed with it, so undeclared fields are stripped even if `build` spreads the payload.
- An event type without a view (not in the registry) is not broadcast. Players just get a `ws.cursor` past its seq.
- Kid safety: views carry usernames and in-game state only (no birth year, time zone or anything else about the account).

**Protocol in short.**

- **Connect:** the upgrade needs a live `hp_session` (`UNAUTHENTICATED` otherwise). It is looked up with `AuthRepo.findSession` **without renewing**: the 101 response can't carry a `Set-Cookie`, so renewal is left to REST requests. `Origin` must equal `PUBLIC_ORIGIN` (`FORBIDDEN` otherwise; this guards against cross-site WebSocket hijacking). The server sends `ws.ready`.
- **Subscribe:** `{ type: 'subscribe', mapId, afterSeq }` subscribes to one map per socket. The player must be an **active** member (`FORBIDDEN` otherwise, also re-checked on every delivery, so a removed player stops at once). The server replays the public views after `afterSeq` in seq order, then sends `ws.subscribed { seq }`; live events follow. Sending `subscribe` again is how the client asks for a replay after a gap.
- **Cursor:** seqs a player doesn't get (no view, or a view for someone else) are covered by `ws.cursor { seq }`, so the client never waits on them as a gap.
- **Resync:** if the client is more than `REPLAY_WINDOW` events behind, its events were pruned, or it is ahead of the map, it gets `ws.resync`. It then refetches state over REST and subscribes again with that state's seq (`MapView.seq`).
- **Heartbeat:** a protocol ping every 25 s, and a socket that misses a pong is closed. The session is re-checked each beat: logout or a password reset closes the socket with `4401`. A player gets at most `MAX_SOCKETS_PER_USER` sockets (`4429` beyond that).

Tunables are in `src/ws/limits.ts`.

## Event consumers and jobs (`src/jobs/`)

Scheduled jobs and event consumers run in this process on **pg-boss** (tech spec §3, §7), which keeps its tables in the `pgboss` schema (created by `boss.start()`, outside Drizzle's migrations; the database role needs `CREATE` on the database). `src/index.ts` calls `startJobs` before listening and stops it on close.

An **event consumer** reads each map's `game_events` in seq order **after commit** and keeps its own state: the tutorial step engine today; milestones, Easter eggs and the raid log later. It never runs inside a command's transaction and never depends on live broadcast.

```ts
export function createMilestonesConsumer(): EventConsumer {
  return {
    name: 'milestones',                 // event_consumers.consumer and the queue name; never rename
    mapKinds: ['multiplayer'],          // only woken for these maps
    handle: async (tx, event) => { … }, // write only through tx; throw to retry the batch
  };
}
```

Add it to the `consumers` list in `src/index.ts`. How it stays exactly-once:

- **Position:** `event_consumers (consumer, map_id, last_seq)`. `runConsumer` (`jobs/consumers.ts`) works in batches; each batch is one transaction that locks the row `FOR UPDATE`, applies the events after `last_seq` and advances it. A crash or a throwing handler rolls the batch back, so it's only delayed. It keeps going until it reaches `maps.event_seq`.
- **Wake-up in the command's transaction:** `appendGameEvent` calls the wake-up `startJobs` installs (`setEventWakeup`), which runs pg-boss `send` on the command's own transaction (`pgBossOnTransaction`). A rolled-back command wakes nobody. Without jobs running (tests, ops tools) there is no wake-up; the catch-up finds the events later.
- **One worker per (consumer, map):** queue `event-consumer.<name>` uses the `stately` policy with the map id as `singletonKey` (one queued and one running job per map); the row lock covers the rest. Different maps run side by side (`CONSUMER_CONCURRENCY`), and LISTEN/NOTIFY wakes the worker on commit, so a tutorial step moves on right after the tap. Failures are logged and retried.
- **Catch-up:** `event-consumers.catch-up` runs every minute (`CATCH_UP_CRON`) and at boot, and wakes every consumer whose `last_seq` is behind `maps.event_seq`.
- **Handlers may append events** (the tutorial does). Call `appendGameEvent` through `tx`; the runner publishes after each batch commits. A consumer never completes anything on its own event types.

Tunables are in `src/jobs/limits.ts`. Never prune `game_events` below the lowest `last_seq` for a map.

## Keepers

Each player's Keeper (design doc §23; issue #42) lives in `src/modules/keepers`: one `keepers` row per account, written when they pick one right after signup and whenever they change it (free, any time).

| Endpoint | Does |
|---|---|
| `GET /api/v1/keeper` | → `{ keeper }`: the player's `KeeperConfig`, or null before they pick one |
| `POST /api/v1/keeper` | `KeeperConfig` (`base`, `hairColor`, `eyeColor`, `outfit`) → `{ keeper }`. Every id must be in the shared `KEEPER_DATA` (`keeperConfigProblem`), else `VALIDATION_FAILED` with a kid-readable message. Rate limited (`limits.ts`) |

**Map gate:** with `HP_KEEPER_REQUIRED` (default `true`), creating or joining a map needs a Keeper (`FORBIDDEN`, "Pick your Keeper first, then come back!"), checked before the tutorial gate. **Shown to other players:** `MapMember.keeper` (map detail and map view) carries each member's config, or null for one who never picked (only possible with the gate off). A change shows on other players' maps the next time they fetch the view; there's no live event for it yet.

## Tutorial

The single-player tutorial (design doc §26; tech spec §7) lives in `src/modules/tutorial` (issue #47). A run is an ordinary map with `kind = 'tutorial'`, one member and the hand-authored Tutorial Glade (`TUTORIAL_LAYOUT` in shared `data/tutorial/`). `users.tutorial_step` is the current step while a run is going (null otherwise); `users.tutorial_completed_at` is the first completion and never moves.

| Endpoint | Does |
|---|---|
| `GET /api/v1/tutorial` | → `{ tutorial }`: status, current step and map, first completion, and `required` (`HP_TUTORIAL_REQUIRED`). What the client resumes from |
| `POST /api/v1/tutorial/start` | First run → 201 `{ tutorial }`; a run already going → 200 with it. `CONFLICT` once finished (use replay) |
| `POST /api/v1/tutorial/replay` | A fresh Glade from the first step, any time; the old run is archived → 201 |
| `POST /api/v1/tutorial/skip` | Ends any run; only after finishing once (`FORBIDDEN` before) → 200 |
| `POST /api/v1/tutorial/acknowledge` | `{ stepId }`: the player read a talk-only step → 204. Only the current step, and only a step that completes on `tutorial.acknowledged` |

**Step engine.** Steps are data (`TUTORIAL_STEPS`: id, goal, Sprout's lines, highlight target, `completeOn: { eventType, actor, where }` with declarative predicates), checked by `checkTutorialData`. The `tutorial` event consumer (`consumer.ts`) feeds each event on a tutorial map to the shared `advanceTutorial`; a match moves the player one step on, or finishes the tutorial after the last one, and appends `tutorial.advanced` (a system event) so the client hears it live. Events on an archived run do nothing. Archived runs keep their map, tiles and events (replays are rate limited); a cleanup job can prune them later. Rewards on first completion are a stub tied to #44, #43 and #14.

**Gameplay on tutorial maps** goes through the real modules. They read `gameplayOverrides(map.kind)` from shared (fast timers, sure capture, scripted opponents, the Hollow Man can't take anything) rather than branching on the map kind themselves. The maps API (`/maps`, `/maps/:id`, invites, admin, leave) doesn't show tutorial maps; only `/maps/:id/view` serves a player's own active run, so the client draws the Tutorial Glade as a normal map. An archived run stays NOT_FOUND.

## Workspace source condition

`@heartpatch/shared` resolves to its TypeScript source under the `@heartpatch/source` export condition, and to `dist/` otherwise.

- `pnpm dev` and tests already pass the condition.
- **Any new `tsx` entrypoint** (seed scripts, ops tools) must pass `--conditions=@heartpatch/source`, or run after `pnpm -r build`.
- **Tools with their own loader** (e.g. drizzle-kit): keep their config and the DB schema free of `@heartpatch/shared` imports, or run them with `NODE_OPTIONS=--conditions=@heartpatch/source`.
- The production build (`pnpm build`) resolves `dist/`, so shared must be built first. `pnpm -r build` and `pnpm --filter @heartpatch/server... build` both do this in order.

## Config

Environment variables are parsed in `src/config.ts` (zod) and the server refuses to start on invalid values. `NODE_ENV` defaults to `production`; `pnpm dev` sets `development`. Keep `.env.example` current.

## Database

Postgres 16 via Drizzle. Schema, migrations, the `game_events` helper and the `db:*` scripts are documented in [`src/db/README.md`](src/db/README.md).
