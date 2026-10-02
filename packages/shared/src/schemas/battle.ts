import { z } from 'zod';
import { SeedSchema } from '../rng/index.js';
import { BattleAiPolicySchema } from './data/battle.js';
import { ContentIdSchema } from './data/common.js';
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

/** What one side does this turn: use one of its moves, or swap (costs the turn). */
export const BattleChoiceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('move'), move: ContentIdSchema }),
  z.strictObject({ type: z.literal('swap'), slot: SlotSchema }),
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
