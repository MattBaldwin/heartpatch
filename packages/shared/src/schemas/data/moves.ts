import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema } from './common.js';
import { ElementIdSchema } from './elements.js';

/** Stats a move can nudge up or down for the rest of a battle. */
export const BattleStatSchema = z.enum(['attack', 'defense', 'speed']);
export type BattleStat = z.infer<typeof BattleStatSchema>;

/**
 * Optional move effects (design doc §6). The battle engine issue may add
 * variants; each is a tagged object so the engine can switch on `type`.
 */
export const MoveEffectSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('stat'),
    target: z.enum(['self', 'opponent']),
    stat: BattleStatSchema,
    stages: z
      .number()
      .int()
      .min(-2)
      .max(2)
      .refine((n) => n !== 0, 'stages must not be 0'),
    chance: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('heal'),
    /** Percent of the user's max energy restored. */
    percent: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal('status'),
    status: z.enum(['dizzy', 'sleepy']),
    chance: z.number().int().min(1).max(100),
  }),
  /**
   * The move takes a round to wind up (#234): this round it only announces
   * itself, next round it lands as a fresh use of the move. Being hit never
   * spoils it; losing the action (dizzy, sleepy, a flinch), a swap, a Heart
   * Charm or a bare potion does.
   */
  z.strictObject({ type: z.literal('windup') }),
  /**
   * On a hit, `chance`% that the target flinches (#234): if it hasn't acted
   * yet this round, it loses its action.
   */
  z.strictObject({ type: z.literal('flinch'), chance: z.number().int().min(1).max(100) }),
  /**
   * Hits harder the lower the user's energy (#234): power × (1 +
   * `extraPercent`% × the share of energy lost), rounded down.
   */
  z.strictObject({
    type: z.literal('low-energy'),
    extraPercent: z.number().int().min(1).max(300),
  }),
  /**
   * The user calls in a friend (#234): `move` is resolved right after, by
   * the same user, on the same targets. No new squishy and no new state.
   */
  z.strictObject({ type: z.literal('assist'), move: ContentIdSchema }),
]);
export type MoveEffect = z.infer<typeof MoveEffectSchema>;

/**
 * How a damaging move plays (#587), shown on its button. `big` hits hard but
 * leaves the user open (it takes more from the next hit); `steady` is lighter,
 * raises its guard for the next hit, and is gentle with a wild squishy. Not
 * stored on the move: each species' moves are sorted into kinds by battle
 * rules `moveKinds` (lowest power is steady), so the same move can be steady
 * on one squishy and big on another.
 */
export const MoveKindSchema = z.enum(['big', 'steady']);
export type MoveKind = z.infer<typeof MoveKindSchema>;

/** Who a move hits (#190); a move without `targets` hits one foe. */
export const MoveTargetsSchema = z.enum(['one', 'all-foes']);
export type MoveTargets = z.infer<typeof MoveTargetsSchema>;

export const MoveSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  element: ElementIdSchema,
  /** 0 for moves that only apply effects. */
  power: z.number().int().min(0).max(200),
  /** Percent chance to land. */
  accuracy: z.number().int().min(1).max(100),
  effects: z.array(MoveEffectSchema).max(3).optional(),
  /**
   * Who it hits (#190): `one` foe (the default when left out) or `all-foes`,
   * each rolled on its own in slot order at `rules.team.spreadPercent` when
   * it hits more than one. With one foe on the field it hits at full power.
   */
  targets: MoveTargetsSchema.optional(),
});
export type Move = z.infer<typeof MoveSchema>;

/** The effect types a move may carry at most once each, and that need extra checks (#234). */
const ONCE_EACH = ['windup', 'flinch', 'low-energy', 'assist'] as const;

/**
 * What's wrong with `move`'s #234 effects, given every move it may call in
 * (public + secret on the server): each of windup, flinch, low-energy and
 * assist at most once; low-energy and windup need power; an assist must call
 * in a known move that doesn't itself assist or wind up. Empty when fine.
 */
export function moveEffectProblems(move: Move, moves: ReadonlyMap<string, Move>): string[] {
  const problems: string[] = [];
  const effects = move.effects ?? [];
  for (const type of ONCE_EACH) {
    if (effects.filter((e) => e.type === type).length > 1) {
      problems.push(`"${type}" is listed more than once`);
    }
  }
  for (const effect of effects) {
    if ((effect.type === 'low-energy' || effect.type === 'windup') && move.power === 0) {
      problems.push(`a "${effect.type}" move needs power`);
    }
    if (effect.type !== 'assist') continue;
    const called = moves.get(effect.move);
    if (!called) {
      problems.push(`assist calls in unknown move "${effect.move}"`);
    } else if ((called.effects ?? []).some((e) => e.type === 'assist' || e.type === 'windup')) {
      problems.push(`assist can't call in "${effect.move}": it assists or winds up itself`);
    }
  }
  return problems;
}
