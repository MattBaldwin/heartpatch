import type { Body, ElementId, FeelingId, Part, SpeciesVisual } from '@heartpatch/shared';

/**
 * DRAFT (#234, lane 234a): the four mini-boss lines, for the owner's mockup
 * round only. Nothing here ships: this file lives in the dev-only squishy
 * gallery (`/gallery.html?drafts`), it is not part of `GAME_DATA`, and no
 * roster, spawn table or server code imports it. Lane 234b moves the approved
 * bodies, parts and lines into `packages/shared/src/data` once the owner signs
 * off on the renders.
 *
 * The body style needs no contract change (plan §8): hair sits in `crown`
 * and `mane`, a moustache or rake-tine teeth in `fangs`, a cap brim, goggles
 * or earrings in `horns`, and a cardigan's buttons in `pattern`. Every new
 * part uses the existing five primitives and the shared squishy material.
 */

/** `?drafts` in the gallery shows these looks; every id starts with this. */
export const DRAFT_PREFIX = 'draft-';

/**
 * A taller, upright toy torso for grown-up bosses: still a soft blob with a
 * big head on top (never Keeper proportions), with a slight waist so the
 * head reads as sitting on shoulders. Plus a low, boxy kart for Rickeyride
 * and a round belly for Dad.
 */
export const DRAFT_BODIES: Body[] = [
  {
    id: 'draft-upright',
    width: 1.0,
    height: 1.12,
    depth: 0.92,
    squareness: 0.12,
    taper: -0.12,
    peak: 0,
    bottomFlat: 0.5,
    waist: { at: 0.5, depth: 0.08, width: 0.35 },
    jitter: 0.04,
  },
  {
    // A cardigan flaring out into a triangle at the hem.
    id: 'draft-cardigan',
    width: 1.24,
    height: 1.1,
    depth: 0.98,
    squareness: 0.35,
    taper: -0.6,
    peak: 0,
    bottomFlat: 0.9,
    hem: { count: 8, depth: 0.06 },
    jitter: 0.04,
  },
  {
    // Widest at the belly.
    id: 'draft-dad-belly',
    width: 1.22,
    height: 1.14,
    depth: 1.08,
    squareness: 0.18,
    taper: -0.14,
    peak: 0,
    bottomFlat: 0.5,
    jitter: 0.04,
  },
  {
    id: 'draft-kart',
    width: 1.3,
    height: 0.62,
    depth: 1.12,
    squareness: 0.6,
    taper: 0.12,
    peak: 0,
    bottomFlat: 0.55,
    jitter: 0.03,
  },
  {
    // Rakelet's head: wide and flat-faced, so the rake bar spans wider than
    // the body. A true oval (squareness 0, round 9): any squareness pushes a
    // ring's middle copies apart, which opened a gap between the middle tines.
    id: 'draft-rake-head',
    width: 1.3,
    height: 1.0,
    depth: 0.92,
    squareness: 0,
    taper: 0,
    peak: 0,
    bottomFlat: 0.3,
    jitter: 0.02,
  },
];

const part = (p: Part): Part => p;

export const DRAFT_PARTS: Part[] = [
  // ── Faces: brows for all four (each keeps its feeling's eye kit, §1.6) ──
  part({
    id: 'draft-soft-brows',
    slot: 'brows',
    shape: 'capsule',
    size: [0.12, 0.035, 0.04],
    color: 'ink',
    layout: { kind: 'pair' },
    around: 21,
    up: 34,
    splay: 4,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    // Inner ends down: determined, never angry (§1.1).
    id: 'draft-fierce-brows',
    slot: 'brows',
    shape: 'capsule',
    size: [0.13, 0.04, 0.045],
    color: 'ink',
    layout: { kind: 'pair' },
    around: 20,
    up: 33,
    splay: -18,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    id: 'draft-bushy-brows',
    slot: 'brows',
    shape: 'capsule',
    size: [0.15, 0.06, 0.06],
    color: 'ink',
    layout: { kind: 'pair' },
    around: 21,
    up: 33,
    splay: -4,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    id: 'draft-wide-grin',
    slot: 'mouth',
    shape: 'arc',
    size: [0.3, 0.09, 0.055],
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -2,
    sink: 0.3,
    jitter: 0,
  }),

  part({
    // Freckles across the nose: on the head (cheeks slot), not the torso.
    id: 'draft-face-freckles',
    slot: 'cheeks',
    shape: 'ellipsoid',
    size: [0.03, 0.03, 0.014],
    color: 'detail',
    layout: { kind: 'scatter', count: 8, aroundRange: 34, upRange: 6 },
    around: 0,
    up: 6,
    sink: 0.4,
    jitter: 0.2,
  }),

  // ── Rakelet: rake-tine teeth, leaf-pile hair, one leaf sliding off ─────
  part({
    // ...long, countable tines hanging from it as the teeth, reaching well
    // below the chin and leaning a little forward of the mouth...
    id: 'draft-rake-tines',
    slot: 'fangs',
    shape: 'capsule',
    size: [0.055, 0.6, 0.055],
    color: 'white',
    layout: { kind: 'ring', count: 8, spread: 48 },
    around: 0,
    up: -19,
    tilt: -62,
    sink: 0.08,
    jitter: 0,
  }),
  // Round 8 (owner decision): "Rakelet should never have a handle. His
  // mouth is the rake." Every stage's mouth is a rake head on its own: a
  // wooden crossbar (`box`, `replaces: 'mouth'`) wider than the face, and a
  // dark cavity behind the tines so it still reads as a mouth. No handle,
  // stub, knob or socket anywhere.
  // Round 11: a garden-rake head, not a comb. The tines come off the bar's
  // FRONT face (`anchor: 'front'`), sparse and parallel, angled down and out
  // towards the viewer, each ending in a big forward hook (`bent`), with a
  // dark rivet at each root. 3, 4 and 5 tines by stage, built the same way.
  part({
    // Pileup's baby crossbar: its mouth, a little wider than its face.
    id: 'draft-rake-bar-small',
    slot: 'mane',
    shape: 'box',
    size: [1.1, 0.14, 0.2], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -12,
    tilt: 12, // levels the plank on the curving face
    sink: 0.45,
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // Pileup's three baby tines.
    id: 'draft-rake-tines-small',
    slot: 'fangs',
    shape: 'bent',
    size: [0.062, 0.372, 0.207], // bentProportions() scaled: a round dowel, a round hook
    color: 'metal',
    layout: { kind: 'ring', count: 3, spread: 68 }, // TUNE: gaps ~2.5x a tine's thickness
    around: 0,
    up: -19, // TUNE: the bar's lower front face
    tilt: 40, // TUNE: down and out, ~40 degrees towards the viewer (30 read as straight down head-on)
    sink: 0.04,
    jitter: 0,
    anchor: 'front',
    standoff: 0.12, // TUNE: just inside the bar's front face
  }),
  part({
    // A dark rivet at each tine's root on the bar's front face.
    id: 'draft-rake-rivets-small',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.06, 0.03, 0.06],
    color: 'ink',
    layout: { kind: 'ring', count: 3, spread: 68 },
    around: 0,
    up: -17,
    tilt: 90, // straight out towards the viewer
    sink: 0.4,
    jitter: 0,
    anchor: 'front',
    standoff: 0.13,
  }),
  part({
    // Pileup's mouth cavity behind its tines.
    id: 'draft-rake-mouth-small',
    slot: 'ears',
    shape: 'ellipsoid',
    size: [0.44, 0.06, 0.22],
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -34, // TUNE: under the bar, behind the tines
    sink: 0.85, // recessed into the face
    jitter: 0,
  }),
  part({
    // Rakeling's crossbar: wider than its face, overhanging both cheeks.
    id: 'draft-rake-bar',
    slot: 'mane',
    shape: 'box',
    size: [1.12, 0.1, 0.14], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -16,
    tilt: 16, // levels the plank on the curving face
    sink: 0.45,
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // Rakeling's four tines.
    id: 'draft-rake-tines-mid',
    slot: 'fangs',
    shape: 'bent',
    size: [0.067, 0.41, 0.228], // bentProportions() scaled: a round dowel, a round hook
    color: 'metal',
    layout: { kind: 'ring', count: 4, spread: 86 }, // TUNE: gaps ~2.5x a tine's thickness
    around: 0,
    up: -21, // TUNE: the bar's lower front face
    tilt: 40, // TUNE: down and out, ~40 degrees towards the viewer (30 read as straight down head-on)
    sink: 0.04,
    jitter: 0,
    anchor: 'front',
    standoff: 0.094, // TUNE: just inside the bar's front face
  }),
  part({
    // A dark rivet at each tine's root on the bar's front face.
    id: 'draft-rake-rivets-mid',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.065, 0.032, 0.065],
    color: 'ink',
    layout: { kind: 'ring', count: 4, spread: 86 },
    around: 0,
    up: -19,
    tilt: 90, // straight out towards the viewer
    sink: 0.4,
    jitter: 0,
    anchor: 'front',
    standoff: 0.104,
  }),
  part({
    // Rakeling's mouth cavity behind its tines.
    id: 'draft-rake-mouth',
    slot: 'ears',
    shape: 'ellipsoid',
    size: [0.66, 0.06, 0.3],
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -36, // TUNE: under the bar, behind the tines
    sink: 0.85, // recessed into the face
    jitter: 0,
  }),
  part({
    // Rakelet's crossbar: a straight rake head, well wider than his face, as his jaw and upper lip.
    id: 'draft-rake-tool-bar',
    slot: 'mane',
    shape: 'box',
    size: [1.3, 0.16, 0.18], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -18,
    tilt: 18, // levels the plank on the curving face
    sink: 0.45,
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // Rakelet's five tines.
    id: 'draft-rake-tool-tines',
    slot: 'fangs',
    shape: 'bent',
    size: [0.08, 0.49, 0.272], // bentProportions() scaled: a round dowel, a round hook
    color: 'metal',
    layout: { kind: 'ring', count: 5, spread: 105 }, // TUNE: gaps ~2.5x a tine's thickness
    around: 0,
    up: -25, // TUNE: the bar's lower front face
    tilt: 40, // TUNE: down and out, ~40 degrees towards the viewer (30 read as straight down head-on)
    sink: 0.04,
    jitter: 0,
    anchor: 'front',
    standoff: 0.148, // TUNE: just inside the bar's front face
  }),
  part({
    // A dark rivet at each tine's root on the bar's front face.
    id: 'draft-rake-tool-rivets',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.075, 0.035, 0.075],
    color: 'ink',
    layout: { kind: 'ring', count: 5, spread: 105 },
    around: 0,
    up: -23,
    tilt: 90, // straight out towards the viewer
    sink: 0.4,
    jitter: 0,
    anchor: 'front',
    standoff: 0.158,
  }),
  part({
    // Rakelet's mouth cavity behind the tines.
    id: 'draft-rake-tool-mouth',
    slot: 'cheeks',
    shape: 'ellipsoid',
    size: [0.92, 0.06, 0.36], // round 11: bigger, so the tines read as teeth in a mouth
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -38, // TUNE: under the bar, behind the tines
    sink: 0.85, // recessed into the face
    jitter: 0,
  }),
  part({
    // A green leaf mid-fall on the leaf pile (round 6: wider than tall, flat,
    // tipped over sideways so it can't read as a horn).
    id: 'draft-falling-leaf-top',
    slot: 'ears',
    shape: 'teardrop',
    size: [0.42, 0.3, 0.05],
    color: 'primary',
    layout: { kind: 'single' },
    around: 40,
    up: 74,
    tilt: -25,
    sink: 0.2,
    jitter: 0,
  }),
  part({
    // Drooping lanky arms: one soft, unjointed piece each side (no elbow
    // seam), thin at the shoulder and swelling to a heavy hanging hand.
    id: 'draft-droop-arms',
    slot: 'arms',
    shape: 'teardrop',
    size: [0.26, 1.15, 0.26],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 70,
    up: 30,
    tilt: -90, // TUNE
    splay: 3,
    flip: true,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    // A messy, spiky heap of autumn leaves for hair.
    id: 'draft-leaf-pile-hair',
    slot: 'crown',
    shape: 'teardrop',
    size: [0.3, 0.42, 0.07],
    color: 'accent',
    layout: { kind: 'scatter', count: 12, aroundRange: 180, upRange: 26 },
    around: 0,
    up: 58,
    tilt: 78,
    sink: 0.3,
    jitter: 0.15,
  }),
  part({
    id: 'draft-leaf-tuft',
    slot: 'crown',
    shape: 'teardrop',
    size: [0.24, 0.34, 0.07],
    color: 'accent',
    layout: { kind: 'scatter', count: 4, aroundRange: 50, upRange: 10 },
    around: 0,
    up: 78,
    tilt: 20,
    sink: 0.25,
    jitter: 0.12,
  }),
  part({
    // The one leaf always falling off.
    id: 'draft-falling-leaf',
    slot: 'horns',
    shape: 'teardrop',
    size: [0.22, 0.3, 0.06],
    color: 'detail',
    layout: { kind: 'single' },
    around: 84,
    up: 36,
    tilt: -72,
    sink: 0.1,
    jitter: 0,
  }),
  part({
    // Long, lanky arms dangling almost to the ground, angled out so they
    // clear the torso instead of sinking into it at the hips.
    id: 'draft-lanky-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.14, 0.9, 0.14],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 86,
    up: 30,
    tilt: -84,
    splay: 9,
    sink: 0.15,
    jitter: 0,
  }),
  part({
    // The long forearm from the same shoulder, thinner and splayed a little
    // further out: the arm tapers and bends at the elbow (boss form).
    id: 'draft-lanky-forearms',
    slot: 'back',
    shape: 'capsule',
    size: [0.12, 1.35, 0.12],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 86,
    up: 30,
    tilt: -85,
    splay: 11,
    sink: 0.15,
    jitter: 0,
  }),
  part({
    id: 'draft-lanky-legs',
    slot: 'legs',
    shape: 'capsule',
    size: [0.24, 0.3, 0.26],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 28,
    up: -55,
    splay: 4,
    sink: 0.3,
    jitter: 0,
  }),

  // ── Mom: a bun bigger than her head, curls, cardigan buttons, earrings ──
  part({
    // Bigger than her head: head parts size against the head's own height,
    // and the orb head is one head-height across, so the bun is wider than 1.
    id: 'draft-big-bun',
    slot: 'crown',
    shape: 'ellipsoid',
    size: [1.4, 1.14, 1.3],
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: 90,
    sink: 0.75,
    jitter: 0,
  }),
  part({
    // A soft fringe of bangs across the forehead (the base form's hair; it
    // stays through the line). Replaces the side curls that read as ears.
    id: 'draft-fringe',
    slot: 'mane',
    shape: 'ellipsoid',
    size: [0.24, 0.16, 0.13],
    color: 'detail',
    layout: { kind: 'ring', count: 5, spread: 44 },
    around: 0,
    up: 50,
    tilt: 55,
    sink: 0.5,
    jitter: 0.06,
  }),
  part({
    // Two gold hair sticks through the bun: Mommentum's fire glow accent (the
    // fire rule needs glow: 'accent'). Long enough to poke out of the bun.
    id: 'draft-hair-sticks',
    slot: 'horns',
    shape: 'capsule',
    size: [0.09, 1.2, 0.09],
    color: 'accent',
    layout: { kind: 'pair' },
    around: 30,
    up: 80,
    tilt: 0,
    splay: 38,
    sink: 0.1,
    jitter: 0,
  }),
  part({
    // Hands on hips, elbows out (two straight pieces, ruling 3): the upper
    // arm angles down and out from the shoulder to the elbow...
    id: 'draft-akimbo-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.16, 0.6, 0.16],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 86,
    up: 26,
    tilt: -66,
    sink: 0.2,
    jitter: 0,
  }),
  part({
    // ...and the forearm comes back up from the hip to meet it. Both run
    // past the elbow into each other, so it reads as one bent arm (round 4:
    // tip-to-tip they showed a break and read as two loose pieces).
    id: 'draft-akimbo-forearms',
    slot: 'back',
    shape: 'capsule',
    size: [0.16, 0.56, 0.16],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 90,
    up: -22,
    tilt: 74,
    sink: 0.2,
    jitter: 0,
  }),

  // ── Dad: moustache wings, ball cap and brim, big sneakers ──────────────
  part({
    // Wider than his face: two long wings swept out sideways.
    id: 'draft-moustache',
    slot: 'fangs',
    shape: 'teardrop',
    size: [0.2, 0.7, 0.13],
    color: 'detail',
    layout: { kind: 'pair' },
    around: 10,
    up: -6,
    tilt: -66,
    splay: 80,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    id: 'draft-moustache-small',
    slot: 'fangs',
    shape: 'teardrop',
    size: [0.1, 0.2, 0.08],
    color: 'detail',
    layout: { kind: 'pair' },
    around: 8,
    up: 0,
    tilt: -78,
    splay: 55,
    sink: 0.45,
    jitter: 0,
  }),
  part({
    // Seated: as wide as the head and centred on its crown (sink 1), so it
    // wraps the top instead of perching on it as a disc.
    id: 'draft-ball-cap',
    slot: 'crown',
    shape: 'ellipsoid',
    size: [1.04, 0.62, 1.04],
    color: 'accent',
    layout: { kind: 'single' },
    around: 0,
    up: 90,
    sink: 1,
    jitter: 0,
  }),
  part({
    // A flat brim straight out the front, rooted in the cap's front edge.
    id: 'draft-cap-brim',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.6, 0.44, 0.1],
    color: 'accent',
    layout: { kind: 'single' },
    around: 0,
    up: 38,
    tilt: -50,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    // Up on the belly, clear of the sneakers in 3/4.
    id: 'draft-belly-patch',
    slot: 'pattern',
    shape: 'ellipsoid',
    size: [0.5, 0.42, 0.04],
    color: 'secondary',
    layout: { kind: 'single' },
    around: 0,
    up: -4,
    sink: 0.75,
    jitter: 0,
  }),
  part({
    id: 'draft-sneakers',
    slot: 'legs',
    shape: 'capsule',
    size: [0.44, 0.3, 0.58],
    color: 'white',
    layout: { kind: 'pair' },
    around: 30,
    up: -60,
    splay: 6,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    id: 'draft-dad-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.2, 0.5, 0.2],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 82,
    up: 12,
    tilt: -75,
    splay: 10,
    sink: 0.25,
    jitter: 0,
  }),

  // ── Rickeyride: a kid in a bumper kart, never standing still ────────────
  part({
    // His "legs" are four chunky wheels (legs grow to the ground).
    id: 'draft-kart-wheels',
    slot: 'legs',
    shape: 'ellipsoid',
    size: [0.32, 0.3, 0.6],
    color: 'detail',
    layout: { kind: 'quad' },
    around: 55,
    up: -40,
    splay: 4,
    sink: 0.55,
    jitter: 0,
  }),
  part({
    // Hair blown straight back by the wind.
    id: 'draft-wind-swoop',
    slot: 'crown',
    shape: 'teardrop',
    size: [0.34, 0.56, 0.16],
    color: 'accent',
    layout: { kind: 'ring', count: 3, spread: 24 },
    around: 180,
    up: 52,
    tilt: -45,
    sink: 0.4,
    jitter: 0.05,
  }),
  part({
    id: 'draft-wind-swoop-small',
    slot: 'crown',
    shape: 'teardrop',
    size: [0.26, 0.36, 0.14],
    color: 'accent',
    layout: { kind: 'ring', count: 2, spread: 16 },
    around: 180,
    up: 60,
    tilt: -40,
    sink: 0.4,
    jitter: 0.05,
  }),
  part({
    id: 'draft-goggles',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.27, 0.25, 0.16],
    color: 'secondary',
    layout: { kind: 'pair' },
    around: 24,
    up: 46,
    tilt: 20,
    sink: 0.35,
    jitter: 0,
  }),
  part({
    // Arms reaching forward to steer, out of the top of the kart.
    id: 'draft-steer-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.19, 0.9, 0.19],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 40,
    up: 60,
    tilt: -60,
    splay: -20,
    sink: 0.15,
    jitter: 0,
  }),
  part({
    // The boss's steering arms: the same angles as the others, a third
    // longer (owner, round 4), so they reach out past the kart's front.
    id: 'draft-steer-arms-long',
    slot: 'arms',
    shape: 'capsule',
    size: [0.19, 1.2, 0.19], // TUNE
    color: 'primary',
    layout: { kind: 'pair' },
    around: 40,
    up: 60,
    tilt: -60,
    splay: -20,
    sink: 0.15,
    jitter: 0,
  }),
  part({
    // The boss's whippy kart-flag antenna off the back, tall enough to show
    // above his head (owner, round 4: replaces the spoiler, which read as
    // bat wings from the front).
    id: 'draft-kart-antenna',
    slot: 'tail',
    shape: 'capsule',
    size: [0.06, 0.75, 0.06],
    color: 'accent',
    layout: { kind: 'chain', count: 3, step: 0.95, curl: 6, wave: 8, shrink: 0.85 },
    around: 160,
    up: 55,
    tilt: 62, // TUNE
    sink: 0.2,
    jitter: 0,
  }),
  part({
    // Twin hot-rod exhaust stacks standing up at the back (Revvy's new
    // part): tall enough to show over the kart from the front.
    id: 'draft-exhaust-pipes',
    slot: 'back',
    shape: 'capsule',
    size: [0.16, 0.7, 0.16],
    color: 'detail',
    layout: { kind: 'pair' },
    around: 145,
    up: 30,
    tilt: 70,
    splay: 8,
    sink: 0.3,
    jitter: 0,
  }),
];

export type DraftStage = 'base' | 'middle' | 'boss';

export interface DraftBossForm {
  readonly id: string;
  /** Draft name, settled at the owner's mockup round. */
  readonly name: string;
  readonly stage: DraftStage;
  /** Plan §8 / owner decision 5: base and middle legendary, boss form mythic. */
  readonly plannedRarity: 'legendary' | 'mythic';
  readonly visual: SpeciesVisual;
}

export interface DraftBossLine {
  readonly key: 'rakelet' | 'mom' | 'dad' | 'rickeyride';
  readonly element: ElementId;
  readonly feeling: FeelingId;
  readonly forms: readonly [DraftBossForm, DraftBossForm, DraftBossForm];
}

const RAKELET_PALETTE = ['#9fd46e', '#fff6dc', '#f08a3c', '#b07a48']; // round 8: wood-brown crossbar, not orange
const MOM_PALETTE = ['#ff8a6a', '#fff0e6', '#ffd166', '#8a3550'];
const DAD_PALETTE = ['#a9d4f5', '#f4fbff', '#e2574c', '#f7f1ea'];
const RICKEY_PALETTE = ['#ffd84a', '#bff0ff', '#3f8fe8', '#4a3a5c'];

// Sizes step ×1.08–1.4 per evolution (ART_RULES.evolutionScale); each step
// adds a sticking-out part; each form keeps its feeling's face kit (§1.6).
export const DRAFT_BOSS_LINES: readonly DraftBossLine[] = [
  {
    key: 'rakelet',
    element: 'leaf',
    feeling: 'silly',
    forms: [
      {
        id: 'draft-pileup',
        name: 'Pileup',
        stage: 'base',
        plannedRarity: 'legendary',
        visual: {
          body: 'blob',
          palette: RAKELET_PALETTE,
          parts: [
            'dot-eyes',
            'draft-soft-brows',
            'draft-rake-bar-small',
            'draft-rake-tines-small',
            'draft-rake-rivets-small',
            'draft-rake-mouth-small',
            'draft-face-freckles',
            'draft-leaf-tuft',
            'stubby-arms',
            'biped-legs',
          ],
          size: 1,
          finish: 'iridescent',
          head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
          stance: 0.25,
          pose: 'stand',
          attackPart: 'fangs',
        },
      },
      {
        id: 'draft-rakeling',
        name: 'Rakeling',
        stage: 'middle',
        plannedRarity: 'legendary',
        visual: {
          body: 'draft-upright',
          palette: RAKELET_PALETTE,
          parts: [
            'dot-eyes',
            'draft-soft-brows',
            'draft-rake-bar',
            'draft-rake-tines-mid',
            'draft-rake-rivets-mid',
            'draft-rake-mouth',
            'draft-face-freckles',
            'draft-leaf-pile-hair',
            'draft-lanky-arms',
            'draft-lanky-legs',
          ],
          size: 1.36,
          finish: 'iridescent',
          head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.78 },
          stance: 0.3,
          pose: 'upright',
          attackPart: 'fangs',
        },
      },
      {
        id: 'draft-rakelet',
        name: 'Rakelet',
        stage: 'boss',
        plannedRarity: 'mythic',
        visual: {
          body: 'draft-upright',
          palette: RAKELET_PALETTE,
          parts: [
            'sharp-eyes',
            'draft-fierce-brows',
            'draft-rake-tool-bar',
            'draft-rake-tool-tines',
            'draft-rake-tool-rivets',
            'draft-rake-tool-mouth',
            'draft-leaf-pile-hair',
            'draft-falling-leaf-top',
            'draft-droop-arms',
            'draft-lanky-legs',
          ],
          size: 1.88,
          finish: 'shimmer',
          head: { body: 'draft-rake-head', size: 0.86, forward: 0.06, up: 0.8 },
          stance: 0.38,
          pose: 'upright',
          attackPart: 'fangs',
        },
      },
    ],
  },
  {
    key: 'mom',
    element: 'fire',
    feeling: 'brave',
    forms: [
      {
        id: 'draft-momo',
        name: 'Momo',
        stage: 'base',
        plannedRarity: 'legendary',
        visual: {
          body: 'pear',
          palette: MOM_PALETTE,
          parts: [
            'oval-eyes',
            'brave-brows',
            'smile',
            'blush-cheeks',
            'draft-fringe',
            'stubby-arms',
            'biped-legs',
          ],
          size: 1,
          finish: 'iridescent',
          glow: 'accent',
          head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
          stance: 0.22,
          pose: 'stand',
          attackPart: 'arms',
        },
      },
      {
        id: 'draft-mamarama',
        name: 'Mamarama',
        stage: 'middle',
        plannedRarity: 'legendary',
        visual: {
          body: 'draft-upright',
          palette: MOM_PALETTE,
          parts: [
            'oval-eyes',
            'brave-brows',
            'smirk',
            'blush-cheeks',
            'draft-fringe',
            'draft-big-bun',
            'draft-akimbo-arms',
            'draft-akimbo-forearms',
            'biped-legs',
          ],
          size: 1.36,
          finish: 'iridescent',
          glow: 'accent',
          head: { body: 'orb', size: 0.8, forward: 0.06, up: 0.8 },
          stance: 0.28,
          pose: 'upright',
          attackPart: 'arms',
        },
      },
      {
        id: 'draft-mommentum',
        name: 'Mommentum',
        stage: 'boss',
        plannedRarity: 'mythic',
        visual: {
          body: 'draft-cardigan',
          palette: MOM_PALETTE,
          parts: [
            'sharp-eyes',
            'brave-brows',
            'smirk',
            'blush-cheeks',
            'draft-fringe',
            'draft-big-bun',
            'draft-hair-sticks',
            'draft-akimbo-arms',
            'draft-akimbo-forearms',
            'biped-legs',
          ],
          size: 1.88,
          finish: 'shimmer',
          glow: 'accent',
          head: { body: 'orb', size: 0.76, forward: 0.06, up: 0.82 },
          stance: 0.32,
          pose: 'upright',
          attackPart: 'arms',
        },
      },
    ],
  },
  {
    key: 'dad',
    element: 'frost',
    feeling: 'cozy',
    forms: [
      {
        id: 'draft-snowpop',
        name: 'Snowpop',
        stage: 'base',
        plannedRarity: 'legendary',
        visual: {
          body: 'blob',
          palette: DAD_PALETTE,
          parts: [
            'oval-eyes',
            'draft-bushy-brows',
            'tiny-smile',
            'blush-cheeks',
            'draft-moustache-small',
            'draft-ball-cap',
            'draft-cap-brim',
            'stubby-arms',
            'draft-sneakers',
          ],
          size: 1,
          finish: 'iridescent',
          head: { body: 'orb', size: 0.9, forward: 0.06, up: 0.72 },
          stance: 0.2,
          pose: 'stand',
          attackPart: 'arms',
        },
      },
      {
        id: 'draft-frostpop',
        name: 'Frostpop',
        stage: 'middle',
        plannedRarity: 'legendary',
        visual: {
          body: 'draft-dad-belly',
          palette: DAD_PALETTE,
          parts: [
            'oval-eyes',
            'draft-bushy-brows',
            'smile',
            'blush-cheeks',
            'draft-moustache-small',
            'draft-ball-cap',
            'draft-cap-brim',
            'draft-belly-patch',
            'draft-dad-arms',
            'draft-sneakers',
          ],
          size: 1.36,
          finish: 'iridescent',
          head: { body: 'orb', size: 0.74, forward: 0.06, up: 0.8 },
          stance: 0.2,
          pose: 'upright',
          attackPart: 'arms',
        },
      },
      {
        id: 'draft-papa-brrr',
        name: 'Papa Brrr',
        stage: 'boss',
        plannedRarity: 'mythic',
        visual: {
          body: 'draft-dad-belly',
          palette: DAD_PALETTE,
          parts: [
            'oval-eyes',
            'draft-bushy-brows',
            'smile',
            'blush-cheeks',
            'draft-moustache',
            'draft-ball-cap',
            'draft-cap-brim',
            'draft-belly-patch',
            'draft-dad-arms',
            'draft-sneakers',
          ],
          size: 1.88,
          finish: 'shimmer',
          head: { body: 'orb', size: 0.7, forward: 0.06, up: 0.82 },
          stance: 0.22,
          pose: 'upright',
          attackPart: 'arms',
        },
      },
    ],
  },
  {
    key: 'rickeyride',
    element: 'spark',
    // Silly, not joy (coordinator ruling 1): silly's face kit allows open
    // dot or sharp eyes, joy's needs closed happy arcs.
    feeling: 'silly',
    forms: [
      {
        id: 'draft-zoomlet',
        name: 'Zoomlet',
        stage: 'base',
        plannedRarity: 'legendary',
        visual: {
          body: 'draft-kart',
          palette: RICKEY_PALETTE,
          parts: [
            'dot-eyes',
            'draft-soft-brows',
            'open-mouth',
            'blush-cheeks',
            'draft-wind-swoop-small',
            'draft-kart-wheels',
            'draft-steer-arms',
          ],
          size: 0.95,
          finish: 'iridescent',
          head: { body: 'orb', size: 1.02, forward: 0.06, up: 0.78 },
          stance: 0.16,
          pose: 'stand',
          attackPart: 'legs',
        },
      },
      {
        id: 'draft-revvy',
        name: 'Revvy',
        stage: 'middle',
        plannedRarity: 'legendary',
        visual: {
          body: 'draft-kart',
          palette: RICKEY_PALETTE,
          parts: [
            'dot-eyes',
            'draft-soft-brows',
            'open-mouth',
            'blush-cheeks',
            'draft-wind-swoop',
            'draft-goggles',
            'draft-kart-wheels',
            'draft-steer-arms',
            'draft-exhaust-pipes',
          ],
          size: 1.3,
          finish: 'iridescent',
          head: { body: 'orb', size: 0.98, forward: 0.06, up: 0.84 },
          stance: 0.18,
          pose: 'stand',
          attackPart: 'legs',
        },
      },
      {
        id: 'draft-rickeyride',
        name: 'Rickeyride',
        stage: 'boss',
        plannedRarity: 'mythic',
        visual: {
          body: 'draft-kart',
          palette: RICKEY_PALETTE,
          parts: [
            'dot-eyes',
            'draft-fierce-brows',
            'open-mouth',
            'blush-cheeks',
            'draft-wind-swoop',
            'draft-goggles',
            'draft-kart-wheels',
            'draft-steer-arms-long',
            'draft-exhaust-pipes',
            'draft-kart-antenna',
          ],
          size: 1.8,
          finish: 'shimmer',
          head: { body: 'orb', size: 0.95, forward: 0.06, up: 0.88 },
          stance: 0.2,
          pose: 'stand',
          attackPart: 'legs',
        },
      },
    ],
  },
];

/** Every draft form as a gallery look, at its planned rarity's material tier. */
export function draftLooks(): {
  id: string;
  visual: SpeciesVisual;
  rarity: 'legendary' | 'mythic';
}[] {
  return DRAFT_BOSS_LINES.flatMap((line) => line.forms).map((f) => ({
    id: f.id,
    visual: f.visual,
    rarity: f.plannedRarity,
  }));
}
