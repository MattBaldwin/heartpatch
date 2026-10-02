// Core spine tables (tech spec §4, docs/DECISIONS.md). Feature tables arrive
// with their own issue's migration. Keep this file free of @heartpatch/shared
// imports and relative imports: drizzle-kit loads it with its own loader.
// See src/db/README.md for what each table is for.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
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
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [check('maps_event_seq_nonnegative', sql`${t.eventSeq} >= 0`)],
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
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.mapId, t.userId] }),
    index('map_members_user_id_idx').on(t.userId),
    // Exactly one owner per map at most; the service creates the owner with the map.
    uniqueIndex('map_members_one_owner_key')
      .on(t.mapId)
      .where(sql`${t.role} = 'owner'`),
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
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'squishies_owner_member_fk',
      columns: [t.mapId, t.ownerUserId],
      foreignColumns: [mapMembers.mapId, mapMembers.userId],
    }),
    index('squishies_map_id_owner_user_id_idx').on(t.mapId, t.ownerUserId),
    check('squishies_level_positive', sql`${t.level} >= 1`),
    check('squishies_xp_nonnegative', sql`${t.xp} >= 0`),
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
