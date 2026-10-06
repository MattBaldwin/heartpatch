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

/** Rarity material tiers (ART_BIBLE §1.4). */
export const FinishSchema = z.enum(['vinyl', 'sparkle', 'iridescent']);
export type Finish = z.infer<typeof FinishSchema>;

/** What glows (ART_BIBLE §1.4): the whole squishy, or only its `accent` parts. */
export const GlowSchema = z.enum(['body', 'accent']);
export type Glow = z.infer<typeof GlowSchema>;

export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, 'Expected a colour like "#ffaa00"');

/**
 * Procedural vinyl-toy parameters (design doc §19). `body` and `parts` are
 * ids from the registry (`BODIES`, `PARTS`); `checkGameData` checks them, and
 * every squishy needs a part in the `eyes` slot. The palette is the
 * `primary`, `secondary`, `accent` and `detail` colours in that order (see
 * `PaletteRoleSchema`). Each squishy's small variations are seeded from its
 * instance id on the client, so this is all the species decides.
 */
export const SpeciesVisualSchema = z.strictObject({
  body: ContentIdSchema,
  palette: z.array(HexColorSchema).min(1).max(4),
  parts: z.array(ContentIdSchema).max(8),
  /** Overall scale; an evolution is ×1.2–1.4 its base (ART_BIBLE §1.3). Defaults to 1. */
  size: z.number().min(0.5).max(2).optional(),
  /** Face ink (eyes, brows, mouth); defaults to `artRules.defaultInk`. Chosen for contrast with the body. */
  ink: HexColorSchema.optional(),
  /** Rarity material tier (ART_BIBLE §1.4); must match `artRules.finishByRarity`. Defaults to vinyl. */
  finish: FinishSchema.optional(),
  /** Lit from inside: the whole squishy, or only its `accent` parts (flames). */
  glow: GlowSchema.optional(),
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
