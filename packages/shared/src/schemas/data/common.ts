import { z } from 'zod';

/**
 * Content ids are lowercase kebab-case slugs (`ember-den`, `heart-charm`).
 * They are stable keys in data and in the database, so never rename one.
 */
export const ContentIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'Expected a lowercase kebab-case id like "ember-den"');
export type ContentId = z.infer<typeof ContentIdSchema>;

/** Player-facing names: short enough for a button or a card title (style guide §2). */
export const DisplayNameSchema = z.string().trim().min(1).max(32);

/** Player-facing descriptions: one or two short sentences (style guide §2). */
export const DescriptionSchema = z.string().trim().min(1).max(160);

/**
 * Rarity (design doc §4), commonest first. `mythic` sits above `legendary`
 * for everything (owner decision on #261); `secret` stays a separate, hidden
 * tier for squishies, never a step on the ladder.
 */
export const RaritySchema = z.enum([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'secret',
]);
export type Rarity = z.infer<typeof RaritySchema>;

/** Resource amounts keyed by resource id, e.g. `{ timber: 3, stone: 1 }`. */
export const ResourceCostSchema = z.record(ContentIdSchema, z.number().int().positive());
export type ResourceCost = z.infer<typeof ResourceCostSchema>;
