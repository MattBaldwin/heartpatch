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
  // ART_BIBLE §1.2 body plans: limbs, spines, manes and fangs.
  'legs',
  'arms',
  'back',
  'spikes',
  'mane',
  'fangs',
]);
export type PartSlot = z.infer<typeof PartSlotSchema>;

/**
 * Slots that sit on a species' head when it has one (`visual.head`); the
 * rest sit on its torso. Without a head, everything sits on the body.
 */
export const HEAD_SLOTS: readonly PartSlot[] = [
  'eyes',
  'brows',
  'mouth',
  'cheeks',
  'fangs',
  'ears',
  'horns',
  'crown',
  'mane',
];

/** Slots whose parts lie flat on the surface instead of sticking out. */
export const SURFACE_SLOTS: readonly PartSlot[] = ['eyes', 'brows', 'mouth', 'cheeks', 'pattern'];

/**
 * The primitive a part is built from; each has one geometry builder in the
 * client. `arc` is a curved tube (smiles, closed eyes, curly tails), opening
 * upwards unless the part sets `flip`. `box` is a flat, softly rounded block
 * whose sides line up with the part's width, length and thickness, so a
 * shallow `size` makes a straight bar or plank that doesn't bulge in the
 * middle (#234 kit extension; new shapes go at the end). `bent` is a flat,
 * slightly tapering strip (a leaf-rake tine), its wide side to the front,
 * straight for its top 40% and then curving evenly towards the front by 65°
 * over the rest. Its thickness covers the strip plus how far the tip curves
 * forward, so size it in the client's `bentProportions()` to keep the
 * strip's section and curve true.
 */
export const PartShapeSchema = z.enum([
  'ellipsoid',
  'capsule',
  'cone',
  'teardrop',
  'arc',
  'box',
  'bent',
]);
export type PartShape = z.infer<typeof PartShapeSchema>;

/**
 * Which colour a part takes. `primary`, `secondary`, `accent` and `detail`
 * are the species palette's 1st to 4th colours (a missing one falls back to
 * the one before it); `ink`, `white` and `blush` are fixed toy colours.
 * `metal` (#234 kit extension, appended) is a fixed cool grey for tool metal
 * such as rake tines.
 */
export const PaletteRoleSchema = z.enum([
  'primary',
  'secondary',
  'accent',
  'detail',
  'ink',
  'white',
  'blush',
  'metal',
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
  /**
   * A heart's single smooth shape: the top dips into a cleft between two
   * shoulders (`depth`, a share of the height) and the bottom draws in to a
   * soft point (`tip`, 0 none to 1 a sharp point). Off unless set.
   */
  cleft: z
    .strictObject({ depth: z.number().min(0).max(0.4), tip: z.number().min(0).max(0.9) })
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
  /** `count` copies evenly spaced around the body at `up`, within `around ± spread`. */
  z.strictObject({
    kind: z.literal('ring'),
    count: z.number().int().min(2).max(16),
    spread: degrees(0, 180),
  }),
  /** `count` copies up the body at `around`, from `up` to `to` (a spine of spikes or fins). */
  z.strictObject({
    kind: z.literal('row'),
    count: z.number().int().min(2).max(12),
    to: degrees(-90, 90),
  }),
  /** Four copies: a front pair at ±`around` and a back pair at ±(180 − `around`). Legs. */
  z.strictObject({ kind: z.literal('quad') }),
  /**
   * `count` pieces in a line from `around`/`up`: each piece steps `step`
   * (of its own length) along, bends `curl` degrees up (negative: down),
   * swings ±`wave` degrees side to side, and scales by `shrink`. Tails and
   * long serpent bodies.
   */
  z.strictObject({
    kind: z.literal('chain'),
    count: z.number().int().min(2).max(14),
    step: z.number().min(0.2).max(1.2),
    curl: degrees(-60, 60),
    wave: degrees(0, 60),
    shrink: z.number().min(0.5).max(1.2),
  }),
]);
export type PartLayout = z.infer<typeof PartLayoutSchema>;

/**
 * A second mesh a part carries in its own colour (#234 234b, appended).
 * `bent-toe` is a wide, flat chisel toe at the tip of a `bent` strip (a
 * leaf-rake tine ending in a lighter steel), so it only fits `bent` parts.
 */
export const PartAccentMeshSchema = z.enum(['bent-toe']);
export type PartAccentMesh = z.infer<typeof PartAccentMeshSchema>;

/** Which part shape each accent mesh is built on. */
const ACCENT_SHAPE: Record<PartAccentMesh, PartShape> = { 'bent-toe': 'bent' };

export const PartSchema = z
  .strictObject({
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
     * or turn outwards like eyebrows (surface parts). On a `ring` (#234 kit
     * extension) the copies fan out: each leans sideways, away from `around`,
     * in proportion to how far round it sits, the outermost by nearly `splay`
     * (a leaf rake's tines). Unset leaves a ring's copies parallel, as before.
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
    /**
     * Opt-in (#234 round 11). `front` lines a sticking-out part up in front of
     * its host's face instead of on the curved surface, like the tines along a
     * rake head: each copy starts at the height and sideways spot of
     * `around`/`up`, `standoff` in front of the face's centre line at that
     * height (so every copy roots on one straight line, the front of a bar),
     * and grows straight down, leaning forward towards the viewer by `tilt`
     * (and sideways by `splay` on a ring). Unset is `surface`, today's
     * behaviour.
     */
    anchor: z.enum(['surface', 'front']).optional(),
    /**
     * Opt-in with `anchor: 'front'` (#234 round 11): how far in front of the
     * face's centre line the part roots, relative to host height.
     */
    standoff: z.number().min(0).max(0.5).optional(),
    /**
     * Opt-in (#234 kit extension): this part stands in for the species' mouth,
     * so a feeling face kit's mouth requirement (`ART_RULES.feelingFaces`) is
     * met by it and no mouth part is drawn (a rake bar that is the mouth).
     * The client also keys two looks on it: a mouth stand-in holds still (no
     * per-squishy placement wobble, so the rings rooted on it stay put) and is
     * drawn plain, without the rarity's vinyl finish, like the rest of the face.
     */
    replaces: z.enum(['mouth']).optional(),
    /**
     * Opt-in (#234 234b): a two-tone part. The accent mesh is drawn on the
     * same part in its own fixed colour (a lighter steel toe on a rake tine).
     * Its own hex colour, like `ink`, so a palette never recolours it.
     */
    accent: z
      .strictObject({
        mesh: PartAccentMeshSchema,
        // The same rule as the species `HexColorSchema` (species.ts imports this file).
        color: z.string().regex(/^#[0-9a-f]{6}$/, 'Expected a colour like "#ffaa00"'),
      })
      .optional(),
  })
  .refine((p) => !p.accent || p.shape === ACCENT_SHAPE[p.accent.mesh], {
    message: 'this accent mesh only fits its own part shape ("bent-toe" needs "bent")',
    path: ['accent', 'mesh'],
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
  visual: {
    readonly body: string;
    readonly parts: readonly string[];
    readonly head?: { readonly body: string };
    readonly attackPart?: PartSlot;
  },
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
    if (part.anchor === 'front' && (SURFACE_SLOTS.includes(part.slot) || part.slot === 'legs')) {
      report(at, `part "${id}" can't stand in front of its host: only sticking-out parts can`);
    }
    if (part.standoff !== undefined && part.anchor !== 'front') {
      report(at, `part "${id}" has a standoff but isn't anchored in front of its host`);
    }
  });
  const replacer = visual.parts.find((id) => registry.parts.get(id)?.replaces === 'mouth');
  if (replacer !== undefined && slots.has('mouth')) {
    report(
      [...path, 'parts'],
      `part "${replacer}" replaces the mouth, so "${slots.get('mouth')}" isn't needed`,
    );
  }
  if (visual.head && !registry.bodies.has(visual.head.body)) {
    report([...path, 'head', 'body'], `unknown head body "${visual.head.body}"`);
  }
  if (visual.attackPart && !slots.has(visual.attackPart)) {
    report([...path, 'attackPart'], `no part in the ${visual.attackPart} slot to attack with`);
  }
  const unknownParts = visual.parts.some((id) => !registry.parts.has(id));
  if (!slots.has('eyes') && !unknownParts) {
    report([...path, 'parts'], 'every squishy needs eyes (a part in the eyes slot)');
  }
}
