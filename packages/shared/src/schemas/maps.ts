import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { PublicUserSchema, RECOVERY_CODE_ALPHABET } from './auth.js';
import { PublicBuildingSchema } from './buildings.js';
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

/**
 * One tile as players see it (#7 renders from this). Leaves out guardian
 * strength and anything else that hints at secret spawns (tech spec §8).
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
   * Buildings on a home tile (#18), in spot order: everyone sees fires and
   * habitats. `lit` is as of the view (or the event that carried it).
   */
  buildings: z.array(PublicBuildingSchema),
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
