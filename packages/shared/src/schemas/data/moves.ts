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
]);
export type MoveEffect = z.infer<typeof MoveEffectSchema>;

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
});
export type Move = z.infer<typeof MoveSchema>;
