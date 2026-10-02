// Core spine tables (tech spec §4, docs/DECISIONS.md). Feature tables arrive
// with their own issue's migration. Keep this file free of @heartpatch/shared
// imports and relative imports: drizzle-kit loads it with its own loader.
// See src/db/README.md for what each table is for.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** `timestamptz`, read and written as UTC `Date`s. */
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const mapKind = pgEnum('map_kind', ['multiplayer', 'tutorial']);
export const mapMemberRole = pgEnum('map_member_role', ['owner', 'member']);
/** Removed players are archived by status, never deleted (tech spec §4). */
export const mapMemberStatus = pgEnum('map_member_status', ['active', 'removed']);
export const squishyState = pgEnum('squishy_state', ['active', 'hollowed']);
/** Map owner's PvP setting (design doc §11, decision B). */
export const pvpMode = pgEnum('pvp_mode', ['on', 'gentle', 'off']);
export const joinRequestStatus = pgEnum('join_request_status', ['pending', 'approved', 'denied']);
/** PvE battle kinds (design doc §6). Tile guardians and raids add values with their issues. */
export const battleKind = pgEnum('battle_kind', ['wild']);
/** `no-contest`: the server called it off (content re-tuned mid-battle). */
export const battleStatus = pgEnum('battle_status', ['active', 'finished', 'no-contest']);

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    // The only personal detail we keep (design doc §18).
    birthYear: smallint('birth_year').notNull(),
    // IANA zone from the device at signup; account-level daily caps reset at
    // its midnight (design doc §3). Validated by the auth service.
    timeZone: text('time_zone').notNull().default('UTC'),
    // Id of the current tutorial step (tutorial step data); null = not started.
    tutorialStep: text('tutorial_step'),
    // Set once the tutorial is finished; replaying it doesn't clear this.
    tutorialCompletedAt: timestamptz('tutorial_completed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // "Pumpkin" and "pumpkin" are the same player.
    uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
    check('users_birth_year_range', sql`${t.birthYear} between 1900 and 2100`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Hash of the `hp_session` cookie token; the raw token is never stored.
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // Rolling expiry (tech spec §5); pushed forward on use.
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Argon2id hash of the code; the code itself is shown once and never stored.
    codeHash: text('code_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // Set when the code is used or replaced by a reset. Used rows stay for audit.
    usedAt: timestamptz('used_at'),
  },
  (t) => [
    // One active code per user (tech spec §9).
    uniqueIndex('recovery_codes_one_active_key')
      .on(t.userId)
      .where(sql`${t.usedAt} is null`),
    index('recovery_codes_user_id_idx').on(t.userId),
  ],
);

export const maps = pgTable(
  'maps',
  {
    id: id(),
    kind: mapKind('kind').notNull(),
    name: text('name').notNull(),
    // IANA zone for map-local time (nightfall, daily jobs).
    timeZone: text('time_zone').notNull(),
    // Last allocated game_events.seq for this map; see game-events.ts.
    eventSeq: bigint('event_seq', { mode: 'number' }).notNull().default(0),
    // Seats (design doc §3). The map is generated with this many home slots.
    maxPlayers: smallint('max_players').notNull().default(4),
    // Who may challenge whom (design doc §11); the owner changes it.
    pvpMode: pvpMode('pvp_mode').notNull().default('gentle'),
    // Map generator seed (crypto.randomBytes). Server-only: it predicts every
    // guardian and spawn, so it is never sent to clients (tech spec §8). Null
    // for hand-authored maps (tutorial, local seed data).
    seed: text('seed'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('maps_event_seq_nonnegative', sql`${t.eventSeq} >= 0`),
    check('maps_max_players_range', sql`${t.maxPlayers} between 1 and 4`),
  ],
);

export const mapMembers = pgTable(
  'map_members',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: mapMemberRole('role').notNull(),
    status: mapMemberStatus('status').notNull().default('active'),
    // Which home base (tiles.home_slot) is theirs. Null on hand-authored maps.
    // A removed member keeps the old value, but only active members hold a slot.
    homeSlot: smallint('home_slot'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.userId] }),
    index('map_members_user_id_idx').on(t.userId),
    // Exactly one owner per map at most; the service creates the owner with the map.
    uniqueIndex('map_members_one_owner_key')
      .on(t.mapId)
      .where(sql`${t.role} = 'owner'`),
    // Two active players can never share a home base.
    uniqueIndex('map_members_active_home_slot_key')
      .on(t.mapId, t.homeSlot)
      .where(sql`${t.status} = 'active'`),
    check('map_members_home_slot_nonnegative', sql`${t.homeSlot} >= 0`),
  ],
);

export const tiles = pgTable(
  'tiles',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // Axial hex coordinates (design doc §11).
    q: smallint('q').notNull(),
    r: smallint('r').notNull(),
    // Terrain id from the shared terrain data table.
    terrain: text('terrain').notNull(),
    // Null = neutral. Must be a member of the same map.
    ownerUserId: uuid('owner_user_id'),
    // Resource id of this tile's node (shared resource data); null = no node.
    nodeResource: text('node_resource'),
    // Wild guardian strength on a neutral tile; null on home tiles. Server-only
    // (it hints at what guards the tile), so it isn't in the public tile view.
    guardianStrength: smallint('guardian_strength'),
    // Set on a home base's tiles (the Heart Seed and its ring): which player
    // slot (map_members.home_slot) it belongs to. Home tiles are never captured.
    homeSlot: smallint('home_slot'),
  },
  (t) => [
    unique('tiles_map_id_q_r_key').on(t.mapId, t.q, t.r),
    foreignKey({
      name: 'tiles_owner_member_fk',
      columns: [t.mapId, t.ownerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    index('tiles_map_id_owner_user_id_idx').on(t.mapId, t.ownerUserId),
  ],
);

/**
 * Home-base buildings (#18, design doc §13–14): one row per building a player
 * put up on a spot of one of their home tiles. `building_id` is from the
 * shared building table (`hearthfire`, `cozy-meadow`); `kind` is copied from
 * it so nightfall (#21) can find every fire with one query.
 *
 * Hearthfire fuel is a date, not a counter (tech spec §7): `fuelled_through`
 * is the last map-local night its fuel covers (null: never fuelled), so
 * nothing ticks and nothing is decremented; whether it's lit is worked out
 * on read (shared `hearthfireState`). `fuel_updated_at` is when it was last
 * fuelled. Rows are deleted when the building is taken down or its owner
 * leaves the map (a returning player gets a fresh home base).
 */
export const buildings = pgTable(
  'buildings',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull(),
    // One of the owner's home tiles (the service checks it).
    tileId: uuid('tile_id')
      .notNull()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    buildingId: text('building_id').notNull(),
    kind: text('kind').notNull(),
    level: smallint('level').notNull().default(1),
    // Building spot on the tile: 0 is the middle, 1-6 around it (shared `spotOffset`).
    spot: smallint('spot').notNull(),
    fuelledThrough: date('fuelled_through', { mode: 'string' }),
    fuelUpdatedAt: timestamptz('fuel_updated_at'),
    placedAt: timestamptz('placed_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'buildings_owner_member_fk',
      columns: [t.mapId, t.ownerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // One building per spot.
    unique('buildings_tile_id_spot_key').on(t.tileId, t.spot),
    index('buildings_map_id_owner_user_id_idx').on(t.mapId, t.ownerUserId),
    check('buildings_level_positive', sql`${t.level} >= 1`),
    check('buildings_spot_range', sql`${t.spot} between 0 and 6`),
  ],
);

export const squishies = pgTable(
  'squishies',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // Owned squishies only; wild squishies are rolled from spawn data, not stored.
    ownerUserId: uuid('owner_user_id').notNull(),
    // Ids from the shared species / element / feeling data tables.
    speciesId: text('species_id').notNull(),
    element: text('element').notNull(),
    feeling: text('feeling').notNull(),
    // Player-chosen; passes the server text filter before it gets here.
    nickname: text('nickname'),
    level: integer('level').notNull().default(1),
    xp: integer('xp').notNull().default(0),
    state: squishyState('state').notNull().default('active'),
    // The habitat it lives in (#18); null: none yet. Only the owner's own
    // habitat, checked by the buildings service. Taking it down moves it out.
    habitatBuildingId: uuid('habitat_building_id').references(() => buildings.id, {
      onDelete: 'set null',
    }),
    // Contentment right after the last care action, and when that was (#19).
    // Today's contentment is worked out from these on read (shared
    // `contentmentAt`; CLAUDE.md rule 4), so nothing ticks.
    contentmentAtLastCare: integer('contentment_at_last_care').notNull().default(0),
    lastCaredAt: timestamptz('last_cared_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('squishies_habitat_building_id_idx').on(t.habitatBuildingId),
    foreignKey({
      name: 'squishies_owner_member_fk',
      columns: [t.mapId, t.ownerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    index('squishies_map_id_owner_user_id_idx').on(t.mapId, t.ownerUserId),
    check('squishies_level_positive', sql`${t.level} >= 1`),
    check('squishies_xp_nonnegative', sql`${t.xp} >= 0`),
    check('squishies_contentment_range', sql`${t.contentmentAtLastCare} between 0 and 100`),
  ],
);

export const gameEvents = pgTable(
  'game_events',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // Per-map, gap-free, allocated from maps.event_seq (tech spec §7).
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    // Null for system events (nightfall, jobs).
    actorUserId: uuid('actor_user_id').references(() => users.id),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('game_events_map_id_seq_key').on(t.mapId, t.seq),
    check('game_events_seq_positive', sql`${t.seq} >= 1`),
  ],
);

export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // Normalized (no dashes, upper case). Shared out loud, so not hashed; it
    // only lets someone ask to join, and the owner still has to say yes.
    code: text('code').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    // Set when the owner revokes or regenerates the code. Kept for audit.
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    unique('invite_codes_code_key').on(t.code),
    // One unrevoked code per map; regenerating revokes the old one first.
    uniqueIndex('invite_codes_one_live_key')
      .on(t.mapId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const joinRequests = pgTable(
  'join_requests',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // The code that was entered (it may be revoked later; the request stays).
    inviteCodeId: uuid('invite_code_id')
      .notNull()
      .references(() => inviteCodes.id),
    status: joinRequestStatus('status').notNull().default('pending'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // Set when the owner approves or denies.
    decidedAt: timestamptz('decided_at'),
  },
  (t) => [
    // One open request per player per map.
    uniqueIndex('join_requests_one_pending_key')
      .on(t.mapId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    index('join_requests_user_id_idx').on(t.userId),
  ],
);

/**
 * How far each event consumer (tutorial steps; later milestones, Easter eggs,
 * the raid log) has read each map's `game_events` (tech spec §7). A consumer's
 * worker holds this row `FOR UPDATE` while it works, and advances `last_seq`
 * in the same transaction as its own writes, so every event is applied once,
 * in seq order. Rows are created on first use. `game_events` are never pruned
 * below a map's lowest `last_seq`.
 */
export const eventConsumers = pgTable(
  'event_consumers',
  {
    // Consumer name (`tutorial`); see apps/server/README.md, "Event consumers".
    consumer: text('consumer').notNull(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // Last game_events.seq applied for this map; 0 = none yet.
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.consumer, t.mapId] }),
    check('event_consumers_last_seq_nonnegative', sql`${t.lastSeq} >= 0`),
  ],
);

/**
 * Battles (design doc §6, tech spec §8, DECISIONS "Battle engine (#11)"): the
 * replay record (seed, setup, actions, content hash) plus the current engine
 * state while a battle runs, and the result and resolved log once it ends.
 * `seed` and `state.rng` are server-only while `status = 'active'`; the API
 * sends `clientBattleView(state)` and reveals the seed only after the end.
 */
export const battles = pgTable(
  'battles',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    kind: battleKind('kind').notNull(),
    status: battleStatus('status').notNull().default('active'),
    // The player on side `a`. Wild and guardian battles have one player.
    playerUserId: uuid('player_user_id').notNull(),
    // Battle seed from `newSeed()` (revealable after the battle, tech spec §8).
    seed: text('seed').notNull(),
    // `BattleContent.contentHash` the battle is played with.
    contentHash: text('content_hash').notNull(),
    // `BattleSetup.sides` (the seed is in `seed`); setup + actions replays the battle.
    setup: jsonb('setup').notNull(),
    // `BattleAction[]`, in order.
    actions: jsonb('actions').notNull().default([]),
    // The current `BattleState`, RNG state included. Server-only.
    state: jsonb('state').notNull(),
    // `BattleResult` once finished; null while active or after no contest.
    result: jsonb('result'),
    // The resolved `BattleEvent[]` once over, kept so a battle stays
    // explainable after re-tuning (tech spec §8 "Content versioning").
    log: jsonb('log'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    endedAt: timestamptz('ended_at'),
    // A wild squishy from a tile's spawn (#14): its tile and spawn window
    // (`2026-10-31/5`), so a befriended one is gone for that player for the
    // rest of the window. Null for battles that don't come from a spawn.
    spawnQ: smallint('spawn_q'),
    spawnR: smallint('spawn_r'),
    spawnWindow: text('spawn_window'),
  },
  (t) => [
    check(
      'battles_spawn_all_or_none',
      sql`(${t.spawnWindow} is null) = (${t.spawnQ} is null) and (${t.spawnWindow} is null) = (${t.spawnR} is null)`,
    ),
    // "Did this player befriend a spawn in this window?" (spawns module).
    index('battles_spawn_window_idx')
      .on(t.mapId, t.playerUserId, t.spawnWindow)
      .where(sql`${t.spawnWindow} is not null`),
    foreignKey({
      name: 'battles_player_member_fk',
      columns: [t.mapId, t.playerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // One battle at a time per player per map; it's resumed, not restarted.
    uniqueIndex('battles_one_active_key')
      .on(t.mapId, t.playerUserId)
      .where(sql`${t.status} = 'active'`),
    index('battles_map_id_player_user_id_idx').on(t.mapId, t.playerUserId),
  ],
);

/**
 * The catalog (#14, design doc §21): every species a player has met on a map
 * (started a battle with) and, once they befriend one, when. Secret species
 * are only ever sent to a player who has a row here.
 */
export const speciesSeen = pgTable(
  'species_seen',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    // Id from the shared species data (public or secret).
    speciesId: text('species_id').notNull(),
    firstSeenAt: timestamptz('first_seen_at').notNull(),
    firstCaughtAt: timestamptz('first_caught_at'),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.userId, t.speciesId] }),
    foreignKey({
      name: 'species_seen_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
  ],
);

/**
 * Idempotency keys (tech spec §5): a mutating request that carries an
 * `Idempotency-Key` header is run once per player and key; a retry gets the
 * stored reply. Rows expire (`lib/idempotency.ts` says how long); the index
 * on `created_at` is for the cleanup.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    // Which route the key was used on, so a key can't replay another route's reply.
    scope: text('scope').notNull(),
    // Hash of the request body, so the same key with a different body is refused.
    requestHash: text('request_hash').notNull(),
    // Null while the first request is still running.
    statusCode: smallint('status_code'),
    // The reply body as sent, replayed to retries.
    response: jsonb('response'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ],
);

/**
 * Each player's Keeper (design doc §23; issue #42): account-level, one row per
 * player, written when they pick one after signup and whenever they change
 * it. Ids are from the shared Keeper data (`KEEPER_DATA`), checked by the
 * keepers service. Clothing and outfits get their own tables with #43.
 */
export const keepers = pgTable('keepers', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  base: text('base').notNull(),
  hairColor: text('hair_color').notNull(),
  eyeColor: text('eye_color').notNull(),
  outfit: text('outfit').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/**
 * Inventory balances (#17, design doc §12, tech spec §4): how many of each
 * item a player has on a map. `item_id` is a resource or crafted-item id
 * from the shared resource table (`timber`, `heart-charm`). A missing row
 * means 0. Only `modules/inventory` (`grantItems`, `consumeItems`) changes
 * it, inside the caller's transaction (CLAUDE.md rule 7), and every change
 * also writes a `resource_ledger` row.
 */
export const inventories = pgTable(
  'inventories',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    itemId: text('item_id').notNull(),
    quantity: integer('quantity').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.userId, t.itemId] }),
    foreignKey({
      name: 'inventories_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    check('inventories_quantity_nonnegative', sql`${t.quantity} >= 0`),
  ],
);

/**
 * Every inventory change, with a reason (tech spec §4 "ledger table"): the
 * balances in `inventories` always equal the sum of `delta` per item, which
 * tests reconcile. `ref_id` points at what caused it (a gather, a craft, a
 * capture's battle) when there is one. Append-only.
 */
export const resourceLedger = pgTable(
  'resource_ledger',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    itemId: text('item_id').notNull(),
    // Positive for a grant, negative for a spend; never 0.
    delta: integer('delta').notNull(),
    // `ItemChangeReason` from shared (`gather`, `craft`, `capture`, `dev-grant`, …).
    reason: text('reason').notNull(),
    refId: uuid('ref_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'resource_ledger_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    index('resource_ledger_map_id_user_id_idx').on(t.mapId, t.userId),
    check('resource_ledger_delta_nonzero', sql`${t.delta} <> 0`),
  ],
);

/** `lost`: the tile changed hands before it was collected, and its new owner started one. */
export const gatherStatus = pgEnum('gather_status', ['active', 'collected', 'lost']);

/**
 * Gathers on resource nodes (#17, design doc §12). Timestamps, not a ticking
 * loop (CLAUDE.md rule 4): a gather is ready once the clock passes `ready_at`,
 * checked when the player collects. `items` is the yield, fixed when it
 * started (seasonal extras included), so it never changes while it runs.
 */
export const gatherJobs = pgTable(
  'gather_jobs',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    tileId: uuid('tile_id')
      .notNull()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    // The node's resource id when it started (shared resource data).
    resource: text('resource').notNull(),
    // Item id → quantity collecting grants.
    items: jsonb('items').notNull(),
    status: gatherStatus('status').notNull().default('active'),
    startedAt: timestamptz('started_at').notNull(),
    readyAt: timestamptz('ready_at').notNull(),
    // When it was collected, or found lost.
    endedAt: timestamptz('ended_at'),
  },
  (t) => [
    foreignKey({
      name: 'gather_jobs_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // One gather at a time per node.
    uniqueIndex('gather_jobs_one_active_per_tile_key')
      .on(t.tileId)
      .where(sql`${t.status} = 'active'`),
    index('gather_jobs_map_id_user_id_idx').on(t.mapId, t.userId),
    check('gather_jobs_ready_after_start', sql`${t.readyAt} >= ${t.startedAt}`),
  ],
);

/**
 * Crafts (#17, design doc §12 recipes): the inputs are used up when one
 * starts; collecting after `ready_at` puts `items` in the bag. One on the go
 * per player per map.
 */
export const crafts = pgTable(
  'crafts',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    // Recipe id from the shared recipe data.
    recipeId: text('recipe_id').notNull(),
    // Item id → quantity collecting grants.
    items: jsonb('items').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    readyAt: timestamptz('ready_at').notNull(),
    // Null while it's on the go.
    collectedAt: timestamptz('collected_at'),
  },
  (t) => [
    foreignKey({
      name: 'crafts_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    uniqueIndex('crafts_one_active_key')
      .on(t.mapId, t.userId)
      .where(sql`${t.collectedAt} is null`),
    check('crafts_ready_after_start', sql`${t.readyAt} >= ${t.startedAt}`),
  ],
);

/**
 * Every care action (#19, design doc §7). Counts a squishy's actions per
 * account-local day (diminishing returns, decision G) and the Patch Coins
 * care earned an account that day (the daily cap, across every patch; #45
 * pays them out). `day` is the owner's `users.time_zone` date at the time.
 */
export const careLog = pgTable(
  'care_log',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    squishyId: uuid('squishy_id')
      .notNull()
      .references(() => squishies.id, { onDelete: 'cascade' }),
    // Care action id from the shared care-action data.
    action: text('action').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    // Contentment it added, and whether it was one of the day's full ones.
    gained: integer('gained').notNull(),
    full: boolean('full').notNull(),
    coins: integer('coins').notNull(),
    caredAt: timestamptz('cared_at').notNull(),
  },
  (t) => [
    index('care_log_squishy_id_day_idx').on(t.squishyId, t.day),
    index('care_log_user_id_day_idx').on(t.userId, t.day),
    check('care_log_gained_nonnegative', sql`${t.gained} >= 0`),
    check('care_log_coins_nonnegative', sql`${t.coins} >= 0`),
  ],
);

/**
 * Evolutions (#19, design doc §8): what each squishy became and when, so a
 * result can be explained later. `seen_at` is null until its owner has seen
 * the celebration.
 */
export const squishyEvolutions = pgTable(
  'squishy_evolutions',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    squishyId: uuid('squishy_id')
      .notNull()
      .references(() => squishies.id, { onDelete: 'cascade' }),
    // Species ids from the shared (or server-only) species data.
    fromSpeciesId: text('from_species_id').notNull(),
    intoSpeciesId: text('into_species_id').notNull(),
    level: integer('level').notNull(),
    evolvedAt: timestamptz('evolved_at').notNull(),
    seenAt: timestamptz('seen_at'),
  },
  (t) => [
    index('squishy_evolutions_unseen_idx')
      .on(t.squishyId)
      .where(sql`${t.seenAt} is null`),
  ],
);
