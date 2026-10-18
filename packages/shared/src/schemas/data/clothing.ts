import { z } from 'zod';
import { ContentIdSchema, DescriptionSchema, DisplayNameSchema, RaritySchema } from './common.js';
import { checkRef, checkUniqueIds, formatDataIssues, type Report } from './issues.js';
import { WARDROBE_SLOTS, type WardrobeSlot } from './keepers.js';
import { HexColorSchema } from './species.js';
import { PartShapeSchema } from './visuals.js';

// Clothing (design doc §23; issue #43): one catalog for Keeper clothing and
// squishy accessories, so one wardrobe, one inventory and (later) one trading
// flow cover both. Cosmetic only: an item never has stats. Ids are stored in
// `clothing_owned` and `outfits` rows, so never rename or remove one.

/**
 * Squishy accessories (tiny hats, bows, scarves) go in this slot. A squishy
 * wears one at a time.
 */
export const SQUISHY_SLOT = 'squishy';

/** Keeper slots (`WARDROBE_SLOTS`, the #42 socket contract) plus squishy accessories. */
export const ClothingSlotSchema = z.enum([...WARDROBE_SLOTS, SQUISHY_SLOT]);
export type ClothingSlot = z.infer<typeof ClothingSlotSchema>;

/** Squishy rarities without `secret`: clothing is never secret (design doc §23). */
export const ClothingRaritySchema = RaritySchema.exclude(['secret']);
export type ClothingRarity = z.infer<typeof ClothingRaritySchema>;
export const CLOTHING_RARITIES = ClothingRaritySchema.options;

/**
 * How an item can be got (design doc §23 "Getting clothing").
 * - `starter`: every account owns it from the start (never stored, never traded).
 * - `found`: a small chance from gathers, captures and rescues, by the server's
 *   drop tables (`@heartpatch/shared/server`, CLAUDE.md rule 6).
 * - `tutorial`: a reward for finishing the tutorial (the Seedling Scarf, #24).
 * - `milestone`: a milestone's signature piece (#44); account-bound.
 * - `boutique`: bought with Patch Coins (#45); needs `boutiquePrice`.
 * - `present`: inside a Christmas present (Phase 3).
 * - `trick-or-treat`: a treat from a patch-mate's home in the Halloween season
 *   (#515): the #261 Halloween Keeper costumes and the squishy costumes, by
 *   the server's prize table (`@heartpatch/shared/server`, CLAUDE.md rule 6).
 */
export const ClothingSourceSchema = z.enum([
  'starter',
  'found',
  'tutorial',
  'milestone',
  'boutique',
  'present',
  'trick-or-treat',
]);
export type ClothingSource = z.infer<typeof ClothingSourceSchema>;

/**
 * What can turn up a `found` item: a gather, a tile capture, a rescue, a won
 * wild battle or an explore find (#261, #199). Game events name it, so it's
 * public; the drop tables themselves are server-only
 * (`schemas/data/clothing-drops.ts`, `data/server/clothing-drops.ts`).
 */
export const ClothingDropSourceSchema = z.enum([
  'gather',
  'capture',
  'rescue',
  'battle',
  'explore',
]);
export type ClothingDropSource = z.infer<typeof ClothingDropSourceSchema>;

/** Sources whose items stay with the account: never `tradable`. */
const ACCOUNT_BOUND: readonly ClothingSource[] = ['starter', 'tutorial', 'milestone'];

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const SizeSchema = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

/**
 * One primitive of an item, in its socket's units (DECISIONS "Keepers (#42)"):
 * every Keeper base has a socket per slot that knows the size of the body
 * part it sits on, so one item fits every base and nothing is made per body
 * type. Squishy accessories use the squishy's body size the same way.
 */
/**
 * Where a costume piece sits (#261): a body part's socket, so a head-to-toe
 * costume lines up on every base. `head` is the head itself (its centre and
 * diameters); `legs`, `arms` and `hands` are mirrored pairs like `shoes`.
 */
export const CostumeAnchorSchema = z.enum([
  'head',
  'hat',
  'top',
  'bottom',
  'shoes',
  'legs',
  'arms',
  'hands',
  'back',
  'held',
]);
export type CostumeAnchor = z.infer<typeof CostumeAnchorSchema>;

/**
 * Where a squishy accessory sits: on top of the head, round the neck, on the
 * back (between the shoulders: wings, capes; #515), or the whole torso
 * (`body`, from its ground point, in its sizes: a sheet's hem; #515).
 */
export const SquishyAnchorSchema = z.enum(['crown', 'neck', 'back', 'body']);
export type SquishyAnchor = z.infer<typeof SquishyAnchorSchema>;

export const ClothingPieceSchema = z.strictObject({
  shape: PartShapeSchema,
  /** Costumes only: the socket this piece sits on (default: the whole-body costume box). */
  on: CostumeAnchorSchema.optional(),
  /**
   * Squishy accessories only: the socket this piece sits on, when it isn't
   * the item's own `anchor` (a squishy costume's cape on the `back`, its
   * collar on the `neck`; #515).
   */
  anchor: SquishyAnchorSchema.optional(),
  /** Lit from inside (eyes, glowing wing spots), like a glowing squishy. */
  glow: z.literal(true).optional(),
  /** Centre, from the socket's anchor, in socket sizes (+x is the viewer's right, +y up, −z the front). */
  at: Vec3Schema,
  /** Size of the primitive, in socket sizes. */
  size: SizeSchema,
  /** Degrees: pitch (x), yaw (y), roll (z). */
  turn: Vec3Schema.optional(),
  color: HexColorSchema,
});
export type ClothingPiece = z.infer<typeof ClothingPieceSchema>;

/**
 * A costume that draws a ready-made figure instead of pieces, by name, so
 * the numbers stay in the one place that owns them (a model costume has no
 * pieces: they would sit on the Keeper's sockets, not on the figure): the
 * client builds `hollow-man` from the Hollow Man's own shape (#21). A closed
 * list, so every model is known and validated.
 */
export const CostumeModelSchema = z.enum(['hollow-man']);
export type CostumeModel = z.infer<typeof CostumeModelSchema>;

/** The chip colour for a model costume, which has no pieces to take one from. */
export const COSTUME_MODEL_SWATCH: Readonly<Record<CostumeModel, string>> = {
  'hollow-man': '#251c3a',
};

/** Most pieces an item has; a head-to-toe costume may have up to `MAX_COSTUME_PIECES`. */
export const MAX_ITEM_PIECES = 12;
export const MAX_COSTUME_PIECES = 24;

/** Soft vinyl-toy primitives (design doc §19), a few per item so they stay cheap. */
export const ClothingVisualSchema = z.strictObject({
  /** At least one, unless the costume is a `model`, which draws itself. */
  pieces: z.array(ClothingPieceSchema).max(MAX_COSTUME_PIECES),
  /** Squishy accessories only. */
  anchor: SquishyAnchorSchema.optional(),
  /**
   * Squishy accessories only: a hood (#515). Like a hat, it tucks the
   * squishy's own crown parts away while worn, and its ears too, so they
   * never poke through the sheet.
   */
  hood: z.literal(true).optional(),
  /**
   * Costumes only: hides the Keeper's own body, head, hands, hair and starter
   * outfit while worn (default: false), so the costume is the whole figure.
   * The Keeper's place, shadow and sockets stay where they were (the feet are
   * not drawn: the figure stands where they did), so walking, exploring and
   * the home view line up.
   */
  replacesBody: z.boolean().optional(),
  /** Costumes only: draws this ready-made figure (it replaces the body). */
  model: CostumeModelSchema.optional(),
});
export type ClothingVisual = z.infer<typeof ClothingVisualSchema>;

/** The colour of an item's chip in a list: its first piece's, else its model's. */
export function clothingSwatch(item: { readonly visual: ClothingVisual }): string {
  const { pieces, model } = item.visual;
  return pieces[0]?.color ?? (model ? COSTUME_MODEL_SWATCH[model] : '#ffffff');
}

/** One catalog row (design doc §23 "Data"). Cosmetic only: no stats, ever. */
export const ClothingItemSchema = z.strictObject({
  id: ContentIdSchema,
  name: DisplayNameSchema,
  description: DescriptionSchema,
  slot: ClothingSlotSchema,
  rarity: ClothingRaritySchema,
  /** Only obtainable in this season (design doc §15); wearable forever. */
  season: ContentIdSchema.optional(),
  sources: z.array(ClothingSourceSchema).min(1),
  /** Can move between players (trades and gifts arrive later). */
  tradable: z.boolean(),
  /** Patch Coins, for items the Boutique sells (#45). */
  boutiquePrice: z.number().int().positive().optional(),
  visual: ClothingVisualSchema,
});
export type ClothingItem = z.infer<typeof ClothingItemSchema>;

/**
 * A squishy costume (#515): a squishy accessory that is a trick-or-treat
 * prize. It sits in the accessory's one slot (owner, #515) and, like a
 * Keeper costume, wears its rarity's finish; everyday accessories stay
 * plain vinyl.
 */
export function isSquishyCostume(item: ClothingItem): boolean {
  return item.slot === SQUISHY_SLOT && item.sources.includes('trick-or-treat');
}

/** A Keeper item: one of the eight wardrobe slots. */
export type KeeperClothing = ClothingItem & { readonly slot: WardrobeSlot };

export function isKeeperClothing(item: ClothingItem): item is KeeperClothing {
  return item.slot !== SQUISHY_SLOT;
}

/** The most things a Keeper wears at once: one per slot. */
export const MAX_WORN = WARDROBE_SLOTS.length;

/**
 * What a Keeper wears: item ids, at most one per slot. A costume hides the
 * other items while it's on (#42's rule) but they stay in the list, so taking
 * the costume off brings them back.
 */
export const WearingSchema = z.array(ContentIdSchema).max(MAX_WORN);
export type Wearing = z.infer<typeof WearingSchema>;

/**
 * Validates the catalog (zod, unique ids, seasons, sources) and returns
 * readable problems, or `[]`. `seasons` are the season ids in `GAME_DATA`.
 */
export function checkClothingData(input: unknown, seasons: readonly string[]): string[] {
  const known = new Set(seasons);
  const schema = z.array(ClothingItemSchema).superRefine((items, ctx) => {
    const report: Report = (path, message) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    checkUniqueIds('clothing', items, report);
    items.forEach((item, i) => {
      const at = (field: string) => ['clothing', i, field];
      checkRef(known, 'season', item.season, at('season'), report);
      if (new Set(item.sources).size !== item.sources.length) {
        report(at('sources'), 'a source is listed twice');
      }
      if (item.season && item.sources.includes('starter')) {
        report(at('sources'), 'seasonal items are only got in season, so never starters');
      }
      if (item.tradable && item.sources.some((s) => ACCOUNT_BOUND.includes(s))) {
        report(at('tradable'), 'starter, tutorial and milestone items stay with the account');
      }
      if ((item.boutiquePrice !== undefined) !== item.sources.includes('boutique')) {
        report(at('boutiquePrice'), 'Boutique items need a price, and only they have one');
      }
      if ((item.visual.anchor !== undefined) !== (item.slot === SQUISHY_SLOT)) {
        report(at('visual'), 'squishy accessories need an anchor, and only they have one');
      }
      if (item.slot !== SQUISHY_SLOT) {
        if (item.visual.hood !== undefined) {
          report(at('visual'), 'only squishy accessories can be a `hood`');
        }
        if (item.visual.pieces.some((p) => p.anchor !== undefined)) {
          report(at('visual'), 'only squishy accessories place pieces on squishy anchors');
        }
      } else if (
        item.visual.hood &&
        !item.visual.pieces.some((p) => (p.anchor ?? item.visual.anchor) === 'crown')
      ) {
        report(at('visual'), 'a `hood` goes on the head, so it needs a piece on the `crown`');
      }
      if (item.visual.pieces.length === 0 && item.visual.model === undefined) {
        report(at('visual'), 'an item needs at least one piece, unless it is a `model`');
      }
      if (item.slot !== 'costume') {
        if (item.visual.replacesBody !== undefined || item.visual.model !== undefined) {
          report(at('visual'), 'only costumes can replace the body or use a `model`');
        }
        if (item.visual.pieces.length > MAX_ITEM_PIECES) {
          report(at('visual'), `only costumes have more than ${String(MAX_ITEM_PIECES)} pieces`);
        }
        if (item.visual.pieces.some((p) => p.on !== undefined)) {
          report(at('visual'), 'only costumes place pieces on body sockets (`on`)');
        }
      }
      if (item.visual.model !== undefined && item.visual.pieces.length > 0) {
        report(at('visual'), 'a `model` draws itself, so it has no pieces');
      }
      if (item.visual.model !== undefined && item.visual.replacesBody !== true) {
        report(at('visual'), 'a `model` is the whole figure, so it needs `replacesBody: true`');
      }
      // An arm piece turns with the arm's splay (a roll), which only adds up
      // right without a pitch or yaw of its own.
      if (item.visual.pieces.some((p) => p.on === 'arms' && (p.turn?.[0] || p.turn?.[1]))) {
        report(at('visual'), 'pieces on the arms may only roll (turn [0, 0, z])');
      }
    });
    // The wardrobe is never empty (design doc §23): every account starts with some.
    if (!items.some((item) => isKeeperClothing(item) && item.sources.includes('starter'))) {
      report(['clothing'], 'no starter clothing for Keepers');
    }
    if (!items.some((item) => !isKeeperClothing(item) && item.sources.includes('starter'))) {
      report(['clothing'], 'no starter accessory for squishies');
    }
  });
  const result = schema.safeParse(input);
  return result.success ? [] : formatDataIssues({ clothing: input }, result.error);
}

/** Why a Keeper can't wear `wearing`, checked against the catalog; null when it can. */
export type WearingProblem =
  | { kind: 'unknown'; itemId: string }
  | { kind: 'not-keeper'; itemId: string }
  | { kind: 'same-slot'; slot: WardrobeSlot }
  | { kind: 'twice'; itemId: string };

/**
 * The first reason `wearing` isn't a valid set of Keeper clothes (an unknown
 * id, a squishy accessory, an item twice, two items in one slot), or null.
 * Ownership is the server's check.
 */
export function wearingProblem(
  wearing: readonly string[],
  catalog: ReadonlyMap<string, ClothingItem>,
): WearingProblem | null {
  const slots = new Set<WardrobeSlot>();
  const seen = new Set<string>();
  for (const id of wearing) {
    const item = catalog.get(id);
    if (!item) return { kind: 'unknown', itemId: id };
    if (!isKeeperClothing(item)) return { kind: 'not-keeper', itemId: id };
    if (seen.has(id)) return { kind: 'twice', itemId: id };
    if (slots.has(item.slot)) return { kind: 'same-slot', slot: item.slot };
    seen.add(id);
    slots.add(item.slot);
  }
  return null;
}

/** `wearing` in slot order (hat first, costume last), so equal outfits compare equal. */
export function sortWearing(
  wearing: readonly string[],
  catalog: ReadonlyMap<string, ClothingItem>,
): string[] {
  const order = (id: string) => {
    const slot = catalog.get(id)?.slot;
    return slot && slot !== SQUISHY_SLOT ? WARDROBE_SLOTS.indexOf(slot) : WARDROBE_SLOTS.length;
  };
  return [...wearing].sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
}
