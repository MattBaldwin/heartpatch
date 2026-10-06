import { z } from 'zod';
import { ContentIdSchema } from './common.js';
import type { Path, Report } from './issues.js';

/**
 * The procedural vinyl-toy registry (design doc §19): body shapes and
 * swappable parts that species visuals point at by id. Ids are the contract
 * species content is written against, so never rename one.
 *
 * Adding a body or a part is a data entry here. Only a new part `shape` (a
 * new primitive) also needs a geometry builder in the client.
 */

const degrees = (min: number, max: number) => z.number().min(min).max(max);

/**
 * Where a part goes. A species has at most one part per slot. `eyes`,
 * `mouth`, `cheeks` and `pattern` lie on the body's surface; the others stick
 * out from it.
 */
export const PartSlotSchema = z.enum([
  'eyes',
  'brows',
  'mouth',
  'cheeks',
  'ears',
  'horns',
  'crown',
  'tail',
  'wings',
  'pattern',
]);
export type PartSlot = z.infer<typeof PartSlotSchema>;

/** Slots whose parts lie flat on the surface instead of sticking out. */
export const SURFACE_SLOTS: readonly PartSlot[] = ['eyes', 'brows', 'mouth', 'cheeks', 'pattern'];

/**
 * The primitive a part is built from; each has one geometry builder in the
 * client. `arc` is a curved tube (smiles, closed eyes, curly tails), opening
 * upwards unless the part sets `flip`.
 */
export const PartShapeSchema = z.enum(['ellipsoid', 'capsule', 'cone', 'teardrop', 'arc']);
export type PartShape = z.infer<typeof PartShapeSchema>;

/**
 * Which colour a part takes. `primary`, `secondary`, `accent` and `detail`
 * are the species palette's 1st to 4th colours (a missing one falls back to
 * the one before it); `ink`, `white` and `blush` are fixed toy colours.
 */
export const PaletteRoleSchema = z.enum([
  'primary',
  'secondary',
  'accent',
  'detail',
  'ink',
  'white',
  'blush',
]);
export type PaletteRole = z.infer<typeof PaletteRoleSchema>;

/** A proportion relative to the body's height. */
const proportion = z.number().min(0.005).max(1.5);

export const BodySchema = z.strictObject({
  id: ContentIdSchema,
  /** Size in world units for a species of `size` 1 (about one hex tile is 2). */
  width: z.number().min(0.3).max(2.5),
  height: z.number().min(0.3).max(2.5),
  depth: z.number().min(0.3).max(2.5),
  /** 0 is a smooth ellipsoid; towards 1 is a soft, boxy squircle. */
  squareness: z.number().min(0).max(1),
  /** Narrower top (negative, a pear) or narrower bottom (positive). */
  taper: z.number().min(-0.6).max(0.6),
  /** Pulls the top into a soft point: drops, flames, little ghosts. */
  peak: z.number().min(0).max(1),
  /** How flat the bottom sits on the ground; 0 is fully round. */
  bottomFlat: z.number().min(0).max(0.9),
  /** Pumpkin-style grooves running top to bottom. */
  lobes: z
    .strictObject({ count: z.number().int().min(2).max(16), depth: z.number().min(0).max(0.25) })
    .optional(),
  /** A pinch around the body at height `at` (−1 bottom to 1 top): a snowman's two balls. */
  waist: z
    .strictObject({
      at: z.number().min(-0.9).max(0.9),
      depth: z.number().min(0).max(0.4),
      width: z.number().min(0.05).max(0.6),
    })
    .optional(),
  /** A standing star seen from the front: `count` soft points, one at the top. */
  points: z
    .strictObject({ count: z.number().int().min(3).max(12), depth: z.number().min(0).max(0.35) })
    .optional(),
  /** A ghost's scalloped hem: the bottom edge lifts between `count` little feet. */
  hem: z
    .strictObject({ count: z.number().int().min(3).max(12), depth: z.number().min(0).max(0.3) })
    .optional(),
  /** Per-squishy proportion variance as a fraction (0.06 is ±6%). */
  jitter: z.number().min(0).max(0.2),
});
export type Body = z.infer<typeof BodySchema>;

/**
 * `single` sits at `around`; `pair` mirrors left and right at ±`around`;
 * `scatter` places `count` copies at random (seeded per squishy) within
 * `around ± aroundRange` and `up ± upRange`.
 */
export const PartLayoutSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('single') }),
  z.strictObject({ kind: z.literal('pair') }),
  z.strictObject({
    kind: z.literal('scatter'),
    count: z.number().int().min(2).max(12),
    aroundRange: degrees(0, 180),
    upRange: degrees(0, 90),
  }),
]);
export type PartLayout = z.infer<typeof PartLayoutSchema>;

export const PartSchema = z.strictObject({
  id: ContentIdSchema,
  slot: PartSlotSchema,
  shape: PartShapeSchema,
  /**
   * `[width, length, thickness]` relative to body height. Surface parts lie
   * flat (length runs up the body); sticking-out parts grow `length` outwards.
   */
  size: z.tuple([proportion, proportion, proportion]),
  color: PaletteRoleSchema,
  layout: PartLayoutSchema,
  /** Degrees around the body from the front: 0 is the face, 180 the back. */
  around: degrees(0, 180),
  /** Degrees up the body: -90 is the bottom, 0 the middle, 90 the top. */
  up: degrees(-90, 90),
  /** Sticking-out parts lean towards the top (positive) or bottom; surface parts ignore it. */
  tilt: degrees(-90, 90).optional(),
  /**
   * Paired parts lean outwards, away from the middle (sticking-out parts),
   * or turn outwards like eyebrows (surface parts).
   */
  splay: degrees(-90, 90).optional(),
  /** How far the part sinks into the body: 0 sits on it, 1 is fully sunk. */
  sink: z.number().min(0).max(1).optional(),
  /** Flips an `arc` upside down (a frown-shaped happy eye). */
  flip: z.boolean().optional(),
  /** Adds a glossy white glint (eyes). */
  highlight: z.boolean().optional(),
  /** Per-squishy size variance as a fraction. */
  jitter: z.number().min(0).max(0.3),
});
export type Part = z.infer<typeof PartSchema>;

/** The registry a species visual is checked against. */
export interface VisualRegistry {
  readonly bodies: ReadonlyMap<string, Body>;
  readonly parts: ReadonlyMap<string, Part>;
}

export function visualRegistry(data: {
  readonly bodies: readonly Body[];
  readonly parts: readonly Part[];
}): VisualRegistry {
  return {
    bodies: new Map(data.bodies.map((b) => [b.id, b])),
    parts: new Map(data.parts.map((p) => [p.id, p])),
  };
}

/**
 * Reports problems with one species visual: unknown body or parts, a part
 * listed twice, two parts in one slot, or no eyes (every squishy has a face).
 * Used by `checkGameData` and by the client's gallery tests.
 */
export function checkSpeciesVisual(
  visual: { readonly body: string; readonly parts: readonly string[] },
  registry: VisualRegistry,
  path: Path,
  report: Report,
): void {
  if (!registry.bodies.has(visual.body)) {
    report([...path, 'body'], `unknown body "${visual.body}"`);
  }
  const slots = new Map<PartSlot, string>();
  visual.parts.forEach((id, i) => {
    const at = [...path, 'parts', i];
    if (visual.parts.indexOf(id) !== i) {
      report(at, `part "${id}" is listed twice`);
      return;
    }
    const part = registry.parts.get(id);
    if (!part) {
      report(at, `unknown part "${id}"`);
      return;
    }
    const other = slots.get(part.slot);
    if (other !== undefined) {
      report(at, `parts "${other}" and "${id}" both use the ${part.slot} slot`);
    }
    slots.set(part.slot, id);
  });
  const unknownParts = visual.parts.some((id) => !registry.parts.has(id));
  if (!slots.has('eyes') && !unknownParts) {
    report([...path, 'parts'], 'every squishy needs eyes (a part in the eyes slot)');
  }
}
