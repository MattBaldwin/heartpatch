import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { PublicUserSchema, RECOVERY_CODE_ALPHABET } from './auth.js';
import { PublicBuildingSchema } from './buildings.js';
import { PublicFenceSchema } from './fences.js';
import { ContentIdSchema, DisplayNameSchema } from './data/common.js';
import { FeelingIdSchema } from './data/elements.js';
import { PublicKeeperSchema } from './data/keepers.js';
import { TimeZoneSchema } from './time.js';
import { WsSeqSchema } from './ws.js';

// Map (patch) API schemas (design doc §3, §11; tech spec §5). Players call a
// map a "patch" in the UI (style guide). Messages are kid-readable.

/** Players per map (design doc §3). The map is generated for this many. */
export const MAP_MIN_PLAYERS = 2;
export const MAP_MAX_PLAYERS = 4;

export const MAP_NAME_MIN_LENGTH = 2; // TUNE: guess
export const MAP_NAME_MAX_LENGTH = 24; // TUNE: fits a lobby card on a phone

/**
 * Letters, numbers, spaces and a little friendly punctuation. Runs of spaces
 * collapse to one. The server also runs the text filter.
 */
export const MapNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(MAP_NAME_MIN_LENGTH, `Patch names need at least ${MAP_NAME_MIN_LENGTH} letters.`)
      .max(MAP_NAME_MAX_LENGTH, `Patch names can be up to ${MAP_NAME_MAX_LENGTH} letters.`)
      .regex(
        /^[\p{L}\p{N} '’!&.,-]+$/u,
        'Patch names can use letters, numbers, spaces and a little punctuation.',
      ),
  );

/** Map-owner PvP setting (design doc §11, decision B). */
export const PvpModeSchema = z.enum(['on', 'gentle', 'off']);
export type PvpMode = z.infer<typeof PvpModeSchema>;
export const DEFAULT_PVP_MODE: PvpMode = 'gentle';

export const MapRoleSchema = z.enum(['owner', 'member']);
export type MapRole = z.infer<typeof MapRoleSchema>;

// Invite codes: 8 characters from the recovery-code alphabet (no look-alikes),
// shown as ABCD-EFGH. Entering one only asks to join; the owner still decides.
export const INVITE_CODE_ALPHABET = RECOVERY_CODE_ALPHABET;
export const INVITE_CODE_LENGTH = 8;

/** Uppercases and drops spaces and dashes, so "abcd efgh" works too. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** ABCDEFGH → ABCD-EFGH. */
export function formatInviteCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export const InviteCodeSchema = z
  .string()
  .max(32, "That doesn't look like an invite code. Check it and try again!")
  .transform(normalizeInviteCode)
  .pipe(
    z
      .string()
      .length(INVITE_CODE_LENGTH, 'Invite codes have 8 letters and numbers.')
      .regex(
        new RegExp(`^[${INVITE_CODE_ALPHABET}]+$`),
        "That doesn't look like an invite code. Check it and try again!",
      ),
  );

/** `POST /api/v1/maps` */
export const CreateMapRequestSchema = z.object({
  name: MapNameSchema,
  /** IANA zone for nightfall and daily resets; the client sends the device's. */
  timeZone: TimeZoneSchema,
});
export type CreateMapRequest = z.infer<typeof CreateMapRequestSchema>;

/** `POST /api/v1/maps/join` */
export const JoinMapRequestSchema = z.object({ code: InviteCodeSchema });
export type JoinMapRequest = z.infer<typeof JoinMapRequestSchema>;

/** `POST /api/v1/maps/:mapId/pvp-mode` */
export const SetPvpModeRequestSchema = z.object({ pvpMode: PvpModeSchema });
export type SetPvpModeRequest = z.infer<typeof SetPvpModeRequestSchema>;

export const MapIdParamsSchema = z.object({ mapId: z.uuid() });
export const JoinRequestParamsSchema = z.object({ mapId: z.uuid(), requestId: z.uuid() });
export const MemberParamsSchema = z.object({ mapId: z.uuid(), userId: z.uuid() });

/** A live invite code, formatted ABCD-EFGH. */
export const InviteSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const MapMemberSchema = z.object({
  user: PublicUserSchema,
  role: MapRoleSchema,
  /** Which home base is theirs (`PublicTile.homeSlot`). */
  homeSlot: z.number().int().nullable(),
  joinedAt: z.iso.datetime(),
  /**
   * Their Keeper and what it wears, so other players see who's who (design
   * doc §23); null if not picked yet.
   */
  keeper: PublicKeeperSchema.nullable(),
  /** The milestone title they wear on their profile card (#44), or null. */
  title: DisplayNameSchema.nullable(),
});
export type MapMember = z.infer<typeof MapMemberSchema>;

/** A pending request, as the owner sees it. */
export const PendingJoinRequestSchema = z.object({
  id: z.uuid(),
  user: PublicUserSchema,
  createdAt: z.iso.datetime(),
});
export type PendingJoinRequest = z.infer<typeof PendingJoinRequestSchema>;

/** One of my maps, for the lobby list. */
export const MapSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: MapRoleSchema,
  owner: PublicUserSchema,
  memberCount: z.number().int(),
  maxPlayers: z.number().int(),
  pvpMode: PvpModeSchema,
  /** Join requests waiting for an answer (#144): the owner's to see; 0 for everyone else. */
  pendingRequests: z.number().int().nonnegative(),
});
export type MapSummary = z.infer<typeof MapSummarySchema>;

/** A request I sent that the owner hasn't answered yet. */
export const MyJoinRequestSchema = z.object({
  id: z.uuid(),
  mapName: z.string(),
  owner: PublicUserSchema,
  createdAt: z.iso.datetime(),
});
export type MyJoinRequest = z.infer<typeof MyJoinRequestSchema>;

/** `GET /api/v1/maps` */
export const MyMapsResponseSchema = z.object({
  maps: z.array(MapSummarySchema),
  requests: z.array(MyJoinRequestSchema),
});
export type MyMapsResponse = z.infer<typeof MyMapsResponseSchema>;

/**
 * One map, as a member sees it. `admin` is only filled in for the owner.
 * Never carries the map seed (tech spec §8).
 */
export const MapDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timeZone: z.string(),
  pvpMode: PvpModeSchema,
  role: MapRoleSchema,
  maxPlayers: z.number().int(),
  members: z.array(MapMemberSchema),
  /**
   * True until the player picks their starter on this patch (owner decision
   * 2026-10-03): the client asks before opening the map.
   */
  needsStarter: z.boolean(),
  /**
   * While `needsStarter`, the starter the pick pre-selects: the player's
   * tutorial Partner (#24, a `STARTERS` species), or null. They can still
   * pick another.
   */
  preselectSpeciesId: ContentIdSchema.nullable(),
  admin: z
    .object({
      invite: InviteSchema.nullable(),
      requests: z.array(PendingJoinRequestSchema),
    })
    .nullable(),
});
export type MapDetail = z.infer<typeof MapDetailSchema>;

/** `POST /maps` (201) and `GET /maps/:mapId` */
export const MapResponseSchema = z.object({ map: MapDetailSchema });
export type MapResponse = z.infer<typeof MapResponseSchema>;

/** `POST /maps/:mapId/invite`: a fresh code (the old one stops working). */
export const InviteResponseSchema = z.object({ invite: InviteSchema });
export type InviteResponse = z.infer<typeof InviteResponseSchema>;

/** `POST /maps/join`: the request now waiting for the owner. */
export const JoinMapResponseSchema = z.object({ request: MyJoinRequestSchema });
export type JoinMapResponse = z.infer<typeof JoinMapResponseSchema>;

/** `POST /maps/:mapId/pvp-mode` */
export const PvpModeResponseSchema = z.object({ pvpMode: PvpModeSchema });
export type PvpModeResponse = z.infer<typeof PvpModeResponseSchema>;

/**
 * `POST /maps/:mapId/members/:userId/reset-password`: shown to the owner once
 * so they can hand them to the player. Never stored in plain text.
 */
export const MemberPasswordResetResponseSchema = z.object({
  user: PublicUserSchema,
  temporaryPassword: z.string(),
  recoveryCode: z.string(),
});
export type MemberPasswordResetResponse = z.infer<typeof MemberPasswordResetResponseSchema>;

/** How hard a neutral tile's guardians are, in three steps (owner decision 10). */
export const GUARDIAN_DIFFICULTIES = ['easy', 'tough', 'very-tough'] as const;
export const GuardianDifficultySchema = z.enum(GUARDIAN_DIFFICULTIES);
export type GuardianDifficulty = z.infer<typeof GuardianDifficultySchema>;

/**
 * A neutral tile's guardians as the tile panel hints at them: how many, a
 * difficulty word, and each one's feeling in team order (#216, owner-approved:
 * a feeling hints a little at a species). Never species, levels, elements,
 * moves or seeds (CLAUDE.md rule 6, tech spec §8). An older server sends no
 * `feelings`, which reads as `[]`.
 */
export const GuardianHintSchema = z
  .object({
    count: z.number().int().min(1),
    difficulty: GuardianDifficultySchema,
    feelings: z.array(FeelingIdSchema).default([]),
  })
  .refine((hint) => hint.feelings.length === 0 || hint.feelings.length === hint.count, {
    message: 'One feeling per guardian',
  });
export type GuardianHint = z.infer<typeof GuardianHintSchema>;

/**
 * One tile as players see it (#7 renders from this). Leaves out guardian
 * strength and anything else that hints at secret spawns (tech spec §8); a
 * neutral tile's guardians show only as `guardianHint`.
 */
export const PublicTileSchema = z.object({
  q: HexSchema.shape.q,
  r: HexSchema.shape.r,
  /** Terrain id from the shared terrain table. */
  terrain: z.string(),
  /** Null = neutral. */
  ownerUserId: z.uuid().nullable(),
  /** Resource id of the tile's node; null = no node. */
  nodeResource: z.string().nullable(),
  /** Set on a home base's tiles: whose slot (`MapMember.homeSlot`) it is. */
  homeSlot: z.number().int().nullable(),
  /**
   * The owner is gathering this tile's node (#17), ready at this time; null
   * when nobody is. What it will yield is only in the owner's own inventory.
   */
  gathering: z.object({ readyAt: z.iso.datetime() }).nullable(),
  /**
   * When the latest battle for this tile stops blocking another (#15, the
   * raid cooldown); null if there's never been one. May be in the past.
   */
  cooldownUntil: z.iso.datetime().nullable(),
  /** How many of the owner's squishies stand watch here (#15). Never which ones. */
  defenders: z.number().int().min(0),
  /**
   * How many of the owner's squishies are gathering here (squishy jobs,
   * owner decisions 2026-10-04): 0 or 1. Never which ones. Optional only so
   * older fixtures parse; the server always sends it.
   */
  workers: z.number().int().min(0).optional(),
  /**
   * Neutral land's guardians today (#15's team for the map-local day), as a
   * count and a difficulty word; null on anyone's land, home bases, and land
   * no table guards. Worked out on read, so it changes with the day.
   */
  guardianHint: GuardianHintSchema.nullable(),
  /**
   * Buildings on a home tile (#18), in spot order: everyone sees fires and
   * habitats. `lit` is as of the view (or the event that carried it).
   */
  buildings: z.array(PublicBuildingSchema),
  /**
   * Fence segments on this tile's edges (#203), in edge order: everyone sees
   * them and how much energy each has left. Optional only so older fixtures
   * parse; the server always sends it.
   */
  fences: z.array(PublicFenceSchema).optional(),
  /**
   * The owner's exploring (#199): `explored` once they've searched every
   * spot (the map's ✨), and the tile's homestead state, `joined` (part of
   * their home) or `paused` (cut off from home; its gathering naps). Null on
   * ordinary land. Optional only so older fixtures parse; the server always
   * sends both.
   */
  explored: z.boolean().optional(),
  homestead: z.enum(['joined', 'paused']).nullable().optional(),
});
export type PublicTile = z.infer<typeof PublicTileSchema>;

/**
 * `GET /api/v1/maps/:mapId/view`: everything needed to draw the map. Never the seed.
 * One consistent snapshot: it holds every event up to `seq` and none after.
 */
export const MapViewSchema = z.object({
  map: z.object({
    id: z.uuid(),
    name: z.string(),
    timeZone: z.string(),
    pvpMode: PvpModeSchema,
    maxPlayers: z.number().int(),
  }),
  members: z.array(MapMemberSchema),
  /** Every tile, sorted by `q` then `r`. */
  tiles: z.array(PublicTileSchema),
  /**
   * The map's latest event seq this view includes (`maps.event_seq`). Live
   * sync subscribes with it as `afterSeq` (tech spec §5 "WebSocket").
   */
  seq: WsSeqSchema,
});
export type MapView = z.infer<typeof MapViewSchema>;
