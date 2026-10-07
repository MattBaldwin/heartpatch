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
  type AnyPgColumn,
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
/** How a player's squishies on watch play (design doc §6, #16). Mirrors `DefenseStanceSchema`. */
export const defenseStance = pgEnum('defense_stance', ['aggressive', 'defensive', 'balanced']);
export const joinRequestStatus = pgEnum('join_request_status', ['pending', 'approved', 'denied']);
/**
 * Battle kinds (design doc §6): a wild squishy, a neutral tile's guardians
 * (`tile`, #15), another player's tile defenders (`rival-tile`, #15) and the
 * Hollow's shadow guardians (`rescue`, #21).
 */
export const battleKind = pgEnum('battle_kind', ['wild', 'tile', 'rival-tile', 'rescue']);
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
    // The First Patch milestone (#44) reads it: the first completion.
    tutorialCompletedAt: timestamptz('tutorial_completed_at'),
    // The Partner's species (#24): the starter befriended in the latest
    // tutorial run (always one of `STARTERS`, checked by the tutorial). The
    // starter pick on a patch pre-selects it.
    partnerSpeciesId: text('partner_species_id'),
    // The first time the opening cinematic was watched or skipped (#46,
    // design doc §25). Set = it never plays by itself again and can be
    // skipped; replays never move it.
    cinematicSeenAt: timestamptz('cinematic_seen_at'),
    // Who brought them in (#195): the family code they signed up with, and
    // its maker or the patch owner whose invite they used. Null for the
    // operator's codes, `HP_SIGNUP_CODE` and accounts from before #195.
    signupCodeId: uuid('signup_code_id').references((): AnyPgColumn => signupCodes.id),
    invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
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

/**
 * A grown-up helper link (#197, owner decisions 2026-10-07). The player asks,
 * the helper says yes; only an `active` link lets the helper see the name and
 * reset the password. `declined` and `removed` rows stay for audit.
 */
export const accountHelperStatus = pgEnum('account_helper_status', [
  'pending',
  'active',
  'declined',
  'removed',
]);

export const accountHelpers = pgTable(
  'account_helpers',
  {
    id: id(),
    // The player who asked for help.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    helperUserId: uuid('helper_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: accountHelperStatus('status').notNull().default('pending'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // When the helper said yes or no.
    answeredAt: timestamptz('answered_at'),
    // When either side removed it (or the player took back an ask).
    endedAt: timestamptz('ended_at'),
  },
  (t) => [
    // One live link per pair; ended ones can be asked again.
    uniqueIndex('account_helpers_one_live_key')
      .on(t.userId, t.helperUserId)
      .where(sql`${t.status} in ('pending', 'active')`),
    index('account_helpers_user_id_idx').on(t.userId),
    index('account_helpers_helper_user_id_idx').on(t.helperUserId),
    check('account_helpers_not_self', sql`${t.userId} <> ${t.helperUserId}`),
  ],
);

/**
 * Each helper reset (#197): the record of who reset whom, and the helper's
 * daily cap (`HELPER_RULES.resetsPerDay`) counts these rows.
 */
export const accountHelperResets = pgTable(
  'account_helper_resets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    helperUserId: uuid('helper_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('account_helper_resets_helper_user_id_idx').on(t.helperUserId, t.createdAt)],
);

/**
 * Family signup codes (#195): made by a patch owner (at most a few live at
 * once) or by the operator (`created_by_user_id` null, `ops/signup-code.ts`).
 * Each sign-up spends one use, in the account's own transaction.
 */
export const signupCodes = pgTable(
  'signup_codes',
  {
    id: id(),
    // SHA-256 of the normalized code; the code itself is shown once and never stored.
    codeHash: text('code_hash').notNull(),
    label: text('label').notNull(),
    createdByUserId: uuid('created_by_user_id').references((): AnyPgColumn => users.id),
    maxUses: integer('max_uses').notNull(),
    useCount: integer('use_count').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    // Set when its maker turns it off. Accounts made with it stay.
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    unique('signup_codes_code_hash_key').on(t.codeHash),
    index('signup_codes_created_by_user_id_idx').on(t.createdByUserId),
    check('signup_codes_use_count_range', sql`${t.useCount} between 0 and ${t.maxUses}`),
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
    // How their squishies on watch play when challenged (#16); per map.
    // The default is `RAID_RULES.defaultStance`.
    defenseStance: defenseStance('defense_stance').notNull().default('balanced'),
    // The starter they picked on this patch (owner decision 2026-10-03); null
    // until then. Set once and kept when they leave and come back, so a
    // membership never gets a second pick. `no action` on delete on purpose:
    // `set null` would reopen the pick, so a future "release a squishy"
    // must decide what happens to a starter first.
    starterSquishyId: uuid('starter_squishy_id').references((): AnyPgColumn => squishies.id),
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
    // One of the owner's home tiles, or for a Hearthfire any tile they own
    // (#202; the service checks it, and land changing hands takes it down).
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
    // One fire per tile (#202) needs no index of its own: fires stand only in
    // a tile's middle (spot 0, `slot: 'centre'`), so `buildings_tile_id_spot_key`
    // already allows one. (A unique index on fires per tile would fail on the
    // home fires main allowed, two to a home tile, before the boot pass packs
    // them up.)
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
    // Squishy jobs (owner decisions 2026-10-04): one job at a time. Its place
    // on its owner's battle team (0 first), or null.
    teamSlot: smallint('team_slot'),
    // A squishy gatherer: the tile it works (its owner's), when the current
    // count of cycles started (moves on at each collect) and when it was
    // assigned (work on land that changed hands since then stops). Finished
    // cycles are worked out on read (CLAUDE.md rule 4). Guards stay in
    // `tile_defenders`; resting is none of these.
    workTileId: uuid('work_tile_id').references(() => tiles.id, { onDelete: 'set null' }),
    workSince: timestamptz('work_since'),
    workStartedAt: timestamptz('work_started_at'),
    // Training Grounds (owner decision 2026-10-06): the Training Grounds it
    // practices at, and when the current count of XP started (moves on at
    // each settle). XP is worked out on read (shared `trainingProgress`;
    // CLAUDE.md rule 4). One job at a time is kept by the commands, as with
    // guards (no check across columns, so the previous release's writes never
    // fail); settle pays only a squishy whose one job is training.
    trainingBuildingId: uuid('training_building_id').references(() => buildings.id, {
      onDelete: 'set null',
    }),
    trainingSince: timestamptz('training_since'),
  },
  (t) => [
    index('squishies_habitat_building_id_idx').on(t.habitatBuildingId),
    // One squishy per team slot per player per map.
    uniqueIndex('squishies_team_slot_key')
      .on(t.mapId, t.ownerUserId, t.teamSlot)
      .where(sql`${t.teamSlot} is not null`),
    index('squishies_work_tile_id_idx')
      .on(t.workTileId)
      .where(sql`${t.workTileId} is not null`),
    index('squishies_training_building_id_idx')
      .on(t.trainingBuildingId)
      .where(sql`${t.trainingBuildingId} is not null`),
    check(
      'squishies_training_since',
      sql`${t.trainingBuildingId} is null or ${t.trainingSince} is not null`,
    ),
    check('squishies_team_slot_range', sql`${t.teamSlot} between 0 and 5`),
    // On the team or gathering, never both (guards are kept apart by the commands).
    check('squishies_one_job', sql`${t.teamSlot} is null or ${t.workTileId} is null`),
    check(
      'squishies_work_times',
      sql`${t.workTileId} is null or (${t.workSince} is not null and ${t.workStartedAt} is not null)`,
    ),
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
    // `BattleRewards` once finished: the XP actually granted (after Gentle's
    // share and care × habitat) and the share paid. Null while active, after
    // no contest, and for battles finished before it was stored.
    rewards: jsonb('rewards'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    endedAt: timestamptz('ended_at'),
    // A wild squishy from a tile's spawn (#14): its tile and spawn window
    // (`2026-10-31/5`), so one the player befriended or beat is gone for them
    // for the rest of the window. Null for battles that don't come from a spawn.
    spawnQ: smallint('spawn_q'),
    spawnR: smallint('spawn_r'),
    spawnWindow: text('spawn_window'),
    // Where it happens (owner decision 2026-10-04): the terrain id the arena
    // is drawn as, and the patch's time of day (`day`, `dusk`, `night`) when
    // it started. Null for battles started before they were stored.
    terrain: text('terrain'),
    timeOfDay: text('time_of_day'),
  },
  (t) => [
    check(
      'battles_spawn_all_or_none',
      sql`(${t.spawnWindow} is null) = (${t.spawnQ} is null) and (${t.spawnWindow} is null) = (${t.spawnR} is null)`,
    ),
    // "Did this player befriend or beat a spawn in this window?" (spawns module).
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
  // A hairstyle id from the shared Keeper data, or null for the base's own
  // style (every Keeper saved before styles could be picked).
  hairstyle: text('hairstyle'),
  // The milestone title shown on their profile card (#44, design doc §24): a
  // title id from the milestone data they've earned, or null for none.
  titleId: text('title_id'),
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
 * How a tile battle went (#15). `active` while it runs; `captured` won and
 * took the tile; `won` won but the tile couldn't change hands (it went home
 * base or another way meanwhile); `lost` lost or left; `no-contest` called
 * off by the server, which refunds the attempt.
 */
export const tileAttackOutcome = pgEnum('tile_attack_outcome', [
  'active',
  'captured',
  'won',
  'lost',
  'no-contest',
]);

/**
 * Every tile battle (#15, design doc §11 raid rules): the attempt log the
 * daily attempt cap, the tile cooldown and the per-defender daily loss cap
 * count from. Timestamps, not counters (CLAUDE.md rule 4): "today" is the
 * map-local day, worked out when counting. The raid log (#16) reads it too.
 */
export const tileAttacks = pgTable(
  'tile_attacks',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    tileId: uuid('tile_id')
      .notNull()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    attackerUserId: uuid('attacker_user_id').notNull(),
    // The tile's owner when the battle started; null for a neutral tile.
    defenderUserId: uuid('defender_user_id'),
    battleId: uuid('battle_id')
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    outcome: tileAttackOutcome('outcome').notNull().default('active'),
    // Gentle mode share of capture rewards (decision B); 100 otherwise.
    rewardPercent: smallint('reward_percent').notNull().default(100),
    startedAt: timestamptz('started_at').notNull(),
    // Nobody can battle for the tile again before this (started + cooldown).
    cooldownUntil: timestamptz('cooldown_until').notNull(),
    // The player's last action; idle past the abandon time counts as a loss.
    lastActionAt: timestamptz('last_action_at').notNull(),
    endedAt: timestamptz('ended_at'),
    // A capture took the defender's fire down (#202): what came back to them,
    // for the Challenge report. Null: no fire there.
    lostFireRefund: jsonb('lost_fire_refund').$type<Record<string, number>>(),
  },
  (t) => [
    unique('tile_attacks_battle_id_key').on(t.battleId),
    foreignKey({
      name: 'tile_attacks_attacker_member_fk',
      columns: [t.mapId, t.attackerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // Attempts today, cooldowns, losses today.
    index('tile_attacks_map_id_attacker_idx').on(t.mapId, t.attackerUserId, t.startedAt),
    index('tile_attacks_tile_id_idx').on(t.tileId, t.cooldownUntil),
    index('tile_attacks_map_id_defender_idx')
      .on(t.mapId, t.defenderUserId, t.endedAt)
      .where(sql`${t.defenderUserId} is not null`),
    check('tile_attacks_reward_percent_range', sql`${t.rewardPercent} between 0 and 100`),
    check('tile_attacks_cooldown_after_start', sql`${t.cooldownUntil} >= ${t.startedAt}`),
  ],
);

/**
 * Squishies standing watch on their owner's tiles (#15, decision C): up to
 * `TERRITORY_RULES.maxDefenders` per tile, by slot. A squishy stands on one
 * tile at most. Rows only count while the squishy's owner still owns the
 * tile; capture and leaving a map delete them (the squishies go home).
 */
export const tileDefenders = pgTable(
  'tile_defenders',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    tileId: uuid('tile_id')
      .notNull()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    slot: smallint('slot').notNull(),
    squishyId: uuid('squishy_id')
      .notNull()
      .references(() => squishies.id, { onDelete: 'cascade' }),
    assignedAt: timestamptz('assigned_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tileId, t.slot] }),
    unique('tile_defenders_squishy_id_key').on(t.squishyId),
    index('tile_defenders_map_id_idx').on(t.mapId),
    check('tile_defenders_slot_range', sql`${t.slot} between 0 and 5`),
  ],
);

/**
 * Land that misses you (owner decision 2026-10-06, design review Q2): when
 * an outer tile's owner last tended it (claimed it, or tapped Visit, which
 * tends all their land). A timestamp, not a counter (CLAUDE.md rule 4):
 * fading is worked out on read and nightfall picks what goes wild. Owned
 * land with no row yet (held before this table) counts as tended when
 * nightfall first sees it. `wild_night` / `wild_from_user_id` / `wild_at`
 * record the last time the tile went wild and from whom: the per-night cap
 * counts them (so a second nightfall run takes nothing more), and land
 * going wild counts as changing hands for work and gathers. Home tiles have
 * no row.
 */
export const tileTending = pgTable(
  'tile_tending',
  {
    tileId: uuid('tile_id')
      .primaryKey()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    // No foreign key to `maps`: a capture writes this row before the battle's
    // squishy locks, and a key-share lock on `maps` there would break the
    // lock order (tech spec §7). `tile_id` already cascades from the map.
    mapId: uuid('map_id').notNull(),
    tendedAt: timestamptz('tended_at').notNull(),
    wildNight: date('wild_night', { mode: 'string' }),
    wildFromUserId: uuid('wild_from_user_id'),
    // When it went wild: work and gathers finished before then still go in
    // the bag, as when land is captured (jobs' `firstCaptureSince`).
    wildAt: timestamptz('wild_at'),
    // Its owner's fire came down when it went wild (#202): what came back,
    // for the welcome-back card. Null: no fire there.
    lostFireRefund: jsonb('lost_fire_refund').$type<Record<string, number>>(),
  },
  (t) => [
    index('tile_tending_map_id_idx').on(t.mapId),
    check(
      'tile_tending_wild_set',
      sql`(${t.wildNight} is null) = (${t.wildFromUserId} is null) and (${t.wildNight} is null) = (${t.wildAt} is null)`,
    ),
  ],
);

/**
 * One row per map per night the Hollow Man came by (#21, design doc §14):
 * the guard that makes nightfall idempotent (a retry, a second job or a
 * restart finds the row and takes nothing more), and the record the morning
 * report reads. `night` is the map-local date the nightfall fell on.
 * `outcomes` holds every active member's result: `{ userId, taken (squishy id
 * or null), exposed, sheltered }`. Server-only.
 */
export const hollowEvents = pgTable(
  'hollow_events',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    night: date('night', { mode: 'string' }).notNull(),
    ranAt: timestamptz('ran_at').notNull(),
    outcomes: jsonb('outcomes').notNull().default([]),
  },
  (t) => [unique('hollow_events_map_id_night_key').on(t.mapId, t.night)],
);

/**
 * Home fires packed up when the Heart Seed began keeping home safe (#202,
 * owner decision 2026-10-07): everything they gave back, for a one-time note
 * in the morning report. One row per player per map, written by the boot
 * pass (`modules/buildings/layout.ts`).
 */
export const packedHomeFires = pgTable(
  'packed_home_fires',
  {
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    refund: jsonb('refund').$type<Record<string, number>>().notNull(),
    packedAt: timestamptz('packed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.mapId, t.userId] })],
);

export const hollowRescueOutcome = pgEnum('hollow_rescue_outcome', [
  'active',
  'rescued',
  'lost',
  'no-contest',
]);

/**
 * Rescue expeditions (#21, design doc §14, decision C): which squishy a
 * `rescue` battle is for, how it went, and the Heartdust it earned (the daily
 * reward cap counts these by map-local day). Settled by the `hollow` event
 * consumer when the battle ends.
 */
export const hollowRescues = pgTable(
  'hollow_rescues',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    squishyId: uuid('squishy_id')
      .notNull()
      .references(() => squishies.id, { onDelete: 'cascade' }),
    battleId: uuid('battle_id')
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    outcome: hollowRescueOutcome('outcome').notNull().default('active'),
    heartdust: smallint('heartdust').notNull().default(0),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at'),
  },
  (t) => [
    unique('hollow_rescues_battle_id_key').on(t.battleId),
    foreignKey({
      name: 'hollow_rescues_user_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // Rewarded rescues today (the daily Heartdust cap).
    index('hollow_rescues_map_id_user_id_idx').on(t.mapId, t.userId, t.endedAt),
    index('hollow_rescues_squishy_id_idx').on(t.squishyId),
    check('hollow_rescues_heartdust_nonnegative', sql`${t.heartdust} >= 0`),
  ],
);

/**
 * Clothing a player owns (#43, design doc §23): account-level (tech spec §4),
 * one row per piece, so a trade can later move a single piece. Starter items
 * aren't stored: every account owns them. `source` says how it arrived
 * (`gather`, `capture`, `rescue`, `dev-grant`; later `tutorial`, `milestone`,
 * `boutique`, `trade`) and `ref_id` what caused it (a gather's id). One piece
 * per source event, so a retried grant can't add a second.
 */
export const clothingOwned = pgTable(
  'clothing_owned',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Clothing id from the shared catalog.
    itemId: text('item_id').notNull(),
    source: text('source').notNull(),
    refId: uuid('ref_id'),
    // Where it was found, if anywhere; the piece stays when the map goes.
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    acquiredAt: timestamptz('acquired_at').notNull().defaultNow(),
  },
  (t) => [
    index('clothing_owned_user_id_item_id_idx').on(t.userId, t.itemId),
    uniqueIndex('clothing_owned_source_ref_id_key')
      .on(t.source, t.refId)
      .where(sql`${t.refId} is not null`),
  ],
);

/**
 * Lore pages a player has found (#24, design doc §16): account-level, one row
 * per page, found once. The pages and what finds them are server-only data
 * (`LORE_PAGES`); a page's words reach the client only from here.
 */
export const loreFound = pgTable(
  'lore_found',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Page id from `LORE_PAGES`.
    pageId: text('page_id').notNull(),
    // Where it was found; the page stays when the map goes.
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    foundAt: timestamptz('found_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })],
);

/**
 * What a player's Keeper wears and their saved outfits (#43, design doc §23):
 * `preset` 0 is what's worn now, 1–3 the saved presets. `wearing` is a list
 * of clothing ids, one per wardrobe slot, in slot order. Account-level.
 */
export const outfits = pgTable(
  'outfits',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preset: smallint('preset').notNull(),
    // Player-typed, filtered (style guide §8); presets only.
    name: text('name'),
    wearing: jsonb('wearing').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.preset] }),
    check('outfits_preset_range', sql`${t.preset} between 0 and 3`),
  ],
);

/**
 * The accessory a squishy wears (#43): one per squishy, an item from its
 * owner's wardrobe. Goes with the squishy.
 */
export const squishyAccessories = pgTable('squishy_accessories', {
  squishyId: uuid('squishy_id')
    .primaryKey()
    .references(() => squishies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

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
    // The debounce reads only the last few seconds of a squishy's care.
    index('care_log_squishy_id_cared_at_idx').on(t.squishyId, t.caredAt),
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

/** How a challenge ended for the defender (#16). Mirrors `RaidOutcomeSchema`. */
export const raidOutcome = pgEnum('raid_outcome', ['held', 'tie', 'lost', 'taken', 'no-contest']);

/**
 * The raid log (#16, design doc §3 "offline defense"): one row per finished
 * challenge on a player's land (a `rival-tile` battle), written by the
 * raid-log event consumer from `battle.ended`. The defender sees new rows in
 * their report next time they open the map, and marks them seen.
 */
export const raids = pgTable(
  'raids',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    // One row per battle: the consumer's insert is idempotent on it.
    battleId: uuid('battle_id')
      .notNull()
      .references(() => battles.id, { onDelete: 'cascade' }),
    tileId: uuid('tile_id')
      .notNull()
      .references(() => tiles.id, { onDelete: 'cascade' }),
    attackerUserId: uuid('attacker_user_id').notNull(),
    defenderUserId: uuid('defender_user_id').notNull(),
    outcome: raidOutcome('outcome').notNull(),
    // `battle.ended`'s reason (`forfeit`: the challenger scooted home).
    reason: text('reason').notNull(),
    // The stance the defenders played with; null when the land's guardians stood in.
    stance: defenseStance('stance'),
    resolvedAt: timestamptz('resolved_at').notNull(),
    seenAt: timestamptz('seen_at'),
  },
  (t) => [
    unique('raids_battle_id_key').on(t.battleId),
    foreignKey({
      name: 'raids_defender_member_fk',
      columns: [t.mapId, t.defenderUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // A defender's report, newest first.
    index('raids_map_id_defender_idx').on(t.mapId, t.defenderUserId, t.resolvedAt),
  ],
);

/**
 * Quick messages (#23, design doc §17 Phase 1): a preset phrase, emoji or
 * sticker id from the shared `QUICK_MESSAGES`, never typed text. Only a map's
 * latest few are kept (the feed's length; older ones are pruned as new ones
 * arrive). Phase 2's free chat brings the 30-day history for parent review.
 */
export const quickMessages = pgTable(
  'quick_messages',
  {
    id: id(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    // Quick message id from the shared data.
    messageId: text('message_id').notNull(),
    sentAt: timestamptz('sent_at').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'quick_messages_member_fk',
      columns: [t.mapId, t.userId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    // A map's feed, newest first.
    index('quick_messages_map_id_sent_at_idx').on(t.mapId, t.sentAt, t.id),
  ],
);

/**
 * Every Patch Coin change (#45, design doc §23, tech spec §4 "ledger table"):
 * account-level (DECISIONS F), append-only. `coin_balances.balance` always
 * equals the sum of `amount`, which tests reconcile. `(source, ref_id)` is
 * unique, so each battle, capture, care action or milestone pays exactly
 * once however often it's retried. `day` is the account's local date when
 * it happened (`users.time_zone`), for the daily earning caps.
 */
export const coinLedger = pgTable(
  'coin_ledger',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // `CoinSource` from shared (`battle`, `capture`, `care`, `milestone`, `boutique`, `dev-grant`).
    source: text('source').notNull(),
    // What it was for: a battle, a care action, a milestone, a piece bought.
    refId: uuid('ref_id').notNull(),
    // Positive for earning, negative for spending; never 0.
    amount: integer('amount').notNull(),
    // The patch it was earned on, if any; the coins stay when the map goes.
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    day: date('day', { mode: 'string' }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('coin_ledger_source_ref_id_key').on(t.source, t.refId),
    // The daily caps sum one account's day by source.
    index('coin_ledger_user_id_day_idx').on(t.userId, t.day, t.source),
    check('coin_ledger_amount_nonzero', sql`${t.amount} <> 0`),
  ],
);

/**
 * Each account's Patch Coins (#45), cached from `coin_ledger` and changed in
 * the same transaction as its ledger row. The row lock is what serialises an
 * account's credits and purchases, so a purchase can't overspend (tech spec
 * §7 "Lock order"). A missing row is 0.
 */
export const coinBalances = pgTable(
  'coin_balances',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('coin_balances_balance_nonnegative', sql`${t.balance} >= 0`)],
);

/**
 * Keeper milestone progress (#44, design doc §24): one row per account and
 * track, written by the `milestones` event consumer. `progress` is in
 * hundredths of a step (`MILESTONE_UNIT`), so Gentle's half share counts half
 * a tile; `kinds` holds what a "kinds of" track has already counted (species
 * ids). Account-level (DECISIONS F). A missing row is no progress.
 */
export const milestoneProgress = pgTable(
  'milestone_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Track id from the milestone data (public or secret).
    milestoneId: text('milestone_id').notNull(),
    progress: integer('progress').notNull().default(0),
    kinds: jsonb('kinds').$type<string[]>().notNull().default([]),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.milestoneId] }),
    check('milestone_progress_progress_nonnegative', sql`${t.progress} >= 0`),
  ],
);

/**
 * Milestone tiers earned (#44): one row per account, track and tier, so a
 * tier's reward is granted exactly once however often an event is retried
 * (the unique key). `id` is uuid v5 of the three, and it is the `ref_id` of
 * the tier's coins (`coin_ledger`) and piece (`clothing_owned`). `seen_at` is
 * set once the player's client has celebrated it.
 */
export const milestoneRewards = pgTable(
  'milestone_rewards',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    milestoneId: text('milestone_id').notNull(),
    // 1 for a track's first tier.
    tier: smallint('tier').notNull(),
    // The patch whose play earned it, if any; the reward stays when the map goes.
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    earnedAt: timestamptz('earned_at').notNull(),
    seenAt: timestamptz('seen_at'),
  },
  (t) => [
    uniqueIndex('milestone_rewards_user_id_milestone_id_tier_key').on(
      t.userId,
      t.milestoneId,
      t.tier,
    ),
    index('milestone_rewards_unseen_idx')
      .on(t.userId)
      .where(sql`${t.seenAt} is null`),
    check('milestone_rewards_tier_positive', sql`${t.tier} >= 1`),
  ],
);
