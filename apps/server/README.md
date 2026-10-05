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
- **Rate limits:** numbers live in the module's `limits.ts` as a `RateLimitTable` (`as const satisfies RateLimitTable`, `MINUTE_MS` from `lib/time.ts`, every number with a `// TUNE:` note). Routes enforce them with `lib/rate-limit.ts`: `const rateLimit = playerRateLimit(fastify, '<module>', TABLE)` and `preHandler: [requireAuth, rateLimit('<action>')]` (per IP, then per player; `RATE_LIMITED` with `Retry-After`). `rateLimit(fastify, checks)` is the same preHandler for other keys (auth limits per username).
- **Membership:** every module that acts on a map checks the player with `requireMember(tx, user, mapId)` from `modules/maps/members.ts`: `{ map, role }` for an active member, else `NOT_FOUND` with the same message as a missing map, so maps can't be probed.

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

**What players get** is `PlayerBattle` (`packages/shared/src/schemas/battle.ts`): `view` is `clientBattleView(state)`, checked against `ClientBattleViewSchema` on the way out, so the RNG state never leaves; `seed` is null while the battle is active and revealed once it ends (tech spec §8); `speciesDefs` and `moveDefs` carry rows outside the public tables (a secret species the player just met) so the client can draw and name every squishy. `rewards` (from `battles.rewards`) is what a finished battle granted the player's squishies (Gentle's share, care and habitat included) and the share it paid; null while running, after no contest, on a defender's replay, and for battles from before it was stored.

**Storage** (`battles`): seed (from `newSeed()`), `setup.sides`, the `actions` list, the current `state` (RNG included, server-only), and once over the `result` and resolved `log`, so a battle stays explainable after re-tuning. Setup + actions replays to the stored state (`battles.test.ts` checks it). One active battle per player per map (partial unique index); starting again resumes it, which is what makes "refresh mid-battle" work.

**Rules of the service:**
- The team is the player's active squishies on the map, strongest first, up to `rules.teamSize` (team picking is a later feature). No squishy → `CONFLICT` "You need a squishy friend first!".
- `BattleRuleError` from the engine (an unknown move, a swap to an empty slot, acting in the wrong phase) becomes `CONFLICT` with a kid-readable message; the client refetches the battle on `CONFLICT`.
- **Content re-tuned mid-battle:** if the stored `content_hash` isn't today's, the battle ends as `no-contest` on the next read or action: nothing is won or lost, no XP, `battle.ended` with `reason: 'no-contest'`. Wild battles cost no attempt; tile battles (#15) refund theirs in `endNoContest`.
- **Rescues (#21)** start through `startRescue(user, mapId, { opponent, soloTeam })` (kind `rescue`, no attempt); the hollow module settles them from `battle.ended` (see "The Hollow Man").
- **Tile battles (#15)** start through `startTile(user, mapId, prepare)`: `prepare` (the territory module) checks the raid rules and builds the other side inside the start transaction, so a refused start uses nothing. The `tileBattles` port (`createTileBattlePort`) is called on the battle's own transactions: `acted` restarts the abandon timer, `ended` settles the attempt and moves the tile on a win (its events follow `battle.ended`), `noContest` refunds the attempt. A tile battle with no action for `abandonMinutes` has been left: it ends as a forfeit (a loss) on the next read, action or start (`settle`), so a player is never stuck behind one.
- **Capture (#14):** `{ type: 'capture' }` offers a Heart Charm to the wild squishy (wild battles only, `CAPTURABLE_BATTLE_KINDS`). In one transaction: one `heart-charm` through #17's `consumeItems` (reason `capture`, ledgered against the battle; `CONFLICT` when out, nothing changes), the engine's capture turn (one roll on the battle RNG; `sure` on tutorial maps), and on a catch the new `squishies` row, `species_seen.first_caught_at`, `battle.ended` (`reason: 'captured'`) and `squishy.captured`. Starting a battle records the opponent's species as seen.
- **Tutorial maps:** `gameplayOverrides(map.kind)` scripts the opponent's AI policy and level (tech spec §7).
- **XP:** on a finished battle the player's squishies get the engine's base battle XP through care's `applyXp` (below), under a row lock, in the same transaction as the result and the `battle.ended` event (whose `xp` is what was granted); `squishy.leveled` / `squishy.evolved` follow it.
- Events: `battle.started` and `battle.ended` (shared registry); `wsHub.publish` after commit.

## Inventory and gathering

Resources, gathering and crafting (design doc §12, §15; issue #17) live in `src/modules/inventory` and `src/modules/gathering`. Inventory is per player per map (`inventories`, a missing row is 0), and every change also writes a `resource_ledger` row with its reason (tech spec §4). Timers are timestamps (CLAUDE.md rule 4): a gather or craft stores `started_at` and `ready_at`, and collecting checks the clock then, so it finishes while the player is logged out and nothing ticks in between.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/inventory` | → `{ items, gathers, crafts, seasons, now }`: the bag, my gathers on land I still own, my craft on the go, the season ids on today (map-local date), and the server's clock, which the client counts down on |
| `POST /api/v1/maps/:mapId/gathers` | `{ q, r }` → 201 `{ gather, now }` (a `gather_jobs` row) and `gather.started`. Only on a tile I own with a node (`FORBIDDEN` / `CONFLICT` otherwise), one active gather per node, seasonal nodes only in season. Tutorial maps use `gameplayOverrides(map.kind).gatherSeconds` |
| `POST /api/v1/maps/:mapId/gathers/:gatherId/collect` | → `{ granted, items, now }` once `ready_at` has passed; grants and appends `resource.gathered` in one transaction |
| `POST /api/v1/maps/:mapId/crafts` | `{ recipeId }` → 201 `{ craft, items, now }`. Uses the inputs up front (`consumeItems`); one craft at a time; seasonal recipes only in season (leftover seasonal items stay as keepsakes); a sealed recipe book page is `FORBIDDEN` (below) |
| `POST /api/v1/maps/:mapId/crafts/:craftId/collect` | → `{ granted, items, now }`; appends `item.crafted` |
| `GET /api/v1/recipe-book` | → `{ unlocked }`: the recipe book page keys (`recipe:<id>`, `building:<id>`) this account has opened, in book order. Account-level |
| `POST /api/v1/maps/:mapId/dev/items` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): `{ items: { "heart-charm": 3 } }` → 201 `{ items }` |

Mutating routes take an `Idempotency-Key` (below), so a retried collect can't grant twice.

**Recipe book (owner decision 2026-10-05).** Pages are the shared `recipeBookPages()` (every recipe, then every buildable building). A page opens once the account has collected every ingredient at least once, on any map: `InventoryRepo.everCollected(userId)` is the distinct `item_id`s of the account's positive `resource_ledger` rows (any reason), joined through `map_members` so the `(map_id, user_id)` index serves it. `RECIPE_BOOK.alwaysOpen` (Heart Charm, Hearthfire, both habitats) is open from the start. `requirePageOpen(tx, userId, page)` refuses a sealed page with `FORBIDDEN` before anything is spent; the craft start and building placement call it inside their transaction. It takes no row locks. Moving, removing and fuelling buildings aren't gated.

**For other modules** (captures spend Heart Charms, buildings spend Timber): move items only with these, inside your own transaction, before your game event:

```ts
import { consumeItems, grantItems } from '../inventory/service.js';

await repo.transaction(async (repo, tx) => {
  // Locks the rows; CONFLICT "You need 1 more Heart Charm first!" and no change if short.
  await consumeItems(tx, { mapId, userId }, { 'heart-charm': 1 }, 'capture', battleId);
  // Unknown ids → VALIDATION_FAILED.
  await grantItems(tx, { mapId, userId }, { timber: 5 }, 'capture', battleId);
  await repo.appendEvent(...); // last write
});
```

`reason` is a shared `ItemChangeReason` (add yours to `ItemChangeReasonSchema`); the optional last argument is the id of what caused it, stored as the ledger row's `ref_id`.

**Rules of the service:**
- A gather's yield is decided when it starts (`gatherYield` in shared `gathering/`): the node's `gather.quantity`, plus `extras` whose season is on (Witch Dust with Emberwood and Pumpkins around Halloween). A gather started in season finishes even if the season ends meanwhile.
- If a tile changes hands, the old owner can't collect its gather, and the new owner's first gather there marks it `lost`. The map view's `PublicTile.gathering` (`{ readyAt }`) only shows the current owner's gather.
- Events: `gather.started` (public: who, where and `readyAt`; the client shows "gathering here"), `resource.gathered` (public: who and where, not how much) and `item.crafted` (who and which recipe).

### Idempotency keys

`lib/idempotency.ts` implements the `Idempotency-Key` header (tech spec §5) for any mutating route; battle actions use it. A route opts in with `preHandler: [requireAuth, idempotency.preHandler]` and `onSend: idempotency.onSend`, where `idempotency = registerIdempotency(plugin, { store, clock })` is built once per routes plugin (it decorates the plugin's requests). Keys are per player (`idempotency_keys (user_id, key)`): the first request claims the key and `onSend` stores its status and body (errors too, except 5xx, which release the key); the same key, route and body again gets the stored reply with `Idempotent-Replayed: true`; the same key with another route or body gets `CONFLICT`; a key whose first request is still running gets `CONFLICT`, unless that claim is older than `PENDING_TTL_MS` (the process died), which this request takes over. Rows are meant to live `KEY_TTL_MS`; the cleanup job is a follow-up.

## Wild squishies and the catalog

`src/modules/spawns` (issue #14; design doc §4, §15; tech spec §8; DECISIONS "Wild squishies and capture (#14)").

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/wild` | → `{ wild: { tiles } }`: tiles in the player's reach with a wild squishy they haven't befriended or beaten, this spawn window only. No species |
| `GET /api/v1/maps/:mapId/catalog` | → `{ catalog: { entries, speciesDefs } }`: `species_seen` for the player, plus the rows of secret species they've met |

**No rerolls.** A tile's squishy for a window is `resolveWildSpawn` (shared, pure) over the secret `SPAWN_TABLES` and `SPAWN_RULES` with the seed `deriveSeed(mapSeed, 'spawn', q, r, windowId)`; nothing is stored until someone battles it, and the seed is never sent anywhere. Battle seeds still come from `newSeed()`. The window is `spawnWindowFor(now, maps.time_zone, SPAWN_RULES.windowHours)` (`lib/time.ts`), so it follows `HP_DEV_NOW`. Season-tagged tables and seasonal species only spawn while their season is on, by the window's map-local date.

**Reach** is the player's land and the tiles next to it; `findWildEncounter` (the battles port) takes a picked tile or the nearest spawn, skipping any the player befriended or beat this window (a finished `battles` row for that `spawn_window` and tile that the player won: a beaten one toddles away, owner decision 2026-10-03). Others can still find theirs. `species_seen` rows are written by the battles service on its own transactions (`createSpawnsRepo(tx)`).

## Territory

`src/modules/territory` (issue #15; design doc §11; decisions B and C): claiming neutral land, challenging another player's, and squishies standing watch. Players say **Claim** and **Challenge** (style guide §9); the code says attack.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/territory` | → `{ territory }`: tries left today, my new-player shield, my tiles with squishies on watch, my squishies (and the secret species rows among them), and the server's clock |
| `POST /api/v1/maps/:mapId/attacks` | `{ q, r }` → 201 `{ battle }` (a `tile` or `rival-tile` battle), or 200 with the battle already going. Takes an `Idempotency-Key` |
| `POST /api/v1/maps/:mapId/defenders` | `{ q, r, squishyIds }` (up to `maxDefenders`, in slot order; `[]` sends everyone home) → `{ territory }`. Only my land outside my home base, only my squishies not in the Hollow and not housed in a habitat (unless already on that tile); a squishy on watch elsewhere moves, and a new guard leaves the team or its work tile (squishy jobs). Appends `defenders.changed` when it changes |

**Raid rules** are `TERRITORY_RULES` (shared, public, `// TUNE:`), all checked on the server in the battle's start transaction, in this order: the tile exists; the target is next to my land, not a home tile, not mine, and not another player's when PvP is Off (`attackTargetProblem`, shared with the client); the tile's cooldown (`cooldownHours` from the last battle **started** on it, by anyone, win or lose); my tries today (`attemptsPerDay` per map-local day; a no-contest doesn't count); and for a rival tile, their new-player shield (`newPlayerShieldHours` from joining), then their daily loss cap (`dailyLossCap[pvpMode]`, counting tiles lost today **plus** challenges against them still going, so two at once can't both get under it). Refusals use nothing up. Lock order: the defender's `map_members` row (`for no key update`, so the cap count is serialized per defender), the tile, then the battle and attempt rows, `maps` last.

**Who defends.** Neutral land: the tile's guardians, `resolveGuardians` over the secret `GUARDIAN_RULES` with `deriveSeed(mapSeed, 'guardian', q, r, windowId)` (tech spec §8: fixed per window, the seed and `guardian_strength` never leave the server). A rival tile: the owner's squishies on watch, or the land's own guardians if nobody stands watch. `defendingSide` is the one place that picks who plays that side: the server's AI always does, so the owner never has to be online. Squishies on watch play the owner's defense stance (`stancePolicy`, #16, read with their member lock), guardians the `guardian` policy; the policy is stored in the battle's setup, so replays need no lookup.

**Gentle XP.** A challenge's `rewardPercent` (Gentle, against a much smaller player) also scales the battle's base XP before care × habitat, win or lose; the tile-battle port's `ended` returns it as `xpPercent`. `battle.ended.xp` and `PlayerBattle.rewards` carry what was granted.

**Capture.** In the battle's finishing transaction (CLAUDE.md rule 7): the tile changes hands only if it's still held by whoever held it at the start (or nobody) and isn't a home tile, the squishies on watch go home (`tile_defenders` rows deleted, the squishies untouched), the attempt is `captured`, and `tile.captured` follows `battle.ended`. Leaving a map releases its tiles and sends its squishies on watch home too (`releaseTiles`).

**Events:** `tile.attacked` (public: who, whose, where, `cooldownUntil`), `tile.captured` (public: new and old owner, where; internal also the kind, terrain, Gentle `rewardPercent` and returned squishies, for found clothing #43 and milestones #44), `defenders.changed` (public: whose and where, and how many; which squishies stays internal). `PublicTile` carries `cooldownUntil` (the latest, may be past) and `defenders` (a count).

**On watch (decision C):** `isOnWatch(squishy, post)` (shared) is true for an active squishy posted on land its owner still holds; the Hollow Man (#21) skips those. A squishy is housed or on watch, not both (owner decision 2026-10-03): posting locks the squishies after the tiles (id order) and refuses a housed one; housing refuses one on watch. One that was both before the rule counts as on watch only (care's XP multiplier skips its habitat).

## Squishy jobs

`src/modules/jobs` (owner decisions 2026-10-04; design doc §6, §12): each squishy has **one job**: on the battle **team** (up to `BATTLE_RULES.teamSize`, in slot order), a **guard** on watch (#15's posts, set from the tile panel), a **gatherer** working a tile of its owner's land on its own, again and again, or **resting** (the default, at home or in a habitat). Giving a squishy a new job takes it off its old one. Stored as `squishies.team_slot`, `work_tile_id`, `work_since` and `work_started_at` (migration 0021); guards stay in `tile_defenders` and habitats in `habitat_building_id`, so existing posts and beds read as jobs with nothing migrated.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/jobs` | → `JobsView`: my squishies with their job, team slot, post, habitat and gatherer status (what's ready, the next ready time, whether a lit fire keeps the tile safe tonight); `names`; my team in slot order; the tiles a gatherer could work (`spots`); and the server's clock |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/job` | `{ job: "team" }` (the first free slot; `CONFLICT` when full), `{ job: "gatherer", q, r }` (my tile with a gatherable node, or land outside my home whose terrain yields something; one gatherer per tile; in season; it moves out of its habitat) or `{ job: "resting" }` → `JobsView`. Not for a squishy in the Hollow |
| `POST /api/v1/maps/:mapId/team` | `{ squishyIds }` (≤ team size, no repeats; `[]` clears) → `JobsView`. Guards and gatherers picked leave their post or tile; someone already on the team may stay while in the Hollow, nobody new joins from there. Appends `team.picked` |
| `POST /api/v1/maps/:mapId/work/collect` | → `{ granted, items, jobs }`: every finished cycle of my gatherers into the bag (ledger reason `work`, ref the squishy), one transaction; `CONFLICT` "Nothing ready yet" when there's nothing. Appends `work.collected` |
| `POST /api/v1/maps/:mapId/dev/work/ready` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): each of my gatherers finishes one more cycle now (e2e's short timer) → `JobsView` |

Mutating routes take an `Idempotency-Key`.

**Work is timestamps** (CLAUDE.md rule 4): finished cycles are worked out on read or collect from `work_since` (`workProgress`), capped at `JOB_RULES.work.maxStoredCycles`; a full gatherer waits, and starts again from the collect. A cycle is the source's gather time × `cyclePercent` ÷ the squishy's speed (100, 135 when its element or seasonal species matches the resource, 175 when its feeling does too; `JOB_RULES.affinities`, `// TUNE:`). Each cycle pays what was in season when it finished (`workYield`). **At work** (`squishyAtWork`, the one SQL spelling) means its owner still holds the tile and nobody captured it since it started there: work on land that changed hands stops, and what it hadn't collected is lost, like a Keeper's gather (#17). **Taking one off** (a new job, a habitat, posting it as a guard, the Hollow Man) banks what it had ready (`leaveWork`); a part-done cycle is let go.

**Battles read the team** (`listTeam`, only at the battle start): the picked team in slot order, active members only; with nobody picked (or all in the Hollow), the strongest resting squishies, never guards or gatherers (on the Tutorial Glade, guards still fight, so its battles keep their old team). A player whose squishies are all busy hears "Everyone is busy with a job! Pick a team first." Rescues keep their `soloTeam`.

**Night:** a gatherer spends the night on its work tile, so outside every lit fire's safe tiles it's exposed like any squishy (shared `shelterOf`, unchanged). The job board shows `firelit` for each spot before assigning.

**Events:** `squishy.assigned` (public: whose, and the work tiles it left and went to, so maps keep `PublicTile.workers`; which squishy and which job stay internal), `team.picked` (the team; only the player hears it), `work.collected` (public: who; how much stays internal).

## Raid log and defense style

`src/modules/raids` (issue #16; design doc §3, §6): offline defense and the defender's "morning report". The challenger plays a rival-tile battle live (#15); the defender's side is always the server's AI in their **defense stance** (`map_members.defense_stance`, per map, default `RAID_RULES.defaultStance`; the UI says **Defense style**: Bold, Careful, Balanced). So a challenge resolves without waiting on the defender.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/raids` | → `{ report }`: my stance, how many raids are new, and my latest `RAID_RULES.reportLimit` raids (newest first). Only the defender's own |
| `POST /api/v1/maps/:mapId/raids/seen` | `{ raidIds }` → `{ report }`. Marks my raids seen (once; others' ids change nothing). Takes an `Idempotency-Key` |
| `GET /api/v1/maps/:mapId/raids/:raidId/replay` | → `{ replay: { start, end } }`: the battle from my side (`mySide: 'b'`) through `playerBattleView` (#13's view): `start` is `startBattle(seed, setup)`, `end` the stored finished battle. 409 if it was called off, or the content was re-tuned since (the stored log is then the truth) |
| `POST /api/v1/maps/:mapId/defense-style` | `{ stance }` → `{ report }`. Takes the member lock a challenge's start takes, so a change lands before or after a start, never during. Takes an `Idempotency-Key` |

**The raid log is an event consumer** (`raid-log`, multiplayer maps; tech spec §7): for each `battle.ended` of a `rival-tile` battle it reads the attempt log (`tile_attacks`) and the battle, writes one `raids` row (unique per battle, so a re-run writes nothing), marks the challenger's species seen for the defender (their squishies met them, so the replay can name a secret one), and appends `raid.resolved` (public: raid id, who, whose, where, outcome). Why not the battle's own transaction: everything that must commit together (attempt, tile) already does; the log only reports it, and `battle.ended` carries the reason (a forfeit) the territory port doesn't see. A broken raid log can delay a report, never a showdown.

## Home base and buildings

Building on a home base (design doc §11, §13–14; issue #18) lives in `src/modules/buildings`. A building is a `buildings` row on a spot (0 = the middle, 1–6 around it) of one of the player's own home tiles. Hearthfire fuel is a date (tech spec §7): `fuelled_through` is the last map-local night it covers, and "lit" / "nights left" are worked out on read (`lib/time.ts`'s `mapLocalTime`, `hearthfire.ts`'s `fireStateAt`), so nothing ticks.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/home` | → `HomeResponse`: my home tiles, buildings (with fuel and residents), active squishies, `speciesDefs` for secret species I own, my bag, today's seasons, `tonight` and `now` |
| `POST /api/v1/maps/:mapId/buildings` | `{ buildingId, q, r, spot }` → 201 `HomeResponse`. My home tile only (`FORBIDDEN`), an open recipe book page (`FORBIDDEN` while sealed), a free spot, within `maxPerHome`, seasonal ones in season; pays with `consumeItems(…, 'build')` in the same transaction; `building.placed` |
| `POST /api/v1/maps/:mapId/buildings/:buildingId/move` | `{ q, r, spot }` → `HomeResponse`; `building.moved` (no event if it didn't move) |
| `POST /api/v1/maps/:mapId/buildings/:buildingId/remove` | → `{ refund, home }`: its refund percent of what it cost plus unburned fuel (`grantItems(…, 'build-refund')`); residents move out; `building.removed` |
| `POST /api/v1/maps/:mapId/buildings/:buildingId/fuel` | `{ nights }` → `HomeResponse`. Fires only; adds what fits (up to `maxFuelNights` from tonight) and charges `consumeItems(…, 'fuel')` for that; `CONFLICT` when full; `building.fueled` |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/habitat` | `{ habitatId \| null }` → `HomeResponse`. My own active squishy into my habitat, up to its capacity, or out; not one standing watch ("Bring … home from watch first!"); `squishy.housed` |

Mutating routes take an `Idempotency-Key`. Every command locks the player's home tiles first (`lockHomeTiles`), so one player's building commands run one at a time ("one Hearthfire per home" and habitat capacity can't race), then the building, squishy and inventory rows, then `maps` (the event).

**For nightfall (#21):** `mapLocalTime(at, zone)` (`lib/time.ts`) gives the map-local date and minute; shared `tonightOf`, `protectsNight(fuelledThrough, night)` and `hearthfireState` answer "is this fire lit for this night"; `litSafeTiles(fires, homeTiles, local)` (or shared `safeTiles`) gives the protected tiles: a lit fire's whole home base plus every tile within its radius. `BuildingsRepo.listOnMap` returns every building with its tile. **Leaving:** `removeMemberBuildings` runs inside the maps module's leave/remove transaction. **Map view:** `listPublicBuildings` fills `PublicTile.buildings` from the view's own snapshot.

## The Hollow Man

`src/modules/hollow` (issue #21; design doc §2, §14; decision C; DECISIONS "The Hollow Man (#21)"). Night falls on every map at 21:00 map time (`HOME_BASE_RULES.nightfallMinute`); for each player with squishies left in the dark he takes **one** to the Hollow. They're never lost: a rescue (a `rescue` battle against shadow guardians) brings them home.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/hollow` | → `{ hollow }`: `night` (is it night on the map, minutes until that changes), my `reports` for the last `HOLLOW_RULES.reportNights` nights, my squishies in the Hollow (`hollowed`, plus `speciesDefs` for secret ones I own), today's rescue reward, `fireHint` (until his first visit to me, or while last night he let my squishies in the dark be, with no fire of mine lit for tonight) and the server's clock |
| `POST /api/v1/maps/:mapId/rescues` | `{ squishyId }` → 201 `{ battle }` (a `rescue` battle), or 200 with the battle already going. My own squishy, in the Hollow (`NOT_FOUND` / `CONFLICT` otherwise), from anywhere on the map; no attempt used. Takes an `Idempotency-Key` |
| `POST /api/v1/maps/:mapId/dev/nightfall` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): the next night that hasn't come yet falls now → `{ night, taken }`. Pressing it again moves on a night |

**Nightfall** (`service.ts` `runNightfall`, one transaction): claims the night's `hollow_events` row first (`insert … on conflict do nothing`), so a retry, a second job or a restart finds it and does nothing (rule 4); then every active member's squishies are sorted with shared `nightfall()`:
- where a squishy sleeps is its habitat's tile, or its owner's Heart Seed;
- it's **safe** inside the tiles lit fires protect that night (`litSafeTiles`, every player's fires, `protectsNight` through the night's date), **on watch** if `isOnWatch` (decision C), else **exposed**;
- one exposed squishy per player is taken (`state = 'hollowed'`, habitat bed kept), picked with `deriveSeed(mapSeed, 'hollow', night, userId)` (never revealed); none on tutorial maps (`gameplayOverrides(kind).hollowManCanTake`), none from a player in their first-night grace (nights before `firstHollowNight(joined_at)`: their first `HOLLOW_RULES.graceNights` nightfalls after joining, game clock), and never a player's last active squishy (`mayTakeFrom`, owner decision 2026-10-05); the night still counts their squishies in the dark (`exposed`).
Lock order: the night's row, squishies, then `maps` (events).

**The job** (`jobs/nightfall.ts`): a `nightfall.sweep` every minute (and at boot) asks `dueNightfalls()` which maps' latest nightfall hasn't run (maps with an active member who joined before it; map-local time, DST included), and enqueues one `nightfall` job per map and night (`singletonKey: mapId/night`). After downtime only the latest missed night runs.

**Rescues** start through the battles service's `startRescue` (shadows from the secret `RESCUE_GUARDIANS`, fixed per squishy per map-local day, at the player's strongest level plus an offset; if every squishy is in the Hollow, the one being rescued fights). The `hollow` event consumer settles them from `battle.ended` (kind `rescue`): a win brings the squishy home (`state = 'active'`) and grants `HOLLOW_RULES.rescue.heartdust` through `grantItems(…, 'rescue')` if the player has rescues left today (counted by the battle's end, map-local day), and rolls #43's `rescue` clothing drop (`rollFoundDrop`) for those rewarded rescues only; a loss or no contest leaves it waiting. TODO(#19): reset its contentment once care exposes a call.

**Events:** `hollow.nightfall` (everyone: the night and who lost someone, never which squishy), `squishy.hollowed` and `squishy.rescued` (only the owner gets them live; `PUBLIC_VIEWS` overrides).

## Care, levels and evolution

Care (design doc §7–8; issue #19; DECISIONS G and "Care (#19)") lives in `src/modules/care`. Contentment is stored as its value at the last care action (`squishies.contentment_at_last_care`) plus `last_cared_at`, and today's value is worked out on read with shared `contentmentAt` (CLAUDE.md rule 4). Every care action is a `care_log` row, which counts a squishy's actions per day (diminishing returns) and an account's Patch Coins from care per day (the cap); the day is the account's (`users.time_zone`).

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/care` | → `CareListResponse`: my active squishies as their care sheets show them (contentment, mood, level, XP bar, stats, XP bonus, care today, debounce, an unseen evolution), `speciesDefs` for secret forms I own or just grew out of, my bag, `coinsToday`, `now` |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/care` | `{ action }` → `CareResponse` (the list plus `result`). My own active squishy; a short per-action debounce (`cooldownSeconds`, `CONFLICT`); feed pays a Treat with `consumeItems(…, 'care', careLogId)`; `squishy.cared` |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/care/seen` | → `CareListResponse`: the owner saw the evolution celebration |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/rename` | `{ nickname }` (shared `NicknameSchema`: trimmed, 1–16 letters, numbers, spaces and a little punctuation; `null` goes back to the species name) → `CareListResponse` (#20). My own active squishy; every nickname passes `lib/filter.ts` (`assertAllowedText(…, 'name')`, `VALIDATION_FAILED` with a kid-readable message); `squishy.updated` (`{ userId, squishyId, nickname }` to members) only when the name changed |

Mutating routes take an `Idempotency-Key` and are rate limited (`limits.ts`; renaming has its own tighter limit). Lock order for a care action: the account (`users`, so the daily coin cap can't race across squishies and patches), the squishy, inventory rows, then `maps` (the event).

**For other modules (battles, Training Grounds later):** grant XP only through `applyXp(tx, squishyId, baseXp, at)` inside your transaction, with the squishy rows already locked, then `appendGrowthEvents(repo.appendEvent, growths)` after your own event:

```ts
const growth = await applyXp(tx, squishyId, baseXp, at); // base × care × habitat (1×–3×), levels, evolution
await repo.appendEvent(...);                              // your event
await appendGrowthEvents(repo.appendEvent, growth ? [growth] : []);
```

It multiplies by the care and habitat multiplier (shared `xpMultiplier`: whole percents, floor 100, cap `GROWTH_RULES.capPercent`), levels from the XP curve in `GROWTH_RULES` (a squishy that joined above level 1 counts from its level's XP), and evolves at the threshold into the single next form (shared `evolutionAt` over public `Species.evolutions`, then server-only `secretEvolutions`), writing a `squishy_evolutions` row. `squishy.evolved` never names a form on the wire; the owner's care list carries the secret rows once it has happened.

## Quick messages

Phase 1 chat (design doc §17; issue #23) lives in `src/modules/chat`. A member picks a preset phrase, emoji or squishy sticker from the shared `QUICK_MESSAGES`; the client sends only its id, the server checks it against that data, stores the id with the sender in `quick_messages` and appends `chat.quick` (`{ chatId, userId, username, messageId }` to members). Every client draws the words from the same shared data, so no player-typed text exists and nothing goes through `lib/filter.ts` (CLAUDE.md rule 9). Phase 2's free chat will.

| Endpoint | Does |
|---|---|
| `GET /api/v1/maps/:mapId/chat` | → `{ messages }`: the map's latest `QUICK_MESSAGES.feedLimit` messages, newest last (on open and reconnect) |
| `POST /api/v1/maps/:mapId/chat` | `{ messageId }` → `{ message }`. An unknown id is `VALIDATION_FAILED`; takes an `Idempotency-Key`; `chat.quick` |

Members only (`NOT_FOUND` otherwise); a tutorial map answers `FORBIDDEN` (Sprout's Glade has no chat). Sending is rate limited per IP, per player and per map (`limits.ts`); in Phase 1 those limits stand in for the owner's mute (tech spec §5). **Retention:** each send keeps the map's latest `feedLimit` rows and deletes older ones in the same transaction, skipping rows another send is already deleting (`for update skip locked`), so concurrent prunes never wait on each other; the next send catches up. Lock order: the new row, then `maps` (the event), last.

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

An **event consumer** reads each map's `game_events` in seq order **after commit** and keeps its own state: the tutorial step engine, the raid log (#16), the Hollow's rescues (#21) and the Lorebook (#24) today; milestones later. It never runs inside a command's transaction and never depends on live broadcast.

```ts
export function createMilestonesConsumer(): EventConsumer {
  return {
    name: 'milestones',                 // event_consumers.consumer and the queue name; never rename
    mapKinds: ['multiplayer'],          // only woken for these maps
    handle: async (tx, event) => { … }, // write only through tx; throw to retry the event
  };
}
```

Add it to the `consumers` list in `src/index.ts`. How it stays exactly-once:

- **Position:** `event_consumers (consumer, map_id, last_seq)`. `runConsumer` (`jobs/consumers.ts`) applies one event per transaction: it locks the row `FOR UPDATE`, applies the next event after `last_seq` and advances it. A crash or a throwing handler rolls that event back, so it's only delayed; the ones before it stay applied. It keeps going until it reaches `maps.event_seq`. One event per transaction keeps the lock order (tech spec §7): a handler's append takes `maps` last, and no later handler locks an entity row after it.
- **Wake-up in the command's transaction:** `appendGameEvent` calls the wake-up `startJobs` installs (`setEventWakeup`), which runs pg-boss `send` on the command's own transaction (`pgBossOnTransaction`). A rolled-back command wakes nobody. Without jobs running (tests, ops tools) there is no wake-up; the catch-up finds the events later.
- **One worker per (consumer, map):** queue `event-consumer.<name>` uses the `short` policy with the map id as `singletonKey` (one queued job per map; a burst of taps is one wake-up); the `event_consumers` row lock serializes the runs, so a wake-up during a run is a job of its own that takes its turn. Not `stately`: its one-active-per-key index makes idle workers trip a "duplicate key" error on every poll while a map's job runs (see `jobs/boss.ts`). Different maps run side by side (`CONSUMER_CONCURRENCY`), and LISTEN/NOTIFY wakes the worker on commit, so a tutorial step moves on right after the tap. Failures are logged and retried.
- **Catch-up:** `event-consumers.catch-up` runs every minute (`CATCH_UP_CRON`) and at boot, and wakes every consumer whose `last_seq` is behind `maps.event_seq`. It also covers the one gap in the wake-ups: a command whose wake-up de-duplicated against a queued job that was then taken, run and finished before the command committed (`eventsAfter` doesn't wait for in-flight commits), so that event waits for the next catch-up.
- **Handlers may append events** (the tutorial does). Call `appendGameEvent` through `tx`, as the handler's last write; the runner publishes after each event commits. A consumer never completes anything on its own event types.

Tunables are in `src/jobs/limits.ts`. Never prune `game_events` below the lowest `last_seq` for a map.

## Keepers

Each player's Keeper (design doc §23; issue #42) lives in `src/modules/keepers`: one `keepers` row per account, written when they pick one right after signup and whenever they change it (free, any time).

| Endpoint | Does |
|---|---|
| `GET /api/v1/keeper` | → `{ keeper }`: the player's `KeeperConfig`, or null before they pick one |
| `POST /api/v1/keeper` | `KeeperConfig` (`base`, `hairColor`, `eyeColor`, `outfit`) → `{ keeper }`. Every id must be in the shared `KEEPER_DATA` (`keeperConfigProblem`), else `VALIDATION_FAILED` with a kid-readable message. Rate limited (`limits.ts`) |

**Map gate:** with `HP_KEEPER_REQUIRED` (default `true`), creating or joining a map needs a Keeper (`FORBIDDEN`, "Pick your Keeper first, then come back!"), checked before the tutorial gate. **Shown to other players:** `MapMember.keeper` (map detail and map view) carries each member's config, or null for one who never picked (only possible with the gate off). A change shows on other players' maps the next time they fetch the view; there's no live event for it yet.

## Wardrobe

Clothing and outfits (design doc §23; issue #43; DECISIONS "Wardrobe (#43)") live in `src/modules/wardrobe`. Account-level (tech spec §4): one wardrobe per player, and their Keeper wears the same outfit on every map. The catalog is shared data (`CLOTHING`); drop tables are server-only (`@heartpatch/shared/server`).

| Endpoint | Does |
|---|---|
| `GET /api/v1/wardrobe` | → `{ wardrobe }`: `owned` (`{ itemId, count }`, starter items included, catalog order), `wearing` (slot order) and saved `presets` |
| `POST /api/v1/wardrobe/wear` | `{ wearing }` → `{ wardrobe }`. The whole set (equip and unequip in one). Every id must be a known Keeper item the player owns, one per slot (`VALIDATION_FAILED` / `FORBIDDEN`). A change writes `outfit.changed` on every map the player is active on |
| `POST /api/v1/wardrobe/presets/:preset` | `{ name, wearing }` (preset 1–3) → `{ wardrobe }`. Checked like wearing; the name passes the name filter |
| `POST /api/v1/wardrobe/presets/:preset/wear` | → `{ wardrobe }`; `NOT_FOUND` for an empty preset |
| `POST /api/v1/maps/:mapId/squishies/:squishyId/accessory` | `{ itemId \| null }` → `{ squishyId, accessory }`. The player's own active squishy, a squishy accessory they own |
| `POST /api/v1/dev/wardrobe/items` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): `{ items: [...] }` → 201 `{ wardrobe }` |

Commands take an `Idempotency-Key`.

**Storage:** `clothing_owned` (one row per piece; starters aren't stored, everyone owns them), `outfits` (preset 0 is what's worn, 1–3 the presets) and `squishy_accessories`. Other players see the worn set on `MapMember.keeper.wearing`.

**Found clothing, for other modules** (gathering calls it; tile captures and Hollow rescues #21 will): call `rollFoundDrop` inside your transaction, after your own state writes and just before your own event, so your event stays the last write (gathering does this):

```ts
import { rollFoundDrop } from '../wardrobe/drops.js';

await repo.transaction(async (repo, tx) => {
  // …your state writes, then:
  await rollFoundDrop(tx, { source: 'capture', refId: battleId, userId, mapId, tileId, at });
  await repo.appendEvent(...); // your event, last
});
```

## Patch Coins and the Boutique

Patch Coins (design doc §23; issue #45; DECISIONS "Patch Coins and the Boutique (#45)") live in `src/modules/coins`, the shop in `src/modules/boutique`. Account-level, like the wardrobe. Earned in play, never bought.

| Endpoint | Does |
|---|---|
| `GET /api/v1/coins` | → `{ coins: { balance } }` |
| `GET /api/v1/boutique` | → `{ boutique }`: the account's `date`, `restocksAt` (its next local midnight), `daily` and `seasonal` racks (`{ itemId, price, owned }`) and `coins` |
| `POST /api/v1/boutique/buy` | `{ itemId }` → `{ boutique, wardrobe }`. `NOT_FOUND` if the Boutique never sells it; `CONFLICT` if it isn't on today's racks, is owned already, or there aren't enough coins. Send an `Idempotency-Key` |
| `POST /api/v1/dev/coins` | **Dev/test only** (`HP_DEV_SQUISHY_GRANTS`): `{ amount }` → 201 `{ coins }` |

**Paying coins, for other modules** (battles, care and #44's milestones do): call `creditCoins` inside your transaction, after your squishy, inventory and `species_seen` locks and before your events (tech spec §7 step 12). It pays once per `(source, refId)` and applies the daily caps (`COIN_RULES.dailyCaps`; care's coins arrive capped already):

```ts
import { creditCoins } from '../coins/service.js';

await creditCoins(tx, { source: 'milestone', refId: rewardId, userId, mapId: null, amount, at });
```

It rolls the source's table (a percent chance, then a weighted pick among pieces that can drop on this tile's terrain in the seasons on now, by the map's local date), grants the piece and appends `clothing.found` (public: who and what). At most one piece per `(source, refId)`, ever, so a retried command can't grant twice. `HP_DEV_DROP_CHANCE` (dev and test only) sets every table's chance.

## Keeper milestones

Account-level goals with tiers (design doc §24, #44). Tracks are data: public ones in `MILESTONE_TRACKS` (`@heartpatch/shared`), secret ones in `SECRET_MILESTONES` (`@heartpatch/shared/server`, CLAUDE.md rule 6), both checked by `checkMilestoneData`. A track's progress comes from game events (`{ eventType, where, player, distinct?, scaleBy? }` with the tutorial's predicates) or, for The First Patch, from `users.tutorial_completed_at`.

**The `milestones` event consumer** (`consumer.ts`, every map kind): for each event on a patch with `MILESTONE_RULES.minMembers` active members who had joined by the event (decision F), it adds the progress shared `milestoneCredits` gives (seasonal tracks only in their season, by the patch's local date on the game clock; Gentle's `rewardPercent` scales a tile) and grants every tier the new total reaches. The Tutorial Glade counts nothing, except that its last `tutorial.advanced` grants The First Patch. It writes no game event, so it never takes `maps`. A new consumer starts from seq 0, so play from before milestones existed is counted on its first run.

**Granting tiers** (`grantMilestoneTiers`, in the caller's transaction): every tier's `milestone_rewards` row first (unique per player, track and tier; its id is uuid v5 of the three; by player, track, tier), then each new tier's piece (`clothing_owned`, source `milestone`, `ref_id` = the reward id) and coins (`creditCoins`, source `milestone`, no daily cap). A retried or redelivered event, `GET /milestones` and the boot backfill can all try; only the first writes anything. Lock order (tech spec §7): `event_consumers`, `milestone_progress` (by player, then track), every `milestone_rewards` row, then `coin_balances`: a reward row taken after a coin lock could deadlock with another path granting the same tier. Membership (decision F) and seasons are judged at the event's game time (`created_at` shifted by the game clock's offset), since `joined_at` and season dates use the game clock.

**The First Patch** is granted by the consumer (the Glade's finish, or a finisher's next counted event), lazily by `GET /milestones`, and at boot by `backfillTutorial` (`index.ts`) for accounts that finished before milestones existed.

**API:** `GET /milestones` (tracks, titles, the worn title, `news` not celebrated yet; a secret track not earned is `{ hidden: true }`, never its name, goal or condition), `POST /milestones/seen { ids }`, `POST /milestones/title { titleId | null }` (`FORBIDDEN` for a title not earned, `CONFLICT` without a Keeper). Other members see the worn title on `MapMember.title`.

## Tutorial

The single-player tutorial (design doc §26; tech spec §7) lives in `src/modules/tutorial` (issue #47). A run is an ordinary map with `kind = 'tutorial'`, one member and the hand-authored Tutorial Glade (`TUTORIAL_LAYOUT` in shared `data/tutorial/`). `users.tutorial_step` is the current step while a run is going (null otherwise); `users.tutorial_completed_at` is the first completion and never moves.

| Endpoint | Does |
|---|---|
| `GET /api/v1/tutorial` | → `{ tutorial }`: status, current step and map, first completion, and `required` (`HP_TUTORIAL_REQUIRED`). What the client resumes from |
| `POST /api/v1/tutorial/start` | First run → 201 `{ tutorial }`; a run already going → 200 with it. `CONFLICT` once finished (use replay) |
| `POST /api/v1/tutorial/replay` | A fresh Glade from the first step, any time; the old run is archived → 201 |
| `POST /api/v1/tutorial/skip` | Ends any run; only after finishing once (`FORBIDDEN` before) → 200 |
| `POST /api/v1/tutorial/acknowledge` | `{ stepId }`: the player read a talk-only step → 204. Only the current step, and only a step that completes on `tutorial.acknowledged` |
| `POST /api/v1/tutorial/nightfall` | Night falls on the Glade now (the Hollow's own `runNightfall`, next night that hasn't run) → 204. Only on a step that completes on `hollow.nightfall` (`CONFLICT` otherwise) |
| `POST /api/v1/tutorial/dev/step` | Dev only (`HP_DEV_SQUISHY_GRANTS`): `{ stepId }`, jumps the run there and appends `tutorial.advanced` (granting the scarf for the wardrobe step) → 200 `{ tutorial }` |
| `GET /api/v1/lore` | → `{ pages }`: the lore pages I've found (id, title, words, when). Never a page I haven't, never how to find one |

**Step engine.** Steps are data (`TUTORIAL_STEPS`: id, goal, Sprout's lines, highlight target, `completeOn: { eventType, actor, where }` with declarative predicates), checked by `checkTutorialData`. The `tutorial` event consumer (`consumer.ts`) feeds each event on a tutorial map to the shared `advanceTutorial`; a match moves the player one step on, or finishes the tutorial after the last one, and appends `tutorial.advanced` (a system event) so the client hears it live. Events on an archived run do nothing. Archived runs keep their map, tiles and events (replays are rate limited); a cleanup job can prune them later.

**The run (#24).** A new run starts with a Glade friend (`TUTORIAL_SETUP.helper`, a level-5 Pebblesnooze: the player has no squishy yet) and Sprout's little bag (`TUTORIAL_SETUP.bag`, ledger reason `tutorial`). The Glade's wild squishies are the three starters (`gladeSpawn`, by `(q - r) mod 3`), and one beaten without befriending stays (spawns' `befriendedOnly`), so a kid can always try again. The consumer adds three beats the step data can't say: finishing the befriend step on a starter's `squishy.captured` stores `users.partner_species_id` (the starter pick pre-selects it: `MapDetail.preselectSpeciesId`); reaching the wardrobe step grants the Seedling Scarf (`clothing_owned`, source `tutorial`, `ref_id` = uuid v5 of the player's id under a fixed namespace, so it's once per account and never collides); a battle ending during the evolve step gives the Partner the XP to its next form through care's `applyXp`, whose `squishy.evolved` finishes the step. Finishing grants the scarf again (a no-op) and sets `tutorial_completed_at` once: the First Patch milestone (#44) reads it. The Glade's night is scripted (`POST /tutorial/nightfall`); the nightfall sweep skips tutorial maps.

**Lorebook (`src/modules/lore`).** Pages and their conditions are server-only data (`LORE_PAGES`, `@heartpatch/shared/server`): `{ id, title, text, trigger: { mapKinds, eventType, where, finder } }`, with the tutorial's declarative predicates. The `lore` event consumer (every map kind) records finds in `lore_found` (one row per player and page) and writes no event; `GET /lore` returns found pages only. `scripts/check-client-bundle.mjs` fails the build if a page's title or words reach the client.

**Gameplay on tutorial maps** goes through the real modules. They read `gameplayOverrides(map.kind)` from shared (fast timers, sure capture, scripted opponents, the Hollow Man can't take anything) rather than branching on the map kind themselves. The maps API (`/maps`, `/maps/:id`, invites, admin, leave) doesn't show tutorial maps; only `/maps/:id/view` serves a player's own active run, so the client draws the Tutorial Glade as a normal map. An archived run stays NOT_FOUND.

## Opening cinematic

The opening story (design doc §25; issue #46; DECISIONS "The opening cinematic (#46)") lives in `src/modules/cinematic`. Account-level: `users.cinematic_seen_at` is the first time the player watched it to the end or skipped it (null until then). The server only remembers that; the script and drawing are in the client.

| Endpoint | Does |
|---|---|
| `GET /api/v1/cinematic` | → `{ cinematic: { seenAt } }`: an ISO time, or null if never seen. Null means play it once; set means skippable and never auto-played |
| `POST /api/v1/cinematic/seen` | Marks it seen → 200 `{ cinematic: { seenAt } }`. Idempotent: `coalesce` keeps the first time, so a retry or a replay from Settings never moves it |

Both need a session. Only `seen` is rate limited (`modules/cinematic/limits.ts`): 120 per IP and 30 per player per 10 minutes (`// TUNE:` guesses; a family shares one IP). The client marks it once, when the story ends watched or skipped.

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
