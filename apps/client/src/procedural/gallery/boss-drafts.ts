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
    width: 1.08,
    height: 1.1,
    depth: 0.94,
    squareness: 0.1,
    taper: -0.6,
    peak: 0,
    bottomFlat: 0.75,
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
    // A wide, straight comb of white tines right across the mouth (not two
    // buck teeth under the nose): seven short tines hanging from one row.
    id: 'draft-rake-tines',
    slot: 'fangs',
    shape: 'capsule',
    size: [0.045, 0.13, 0.045],
    color: 'white',
    layout: { kind: 'ring', count: 7, spread: 26 },
    around: 0,
    up: -6,
    tilt: -84,
    sink: 0.6,
    jitter: 0,
  }),
  part({
    id: 'draft-rake-tines-small',
    slot: 'fangs',
    shape: 'capsule',
    size: [0.05, 0.1, 0.05],
    color: 'white',
    layout: { kind: 'ring', count: 5, spread: 26 },
    around: 0,
    up: -6,
    tilt: -84,
    sink: 0.45,
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
    up: 0,
    tilt: -64,
    sink: 0.2,
    jitter: 0,
  }),
  part({
    // Long, lanky arms dangling almost to the ground, angled out so they
    // clear the torso instead of sinking into it at the hips.
    id: 'draft-lanky-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.13, 1.35, 0.13],
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
    sink: 0.5,
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
    // A gold bow on the bun: Momentum's fire glow accent (the fire rule
    // needs glow: 'accent'), dark until she attacks in a move animation.
    id: 'draft-bun-bow',
    slot: 'horns',
    shape: 'teardrop',
    size: [0.3, 0.42, 0.14],
    color: 'accent',
    layout: { kind: 'pair' },
    around: 40,
    up: 62,
    tilt: -10,
    splay: 40,
    sink: 0.1,
    jitter: 0,
  }),
  part({
    // Hands on hips, elbows out (two straight pieces, ruling 3): the upper
    // arm angles down and out from the shoulder to the elbow...
    id: 'draft-akimbo-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.14, 0.5, 0.14],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 86,
    up: 30,
    tilt: -40,
    sink: 0.2,
    jitter: 0,
  }),
  part({
    // ...and the forearm comes back up from the hip to meet it.
    id: 'draft-akimbo-forearms',
    slot: 'back',
    shape: 'capsule',
    size: [0.14, 0.4, 0.14],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 84,
    up: -24,
    tilt: 55,
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
    tilt: 10,
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
    tilt: 20,
    sink: 0.4,
    jitter: 0.05,
  }),
  part({
    id: 'draft-goggles',
    slot: 'horns',
    shape: 'ellipsoid',
    size: [0.22, 0.2, 0.14],
    color: 'secondary',
    layout: { kind: 'pair' },
    around: 24,
    up: 42,
    tilt: 20,
    sink: 0.35,
    jitter: 0,
  }),
  part({
    // Arms reaching forward to steer, out of the top of the kart.
    id: 'draft-steer-arms',
    slot: 'arms',
    shape: 'capsule',
    size: [0.15, 0.5, 0.15],
    color: 'primary',
    layout: { kind: 'pair' },
    around: 40,
    up: 60,
    tilt: -60,
    splay: -20,
    sink: 0.25,
    jitter: 0,
  }),
  part({
    // His feet in sneakers, propped on the kart's front footboard (ruling 4:
    // the wheels keep the legs slot, the feet use the free tail slot).
    id: 'draft-kart-feet',
    slot: 'tail',
    shape: 'capsule',
    size: [0.22, 0.4, 0.2],
    color: 'white',
    layout: { kind: 'pair' },
    around: 22,
    up: 35,
    tilt: -45,
    splay: 12,
    sink: 0.3,
    jitter: 0,
  }),
  part({
    // Two racing fins on the back of the kart (boss form), rooted in it.
    id: 'draft-kart-fins',
    slot: 'spikes',
    shape: 'teardrop',
    size: [0.3, 0.42, 0.1],
    color: 'secondary',
    layout: { kind: 'pair' },
    around: 140,
    up: 40,
    tilt: 50,
    splay: 10,
    sink: 0.35,
    jitter: 0,
  }),
  part({
    // Twin exhaust pipes at the back (boss form).
    id: 'draft-exhaust-pipes',
    slot: 'back',
    shape: 'capsule',
    size: [0.12, 0.34, 0.12],
    color: 'detail',
    layout: { kind: 'pair' },
    around: 160,
    up: 0,
    tilt: 10,
    splay: 6,
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

const RAKELET_PALETTE = ['#9fd46e', '#fff6dc', '#f08a3c', '#d6533a'];
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
            'open-mouth',
            'draft-rake-tines-small',
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
            'open-mouth',
            'draft-rake-tines',
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
            'open-mouth',
            'draft-rake-tines',
            'draft-face-freckles',
            'draft-leaf-pile-hair',
            'draft-falling-leaf',
            'draft-lanky-arms',
            'draft-lanky-legs',
          ],
          size: 1.88,
          finish: 'shimmer',
          head: { body: 'orb', size: 0.86, forward: 0.06, up: 0.8 },
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
        id: 'draft-momentum',
        name: 'Momentum',
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
            'draft-bun-bow',
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
            'draft-kart-feet',
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
            'draft-kart-feet',
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
            'draft-steer-arms',
            'draft-kart-feet',
            'draft-exhaust-pipes',
            'draft-kart-fins',
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
  return DRAFT_BOSS_LINES.flatMap((line) =>
    line.forms.map((f) => ({ id: f.id, visual: f.visual, rarity: f.plannedRarity })),
  );
}
