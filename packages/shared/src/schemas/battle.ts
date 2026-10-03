import { z } from 'zod';
import { SeedSchema } from '../rng/index.js';
import { BattleAiPolicySchema } from './data/battle.js';
import { ContentIdSchema } from './data/common.js';
import { BattleStatSchema, MoveSchema } from './data/moves.js';
import { SpeciesSchema } from './data/species.js';
import { ElementIdSchema, FeelingIdSchema } from './data/elements.js';

/**
 * Battle inputs (design doc §6): the setup a battle starts from and the
 * actions that move it along. Setup + actions is the replay record.
 */

export const BattleSideIdSchema = z.enum(['a', 'b']);
export type BattleSideId = z.infer<typeof BattleSideIdSchema>;

const battleStat = z.number().int().min(1).max(9999);

/** A squishy's stats at its level; `hp` is its full energy bar. */
export const BattleStatsSchema = z.strictObject({
  hp: battleStat,
  attack: battleStat,
  defense: battleStat,
  speed: battleStat,
});
export type BattleStats = z.infer<typeof BattleStatsSchema>;

export const BattleSquishySetupSchema = z.strictObject({
  /** The squishy instance id; unique within the battle. */
  id: z.string().min(1).max(64),
  speciesId: ContentIdSchema,
  level: z.number().int().min(1).max(100),
  /** The instance's element and feeling; default to the species'. */
  element: ElementIdSchema.optional(),
  feeling: FeelingIdSchema.optional(),
  /**
   * The instance's stats (with its small individual variance). Computed from
   * the species' base stats and level when left out.
   */
  stats: BattleStatsSchema.optional(),
});
export type BattleSquishySetup = z.infer<typeof BattleSquishySetupSchema>;

/** A player picks this side's actions, or an AI policy does. */
export const BattleControllerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('player') }),
  z.strictObject({ type: z.literal('ai'), policy: BattleAiPolicySchema }),
]);
export type BattleController = z.infer<typeof BattleControllerSchema>;

export const BattleSideSetupSchema = z.strictObject({
  controller: BattleControllerSchema,
  /** The first squishy starts out. The team size limit is in battle rules. */
  squishies: z.array(BattleSquishySetupSchema).min(1),
});
export type BattleSideSetup = z.infer<typeof BattleSideSetupSchema>;

export const BattleSetupSchema = z
  .strictObject({
    seed: SeedSchema,
    sides: z.strictObject({ a: BattleSideSetupSchema, b: BattleSideSetupSchema }),
  })
  .superRefine((setup, ctx) => {
    const seen = new Set<string>();
    for (const side of BattleSideIdSchema.options) {
      setup.sides[side].squishies.forEach((s, i) => {
        if (seen.has(s.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sides', side, 'squishies', i, 'id'],
            message: `squishy "${s.id}" is in the battle twice`,
          });
        }
        seen.add(s.id);
      });
    }
  });
export type BattleSetup = z.infer<typeof BattleSetupSchema>;

/** Team slot index (0 is the first squishy listed). */
const SlotSchema = z.number().int().min(0).max(5);

/**
 * What one side does this turn: use one of its moves, swap (costs the turn),
 * or offer a Heart Charm to the other side's squishy (`capture`, #14; costs
 * the turn too). Only a player side can capture, and only from an AI side.
 * `sure` makes it always work (the tutorial's first capture, design doc §26);
 * the server sets it, never the client.
 */
export const BattleChoiceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), move: ContentIdSchema }),
  z.strictObject({ type: z.literal('swap'), slot: SlotSchema }),
  z.strictObject({ type: z.literal('capture'), sure: z.literal(true).optional() }),
]);
export type BattleChoice = z.infer<typeof BattleChoiceSchema>;

/**
 * - `turn`: both sides' choices; AI-controlled sides must be left out (the
 *   engine picks for them with the battle's seeded RNG).
 * - `replace`: a player picks who comes out after a squishy is tuckered out.
 *   Free; doesn't cost a turn.
 * - `forfeit`: a side gives up (running away from a wild squishy).
 */
export const BattleActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('turn'),
    choices: z.strictObject({
      a: BattleChoiceSchema.optional(),
      b: BattleChoiceSchema.optional(),
    }),
  }),
  z.strictObject({ type: z.literal('replace'), side: BattleSideIdSchema, slot: SlotSchema }),
  z.strictObject({ type: z.literal('forfeit'), side: BattleSideIdSchema }),
]);
export type BattleAction = z.infer<typeof BattleActionSchema>;

// ── What players see (#13) ─────────────────────────────────────────────────
//
// The server keeps `BattleState` (with the RNG state) and sends
// `clientBattleView(state)`: everything but `rng` (DECISIONS "Battle engine
// (#11)"). These schemas describe that view, so the API checks every reply
// against them and a stray `rng` or `seed` can never slip out, and the client
// validates what it draws. `packages/shared/src/schemas/battle.test.ts` pins
// them to the engine's types.

export const BattleStatusIdSchema = z.enum(['dizzy', 'sleepy']);

const stage = z.number().int().min(-6).max(6);

/** One squishy in a battle, as the engine tracks it (`BattleSquishy`). */
export const BattleSquishyViewSchema = z.object({
  id: z.string().min(1).max(64),
  speciesId: ContentIdSchema,
  level: z.number().int().min(1).max(100),
  element: ElementIdSchema,
  feeling: FeelingIdSchema,
  stats: BattleStatsSchema,
  moves: z.array(ContentIdSchema),
  /** Current energy; 0 means tuckered out. */
  energy: z.number().int().min(0),
  stages: z.object({ attack: stage, defense: stage, speed: stage }),
  status: z.object({ id: BattleStatusIdSchema, turnsLeft: z.number().int().min(0) }).nullable(),
  joined: z.boolean(),
});
export type BattleSquishyView = z.infer<typeof BattleSquishyViewSchema>;

export const BattleSideViewSchema = z.object({
  controller: BattleControllerSchema,
  squishies: z.array(BattleSquishyViewSchema).min(1),
  active: z.number().int().min(0),
});
export type BattleSideView = z.infer<typeof BattleSideViewSchema>;

/** `BattleEndReason` (battle/state.ts) as a schema. */
export const BattleEndReasonSchema = z.enum(['tuckered-out', 'forfeit', 'turn-limit', 'captured']);

const WinnerSchema = z.union([BattleSideIdSchema, z.literal('draw')]);

export const BattleXpAwardSchema = z.object({
  side: BattleSideIdSchema,
  squishyId: z.string(),
  xp: z.number().int().min(0),
});

export const BattleResultSchema = z.object({
  winner: WinnerSchema,
  reason: BattleEndReasonSchema,
  contentHash: z.string(),
  turns: z.number().int().min(0),
  xp: z.array(BattleXpAwardSchema),
});
export type BattleResultView = z.infer<typeof BattleResultSchema>;

export const BattlePhaseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn') }),
  z.object({ type: z.literal('replace'), sides: z.array(BattleSideIdSchema) }),
  z.object({ type: z.literal('over'), result: BattleResultSchema }),
]);
export type BattlePhaseView = z.infer<typeof BattlePhaseSchema>;

const at = { turn: z.number().int().min(0), side: BattleSideIdSchema, slot: SlotSchema };

/** The resolved log, one entry per thing that happened (`BattleEvent`). */
export const BattleEventSchema = z.discriminatedUnion('type', [
  z.object({ ...at, type: z.literal('swap'), to: SlotSchema }),
  z.object({ ...at, type: z.literal('replace') }),
  z.object({ ...at, type: z.literal('move'), move: ContentIdSchema }),
  z.object({ ...at, type: z.literal('miss'), move: ContentIdSchema }),
  z.object({
    ...at,
    type: z.literal('hit'),
    amount: z.number().int().min(0),
    energy: z.number().int().min(0),
    effectiveness: ContentIdSchema,
  }),
  z.object({
    ...at,
    type: z.literal('heal'),
    amount: z.number().int().min(0),
    energy: z.number().int().min(0),
  }),
  z.object({
    ...at,
    type: z.literal('stat-change'),
    stat: BattleStatSchema,
    stages: z.number().int(),
    total: stage,
  }),
  z.object({ ...at, type: z.literal('status-start'), status: BattleStatusIdSchema }),
  z.object({ ...at, type: z.literal('status-skip'), status: BattleStatusIdSchema }),
  z.object({ ...at, type: z.literal('status-end'), status: BattleStatusIdSchema }),
  z.object({ ...at, type: z.literal('tuckered-out') }),
  z.object({ ...at, type: z.literal('capture'), caught: z.boolean() }),
  z.object({ turn: at.turn, type: z.literal('forfeit'), side: BattleSideIdSchema }),
  z.object({
    turn: at.turn,
    type: z.literal('battle-end'),
    winner: WinnerSchema,
    reason: BattleEndReasonSchema,
  }),
]);
export type BattleEventView = z.infer<typeof BattleEventSchema>;

/**
 * `clientBattleView(state)`: the battle without its RNG state. The seed isn't
 * here either; it is only revealed once the battle is over (`PlayerBattle.seed`).
 */
export const ClientBattleViewSchema = z.object({
  version: z.literal(1),
  contentHash: z.string(),
  turn: z.number().int().min(0),
  sides: z.object({ a: BattleSideViewSchema, b: BattleSideViewSchema }),
  phase: BattlePhaseSchema,
  log: z.array(BattleEventSchema),
});

/** `active`: being played. `no-contest`: ended by the server (content re-tuned mid-battle). */
export const BattleStatusSchema = z.enum(['active', 'finished', 'no-contest']);
export type BattleStatus = z.infer<typeof BattleStatusSchema>;

/**
 * Kinds of battle: a wild squishy (#14), a neutral tile's guardians (`tile`,
 * #15), another player's defenders (`rival-tile`, #15) and the Hollow's
 * shadow guardians (`rescue`, #21). Tile battles use one of the player's
 * daily attempts; rescues never cost one (decision C).
 */
export const BattleKindSchema = z.enum(['wild', 'tile', 'rival-tile', 'rescue']);
export type BattleKind = z.infer<typeof BattleKindSchema>;

/** Kinds that battle for a tile (#15): they use an attempt, and leaving counts as a loss. */
export const TILE_BATTLE_KINDS: ReadonlySet<BattleKind> = new Set(['tile', 'rival-tile']);

/**
 * Kinds whose squishy can be befriended with a Heart Charm (#14): wild ones,
 * never tile guardians (#15) or another player's.
 */
export const CAPTURABLE_BATTLE_KINDS: ReadonlySet<BattleKind> = new Set(['wild']);

/**
 * A battle as its player sees it (`GET /battles/:battleId`). `speciesDefs` and
 * `moveDefs` carry rows the public data tables don't have (a secret species
 * the player just met), so the client can draw and name every squishy here.
 * `seed` is null while the battle is going (tech spec §8).
 */
/**
 * What a finished battle gave the player's squishies, as the server granted
 * it: the engine's base XP × the battle's `percent` (100, or Gentle's 50 for
 * challenging a much smaller player: owner decision 2026-10-03), then × each
 * squishy's care and habitat multiplier (#19). The same numbers as
 * `battle.ended.xp`.
 */
export const BattleRewardsSchema = z.object({
  xp: z.array(z.object({ squishyId: z.uuid(), xp: z.number().int().min(0) })),
  /** The share of the battle's XP it paid, in percent (Gentle mode, design doc §11). */
  percent: z.number().int().min(0).max(100),
});
export type BattleRewards = z.infer<typeof BattleRewardsSchema>;

export const PlayerBattleSchema = z.object({
  id: z.uuid(),
  mapId: z.uuid(),
  kind: BattleKindSchema,
  status: BattleStatusSchema,
  /** The side the player controls. */
  mySide: BattleSideIdSchema,
  view: ClientBattleViewSchema,
  speciesDefs: z.array(SpeciesSchema),
  moveDefs: z.array(MoveSchema),
  seed: SeedSchema.nullable(),
  /**
   * What the battle granted the player's squishies. Null while it runs,
   * after no contest, on the defender's replay of a challenge (#16), and for
   * battles that ended before rewards were stored (the view's base XP is all
   * there is then).
   */
  rewards: BattleRewardsSchema.nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type PlayerBattle = z.infer<typeof PlayerBattleSchema>;

export const BattleResponseSchema = z.object({ battle: PlayerBattleSchema });
export type BattleResponse = z.infer<typeof BattleResponseSchema>;

/** `GET /maps/:mapId/battles/current`: the battle to resume, or null. */
export const CurrentBattleResponseSchema = z.object({ battle: PlayerBattleSchema.nullable() });
export type CurrentBattleResponse = z.infer<typeof CurrentBattleResponseSchema>;

export const BattleIdParamsSchema = z.object({ battleId: z.uuid() });

/**
 * What a player can do (`POST /battles/:battleId/actions`). The server turns
 * it into the engine's `BattleAction` for the player's side, so a client can
 * never act for the other side.
 */
export const PlayerBattleActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), move: ContentIdSchema }),
  z.strictObject({ type: z.literal('swap'), slot: SlotSchema }),
  z.strictObject({ type: z.literal('replace'), slot: SlotSchema }),
  z.strictObject({ type: z.literal('forfeit') }),
  /** Use a Heart Charm on the wild squishy (wild battles only; costs one charm). */
  z.strictObject({ type: z.literal('capture') }),
]);
export type PlayerBattleAction = z.infer<typeof PlayerBattleActionSchema>;

export const BattleActionRequestSchema = z.strictObject({
  action: PlayerBattleActionSchema,
  /**
   * The `view.turn` the client acted on. A stale or repeated submit (the
   * battle has moved on) is refused instead of applied to the next turn; the
   * `Idempotency-Key` header makes a retry of the same submit safe.
   */
  turn: z.number().int().min(0),
});
export type BattleActionRequest = z.infer<typeof BattleActionRequestSchema>;

// ── Dev and test only ──────────────────────────────────────────────────────
// How a player gets their first squishy isn't decided yet (the tutorial's
// starter, #24), so a dev-only route (`HP_DEV_SQUISHY_GRANTS`) hands a player a
// squishy, and another picks a fight with a chosen one. The production server
// never registers them.

export const DevGrantSquishyRequestSchema = z.strictObject({
  /** Any species the server knows (public or secret). Defaults to the first one. */
  speciesId: ContentIdSchema.optional(),
  level: z.number().int().min(1).max(100).optional(),
});
export type DevGrantSquishyRequest = z.infer<typeof DevGrantSquishyRequestSchema>;

export const DevStartBattleRequestSchema = z.strictObject({
  opponent: z
    .strictObject({
      speciesId: ContentIdSchema.optional(),
      level: z.number().int().min(1).max(100).optional(),
    })
    .optional(),
});
export type DevStartBattleRequest = z.infer<typeof DevStartBattleRequestSchema>;
