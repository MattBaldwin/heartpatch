import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './data/common.js';
import { HouseExteriorSchema, HouseRoomLayoutSchema, HouseRoomLookSchema } from './data/house.js';
import { RequirementProgressSchema } from './data/requirements.js';
import { ItemCountsSchema } from './inventory.js';
import { LocalDateSchema } from './time.js';

/*
 * The Keeper's house API (#381 plan §7). Patch-scoped and member-only under
 * `/api/v1/maps/:mapId/house`, behind the `HP_HOUSE` switch: while it is off
 * for a player every house route is NOT_FOUND and `HomeResponse.house` is
 * left out, so the client draws no house at all.
 */

/** Why a resident isn't in its room right now. */
export const ResidentAwaySchema = z.enum([
  'gathering',
  'guarding',
  'training',
  'hollow',
  'in-trade',
]);
export type ResidentAway = z.infer<typeof ResidentAwaySchema>;

export const HouseResidentSchema = z.object({
  squishyId: z.uuid(),
  since: z.iso.datetime(),
  away: ResidentAwaySchema.nullable(),
});
export type HouseResident = z.infer<typeof HouseResidentSchema>;

export const HouseRoomViewSchema = z.object({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  beds: z.number().int().min(1),
  look: HouseRoomLookSchema,
  layout: HouseRoomLayoutSchema,
  /** The level that added it. */
  level: z.number().int().min(1),
  residents: z.array(HouseResidentSchema),
});
export type HouseRoomView = z.infer<typeof HouseRoomViewSchema>;

/** The next level: what it adds, what it needs and what it costs. */
export const HouseNextLevelSchema = z.object({
  level: z.number().int().min(2),
  name: DisplayNameSchema,
  room: z.object({ id: ContentIdSchema, name: DisplayNameSchema, beds: z.number().int().min(1) }),
  final: z.boolean(),
  requirements: z.array(RequirementProgressSchema),
  cost: ItemCountsSchema,
  /** Every requirement holds (checked again when building). */
  unlocked: z.boolean(),
  /** The bag covers the cost. */
  affordable: z.boolean(),
});
export type HouseNextLevel = z.infer<typeof HouseNextLevelSchema>;

/**
 * Today's gift (#381 PR H): what a resident left the Keeper, rolled on the
 * server on the first `GET /house` of the patch day, and whether it's been
 * opened. `giverSquishyId` is null once the giver is gone from the patch; a
 * giver traded away since still counts as who left it, and the gift is still
 * the Keeper's to open. `note` is the rendered line, the giver's name in it.
 */
export const HouseGiftSchema = z.object({
  /** The patch's local day it belongs to. */
  day: LocalDateSchema,
  giverSquishyId: z.uuid().nullable(),
  itemId: ContentIdSchema,
  count: z.number().int().min(1),
  note: z.string().min(1),
  claimed: z.boolean(),
});
export type HouseGift = z.infer<typeof HouseGiftSchema>;

/** `GET /maps/:mapId/house`, and later the reply to every house command. */
export const HouseViewSchema = z.object({
  level: z.number().int().min(1),
  levelName: DisplayNameSchema,
  exterior: HouseExteriorSchema,
  /** The top level is built: the gold look. */
  final: z.boolean(),
  rooms: z.array(HouseRoomViewSchema),
  next: HouseNextLevelSchema.nullable(),
  /** My bag, for the cost line. */
  items: ItemCountsSchema,
  /** Today's gift, or null when there's none (no resident home; older servers). */
  gift: HouseGiftSchema.nullable().default(null),
  now: z.iso.datetime(),
});
export type HouseView = z.infer<typeof HouseViewSchema>;

/**
 * The house as the home screen needs it (`HomeResponse.house`): only its
 * level. Left out while the house is switched off for the player, and by
 * older servers.
 */
export const HomeHouseSchema = z.object({ level: z.number().int().min(1) });
export type HomeHouse = z.infer<typeof HomeHouseSchema>;

/** `POST /maps/:mapId/house/build`: build the next level (it must be the next one). */
export const BuildHouseRequestSchema = z.strictObject({
  toLevel: z.number().int().min(2),
});
export type BuildHouseRequest = z.infer<typeof BuildHouseRequestSchema>;

/**
 * `POST /maps/:mapId/house/residents`: move one of my squishies into a room
 * of my house, into another room, or out (`roomId: null`). Replies with the
 * `HouseView`.
 */
export const MoveResidentRequestSchema = z.strictObject({
  squishyId: z.uuid(),
  roomId: ContentIdSchema.nullable(),
});
export type MoveResidentRequest = z.infer<typeof MoveResidentRequestSchema>;
