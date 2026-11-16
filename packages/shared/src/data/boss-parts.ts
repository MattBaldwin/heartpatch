import type { Body, Part } from '../schemas/data/visuals.js';

/*
 * The mini-boss kit (#234, art from #810): the bodies and parts the four
 * boss lines are built from. Public on purpose: a boss's def reaches a
 * Keeper only once they meet it (`hiddenUntilSeen`), and the client then
 * draws it from these public tables (`visualRegistry(GAME_DATA)`), so every
 * body and part a boss uses lives here. The species themselves, their
 * names and moves are server-only (`data/server/boss-species.ts`).
 *
 * Bundle-leak guard (#234 plan risk 1): nothing in this file, ids or
 * comments, may name a boss species. The client bundle check bans every
 * secret species id and name as a substring, source maps included, so the
 * lines are "the rake line", "the mom line", "the dad line" and "the kart
 * line" here (a shared boundary test reads this file to check).
 *
 * Hair sits in `crown` and `mane`, a moustache or rake tines in `fangs`, a
 * cap brim, goggles or rivets in `horns`, and a cardigan's buttons in
 * `pattern`. The mom, dad and kart lines use only the original five
 * primitives. The rake line uses the #234 kit extension (ART_BIBLE §1.9):
 * `box` and `bent` shapes, the `metal` colour, ring `splay`, `anchor:
 * 'front'` with `standoff`, `replaces: 'mouth'`, and the two-tone `accent`.
 * Every body and part here is used by some boss form (checked by a shared boundary test).
 */

/**
 * A taller, upright toy torso for grown-up bosses: still a soft blob with a
 * big head on top (never Keeper proportions), with a slight waist so the
 * head reads as sitting on shoulders. Plus a low, boxy kart for the kart line
 * and a round belly for the dad line.
 */
export const BOSS_BODIES: Body[] = [
  {
    id: 'upright',
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
    id: 'cardigan',
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
    id: 'dad-belly',
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
    id: 'kart',
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
    // The rake line's boss head: wide and flat-faced, so the rake bar spans wider than
    // the body. A true oval (squareness 0, round 9): any squareness pushes a
    // ring's middle copies apart, which opened a gap between the middle tines.
    id: 'rake-head',
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

/** // TUNE: (#234 v16): the rake tines' chisel toes, a clearly lighter steel than the shaft. */
const RAKE_TOE_STEEL = '#b4bdc8';

export const BOSS_PARTS: Part[] = [
  // ── Faces: brows for all four (each keeps its feeling's eye kit, §1.6) ──
  part({
    id: 'soft-brows',
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
    id: 'fierce-brows',
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
    id: 'bushy-brows',
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
    // Freckles across the nose: on the head, not the torso. Round 11b: tiny
    // bumps in the ears slot, so the mouth cavity can take cheeks (plain dark).
    id: 'face-freckles',
    slot: 'ears',
    shape: 'ellipsoid',
    size: [0.03, 0.014, 0.03], // [width, out from the face, height]
    color: 'detail',
    layout: { kind: 'scatter', count: 8, aroundRange: 34, upRange: 6 },
    around: 0,
    up: 6,
    sink: 0.4,
    jitter: 0.2,
  }),

  // ── The rake line: rake-tine teeth, leaf-pile hair, one leaf sliding off ─────
  // Round 8 (owner decision): "[The rake boss] should never have a handle. His
  // mouth is the rake." Every stage's mouth is a rake head on its own: a
  // wooden crossbar (`box`, `replaces: 'mouth'`) wider than the face, and a
  // dark cavity behind the tines so it still reads as a mouth. No handle,
  // stub, knob or socket anywhere.
  // Round 11: a garden-rake head, not a comb. The tines come off the bar's
  // FRONT face (`anchor: 'front'`), with a dark rivet at each root.
  // Round 11b (v13): each tine roots on its rivet in the middle of the bar's
  // front face and passes over its lower edge, leaning ~42° towards the
  // viewer; a leaf-rake tine (`bent`: tapered, a gentle, wide 35° forward arc at
  // the tip, no curl); the row fans out 6° with the outer tines longer
  // (ring `grow`). 3, 4 and 5 tines by stage, built the same way.
  // v14: shorter tines (~28%) ending at the chin line; a 30° arc then a short
  // straight forward foot (no J); the fan opens to ~18° with the outer tines
  // ~18% longer, and each fanned tine's curl turns outwards with it so the
  // curve shows head-on [dropped in v15]; metal rivets half set into the face over each root;
  // a wider dark mouth shading the roots; the bar stays plain wood.
  // v15: no sideways curl. Every tine is the same flat steel strip, the same
  // length, evenly spaced, and hooks the same way: 65° towards the viewer
  // over its last ~30%, ending in a flat chisel toe in front of the lower
  // lip. The shafts lean ~20° (was 42) so the toe never turns up; the ~18°
  // fan stays in the straight shafts. No dark collar under the rivets yet:
  // no stage has a free sticking-out head slot for one (flagged to the
  // coordinator).
  // v16 (final round): two-tone tines. Each ends in a wide, flat chisel toe
  // (~1.8× the shaft) in a lighter steel (an `accent` mesh on the same part),
  // so head-on every tine ends in a bright toe in front of the lower lip. The
  // shaft now curves evenly over its lower 60% (same 65° turn, no straight
  // foot), so it foreshortens head-on instead of reading as a straight peg.
  // The strip is wider and flatter (1.8 × 0.7), the rivets are low pan-heads,
  // and the base form's tines are widened to suit its chunky bar.
  part({
    // The rake line's base form: its baby crossbar: its mouth, a little wider than its face.
    id: 'rake-bar-small',
    slot: 'mane',
    shape: 'box',
    size: [1.1, 0.14, 0.2], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -12,
    tilt: 12, // levels the plank on the curving face
    sink: 0.6, // TUNE: tucked into the cheeks, a lip not a plank (round 11b)
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // The base form's three baby tines.
    id: 'rake-tines-small',
    slot: 'fangs',
    shape: 'bent',
    size: [0.08, 0.22, 0.0862], // v16: bentProportions() scaled (the curve stays true), widened ~1.25× to match its chunky bar
    color: 'metal',
    accent: { mesh: 'bent-toe', color: RAKE_TOE_STEEL }, // v16: a bright chisel toe
    layout: { kind: 'ring', count: 3, spread: 68 }, // v15: all tines the same length and shape, evenly spaced
    around: 0,
    up: -11.45, // TUNE: the bar's front face, mid-height (kit test), on its rivet
    tilt: 20, // TUNE: v15 ~20° lean so the 65° hook's toe still points a little down (no J)
    splay: 22, // TUNE: the outer tines fan out ~18° (v14: 6 was invisible head-on)
    sink: 0, // the root's round end sits on the face, under its rivet
    jitter: 0,
    anchor: 'front',
    standoff: 0.097, // TUNE: on the bar's front face (kit test)
  }),
  part({
    // A metal rivet at each tine's root, half set into the bar's front face (v14: lighter than the cavity, so not a hole).
    id: 'rake-rivets-small',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.085, 0.022, 0.085], // v16: a low pan-head (55% of v15's dome), a touch wider than the widened tine
    color: 'metal',
    layout: { kind: 'ring', count: 3, spread: 68 },
    around: 0,
    up: -11.45, // on each tine's root
    tilt: 90, // straight out towards the viewer
    sink: 0.5, // centred on the face: a dome half set into the bar
    jitter: 0,
    anchor: 'front',
    standoff: 0.097,
  }),
  part({
    // The base form's mouth cavity behind its tines.
    id: 'rake-cavity-small',
    slot: 'cheeks', // a head surface patch: plain dark, no rainbow rim (round 11b)
    shape: 'ellipsoid',
    size: [0.58, 0.21, 0.03], // [width, height, depth]: a flat dark opening, not a plate; v14: wider, shading the tine roots
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -25, // TUNE: its top tucked behind the bar
    sink: 0.5, // flush with the face
    jitter: 0,
  }),
  part({
    // The middle form's crossbar: wider than its face, overhanging both cheeks.
    id: 'rake-bar',
    slot: 'mane',
    shape: 'box',
    size: [1.12, 0.1, 0.14], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -16,
    tilt: 16, // levels the plank on the curving face
    sink: 0.6, // TUNE: tucked into the cheeks, a lip not a plank (round 11b)
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // The middle form's four tines.
    id: 'rake-tines-mid',
    slot: 'fangs',
    shape: 'bent',
    size: [0.0736, 0.25, 0.0979], // bentProportions() scaled, so the strip and its curve stay true (v16)
    color: 'metal',
    accent: { mesh: 'bent-toe', color: RAKE_TOE_STEEL }, // v16: a bright chisel toe
    layout: { kind: 'ring', count: 4, spread: 86 }, // v15: all tines the same length and shape, evenly spaced
    around: 0,
    up: -15.55, // TUNE: the bar's front face, mid-height (kit test), on its rivet
    tilt: 20, // TUNE: v15 ~20° lean so the 65° hook's toe still points a little down (no J)
    splay: 22, // TUNE: the outer tines fan out ~18° (v14: 6 was invisible head-on)
    sink: 0, // the root's round end sits on the face, under its rivet
    jitter: 0,
    anchor: 'front',
    standoff: 0.069, // TUNE: on the bar's front face (kit test)
  }),
  part({
    // A metal rivet at each tine's root, half set into the bar's front face (v14: lighter than the cavity, so not a hole).
    id: 'rake-rivets-mid',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.08, 0.025, 0.08], // v16: a low pan-head, 55% of v15's dome
    color: 'metal',
    layout: { kind: 'ring', count: 4, spread: 86 },
    around: 0,
    up: -15.55, // on each tine's root
    tilt: 90, // straight out towards the viewer
    sink: 0.5, // centred on the face: a dome half set into the bar
    jitter: 0,
    anchor: 'front',
    standoff: 0.069,
  }),
  part({
    // The middle form's mouth cavity behind its tines.
    id: 'rake-cavity',
    slot: 'cheeks', // a head surface patch: plain dark, no rainbow rim (round 11b)
    shape: 'ellipsoid',
    size: [0.82, 0.26, 0.03], // [width, height, depth]: a flat dark opening, not a plate; v14: wider, shading the tine roots
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -28, // TUNE: its top tucked behind the bar
    sink: 0.5, // flush with the face
    jitter: 0,
  }),
  part({
    // The rake boss's crossbar: a straight rake head, well wider than his face, as his jaw and upper lip.
    id: 'rake-tool-bar',
    slot: 'mane',
    shape: 'box',
    size: [1.3, 0.16, 0.18], // [width, depth off the face, height]; TUNE
    color: 'detail',
    layout: { kind: 'single' },
    around: 0,
    up: -18,
    tilt: 18, // levels the plank on the curving face
    sink: 0.6, // TUNE: tucked into the cheeks, a lip not a plank (round 11b)
    jitter: 0,
    replaces: 'mouth',
  }),
  part({
    // The rake boss's five tines.
    id: 'rake-tool-tines',
    slot: 'fangs',
    shape: 'bent',
    size: [0.0871, 0.296, 0.1159], // bentProportions() scaled, so the strip and its curve stay true (v16)
    color: 'metal',
    accent: { mesh: 'bent-toe', color: RAKE_TOE_STEEL }, // v16: a bright chisel toe
    layout: { kind: 'ring', count: 5, spread: 105 }, // v15: all tines the same length and shape, evenly spaced
    around: 0,
    up: -16.85, // TUNE: the bar's front face, mid-height (kit test), on its rivet
    tilt: 20, // TUNE: v15 ~20° lean so the 65° hook's toe still points a little down (no J)
    splay: 22, // TUNE: the outer tines fan out ~18° (v14: 6 was invisible head-on)
    sink: 0, // the root's round end sits on the face, under its rivet
    jitter: 0,
    anchor: 'front',
    standoff: 0.109, // TUNE: on the bar's front face (kit test)
  }),
  part({
    // A metal rivet at each tine's root, half set into the bar's front face (v14: lighter than the cavity, so not a hole).
    id: 'rake-tool-rivets',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.095, 0.028, 0.095], // v16: a low pan-head, 55% of v15's dome
    color: 'metal',
    layout: { kind: 'ring', count: 5, spread: 105 },
    around: 0,
    up: -16.85, // on each tine's root
    tilt: 90, // straight out towards the viewer
    sink: 0.5, // centred on the face: a dome half set into the bar
    jitter: 0,
    anchor: 'front',
    standoff: 0.109,
  }),
  part({
    // The rake boss's mouth cavity behind the tines.
    id: 'rake-tool-cavity',
    slot: 'cheeks', // a head surface patch: plain dark, no rainbow rim (round 11b)
    shape: 'ellipsoid',
    size: [1.1, 0.3, 0.03], // [width, height, depth]: a flat dark opening, not a plate; v14: wider, shading the tine roots
    color: 'ink',
    layout: { kind: 'single' },
    around: 0,
    up: -30, // TUNE: its top tucked behind the bar
    sink: 0.5, // flush with the face
    jitter: 0,
  }),
  part({
    // A green leaf mid-fall on the leaf pile (round 6: wider than tall, flat,
    // tipped over sideways so it can't read as a horn).
    id: 'falling-leaf-top',
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
    id: 'droop-arms',
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
    id: 'leaf-pile-hair',
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
    id: 'leaf-tuft',
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
    // Long, lanky arms dangling almost to the ground, angled out so they
    // clear the torso instead of sinking into it at the hips.
    id: 'lanky-arms',
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
    id: 'lanky-legs',
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

  // ── The mom line: a bun bigger than her head, curls, cardigan buttons, earrings ──
  part({
    // Bigger than her head: head parts size against the head's own height,
    // and the orb head is one head-height across, so the bun is wider than 1.
    id: 'big-bun',
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
    id: 'fringe',
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
    // Two gold hair sticks through the bun: the mom boss's fire glow accent (the
    // fire rule needs glow: 'accent'). Long enough to poke out of the bun.
    id: 'hair-sticks',
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
    id: 'akimbo-arms',
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
    id: 'akimbo-forearms',
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

  // ── The dad line: moustache wings, ball cap and brim, big sneakers ──────────────
  part({
    // Wider than his face: two long wings swept out sideways.
    id: 'moustache',
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
    id: 'moustache-small',
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
    id: 'ball-cap',
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
    id: 'cap-brim',
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
    id: 'dad-belly-patch',
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
    id: 'sneakers',
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
    id: 'dad-arms',
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

  // ── The kart line: a kid in a bumper kart, never standing still ────────────
  part({
    // His "legs" are four chunky wheels (legs grow to the ground).
    id: 'kart-wheels',
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
    id: 'wind-swoop',
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
    id: 'wind-swoop-small',
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
    id: 'goggles',
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
    id: 'steer-arms',
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
    id: 'steer-arms-long',
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
    id: 'kart-antenna',
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
    // Twin hot-rod exhaust stacks standing up at the back (the middle form's new
    // part): tall enough to show over the kart from the front.
    id: 'exhaust-pipes',
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
