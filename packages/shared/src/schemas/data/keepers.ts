import { z } from 'zod';
import { ContentIdSchema, DisplayNameSchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { HexColorSchema } from './species.js';
import { PartShapeSchema } from './visuals.js';

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

/** A point or size in head units (radii from the head's centre, or head diameters). */
const HeadVecSchema = z.tuple([z.number(), z.number(), z.number()]);

/**
 * One primitive of a hairstyle, in head units: `at` is its centre in head
 * radii from the head's centre (+y up, −z the face), `size` is in head
 * diameters, `turn` is degrees (pitch, yaw, roll).
 */
export const HairPieceSchema = z.strictObject({
  shape: PartShapeSchema,
  at: HeadVecSchema,
  size: HeadVecSchema,
  turn: HeadVecSchema.optional(),
});
export type HairPiece = z.infer<typeof HairPieceSchema>;

/**
 * A hairstyle any Keeper can wear: primitives on the head, scaled to each
 * base's head, so a new style is a data entry, not engine code (CLAUDE.md
 * rule 5). Ids are stored in `keepers` rows: never rename or remove one.
 */
export const KeeperHairstyleSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /** How far the hair reaches above and around the head (head radii), for the hat socket. */
  volume: z.strictObject({ top: z.number().min(1).max(2), width: z.number().min(1).max(1.6) }),
  /** Drawn with thin instances, so pieces cost vertices, not draw calls. */
  pieces: z.array(HairPieceSchema).min(1).max(16),
});
export type KeeperHairstyle = z.infer<typeof KeeperHairstyleSchema>;

export const KeeperEyesSchema = z.enum(['round', 'oval', 'happy', 'sleepy']);
export type KeeperEyes = z.infer<typeof KeeperEyesSchema>;

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

/** A face line's shape (#289): a curve (∪, or ∩ when rolled 180°) or a straight stroke. */
export const FaceLineShapeSchema = z.enum(['arc', 'capsule']);

/**
 * A brow or mouth line (#289), drawn in the face-line ink. `size` is width and
 * height in head diameters; `depth` multiplies the shared line depth; `roll`
 * is degrees; `lift` moves it up (head heights) from where brows or the mouth
 * sit. Where it sits is the renderer's (both brows mirror), so a new line is
 * a data entry, not engine code (CLAUDE.md rule 5).
 */
export const KeeperFaceLineSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  shape: FaceLineShapeSchema,
  size: z.tuple([z.number().positive().max(0.3), z.number().positive().max(0.3)]),
  depth: z.number().positive().max(3),
  roll: z.number().min(-180).max(180),
  lift: z.number().min(-0.1).max(0.1).optional(),
});
export type KeeperFaceLine = z.infer<typeof KeeperFaceLineSchema>;

/**
 * One piece of a face extra (#289), on the head's front: `at` is from the
 * face's middle (head widths across, head heights up), `size` is width,
 * height and depth in head diameters, `color` is a hex colour or `line` (the
 * face-line ink). `mirror` draws it on both cheeks.
 */
export const FacePieceSchema = z.strictObject({
  shape: PartShapeSchema,
  at: z.tuple([z.number().min(-0.5).max(0.5), z.number().min(-0.5).max(0.5)]),
  size: HeadVecSchema,
  color: z.union([HexColorSchema, z.literal('line')]),
  roll: z.number().min(-180).max(180).optional(),
  mirror: z.boolean().optional(),
});
export type FacePiece = z.infer<typeof FacePieceSchema>;

/** An optional face extra (#289): blush, freckles and so on. Off unless picked; anyone can pick any. */
export const KeeperFaceExtraSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  pieces: z.array(FacePieceSchema).min(1).max(8),
});
export type KeeperFaceExtra = z.infer<typeof KeeperFaceExtraSchema>;

/** A skin tone (#289). Shown as a swatch with no name ("Skin tone 1–10", light to deep). */
export const KeeperSkinToneSchema = z.strictObject({
  id: ContentIdSchema,
  color: HexColorSchema,
});
export type KeeperSkinTone = z.infer<typeof KeeperSkinToneSchema>;

/** A starting look's face (#289): the eyes, brows and mouth it starts with (ids for brows and mouth). */
export const KeeperFaceSchema = z.strictObject({
  eyes: KeeperEyesSchema,
  brows: ContentIdSchema,
  mouth: ContentIdSchema,
});
export type KeeperFace = z.infer<typeof KeeperFaceSchema>;

/**
 * A starting look (design doc §23; #289): one tap sets every choice, then the
 * player changes any of them. Its body shape isn't a choice yet.
 */
export const KeeperBaseSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  /** The skin tone it starts with (an id in the skin tones below). */
  skinTone: ContentIdSchema,
  body: KeeperBodySchema,
  face: KeeperFaceSchema,
  /** The hairstyle it starts with (an id in the hairstyles below). */
  hairstyle: ContentIdSchema,
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
  skinTones: z.array(KeeperSkinToneSchema).min(1),
  brows: z.array(KeeperFaceLineSchema).min(1),
  mouths: z.array(KeeperFaceLineSchema).min(1),
  faceExtras: z.array(KeeperFaceExtraSchema),
  hairstyles: z.array(KeeperHairstyleSchema).min(1),
  hairColors: z.array(KeeperSwatchSchema).min(1),
  eyeColors: z.array(KeeperSwatchSchema).min(1),
  outfits: z.array(OutfitPaletteSchema).min(1),
});
export type KeeperData = z.infer<typeof KeeperDataObjectSchema>;

/**
 * A player's Keeper (design doc §23): a starting look (`base`) plus their
 * picks, and optionally a hairstyle; without one the base's own style shows,
 * so Keepers saved before styles could be picked look exactly as they did.
 * Account-level (tech spec §4) and stored server-side (`keepers`); the server
 * also checks every id against `KEEPER_DATA` (`keeperConfigProblem`).
 * Clothing is the wardrobe's (#43): see `PublicKeeperSchema`.
 */
export const KeeperConfigSchema = z.strictObject({
  base: ContentIdSchema,
  hairColor: ContentIdSchema,
  eyeColor: ContentIdSchema,
  outfit: ContentIdSchema,
  hairstyle: ContentIdSchema.optional(),
  // The Keeper builder (#289). Optional, so an older app that doesn't send
  // them still saves: the server fills each from the starting look (`base`),
  // and always sends them back.
  skinTone: ContentIdSchema.optional(),
  eyes: KeeperEyesSchema.optional(),
  brows: ContentIdSchema.optional(),
  mouth: ContentIdSchema.optional(),
  /** Face extras the player picked (ids), in data order. */
  extras: z
    .array(ContentIdSchema)
    .max(8)
    .refine((list) => new Set(list).size === list.length, 'Pick each extra once.')
    .optional(),
});
export type KeeperConfig = z.infer<typeof KeeperConfigSchema>;

/** A config with every Keeper builder choice filled in (#289): what's stored and sent back. */
export type CompleteKeeperConfig = KeeperConfig &
  Required<Pick<KeeperConfig, 'skinTone' | 'eyes' | 'brows' | 'mouth' | 'extras'>>;

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
    checkUniqueIds('hairstyles', data.hairstyles, report);
    checkUniqueIds('hairColors', data.hairColors, report);
    checkUniqueIds('eyeColors', data.eyeColors, report);
    checkUniqueIds('outfits', data.outfits, report);
    checkUniqueIds('skinTones', data.skinTones, report);
    checkUniqueIds('brows', data.brows, report);
    checkUniqueIds('mouths', data.mouths, report);
    checkUniqueIds('faceExtras', data.faceExtras, report);
    const tones = ids(data.skinTones);
    const brows = ids(data.brows);
    const mouths = ids(data.mouths);
    const hair = ids(data.hairColors);
    const eyes = ids(data.eyeColors);
    const outfits = ids(data.outfits);
    const styles = ids(data.hairstyles);
    data.bases.forEach((base, i) => {
      checkRef(styles, 'hairstyle', base.hairstyle, ['bases', i, 'hairstyle'], report);
      checkRef(tones, 'skin tone', base.skinTone, ['bases', i, 'skinTone'], report);
      checkRef(brows, 'brows', base.face.brows, ['bases', i, 'face', 'brows'], report);
      checkRef(mouths, 'mouth', base.face.mouth, ['bases', i, 'face', 'mouth'], report);
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
  if (config.hairstyle !== undefined && !data.hairstyles.some((h) => h.id === config.hairstyle)) {
    return 'hairstyle';
  }
  const known = (rows: readonly { id: string }[], id: string | undefined) =>
    id === undefined || rows.some((r) => r.id === id);
  if (!known(data.skinTones, config.skinTone)) return 'skinTone';
  if (!known(data.brows, config.brows)) return 'brows';
  if (!known(data.mouths, config.mouth)) return 'mouth';
  if (!(config.extras ?? []).every((id) => known(data.faceExtras, id))) return 'extras';
  return null;
}

/** A starting look's own choices (and its own hairstyle: none is set), with no extras. */
export function defaultKeeperConfig(base: KeeperBase): CompleteKeeperConfig {
  return {
    base: base.id,
    hairColor: base.hairColor,
    eyeColor: base.eyeColor,
    outfit: base.outfit,
    skinTone: base.skinTone,
    eyes: base.face.eyes,
    brows: base.face.brows,
    mouth: base.face.mouth,
    extras: [],
  };
}

/**
 * `config` with every builder choice filled in from its starting look (#289),
 * extras in data order, so what's stored and drawn is always complete.
 */
export function completeKeeperConfig(config: KeeperConfig, data: KeeperData): CompleteKeeperConfig {
  // An unknown base (the server refuses it) fills from the first.
  const base = data.bases.find((b) => b.id === config.base) ?? data.bases[0];
  if (!base) throw new Error('completeKeeperConfig: no Keeper bases');
  const picked = new Set(config.extras ?? []);
  return {
    ...config,
    skinTone: config.skinTone ?? base.skinTone,
    eyes: config.eyes ?? base.face.eyes,
    brows: config.brows ?? base.face.brows,
    mouth: config.mouth ?? base.face.mouth,
    extras: data.faceExtras.filter((e) => picked.has(e.id)).map((e) => e.id),
  };
}
