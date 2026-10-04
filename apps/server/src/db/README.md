# Database (`apps/server/src/db`)

Postgres 16 with Drizzle ORM and the `postgres` driver. Read `docs/TECH_SPEC.md` §4 (data model) and §7 (game event stream) first.

## Quick start

```sh
cp .env.example .env   # includes DATABASE_URL for the dev container
pnpm db:up             # Postgres 16 in Docker (infra/compose/docker-compose.dev.yml)
pnpm db:migrate        # create / update the schema
pnpm db:seed           # a test map ("Seed Patch") with 2 users; re-running is a no-op
pnpm db:down           # stop the container (data stays in the volume)
```

Already have Postgres 16 locally? Skip `db:up` and point `DATABASE_URL` at it.

| Script | What it does |
|---|---|
| `pnpm db:generate` | Writes a new migration from `schema.ts` changes (then formats drizzle-kit's JSON) |
| `pnpm db:check` | `drizzle-kit check`: migration history is consistent |
| `pnpm db:migrate` | Applies pending migrations (`node dist/db/cli.js migrate` in production) |
| `pnpm db:seed` | Seeds local test data. Refuses to run with `NODE_ENV=production` |

## Files

| File | Job |
|---|---|
| `schema.ts` | Table definitions. No `@heartpatch/shared` or relative imports (drizzle-kit loads it with its own loader) |
| `migrations/` | Generated SQL + drizzle-kit journal. Committed; never edit a merged one. `pnpm build` copies it into `dist/` |
| `client.ts` | `createDbClient(url)` → `{ db, ping, close }`, the `Database` / `Transaction` / `Executor` types, `withTransaction(db, fn)`, and `dbReadinessCheck` for `/api/v1/ready` |
| `migrator.ts` | `runMigrations(db)` |
| `game-events.ts` | `appendGameEvent(tx, event)`: the only way to write `game_events`, typed by the shared registry. Also enqueues event-consumer wake-ups in the same transaction (`setEventWakeup`) |
| `seed.ts` | Local test data |
| `cli.ts` | `migrate` / `seed` entrypoint |

Module repos (`modules/<name>/repo.ts`) import `Database` / `Transaction` and the tables from here. Nothing else touches Drizzle (lint-enforced).

## Conventions

- **IDs:** `uuid`, v7, generated in the app (`uuidv7` package) by the column's `$defaultFn`. Postgres 16 has no built-in v7, so raw SQL inserts must supply an id.
- **Time:** `timestamptz`, read as UTC `Date`s. Map-local time uses `maps.time_zone`.
- **Map scoping:** game state carries `map_id` and is deleted with its map (`on delete cascade`). Users and sessions are per account.
- **Owners must be members:** `tiles` and `squishies` reference `map_members (map_id, user_id)`, so a row can only be owned by a member of **the same map**.
- **Removed players are archived,** not deleted: `map_members.status = 'removed'` (tech spec §4). That's why `users` aren't cascade-deleted from maps.
- **Statuses** are Postgres enums. Adding a value is additive, but Postgres won't let a value added by `ALTER TYPE … ADD VALUE` be used in the same transaction, and the migrator applies all pending migrations in one transaction. So add the value in one migration and start using it (defaults, backfills) in a later deploy.
- **Content ids** (species, element, feeling, terrain) are plain `text` holding ids from the shared data tables. Their values are validated by zod data, not duplicated in the database.

## Tables (core spine)

Only the spine that other tables reference is designed here (tech spec §4, `docs/DECISIONS.md`), plus the map tables from #4, `event_consumers` (#47), `battles` and `idempotency_keys` (#13), `keepers` (#42), `inventories`, `resource_ledger`, `gather_jobs` and `crafts` (#17), `species_seen` plus the `battles.spawn_*` columns (#14), `clothing_owned`, `outfits` and `squishy_accessories` (#43), `coin_ledger` and `coin_balances` (#45), `milestone_progress`, `milestone_rewards` and `keepers.title_id` (#44), `care_log`, `squishy_evolutions` plus the squishies' care columns (#19), `raids` plus `map_members.defense_stance` (#16), and `quick_messages` (#23). Feature tables (`buildings`, other ledgers, …) and extra feature columns arrive with their own issues as new migrations.

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `username` | text | Unique **case-insensitively** (`lower(username)` index). Filtered by the server text filter before insert |
| `password_hash` | text | Argon2id (#3). Seed users get a placeholder that can never verify (login treats it as a wrong password) |
| `birth_year` | smallint | The only personal detail kept (design doc §18). Checked 1900–2100 |
| `time_zone` | text, default `'UTC'` | IANA zone from the device at signup, canonicalized by the auth service; account-level daily caps reset at its midnight (design doc §3). The default only covers rows from before #3 |
| `tutorial_step` | text, null | Current tutorial step id from the tutorial data; null = not started |
| `tutorial_completed_at` | timestamptz, null | Set on first completion and kept when replaying (unlocks skip, design doc §26) |
| `created_at` | timestamptz | |

### `sessions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → users | Cascade delete. Indexed (revoke all sessions on password reset) |
| `token_hash` | text, unique | Hash of the `hp_session` cookie token; the raw token is never stored |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Rolling 30-day expiry. Indexed for the `session-cleanup` job |

### `recovery_codes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → users | Cascade delete. Indexed |
| `code_hash` | text | Argon2id hash; the code is shown once and never stored |
| `created_at` | timestamptz | |
| `used_at` | timestamptz, null | Set when the code is redeemed or replaced by a reset. Used rows stay for audit |

One active code per user: a partial unique index on `user_id` where `used_at is null` (tech spec §9).

### `maps`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | enum `map_kind` | `multiplayer` \| `tutorial` (tech spec §7: tutorials are ordinary maps) |
| `name` | text | |
| `time_zone` | text | IANA zone, for nightfall and daily jobs |
| `event_seq` | bigint, default 0 | Last allocated `game_events.seq`; see below |
| `max_players` | smallint, default 4 | Seats; the map is generated with this many home slots. Checked 1–4 |
| `pvp_mode` | enum `pvp_mode`, default `gentle` | `on` \| `gentle` \| `off` (design doc §11, decision B); the owner changes it |
| `seed` | text, null | Map generator seed (`crypto.randomBytes`). **Server-only**: never in a response schema (tech spec §8). Null for hand-authored maps |
| `created_at` | timestamptz | |

### `map_members`
| Column | Type | Notes |
|---|---|---|
| `map_id` | uuid → maps | PK part. Cascade delete |
| `user_id` | uuid → users | PK part. Indexed (a player's maps) |
| `role` | enum `map_member_role` | `owner` \| `member`. At most one owner per map (partial unique index) |
| `status` | enum `map_member_status` | `active` \| `removed` |
| `home_slot` | smallint, null | Which home base (`tiles.home_slot`) is theirs. Unique per map among active members. A removed member keeps the old value but holds no slot |
| `joined_at` | timestamptz | |
| `defense_stance` | enum `defense_stance`, default `'balanced'` | How their squishies on watch play when challenged (#16): `aggressive` \| `defensive` \| `balanced` (UI: Bold, Careful, Balanced). Read under the member lock in a challenge's start transaction |

The 2–4 players-per-map limit is a game rule, enforced by the maps service under a row lock (apps/server/README.md, "Maps").

### `tiles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `q`, `r` | smallint | Axial hex coords. Unique per map |
| `terrain` | text | Terrain id from shared data |
| `owner_user_id` | uuid, null | Null = neutral. FK `(map_id, owner_user_id)` → `map_members` |
| `node_resource` | text, null | Resource id of the tile's node; null = none |
| `guardian_strength` | smallint, null | Wild guardian strength on neutral tiles. Server-only (not in `PublicTileSchema`) |
| `home_slot` | smallint, null | Set on a home base's 7 tiles: whose slot it is. Home tiles are never captured |

Tiles are written once, from `generateMap`, when the map is created.

### `invite_codes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `code` | text, unique | 8 characters, normalized (no dash). Not hashed: it's shared out loud and only lets someone *ask* to join |
| `created_by_user_id` | uuid → users | |
| `created_at`, `expires_at` | timestamptz | Live for 7 days (`INVITE_CODE_TTL_MS`, `// TUNE:`) |
| `revoked_at` | timestamptz, null | Set on revoke or regenerate; kept for audit. One unrevoked code per map (partial unique index) |

### `join_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `user_id` | uuid → users | Indexed |
| `invite_code_id` | uuid → invite_codes | The code they entered |
| `status` | enum `join_request_status` | `pending` \| `approved` \| `denied`. One pending request per player per map (partial unique index) |
| `created_at` | timestamptz | |
| `decided_at` | timestamptz, null | |

### `squishies`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `owner_user_id` | uuid | FK `(map_id, owner_user_id)` → `map_members`. Owned squishies only; wild ones are rolled from spawn data, not stored |
| `species_id`, `element`, `feeling` | text | Ids from shared data. Feeling can shift with care |
| `nickname` | text, null | Filtered before insert |
| `level` | integer, default 1 | ≥ 1 |
| `xp` | integer, default 0 | ≥ 0 |
| `state` | enum `squishy_state` | `active` \| `hollowed` |
| `habitat_building_id` | uuid → buildings, null | The habitat it lives in (#18); `ON DELETE SET NULL` |
| `contentment_at_last_care` | integer, default 0 | 0–100 (check): contentment right after the last care action (#19) |
| `last_cared_at` | timestamptz, null | When. Today's contentment is worked out from these two on read (shared `contentmentAt`), so nothing ticks |
| `created_at` | timestamptz | |

`level` and `xp` change only through care's `applyXp` (#19): `xp` is the total, and a squishy that joined above level 1 counts from its level's XP. Stats come from the species and level (`statsAtLevel`); individual variance, care history and accessories columns are added by their feature issues.

### `care_log`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | The `ref_id` of a feed's `resource_ledger` row |
| `map_id` | uuid → maps | Cascade delete |
| `user_id` | uuid → users | Cascade delete. Indexed with `day`: Patch Coins from care per account per day, across every patch (the cap) |
| `squishy_id` | uuid → squishies | Cascade delete. Indexed with `day` (care actions per squishy per day: diminishing returns) and with `cared_at` (the debounce) |
| `action` | text | Care action id (`feed`, `pet`, `play`) |
| `day` | date | The owner's account-local date (`users.time_zone`) when it happened |
| `gained` | integer | Contentment it added, ≥ 0 |
| `full` | boolean | One of the day's full-value actions |
| `coins` | integer | Patch Coins it earned, ≥ 0. #45 pays them out into `coin_ledger` |
| `cared_at` | timestamptz | Append-only |

### `squishy_evolutions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `squishy_id` | uuid → squishies | Cascade delete |
| `from_species_id`, `into_species_id` | text | Species ids (the target may be a secret form) |
| `level` | integer | The level it evolved at |
| `evolved_at` | timestamptz | |
| `seen_at` | timestamptz, null | Null until its owner has seen the celebration (partial index on `squishy_id` where null) |

### `battles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete. Indexed with `player_user_id` |
| `kind` | enum `battle_kind` | `wild`, `tile` (a neutral tile's guardians, #15), `rival-tile` (another player's tile, #15) or `rescue` (the Hollow's shadow guardians, #21). Tile battles have a `tile_attacks` row; rescues a `hollow_rescues` row |
| `status` | enum `battle_status` | `active` \| `finished` \| `no-contest` (the server called it off: content re-tuned mid-battle). One `active` per player per map (partial unique index) |
| `player_user_id` | uuid | The player on side `a`. FK `(map_id, player_user_id)` → `map_members` |
| `seed` | text | From `newSeed()`. **Server-only while active**; revealed by the API after the end (tech spec §8) |
| `content_hash` | text | `BattleContent.contentHash` the battle is played with |
| `setup` | jsonb | `BattleSetup.sides`; with `seed` and `actions` it replays the battle |
| `actions` | jsonb | `BattleAction[]`, in order |
| `state` | jsonb | The current `BattleState`, RNG state included. **Server-only** (the API sends `clientBattleView`) |
| `result` | jsonb, null | `BattleResult` once finished |
| `log` | jsonb, null | The resolved `BattleEvent[]` once over, kept so a battle stays explainable after re-tuning |
| `started_at`, `ended_at` | timestamptz | |
| `spawn_q`, `spawn_r`, `spawn_window` | smallint, smallint, text, null | The tile and spawn window (`2026-10-31/5`) a wild squishy came from (#14). All set or all null (`battles_spawn_all_or_none`). Indexed `(map_id, player_user_id, spawn_window)` where set, so a befriended spawn is skipped for the rest of its window |

### `tile_attacks`
Every tile battle (#15, design doc §11 raid rules): the attempt log the daily attempts, the tile cooldown and the per-defender daily loss cap count from. Timestamps, not counters; "today" is the map-local day (`at time zone maps.time_zone`). The raid log (#16) reads it too.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `tile_id` | uuid → tiles | Cascade delete. Indexed with `cooldown_until` |
| `attacker_user_id` | uuid | FK `(map_id, attacker_user_id)` → `map_members`. Indexed `(map_id, attacker_user_id, started_at)` |
| `defender_user_id` | uuid, null | The tile's owner when the battle started; null for neutral land. Indexed `(map_id, defender_user_id, ended_at)` where set |
| `battle_id` | uuid → battles | Unique. Cascade delete |
| `outcome` | enum `tile_attack_outcome` | `active` \| `captured` \| `won` (won, but the tile couldn't change hands) \| `lost` (lost or left) \| `no-contest` (refunded: not counted as an attempt) |
| `reward_percent` | smallint | Gentle mode share of capture rewards (decision B); 100 otherwise |
| `started_at` | timestamptz | |
| `cooldown_until` | timestamptz | `started_at` + `TERRITORY_RULES.cooldownHours`; nobody battles for the tile again before it |
| `last_action_at` | timestamptz | The player's last action; idle past `abandonMinutes` counts as a loss |
| `ended_at` | timestamptz, null | |

### `tile_defenders`
Squishies standing watch on their owner's tiles (#15, decision C), up to `TERRITORY_RULES.maxDefenders` per tile.

| Column | Type | Notes |
|---|---|---|
| `map_id` | uuid → maps | Cascade delete. Indexed |
| `tile_id` | uuid → tiles | PK part, with `slot`. Cascade delete |
| `slot` | smallint | 0-based order (0–5, checked) |
| `squishy_id` | uuid → squishies | Unique: a squishy stands on one tile at most. Cascade delete |
| `assigned_at` | timestamptz | |

Rows only count while the squishy's owner still owns the tile and it isn't in the Hollow. A capture and `releaseTiles` (leaving or removal) delete the tile's rows: the squishies go home.

### `raids`
The raid log (#16): one row per finished challenge on a player's land (a `rival-tile` battle), written by the `raid-log` event consumer from `battle.ended` (tech spec §7 "Event consumers"). The defender's report lists them and marks them seen.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `battle_id` | uuid → battles | Unique (the consumer's insert is idempotent on it). Cascade delete. The replay reads the battle |
| `tile_id` | uuid → tiles | Cascade delete |
| `attacker_user_id` | uuid | |
| `defender_user_id` | uuid | FK `(map_id, defender_user_id)` → `map_members`. Indexed `(map_id, defender_user_id, resolved_at)` |
| `outcome` | enum `raid_outcome` | From the defender's side: `held` (won, or the challenger left) \| `tie` \| `lost` (lost the showdown, land didn't move) \| `taken` \| `no-contest` |
| `reason` | text | `battle.ended`'s reason (`tuckered-out`, `forfeit`, `turn-limit`, `no-contest`) |
| `stance` | enum `defense_stance`, null | The style the defenders played with; null when the land's guardians stood in |
| `resolved_at` | timestamptz | When the battle ended |
| `seen_at` | timestamptz, null | When the defender saw it in their report |

### `hollow_events`
One row per map per night the Hollow Man came by (#21, design doc §14): the guard that makes nightfall idempotent, and what the morning report reads. Server-only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `night` | date | The map-local date the nightfall fell on. Unique with `map_id` |
| `ran_at` | timestamptz | |
| `outcomes` | jsonb | Every active member's result: `{ userId, taken (squishy id or null), exposed, sheltered }` |

### `hollow_rescues`
Rescue expeditions (#21, decision C): which squishy a `rescue` battle is for, and how it went.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `user_id` | uuid | FK `(map_id, user_id)` → `map_members` |
| `squishy_id` | uuid → squishies | Cascade delete. Indexed |
| `battle_id` | uuid → battles | Unique. Cascade delete |
| `outcome` | enum | `active`, `rescued`, `lost`, `no-contest` |
| `heartdust` | smallint | Heartdust it earned (0 past the daily cap). The cap counts rows with `heartdust > 0` by map-local day (`(map_id, user_id, ended_at)` index) |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz, null | The battle's end (game clock) |

### `species_seen`
| Column | Type | Notes |
|---|---|---|
| `map_id` | uuid → maps | PK part. Cascade delete |
| `user_id` | uuid | PK part. FK `(map_id, user_id)` → `map_members` |
| `species_id` | text | PK part. Species id from shared data (public or secret) |
| `first_seen_at` | timestamptz | When the player first met it (started a battle with it); never moves |
| `first_caught_at` | timestamptz, null | When they first befriended one; never moves once set |

The catalog (#14). A secret species' row is only ever sent to a player who has a row here for it.

### `idempotency_keys`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → users | PK part. Cascade delete |
| `key` | text | PK part. The `Idempotency-Key` header value |
| `scope` | text | The route the key was used on |
| `request_hash` | text | SHA-256 of method, URL and body, so the same key with another body is refused |
| `status_code` | smallint, null | Null while the first request runs |
| `response` | jsonb, null | The reply body, replayed to retries |
| `created_at` | timestamptz | Indexed, for the cleanup job (`lib/idempotency.ts`) |

### `keepers`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK → users | One row per player (account-level, tech spec §4). Cascade delete |
| `base` | text | Keeper base id (`KEEPER_DATA.bases`) |
| `hair_color` | text | Hair colour id (`KEEPER_DATA.hairColors`) |
| `eye_color` | text | Eye colour id (`KEEPER_DATA.eyeColors`) |
| `outfit` | text | Starter outfit palette id (`KEEPER_DATA.outfits`) |
| `created_at` | timestamptz | First pick |
| `updated_at` | timestamptz | Last change (changing is free, any time) |

Written by the keepers service (#42), which checks every id against the shared Keeper data first. No row = the player hasn't picked yet; with `HP_KEEPER_REQUIRED` they can't make or join a map until they do. What the Keeper wears is in `outfits` (#43).

### `clothing_owned`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | One row per piece, so a trade can move one (account-level, tech spec §4) |
| `user_id` | uuid → users | Cascade delete. Indexed with `item_id` |
| `item_id` | text | Clothing id (`CLOTHING`) |
| `source` | text | How it arrived: `gather`, `capture`, `rescue`, `tutorial`, `boutique`, `dev-grant` (later `milestone`, `trade`) |
| `ref_id` | uuid, null | What caused it (a gather's id). Unique with `source` when set: one piece per event |
| `map_id` | uuid, null → maps | Where it was found; set null when the map goes (the piece stays) |
| `acquired_at` | timestamptz | |

Starter items are never stored: every account owns them (DECISIONS "Wardrobe (#43)").

### `outfits`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → users | Cascade delete. PK with `preset` |
| `preset` | smallint | 0 is what the Keeper wears now; 1–3 the saved presets (checked) |
| `name` | text, null | A preset's name, filtered |
| `wearing` | jsonb | Clothing ids, one per wardrobe slot, in slot order |
| `updated_at` | timestamptz | |

### `squishy_accessories`
| Column | Type | Notes |
|---|---|---|
| `squishy_id` | uuid PK → squishies | One accessory per squishy; cascade delete |
| `user_id` | uuid | The owner when it was put on |
| `item_id` | text | A squishy accessory (`CLOTHING`, slot `squishy`) |
| `updated_at` | timestamptz | |

### `coin_ledger`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Append-only: every Patch Coin change (#45, tech spec §4) |
| `user_id` | uuid → users | Account-level (DECISIONS F); cascade delete |
| `source` | text | `CoinSource`: `battle`, `capture`, `care`, `milestone`, `boutique` (a purchase), `dev-grant` |
| `ref_id` | uuid | What it was for (a battle, a `care_log` row, a milestone, a purchase). Unique with `source`: each pays once |
| `amount` | integer | Positive to earn, negative to spend; never 0 (checked) |
| `map_id` | uuid, null → maps | The patch it was earned on; set null when the map goes (the coins stay) |
| `day` | date | The account's local date (`users.time_zone`), for the daily caps. Indexed with `user_id`, `source` |
| `created_at` | timestamptz | Game clock |

### `milestone_progress`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → users | PK part. Account-level (DECISIONS F); cascade delete |
| `milestone_id` | text | PK part. A track id from the milestone data (`MILESTONE_TRACKS`, or server-only `SECRET_MILESTONES`) |
| `progress` | integer | Hundredths of a step (`MILESTONE_UNIT`), so Gentle's half share counts half a tile; `>= 0` (check) |
| `kinds` | jsonb | For "kinds of" tracks (Collector): the kinds already counted (species ids). `[]` otherwise |
| `updated_at` | timestamptz | Game clock |

Written only by the `milestones` event consumer, under the row's lock (tech spec §7 step 11). A missing row is no progress.

### `milestone_rewards`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | uuid v5 of `user/milestone/tier` under a fixed namespace; also the `ref_id` of the tier's `coin_ledger` row and `clothing_owned` piece |
| `user_id` | uuid → users | Cascade delete. Unique with `milestone_id`, `tier`: a tier is granted once |
| `milestone_id` | text | Track id |
| `tier` | smallint | 1 for the first tier; `>= 1` (check) |
| `map_id` | uuid, null → maps | The patch whose play earned it (null for The First Patch); set null when the map goes |
| `earned_at` | timestamptz | Game clock |
| `seen_at` | timestamptz, null | Set once the player's client celebrated it. Partial index on unseen rows per player |

`keepers.title_id` (text, null) is the title the player wears on their profile card: a tier's title id they have earned (`POST /milestones/title` checks).

### `coin_balances`
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK → users | One row per account, made on its first coin; cascade delete |
| `balance` | integer | Always the sum of the account's `coin_ledger.amount`, changed in the same transaction; never below 0 (checked) |
| `updated_at` | timestamptz | |

Every credit and purchase locks this row first (tech spec §7 step 12), so an account's coins change one at a time.

### `inventories`
| Column | Type | Notes |
|---|---|---|
| `map_id` | uuid → maps | PK part. Cascade delete |
| `user_id` | uuid | PK part. FK `(map_id, user_id)` → `map_members` |
| `item_id` | text | PK part. A resource or crafted-item id from the shared resource table (`timber`, `heart-charm`) |
| `quantity` | integer | `>= 0` (check). A missing row means 0. Changed only by `grantItems` / `consumeItems` (`modules/inventory`), in the caller's transaction, each writing `resource_ledger` rows |
| `updated_at` | timestamptz | |

### `resource_ledger`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete. Indexed with `user_id` |
| `user_id` | uuid | FK `(map_id, user_id)` → `map_members` |
| `item_id` | text | |
| `delta` | integer | `+` granted, `−` spent; never 0 (check). Per item, the sum equals `inventories.quantity` (tests reconcile it) |
| `reason` | text | `ItemChangeReason` from shared (`gather`, `craft`, `capture`, `dev-grant`, `build`, `fuel`, `build-refund`, `care`; later issues add more) |
| `ref_id` | uuid, null | What caused it: the gather or craft id |
| `created_at` | timestamptz | Append-only |

### `gather_jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete. Indexed with `user_id` |
| `user_id` | uuid | Who started it. FK `(map_id, user_id)` → `map_members` |
| `tile_id` | uuid → tiles | Cascade delete. One `active` gather per tile (partial unique index) |
| `resource` | text | The node's resource id when it started |
| `items` | jsonb | What collecting grants (item id → quantity), fixed at the start, seasonal extras included |
| `status` | enum `gather_status` | `active` \| `collected` \| `lost` (the tile changed hands and its new owner started one) |
| `started_at`, `ready_at` | timestamptz | The timer (CLAUDE.md rule 4): collecting checks the clock against `ready_at` |
| `ended_at` | timestamptz, null | When it was collected or lost |

### `crafts`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `user_id` | uuid | FK `(map_id, user_id)` → `map_members`. One uncollected craft per player per map (partial unique index) |
| `recipe_id` | text | Recipe id from the shared recipe table |
| `items` | jsonb | What collecting grants. The inputs were used up when it started |
| `started_at`, `ready_at` | timestamptz | `ready_at` = start + the recipe's `craftSeconds` |
| `collected_at` | timestamptz, null | Null while it's on the go |

### `game_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps | Cascade delete |
| `seq` | bigint | Per-map, gap-free, ≥ 1. Unique `(map_id, seq)` (also the replay index) |
| `type` | text | Event type, e.g. `tile.updated` |
| `actor_user_id` | uuid → users, null | Null for system events |
| `payload` | jsonb | |
| `created_at` | timestamptz | |

### `event_consumers`
| Column | Type | Notes |
|---|---|---|
| `consumer` | text | PK part. Consumer name (`tutorial`) |
| `map_id` | uuid → maps | PK part. Cascade delete |
| `last_seq` | bigint, default 0 | Last `game_events.seq` the consumer applied on this map. ≥ 0 |

Event consumers' positions (tech spec §7; apps/server/README.md, "Event consumers and jobs"). A worker holds its row `FOR UPDATE` and advances `last_seq` in the same transaction as its own writes. Rows are created on first use. Never prune `game_events` below a map's lowest `last_seq`.

pg-boss keeps its own tables in the `pgboss` schema; it creates and migrates them itself when the server starts.

### `quick_messages`
Phase 1 chat (#23, design doc §17): one row per quick message sent on a map. Only an id from the shared `QUICK_MESSAGES` data is stored, never typed text. Each send keeps the map's latest `QUICK_MESSAGES.feedLimit` rows and prunes older ones (Phase 2's free chat brings the 30-day history for parent review).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Also `chat.quick`'s `chatId` |
| `map_id` | uuid → maps | Cascade delete |
| `user_id` | uuid | The sender. FK `(map_id, user_id)` → `map_members` |
| `message_id` | text | Quick message id from the shared data |
| `sent_at` | timestamptz | Indexed `(map_id, sent_at, id)` for the feed |

## Writing game events

Every meaningful change writes a `game_events` row **in the same transaction** as the change, through `appendGameEvent`, called as the **last write**:

```ts
await withTransaction(db, async (tx) => {
  // 1. Lock and change entity rows (SELECT … FOR UPDATE, UPDATE …)
  // 2. Last: allocate seq and write the event
  const event = await appendGameEvent(tx, { mapId, type: 'map.updated', actorUserId, payload });
  return event;
});
// 3. After commit: wsHub.publish(mapId); live sync sends the type's public view (apps/server/README.md)
```

When jobs are running, `appendGameEvent` also enqueues the event consumers' wake-up (pg-boss `send`) on the same transaction, so it commits or rolls back with the event.

Event types and payloads come from the shared registry, `packages/shared/src/schemas/events.ts`: each type has an **internal** payload schema (what's stored; `appendGameEvent` is generic over the type, so payloads typecheck, and it validates them at runtime too) and a **public** one (what live sync may broadcast: `PUBLIC_VIEWS` in `src/ws/public-views.ts` is built from these, one view per type). Add a type there before writing it. Tests of the event stream itself, which need made-up types, use `appendRawGameEvent`; modules never do.

`appendGameEvent` runs `UPDATE maps SET event_seq = event_seq + 1 … RETURNING event_seq` and inserts the event with that seq. The update row-locks the map until commit, so seqs never skip (a rollback undoes the bump too, unlike a Postgres sequence) and commit order matches seq order. Taking that lock last keeps a fixed lock order (entities, then `maps`), which avoids deadlocks. Integration tests in `game-events.test.ts` check concurrent appends, rollbacks and both mixed together.

## Changing the schema

1. Edit `schema.ts`, then `pnpm db:generate` and commit the migration.
2. Migrations must work while the previous release is still running: **expand, then contract** in a later release (tech spec §4).
3. Before merging a branch, follow the regenerate-on-latest-`main` workflow in tech spec §4.
4. CI runs `drizzle-kit check` and fails if `pnpm db:generate` would produce a new migration.

## Tests

DB integration tests run against a real Postgres. `tests/global-setup.ts` creates a scratch database next to `DATABASE_URL` (the role needs `CREATEDB`), applies every migration from scratch, and drops it afterwards, so tests never touch your dev data. Without `DATABASE_URL`, those tests are skipped locally with a warning. CI sets it and fails if it's missing.
