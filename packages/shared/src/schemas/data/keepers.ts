import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { HexColorSchema } from './species.js';

// Keepers: the character each player shows up as (design doc §23), in the
// squishies' soft vinyl-toy style (§19). Bases and palettes are data, so a
// new base or colour is a data entry, not engine code (CLAUDE.md rule 5).
// Ids are stored in `keepers` rows, so never rename or remove one.

/**
 * Wardrobe slots (design doc §23). Every Keeper base has a socket for each,
 * and every clothing item fits every base: sockets carry the size, so items
 * are never made per body type. `costume` covers the whole body and hides
 * the others while it's worn. Ids are a contract #43 builds on: add, never
 * rename.
 */
export const WARDROBE_SLOTS = [
  'hat',
  'hair-accessory',
  'top',
  'bottom',
  'shoes',
  'back',
  'held',
  'costume',
] as const;
export const WardrobeSlotSchema = z.enum(WARDROBE_SLOTS);
export type WardrobeSlot = z.infer<typeof WardrobeSlotSchema>;

/**
 * Hairstyles; each has one builder in the client (`procedural/keeper/`), the
 * same way part shapes do. A new hairstyle needs a builder; a new base using
 * an existing one is a data entry.
 */
export const HairstyleSchema = z.enum([
  'bob',
  'spiky',
  'pigtails',
  'bun',
  'curly',
  'long',
  'swoop',
  'puff',
]);
export type Hairstyle = z.infer<typeof HairstyleSchema>;

export const KeeperEyesSchema = z.enum(['round', 'oval', 'happy', 'sleepy']);
export type KeeperEyes = z.infer<typeof KeeperEyesSchema>;

export const KeeperMouthSchema = z.enum(['smile', 'grin', 'tiny', 'cat']);
export type KeeperMouth = z.infer<typeof KeeperMouthSchema>;

/** A proportion of the Keeper's standard height (about 1.6 world units). */
const proportion = (min: number, max: number) => z.number().min(min).max(max);

/**
 * Chibi proportions (design doc §23): a big head on a small, rounded body.
 * All sizes are fractions of the standard Keeper height, except `height`.
 */
export const KeeperBodySchema = z.strictObject({
  /** Overall size: 1 is standard; small and tall Keepers sit either side. */
  height: proportion(0.8, 1.2),
  /** Head diameter. */
  head: proportion(0.38, 0.6),
  /** Head width over height: rounder (above 1) or longer (below 1). */
  headShape: proportion(0.85, 1.2),
  /** Body (torso) width and height. */
  torsoWidth: proportion(0.2, 0.42),
  torsoHeight: proportion(0.18, 0.32),
  /** 0 is a straight body; towards 1 a rounder, softer middle. */
  roundness: proportion(0, 1),
  /** Leg length from hip to sole. */
  legs: proportion(0.1, 0.24),
  /** Arm length from shoulder to hand. */
  arms: proportion(0.14, 0.28),
  /** Arm and leg thickness. */
  limbs: proportion(0.06, 0.12),
});
export type KeeperBody = z.infer<typeof KeeperBodySchema>;

export const KeeperFaceSchema = z.strictObject({
  eyes: KeeperEyesSchema,
  mouth: KeeperMouthSchema,
  freckles: z.boolean(),
  /** Soft eyebrows over the eyes. */
  brows: z.boolean(),
});
export type KeeperFace = z.infer<typeof KeeperFaceSchema>;

/** A preset Keeper (design doc §23 [DEFAULT: 8]) and its starting colours. */
export const KeeperBaseSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  skin: HexColorSchema,
  body: KeeperBodySchema,
  face: KeeperFaceSchema,
  hairstyle: HairstyleSchema,
  /** The colours the base starts with (ids in the palettes below). */
  hairColor: ContentIdSchema,
  eyeColor: ContentIdSchema,
  outfit: ContentIdSchema,
});
export type KeeperBase = z.infer<typeof KeeperBaseSchema>;

/** One colour a player can pick (hair or eyes). */
export const KeeperSwatchSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  color: HexColorSchema,
});
export type KeeperSwatch = z.infer<typeof KeeperSwatchSchema>;

/** A starter outfit's colours (design doc §23 [DEFAULT: 6]). */
export const OutfitPaletteSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  top: HexColorSchema,
  bottom: HexColorSchema,
  shoes: HexColorSchema,
  /** Collar, cuffs and buttons. */
  trim: HexColorSchema,
});
export type OutfitPalette = z.infer<typeof OutfitPaletteSchema>;

const KeeperDataObjectSchema = z.strictObject({
  bases: z.array(KeeperBaseSchema).min(1),
  hairColors: z.array(KeeperSwatchSchema).min(1),
  eyeColors: z.array(KeeperSwatchSchema).min(1),
  outfits: z.array(OutfitPaletteSchema).min(1),
});
export type KeeperData = z.infer<typeof KeeperDataObjectSchema>;

/**
 * A player's Keeper (design doc §23): a base plus their colour picks.
 * Account-level (tech spec §4) and stored server-side (`keepers`); the server
 * also checks every id against `KEEPER_DATA` (`keeperConfigProblem`).
 * Clothing is the wardrobe's (#43): see `PublicKeeperSchema`.
 */
export const KeeperConfigSchema = z.strictObject({
  base: ContentIdSchema,
  hairColor: ContentIdSchema,
  eyeColor: ContentIdSchema,
  outfit: ContentIdSchema,
});
export type KeeperConfig = z.infer<typeof KeeperConfigSchema>;

/**
 * A Keeper as other players see it (`MapMember.keeper`): the config plus the
 * clothing it wears (#43), as clothing ids in slot order. Unknown ids (from a
 * newer server) are skipped when drawing.
 */
export const PublicKeeperSchema = z.object({
  ...KeeperConfigSchema.shape,
  wearing: z.array(ContentIdSchema).max(WARDROBE_SLOTS.length),
});
export type PublicKeeper = z.infer<typeof PublicKeeperSchema>;

const ids = (rows: readonly { id: string }[]) => new Set(rows.map((r) => r.id));

/**
 * Validates the Keeper tables (zod, then unique ids and every base's starting
 * colours) and returns readable problems, or `[]`.
 */
export function checkKeeperData(input: unknown): string[] {
  const schema = KeeperDataObjectSchema.superRefine((data, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    checkUniqueIds('bases', data.bases, report);
    checkUniqueIds('hairColors', data.hairColors, report);
    checkUniqueIds('eyeColors', data.eyeColors, report);
    checkUniqueIds('outfits', data.outfits, report);
    const hair = ids(data.hairColors);
    const eyes = ids(data.eyeColors);
    const outfits = ids(data.outfits);
    data.bases.forEach((base, i) => {
      checkRef(hair, 'hair colour', base.hairColor, ['bases', i, 'hairColor'], report);
      checkRef(eyes, 'eye colour', base.eyeColor, ['bases', i, 'eyeColor'], report);
      checkRef(outfits, 'outfit', base.outfit, ['bases', i, 'outfit'], report);
    });
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * The first field of `config` that names something `data` doesn't have, or
 * null when every id is known. The server refuses such a config.
 */
export function keeperConfigProblem(
  config: KeeperConfig,
  data: KeeperData,
): keyof KeeperConfig | null {
  if (!data.bases.some((b) => b.id === config.base)) return 'base';
  if (!data.hairColors.some((c) => c.id === config.hairColor)) return 'hairColor';
  if (!data.eyeColors.some((c) => c.id === config.eyeColor)) return 'eyeColor';
  if (!data.outfits.some((o) => o.id === config.outfit)) return 'outfit';
  return null;
}

/** A base with the colours it starts with. */
export function defaultKeeperConfig(base: KeeperBase): KeeperConfig {
  return {
    base: base.id,
    hairColor: base.hairColor,
    eyeColor: base.eyeColor,
    outfit: base.outfit,
  };
}
