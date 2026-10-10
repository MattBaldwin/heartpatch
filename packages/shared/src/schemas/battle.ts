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

/**
 * A fence segment as the other side of a fence battle (#203): a stat block
 * from data, not a squishy. It has energy and toughness but no moves, and
 * starts with the energy it has left (damage stays, owner decision
 * 2026-10-07). `fence` is its building id; the element is its material's.
 */
export const BattleFenceSetupSchema = z.strictObject({
  id: z.string().min(1).max(64),
  fence: ContentIdSchema,
  level: z.number().int().min(1).max(100),
  element: ElementIdSchema,
  stats: BattleStatsSchema,
  /** Energy it starts with; at most `stats.hp`. */
  energy: z.number().int().min(1).max(9999),
});
export type BattleFenceSetup = z.infer<typeof BattleFenceSetupSchema>;

/** One participant: a squishy, or a fence (#203). */
export const BattleParticipantSetupSchema = z.union([
  BattleSquishySetupSchema,
  BattleFenceSetupSchema,
]);
export type BattleSquishySetup = z.infer<typeof BattleSquishySetupSchema>;
export type BattleParticipantSetup = z.infer<typeof BattleParticipantSetupSchema>;

/** Is this participant a fence (#203)? */
export function isFenceSetup(setup: BattleParticipantSetup): setup is BattleFenceSetup {
  return 'fence' in setup;
}

/** The species of a side's squishies, leaving out a fence (#203: it isn't one). */
export function setupSpecies(squishies: readonly BattleParticipantSetup[]): string[] {
  return squishies.flatMap((s) => (isFenceSetup(s) ? [] : [s.speciesId]));
}

/** A player picks this side's actions, or an AI policy does. */
export const BattleControllerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('player') }),
  z.strictObject({ type: z.literal('ai'), policy: BattleAiPolicySchema }),
]);
export type BattleController = z.infer<typeof BattleControllerSchema>;

export const BattleSideSetupSchema = z.strictObject({
  controller: BattleControllerSchema,
  /**
   * The first squishy starts out. The team size limit is in battle rules. A
   * fence (#203) stands alone on an AI side.
   */
  squishies: z.array(BattleParticipantSetupSchema).min(1),
});
export type BattleSideSetup = z.infer<typeof BattleSideSetupSchema>;

export const BattleSetupSchema = z
  .strictObject({
    seed: SeedSchema,
    sides: z.strictObject({ a: BattleSideSetupSchema, b: BattleSideSetupSchema }),
    /**
     * Turns this battle lasts at most, if fewer than battle rules'
     * `maxTurns` (a fence battle, #203).
     */
    turnLimit: z.number().int().min(1).optional(),
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
 * the server sets it, never the client. `item`: the squishy that's out uses
 * a battle item (a potion, #214; costs the turn), each kind at most
 * `rules.items.usesEach` times per side per battle.
 */
export const BattleChoiceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), move: ContentIdSchema }),
  z.strictObject({ type: z.literal('swap'), slot: SlotSchema }),
  z.strictObject({ type: z.literal('capture'), sure: z.literal(true).optional() }),
  z.strictObject({ type: z.literal('item'), item: ContentIdSchema }),
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
  /** A fence segment (#203): its building id. It has no moves. */
  fence: ContentIdSchema.optional(),
  // Potions (#214). Defaults read battles stored before them.
  boosts: z
    .object({ attack: z.number().int().min(0), defense: z.number().int().min(0) })
    .default({ attack: 0, defense: 0 }),
  shield: z.number().int().min(0).max(100).default(0),
  /** Said yes to a Heart Charm and left the fight (#279). */
  befriended: z.literal(true).optional(),
});
export type BattleSquishyView = z.infer<typeof BattleSquishyViewSchema>;

export const BattleSideViewSchema = z.object({
  controller: BattleControllerSchema,
  squishies: z.array(BattleSquishyViewSchema).min(1),
  active: z.number().int().min(0),
  itemsUsed: z.array(ContentIdSchema).default([]),
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
    shielded: z.literal(true).optional(),
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
  z.object({ ...at, type: z.literal('item'), item: ContentIdSchema }),
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
  /** Turns the battle lasts at most, when less than the rules' (a fence battle, #203). */
  turnLimit: z.number().int().min(1).optional(),
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
 * shadow guardians (`rescue`, #21) and a trading post's trail squishies
 * (`journey`, #270), and a friendly battle between two Keepers who are both
 * online (`friendly`, #29). Tile battles use one of the player's daily
 * attempts; rescues (decision C), journeys and friendly battles never cost one.
 */
export const BattleKindSchema = z.enum([
  'wild',
  'tile',
  'rival-tile',
  'rescue',
  'journey',
  'friendly',
]);
export type BattleKind = z.infer<typeof BattleKindSchema>;

/** Kinds that battle for a tile (#15): they use an attempt, and leaving counts as a loss. */
export const TILE_BATTLE_KINDS: ReadonlySet<BattleKind> = new Set(['tile', 'rival-tile']);

/**
 * Kinds whose squishy can be befriended with a Heart Charm (#14): wild ones,
 * and the guardians of neutral land (#279), where a befriend counts as a
 * knockout. Never a rival's guard or land guardians (`rival-tile`), so a
 * Keeper's squishy is never taken, and never a fence (the engine refuses).
 */
export const CAPTURABLE_BATTLE_KINDS: ReadonlySet<BattleKind> = new Set(['wild', 'tile']);

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
const EvolvingPercentSchema = z.number().int().min(0).max(100).nullable().default(null);

export const BattleRewardsSchema = z.object({
  xp: z.array(
    z.object({
      squishyId: z.uuid(),
      xp: z.number().int().min(0),
      /**
       * Its evolving meter before and after this battle's XP (#205), for the
       * results card; null with no meter (a top form, a secret one next) and
       * for battles stored before it. After is null when this battle evolved
       * it (the evolution celebration takes over); 100: it evolves on its
       * next XP.
       */
      evolvingBefore: EvolvingPercentSchema,
      evolvingAfter: EvolvingPercentSchema,
    }),
  ),
  /** The share of the battle's XP it paid, in percent (Gentle mode, design doc §11). */
  percent: z.number().int().min(0).max(100),
  /**
   * Set when the daily battle-XP falloff cut this battle's XP (#201): the
   * patch's next local midnight, when full XP comes back. Null otherwise and
   * for battles stored before it.
   */
  fullXpResetAt: z.iso.datetime().nullable().default(null),
});
export type BattleRewards = z.infer<typeof BattleRewardsSchema>;

/**
 * The patch's time of day where a battle happens (owner decision 2026-10-04):
 * `night` is the map's night (nightfall to morning, as the Hollow's), `dusk`
 * the hours just before it. Only for how the arena looks.
 */
export const BattleTimeOfDaySchema = z.enum(['day', 'dusk', 'night']);
export type BattleTimeOfDay = z.infer<typeof BattleTimeOfDaySchema>;

/**
 * A live battle's turn state (#29), from the viewer's side: both players pick
 * at once and the turn plays when both have. The opponent's pick is never
 * here, only whether they've picked. `deadlineAt`: when the AI picks for
 * whoever hasn't (null once the battle is over). `covered`: turns the AI
 * picked for a side whose time ran out, so the client can say "Sprout helped".
 */
export const LiveBattleViewSchema = z.object({
  opponentUserId: z.uuid(),
  deadlineAt: z.iso.datetime().nullable(),
  myPick: BattleChoiceSchema.nullable(),
  opponentPicked: z.boolean(),
  covered: z.array(z.object({ turn: z.number().int().min(0), side: BattleSideIdSchema })),
});
export type LiveBattleView = z.infer<typeof LiveBattleViewSchema>;

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
  /**
   * Where it happens (owner decision 2026-10-04): a terrain id from the
   * shared terrain table, which the client draws as the arena. The battle's
   * tile for a tile battle or a wild squishy's spawn, else the player's home
   * tile. Set by the server when the battle starts.
   */
  terrain: ContentIdSchema,
  /** The patch's time of day when the battle started, so a night battle looks like night. */
  timeOfDay: BattleTimeOfDaySchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** Present only for a battle between two players (#29). */
  live: LiveBattleViewSchema.optional(),
});
export type PlayerBattle = z.infer<typeof PlayerBattleSchema>;

/**
 * `POST /battles/:battleId/cheer` (#29): a quick message or emoji id from
 * `QUICK_MESSAGES`, never text (CLAUDE.md rule 9). Live battles only.
 */
export const BattleCheerRequestSchema = z.strictObject({ messageId: ContentIdSchema });
export type BattleCheerRequest = z.infer<typeof BattleCheerRequestSchema>;

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
  /** Use a battle item from the bag (a potion, #214; costs one and the turn). */
  z.strictObject({ type: z.literal('item'), item: ContentIdSchema }),
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
