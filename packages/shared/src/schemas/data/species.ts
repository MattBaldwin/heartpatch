import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema, RaritySchema } from './common.js';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';

const statValue = z.number().int().min(1).max(255);

export const BaseStatsSchema = z.strictObject({
  hp: statValue,
  attack: statValue,
  defense: statValue,
  speed: statValue,
});
export type BaseStats = z.infer<typeof BaseStatsSchema>;

/**
 * Public, level-based evolutions (design doc §8, Phase 1). Branch weights
 * and secret branches are server-only and never live here.
 */
export const EvolutionSchema = z.strictObject({
  into: ContentIdSchema,
  level: z.number().int().min(2).max(100),
});
export type Evolution = z.infer<typeof EvolutionSchema>;

const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, 'Expected a colour like "#ffaa00"');

/**
 * Procedural vinyl-toy parameters (design doc §19): a body shape, a palette
 * and swappable parts. The procedural generator issue may extend this.
 */
export const SpeciesVisualSchema = z.strictObject({
  body: ContentIdSchema,
  palette: z.array(HexColorSchema).min(1).max(4),
  parts: z.array(ContentIdSchema).max(8),
});
export type SpeciesVisual = z.infer<typeof SpeciesVisualSchema>;

export const HabitatPreferencesSchema = z.strictObject({
  elements: z.array(ElementIdSchema),
  feelings: z.array(FeelingIdSchema),
});
export type HabitatPreferences = z.infer<typeof HabitatPreferencesSchema>;

/**
 * A squishy species (design doc §4). Spawn rules are secret, so they live in
 * the server-only spawn tables, not on the species.
 */
export const SpeciesSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  element: ElementIdSchema,
  feeling: FeelingIdSchema,
  rarity: RaritySchema,
  season: ContentIdSchema.optional(),
  baseStats: BaseStatsSchema,
  /** Move ids; each species has 2–4 moves (design doc §6). */
  moves: z.array(ContentIdSchema).min(2).max(4),
  evolutions: z.array(EvolutionSchema),
  visual: SpeciesVisualSchema,
  habitatPreferences: HabitatPreferencesSchema,
});
export type Species = z.infer<typeof SpeciesSchema>;
