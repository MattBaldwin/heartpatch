import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { ElementIdSchema } from './elements.js';

/*
 * The Crooked House (#306 6b, owner decision 8 of 2026-10-23): Halloween
 * 2026's far Hollow, a fixed house of rooms and doors whose details (which
 * thing hides which key, each echo's phase, the bonus chests) shuffle per
 * patch and season (the server-only secrets). Rule 5: adding a
 * room, a thing or an echo loop is a data edit; the engine never names a
 * room. State is bitmasks over these lists' order (`far_hollow_state`,
 * `far_hollow_rooms`), so an id or an order never changes once shipped.
 */

/** Bitmask columns are Postgres `integer`: 31 usable bits. */
export const CROOKED_HOUSE_MAX_BITS = 31;

/** A wall of a room (x east, z north). */
export const CrookedSideSchema = z.enum(['n', 's', 'e', 'w']);
export type CrookedSide = z.infer<typeof CrookedSideSchema>;

/**
 * How a crooked thing is put right (the design's touch interactions, each
 * with a button): drag to straighten, hold to lift, stroke to dust, tap to
 * a rhythm, or a Relight board (#306 6f).
 */
export const CrookedThingKindSchema = z.enum([
  'straighten',
  'lift',
  'rub',
  'tap-rhythm',
  'relight',
]);
export type CrookedThingKind = z.infer<typeof CrookedThingKindSchema>;

/** A point in a room, metres from its centre (x east, z north). */
const RoomPointSchema = z.tuple([z.number(), z.number()]);

export const CrookedThingSchema = z.strictObject({
  id: ContentIdSchema,
  /** The action button names it: "Straighten the picture". */
  name: DisplayNameSchema,
  kind: CrookedThingKindSchema,
  /** The kit prop the client draws (6c). */
  prop: ContentIdSchema,
  at: RoomPointSchema,
  /** A Relight thing's board size (`MEMORY_PUZZLES.relight` tier, owner decision 5). */
  puzzle: z.enum(['rim', 'inner', 'heart']).optional(),
});
export type CrookedThing = z.infer<typeof CrookedThingSchema>;

export const CrookedRoomSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /** 0 ground, 1 upstairs, 2 the attic. */
  floor: z.number().int().min(0).max(2),
  /**
   * `main` rooms bloom when their things are put right (each one a story
   * scrap); a `bonus` room sits behind a power door and holds a chest; the
   * `attic` holds the big chest.
   */
  kind: z.enum(['main', 'bonus', 'attic']),
  /** Where it stands on its floor, metres (x east, z north), and its size. */
  box: z.strictObject({
    x: z.number(),
    z: z.number(),
    w: z.number().positive(),
    d: z.number().positive(),
  }),
  /** Wallpaper and floor colours once it's lit (it's grey until then). */
  look: z.strictObject({
    paper: z.string().regex(/^#[0-9a-f]{6}$/),
    floor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .optional(),
  }),
  /** Its crooked things, in bit order (`far_hollow_rooms.fixed`). */
  things: z.array(CrookedThingSchema).max(CROOKED_HOUSE_MAX_BITS),
  /** Its lamp, which lights for good when it blooms. */
  lamp: RoomPointSchema.nullable(),
});
export type CrookedRoom = z.infer<typeof CrookedRoomSchema>;

/** One side of a door: the room, its wall and where along it (metres from the wall's middle). */
const DoorSideSchema = z.strictObject({
  room: ContentIdSchema,
  side: CrookedSideSchema,
  at: z.number(),
});

/**
 * A door between two rooms. Locked by a key (opened by `unlock` once the
 * key is found), or by a power (a bonus door: a squishy of `power` on the
 * battle team opens it), or neither.
 */
export const CrookedDoorSchema = z.strictObject({
  id: ContentIdSchema,
  a: DoorSideSchema,
  b: DoorSideSchema,
  key: ContentIdSchema.optional(),
  power: ElementIdSchema.optional(),
  /** What the sleeping thing is called on a power door ("the cold fireplace"). */
  sleeper: DisplayNameSchema.optional(),
});
export type CrookedDoor = z.infer<typeof CrookedDoorSchema>;

export const CrookedKeySchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /**
   * The rooms whose things may hide it (the season's seed picks one thing),
   * each reachable with only the keys before it in the chain: never a dead end.
   */
  hidesIn: z.array(ContentIdSchema).min(1),
});
export type CrookedKey = z.infer<typeof CrookedKeySchema>;

/**
 * An echo's loop through dark rooms (the client draws it, the server checks
 * it, both from `echoAt`). It drifts from room to room in order and back to
 * the first, one lap a `period`; it catches a Keeper who steps into a dark
 * room it is within `reach` of (in rooms; tiptoe halves it).
 */
export const EchoLoopSchema = z.strictObject({
  id: ContentIdSchema,
  rooms: z.array(ContentIdSchema).min(2),
  periodSeconds: z.number().int().min(4),
  reach: z.number().gt(0).max(0.5),
});
export type EchoLoop = z.infer<typeof EchoLoopSchema>;

export const CrookedHouseSchema = z
  .strictObject({
    name: DisplayNameSchema,
    /** Where a Keeper comes in: lit from the start, the first "last lit room". */
    start: ContentIdSchema,
    rooms: z.array(CrookedRoomSchema).min(2).max(CROOKED_HOUSE_MAX_BITS),
    doors: z.array(CrookedDoorSchema).min(1).max(CROOKED_HOUSE_MAX_BITS),
    /** The key chain, in order: each key opens rooms the next one may hide in. */
    keys: z.array(CrookedKeySchema).min(1).max(CROOKED_HOUSE_MAX_BITS),
    echoLoops: z.array(EchoLoopSchema),
  })
  .superRefine((house, ctx) => {
    const issue = (message: string) => {
      ctx.addIssue({ code: 'custom', message });
    };
    const rooms = new Map(house.rooms.map((r) => [r.id, r]));
    const keyIds = new Set(house.keys.map((k) => k.id));
    const unique = (what: string, ids: readonly string[]) => {
      if (new Set(ids).size !== ids.length) issue(`duplicate ${what} id`);
    };
    unique(
      'room',
      house.rooms.map((r) => r.id),
    );
    unique(
      'door',
      house.doors.map((d) => d.id),
    );
    unique(
      'key',
      house.keys.map((k) => k.id),
    );
    unique(
      'echo loop',
      house.echoLoops.map((l) => l.id),
    );
    for (const room of house.rooms)
      unique(
        `${room.id} thing`,
        room.things.map((t) => t.id),
      );
    const start = rooms.get(house.start);
    if (!start || start.kind !== 'main') issue(`start "${house.start}" must be a main room`);
    if (house.rooms.filter((r) => r.kind === 'attic').length !== 1) issue('exactly one attic');
    for (const room of house.rooms) {
      if (room.kind !== 'main' && room.things.length > 0) issue(`${room.id} has things`);
      for (const thing of room.things) {
        if ((thing.kind === 'relight') !== (thing.puzzle !== undefined)) {
          issue(`${room.id}/${thing.id}: a relight thing (only) has a puzzle size`);
        }
      }
    }
    for (const door of house.doors) {
      for (const side of [door.a, door.b]) {
        if (!rooms.has(side.room)) issue(`door ${door.id}: unknown room "${side.room}"`);
      }
      if (door.a.room === door.b.room) issue(`door ${door.id} leads nowhere`);
      if (door.key !== undefined && door.power !== undefined) issue(`door ${door.id}: two locks`);
      if (door.key !== undefined && !keyIds.has(door.key)) issue(`door ${door.id}: unknown key`);
      if ((door.power !== undefined) !== (door.sleeper !== undefined)) {
        issue(`door ${door.id}: a power door (only) has a sleeper`);
      }
      const into = [rooms.get(door.a.room), rooms.get(door.b.room)];
      if (into.some((r) => r?.kind === 'bonus') && door.power === undefined) {
        issue(`door ${door.id}: a bonus room is behind a power door`);
      }
    }
    for (const key of house.keys) {
      if (!house.doors.some((d) => d.key === key.id)) issue(`key ${key.id} opens nothing`);
      for (const id of key.hidesIn) {
        const room = rooms.get(id);
        if (!room?.things.some((t) => t.kind !== 'relight')) {
          issue(`key ${key.id}: "${id}" has nothing to hide it in`);
        }
      }
    }
    for (const loop of house.echoLoops) {
      for (const id of loop.rooms) {
        if (rooms.get(id)?.kind !== 'main' || id === house.start) {
          issue(`echo ${loop.id}: "${id}" isn't a dark main room`);
        }
      }
    }
  });
export type CrookedHouse = z.infer<typeof CrookedHouseSchema>;
