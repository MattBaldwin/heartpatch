import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema, RaritySchema } from './common.js';
import { ElementIdSchema, FeelingIdSchema } from './elements.js';
import { PartSlotSchema } from './visuals.js';

const statValue = z.number().int().min(1).max(255);

export const BaseStatsSchema = z.strictObject({
  hp: statValue,
  attack: statValue,
  defense: statValue,
  speed: statValue,
});
export type BaseStats = z.infer<typeof BaseStatsSchema>;

/**
 * Public, level-based evolutions (design doc §8). Several at one level are a
 * branch (#32): the first listed is the default form. Branch odds, rare
 * conditions and secret branches are server-only and never live here.
 */
export const EvolutionSchema = z.strictObject({
  into: ContentIdSchema,
  level: z.number().int().min(2).max(100),
});
export type Evolution = z.infer<typeof EvolutionSchema>;

/** How a squishy stands (ART_BIBLE §1.2), for battle animation. */
export const PoseSchema = z.enum(['sit', 'stand', 'upright', 'slither', 'hover']);
export type Pose = z.infer<typeof PoseSchema>;

/** Rarity material tiers (ART_BIBLE §1.4). */
export const FinishSchema = z.enum(['vinyl', 'sparkle', 'iridescent', 'shimmer']);
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
  parts: z.array(ContentIdSchema).max(12),
  /** Overall scale; an evolution is ×1.2–1.4 its base (ART_BIBLE §1.3). Defaults to 1. */
  size: z.number().min(0.5).max(2).optional(),
  /** Face ink (eyes, brows, mouth); defaults to `artRules.defaultInk`. Chosen for contrast with the body. */
  ink: HexColorSchema.optional(),
  /** Rarity material tier (ART_BIBLE §1.4); must match `artRules.finishByRarity`. Defaults to vinyl. */
  finish: FinishSchema.optional(),
  /** Lit from inside: the whole squishy, or only its `accent` parts (flames). */
  glow: GlowSchema.optional(),
  /**
   * A separate head (ART_BIBLE §1.2): a registry body sitting on the torso,
   * `size` times the torso's height, moved `forward` and `up` (fractions of
   * the torso's height). Face, ears, horns, crown and mane go on it.
   */
  head: z
    .strictObject({
      body: ContentIdSchema,
      size: z.number().min(0.3).max(2),
      forward: z.number().min(-0.6).max(0.8),
      up: z.number().min(0).max(1.4),
    })
    .optional(),
  /** Lifts the torso off the ground (a fraction of its height); legs grow to reach the ground, or it hovers. */
  stance: z.number().min(0).max(1.2).optional(),
  /** How it stands, for battle animation (the battle-feel lane). */
  pose: PoseSchema.optional(),
  /** The slot a move animation swings, stomps or flares (tail, arms, horns…). */
  attackPart: PartSlotSchema.optional(),
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
