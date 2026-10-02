import { z } from 'zod';
import { HexSchema } from '../hex/index.js';
import { PvpModeSchema } from './maps.js';
import { BattleEndReasonSchema, BattleKindSchema, BattleSideIdSchema } from './battle.js';

/**
 * The game-event type registry (tech spec §5, §7): every `game_events.type`,
 * with two schemas each.
 *
 * - `internal`: the stored `game_events.payload`. May hold server-only detail.
 *   `appendGameEvent` is typed against it and checks every payload with it.
 * - `public`: what live sync may send to the map's members. The server's
 *   `PUBLIC_VIEWS` (apps/server/src/ws/public-views.ts) is built from it, so
 *   every type here is broadcast through its public schema, never raw.
 *
 * Naming: `noun.verb-ed`, lower case (`member.joined`), matching the WebSocket
 * `type` (tech spec §5). Add a type when a module needs one; keep payloads
 * small (ids and coordinates, not whole rows).
 */
interface GameEventSchemas {
  internal: z.ZodType<Record<string, unknown>>;
  /**
   * A plain `z.object` (not strict, loose or a record): live sync parses the
   * stored payload with it, which strips every undeclared field.
   */
  public: z.ZodObject;
}

const MapSettingsSchema = z.strictObject({ pvpMode: PvpModeSchema });
const DepartedSchema = z.strictObject({
  userId: z.uuid(),
  /** Tiles that went back to neutral (their home base and any land they held). */
  releasedTiles: z.number().int().min(0),
});
const DepartedPublicSchema = z.object(DepartedSchema.shape);
const TutorialAdvancedSchema = z.strictObject({
  completedStepId: z.string(),
  stepId: z.string().nullable(),
});
const BattleStartedSchema = z.strictObject({
  battleId: z.uuid(),
  kind: BattleKindSchema,
  userId: z.uuid(),
  /** The player's team and the other side, by species. */
  teamSpecies: z.array(z.string()),
  opponentSpecies: z.array(z.string()),
});
const BattleEndedSchema = z.strictObject({
  battleId: z.uuid(),
  kind: BattleKindSchema,
  userId: z.uuid(),
  /** The side the player controlled. */
  playerSide: BattleSideIdSchema,
  /** Null when the server ended it as no contest. */
  winner: z.union([BattleSideIdSchema, z.literal('draw')]).nullable(),
  reason: z.union([BattleEndReasonSchema, z.literal('no-contest')]),
  turns: z.number().int().min(0),
  /** Base battle XP granted to the player's squishies (design doc §7). */
  xp: z.array(z.strictObject({ squishyId: z.uuid(), xp: z.number().int().min(0) })),
});

export const GAME_EVENTS = {
  /** A player made a map and is its owner. Always seq 1. */
  'map.created': {
    internal: z.strictObject({
      name: z.string(),
      timeZone: z.string(),
      pvpMode: PvpModeSchema,
      maxPlayers: z.number().int(),
      /** The owner's home slot and Heart Seed tile. */
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
    public: z.object({ name: z.string(), pvpMode: PvpModeSchema }),
  },
  /** The owner changed a map setting. */
  'map.updated': { internal: MapSettingsSchema, public: z.object(MapSettingsSchema.shape) },
  /** The owner approved a join request; the player has a home base now. */
  'member.joined': {
    internal: z.strictObject({
      userId: z.uuid(),
      username: z.string(),
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
    public: z.object({
      userId: z.uuid(),
      username: z.string(),
      homeSlot: z.number().int().min(0),
      heartSeed: HexSchema,
    }),
  },
  /** A member left on their own. */
  'member.left': { internal: DepartedSchema, public: DepartedPublicSchema },
  /** The owner removed a member. */
  'member.removed': { internal: DepartedSchema, public: DepartedPublicSchema },
  /**
   * Tutorial maps only: the player tapped through a talk-only step (Sprout's
   * welcome, graduation). The step engine completes such a step on it.
   */
  'tutorial.acknowledged': {
    internal: z.strictObject({ stepId: z.string() }),
    public: z.object({ stepId: z.string() }),
  },
  /**
   * Tutorial maps only, written by the step engine (a system event): the
   * player finished `completedStepId`. `stepId` is the new current step, or
   * null when the tutorial is done.
   */
  'tutorial.advanced': {
    internal: TutorialAdvancedSchema,
    public: z.object(TutorialAdvancedSchema.shape),
  },
  /**
   * A player started a PvE battle on this map (#13). The species stay in the
   * internal payload: a secret one would otherwise reach members who never
   * met it (CLAUDE.md rule 6).
   */
  'battle.started': {
    internal: BattleStartedSchema,
    public: z.object({ battleId: z.uuid(), kind: BattleKindSchema, userId: z.uuid() }),
  },
  /**
   * A battle ended: won, lost, drawn, run away from, or called off by the
   * server (`no-contest`, when the content was re-tuned mid-battle).
   */
  'battle.ended': { internal: BattleEndedSchema, public: z.object(BattleEndedSchema.shape) },
  /**
   * A player started gathering a node they own (#17): members see "gathering
   * here, ready at …" on the tile. What it will yield stays internal.
   */
  'gather.started': {
    internal: z.strictObject({
      gatherId: z.uuid(),
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
      readyAt: z.iso.datetime(),
    }),
    public: z.object({
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      readyAt: z.iso.datetime(),
    }),
  },
  /**
   * A player collected a finished gather on a node they own (#17). Members
   * see where (the tile's "gathering here" ends); how much stays internal.
   */
  'resource.gathered': {
    internal: z.strictObject({
      gatherId: z.uuid(),
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({
      userId: z.uuid(),
      q: z.number().int(),
      r: z.number().int(),
      resource: z.string(),
    }),
  },
  /** A player collected a finished craft into their bag (#17). */
  'item.crafted': {
    internal: z.strictObject({
      craftId: z.uuid(),
      userId: z.uuid(),
      recipeId: z.string(),
      items: z.record(z.string(), z.number().int().min(1)),
    }),
    public: z.object({ userId: z.uuid(), recipeId: z.string() }),
  },
} satisfies Record<string, GameEventSchemas>;

export type GameEventType = keyof typeof GAME_EVENTS;
export type GameEventPayload<T extends GameEventType> = z.infer<
  (typeof GAME_EVENTS)[T]['internal']
>;
export type PublicGameEventPayload<T extends GameEventType> = z.infer<
  (typeof GAME_EVENTS)[T]['public']
>;

/** Every registered event type: the one list (live sync and consumers use it). */
export const GAME_EVENT_TYPES = Object.keys(GAME_EVENTS) as [GameEventType, ...GameEventType[]];

export const GameEventTypeSchema = z.enum(GAME_EVENT_TYPES);

export function isGameEventType(type: string): type is GameEventType {
  return Object.hasOwn(GAME_EVENTS, type);
}

/** Checks a stored (internal) payload against its type; throws on a mismatch. */
export function parseGameEventPayload<T extends GameEventType>(
  type: T,
  payload: unknown,
): GameEventPayload<T> {
  return GAME_EVENTS[type].internal.parse(payload) as GameEventPayload<T>;
}
