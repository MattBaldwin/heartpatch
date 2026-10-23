import { z } from 'zod';
import { ContentIdSchema } from './data/common.js';
import { LocalDateSchema } from './data/seasons.js';
import { ExploreNotableSchema } from './events.js';
import { ItemCountsSchema } from './inventory.js';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7): each kid's own
// place, fresh every season, reached by the far road from any trading post.
// Halloween 2026's is the Crooked House (#306 6b): `house` is my progress
// through it, and its commands are `fix`, `enter`, `unlock`, `power` and
// `chest`. The house itself is `CROOKED_HOUSE`; ids are its rooms, things,
// doors, keys and echo loops.

/** A season as the far Hollow names it. */
const FarHollowSeasonSchema = z.object({ id: ContentIdSchema, name: z.string() });

/** An echo this season: where it starts on its loop and which way it goes (`echoAt`). */
export const CrookedEchoSchema = z.object({
  loop: ContentIdSchema,
  offset: z.number().min(0).max(1),
  direction: z.union([z.literal(1), z.literal(-1)]),
});

/** A room's progress: the things put right, and whether it has bloomed (lit for good). */
export const CrookedRoomViewSchema = z.object({
  id: ContentIdSchema,
  fixed: z.array(ContentIdSchema),
  bloomed: z.boolean(),
});

/**
 * My Crooked House this season (#306 6b). `room` is where I stand (the
 * start at first) and `lastLitRoom` where a catch or a reload takes me back
 * to. Keys found, doors unlocked, power doors opened and chests opened are
 * by id. `serverTime` lets the client draw the echoes on the server's clock.
 */
export const CrookedHouseViewSchema = z.object({
  room: ContentIdSchema,
  lastLitRoom: ContentIdSchema,
  keys: z.array(ContentIdSchema),
  unlocked: z.array(ContentIdSchema),
  bonusOpen: z.array(ContentIdSchema),
  chestsOpened: z.array(ContentIdSchema),
  /** Every main room, in the data's order. */
  rooms: z.array(CrookedRoomViewSchema),
  echoes: z.array(CrookedEchoSchema),
  serverTime: z.iso.datetime(),
});
export type CrookedHouseView = z.infer<typeof CrookedHouseViewSchema>;

/**
 * `GET /maps/:mapId/far-hollow`: my far Hollow this season. `arrived` once
 * I've won the far road this season; `completedAt` once I've brought it all
 * back this season. A new season brings a new one (`nextSeason`).
 */
export const FarHollowViewSchema = z.object({
  name: z.string(),
  season: FarHollowSeasonSchema,
  arrived: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  /** When a fresh far Hollow comes: the next season's first day, map-local. */
  nextSeason: FarHollowSeasonSchema.extend({ startsOn: LocalDateSchema }).nullable(),
  /** The far road's trail, as a journey preview shows it. */
  road: z.object({
    distance: z.number().int().min(1),
    level: z.number().int().min(1),
    teamSize: z.number().int().min(1),
  }),
  /** My Crooked House, once I've arrived this season (#306 6b). */
  house: CrookedHouseViewSchema.nullable(),
});
export type FarHollowView = z.infer<typeof FarHollowViewSchema>;

/** What a bloom or a chest gave: items, maybe a lore page and a piece of clothing. */
export const CrookedFindSchema = z.object({
  found: ItemCountsSchema,
  lore: z.object({ id: ContentIdSchema, title: z.string() }).nullable(),
  clothing: ContentIdSchema.nullable(),
  notable: ExploreNotableSchema.nullable(),
  /** XP each team squishy got. */
  xp: z.array(z.object({ squishyId: z.uuid(), xp: z.number().int().min(0) })),
});
export type CrookedFind = z.infer<typeof CrookedFindSchema>;

/** `POST /maps/:mapId/far-hollow/fix`: put a crooked thing right in the room I'm in. */
export const CrookedFixRequestSchema = z.strictObject({ room: ContentIdSchema, thing: ContentIdSchema });
export type CrookedFixRequest = z.infer<typeof CrookedFixRequestSchema>;

export const CrookedFixResponseSchema = z.object({
  view: FarHollowViewSchema,
  /** The key it hid, if it hid one. */
  key: z.object({ id: ContentIdSchema, name: z.string() }).nullable(),
  /** The room's last thing: it bloomed, and this is what it gave. */
  bloom: CrookedFindSchema.nullable(),
});
export type CrookedFixResponse = z.infer<typeof CrookedFixResponseSchema>;

/**
 * `POST /maps/:mapId/far-hollow/enter`: step into a room through an open
 * door from the room I'm in, or straight to a lit room I can reach (the
 * dollhouse map). Stepping into a dark room checks the echoes on the
 * server's clock; `tiptoe` halves their reach (owner decision 2).
 */
export const CrookedEnterRequestSchema = z.strictObject({
  room: ContentIdSchema,
  tiptoe: z.boolean().default(false),
});
export type CrookedEnterRequest = z.infer<typeof CrookedEnterRequestSchema>;

export const CrookedEnterResponseSchema = z.object({
  view: FarHollowViewSchema,
  /** Peekaboo! The echo that caught me, and the lit room I'm back in. Nothing is lost. */
  caught: z.object({ echo: ContentIdSchema, backTo: ContentIdSchema }).nullable(),
});
export type CrookedEnterResponse = z.infer<typeof CrookedEnterResponseSchema>;

/** `POST /maps/:mapId/far-hollow/unlock`: turn a found key in a door of the room I'm in. */
export const CrookedUnlockRequestSchema = z.strictObject({ door: ContentIdSchema });
export type CrookedUnlockRequest = z.infer<typeof CrookedUnlockRequestSchema>;

/**
 * `POST /maps/:mapId/far-hollow/power`: a squishy on my battle team of the
 * door's element opens a power door of the room I'm in (owner decision 7:
 * any level, free, every time).
 */
export const CrookedPowerRequestSchema = z.strictObject({
  door: ContentIdSchema,
  squishyId: z.uuid(),
});
export type CrookedPowerRequest = z.infer<typeof CrookedPowerRequestSchema>;

/** The view after a command that only changes progress (`unlock`, `power`). */
export const CrookedViewResponseSchema = z.object({ view: FarHollowViewSchema });
export type CrookedViewResponse = z.infer<typeof CrookedViewResponseSchema>;

/** `POST /maps/:mapId/far-hollow/chest`: open the chest of the bonus room or attic I'm in. */
export const CrookedChestRequestSchema = z.strictObject({ room: ContentIdSchema });
export type CrookedChestRequest = z.infer<typeof CrookedChestRequestSchema>;

export const CrookedChestResponseSchema = z.object({
  view: FarHollowViewSchema,
  find: CrookedFindSchema,
  /**
   * A bonus chest's rare friend (owner decision 6): a wild battle has
   * started against it, where a Heart Charm can befriend it.
   */
  friend: z.object({ speciesId: ContentIdSchema, battleId: z.uuid() }).nullable(),
  /** The attic's chest: the far Hollow is all put right this season. */
  completed: z.boolean(),
});
export type CrookedChestResponse = z.infer<typeof CrookedChestResponseSchema>;

/**
 * Dev only: `POST /maps/:mapId/dev/far-hollow`. Arrives without the far
 * road; `room` jumps there with every key door it needs open; `nearlyDone`
 * puts the whole house right but one thing (in `room`, or the last main
 * room), so one fix and the attic finish it.
 */
export const DevFarHollowRequestSchema = z.strictObject({
  room: ContentIdSchema.optional(),
  nearlyDone: z.boolean().optional(),
});
export type DevFarHollowRequest = z.infer<typeof DevFarHollowRequestSchema>;
