/**
 * Three presentation directions for the battle screen, as data. Everything
 * the prototypes do differently (camera, lighting rig, sky, ground, effects
 * language, motion exaggeration, HUD skin) is a number or a word here, so the
 * same scene can be judged three ways side by side. MOCKUPS ONLY: nothing
 * here ships; the chosen direction is rebuilt properly in a later lane.
 */

export type DirectionId = 'A' | 'B' | 'C';

export interface LightRig {
  /** Key light direction (where the light travels), and its sRGB colour and intensity. */
  readonly key: { dir: readonly [number, number, number]; color: string; intensity: number };
  /** An optional second directional light: a cool rim from behind, or a soft fill. */
  readonly second: {
    dir: readonly [number, number, number];
    color: string;
    intensity: number;
  } | null;
  /** The sky light (IBL) strength. */
  readonly environment: number;
  /** `map`: a blurred shadow map from the key light for the fighters; `contact`: soft discs only. */
  readonly shadows: 'map' | 'contact';
  /** Contact shadow stretch along the key light (long golden-hour shadows), 1 = round. */
  readonly shadowStretch: number;
  /** Image processing tweaks over the stage defaults. */
  readonly exposure: number;
  readonly contrast: number;
  /** Extra vignette (0 off). */
  readonly vignette: number;
}

export interface CameraRig {
  /** Tilt down from the horizon, radians. */
  readonly pitch: number;
  /** Swing around the fight, radians (0 looks along +z; + swings the camera to the right). */
  readonly yaw: number;
  readonly fov: number;
  /** Where it looks: a point at the fighters' feet, between them (world units). */
  readonly aim: { x: number; y: number; z: number };
  /** Where the aim lands on screen, as a fraction of the height from the top. */
  readonly feetY: number;
  /** The fight's box that must fit in the safe region: half width and height (world units). */
  readonly fitHalfWidth: number;
  readonly fitHeight: number;
  /** Push-in on a hit (fraction of distance), shake (world units), dutch roll on impact (radians). */
  readonly hitPush: number;
  readonly shake: number;
  readonly roll: number;
}

export interface SkyLook {
  readonly zenith: string;
  readonly horizon: string;
  readonly below: string;
  /** A warm glow around the sun's azimuth near the horizon (0 off). */
  readonly sunGlow: number;
  readonly sunColor: string;
  /** Flat vinyl clouds (count; 0 none) and their colour. */
  readonly clouds: number;
  readonly cloudColor: string;
  /** A sun disc in the sky. */
  readonly sunDisc: boolean;
  /** Dark distant hills behind the treeline (depth layer). */
  readonly farHills: boolean;
  /** Linear fog start/end for depth haze. */
  readonly fog: readonly [number, number];
  /** Ambient motes (fireflies by night, pollen by day): count, 0 off. */
  readonly motes: number;
}

export interface GroundLook {
  /** Darken towards the rim (0 flat). */
  readonly rimDarken: number;
  /** A lighter stage ring under the fight (0 off). */
  readonly stageRing: number;
  /** Prop density share against the arena spec (1 = as specified). */
  readonly propShare: number;
  /** Saturation push on the terrain colour (1 as the map draws it). */
  readonly saturation: number;
}

export interface MotionLook {
  /** Overall exaggeration of squash & stretch (1 = the map's gentle squish). */
  readonly exaggeration: number;
  /** Hit-stop length, ms. */
  readonly hitStop: number;
  /** Knockback distance, world units. */
  readonly knockback: number;
  /** Idle bob height (fraction of body height). */
  readonly idleBob: number;
}

export type FxStyle = 'soft' | 'bold' | 'glow';

export interface FxLook {
  readonly style: FxStyle;
  /** Particle count multiplier. */
  readonly density: number;
  /** Particle size multiplier. */
  readonly size: number;
  /** Speed lines radiating from the impact (count, 0 off). */
  readonly speedLines: number;
  /** Expanding impact ring on the ground. */
  readonly impactRing: boolean;
  /** Sky burst rays behind the hit (anime action lines). */
  readonly burstRays: boolean;
  /** A bright flash puff at the hit. */
  readonly flash: number;
  /** Element trail behind the dash. */
  readonly trail: boolean;
  /** A charging aura during the wind-up. */
  readonly chargeAura: boolean;
}

export interface Direction {
  readonly id: DirectionId;
  readonly name: string;
  readonly tagline: string;
  readonly lights: Readonly<Record<'day' | 'dusk' | 'night', LightRig>>;
  readonly camera: CameraRig;
  readonly sky: Readonly<Record<'day' | 'dusk' | 'night', SkyLook>>;
  readonly ground: GroundLook;
  readonly motion: MotionLook;
  readonly fx: FxLook;
  /** HUD skin, a CSS data attribute. */
  readonly hud: 'storybook' | 'comic' | 'glass';
}

const d2r = (deg: number) => (deg * Math.PI) / 180;

/**
 * A — Storybook Diorama. Animal Crossing warmth: a toy shelf diorama under a
 * soft sky with vinyl clouds, a warm front key, round pastel effects, a cream
 * HUD like a picture-book page. Calm and cosy; the least costly.
 */
const A: Direction = {
  id: 'A',
  name: 'Storybook Diorama',
  tagline: 'A toy-shelf stage under a picture-book sky. Warm, round, cosy.',
  lights: {
    day: {
      key: { dir: [-0.55, -0.9, 0.55], color: '#fff1dc', intensity: 2.1 },
      second: { dir: [0.6, -0.4, -0.7], color: '#ffd6e8', intensity: 0.35 },
      environment: 0.8,
      shadows: 'contact',
      shadowStretch: 1,
      exposure: 1.04,
      contrast: 1.14,
      vignette: 0.8,
    },
    dusk: {
      key: { dir: [-0.8, -0.55, 0.5], color: '#ffc08a', intensity: 1.7 },
      second: { dir: [0.5, -0.4, -0.7], color: '#b9a4ff', intensity: 0.45 },
      environment: 0.75,
      shadows: 'contact',
      shadowStretch: 1,
      exposure: 1.05,
      contrast: 1.1,
      vignette: 0.8,
    },
    night: {
      key: { dir: [-0.5, -1, 0.5], color: '#cfd6ff', intensity: 1.2 },
      second: { dir: [0.6, -0.5, -0.6], color: '#ffb48a', intensity: 0.5 },
      environment: 0.55,
      shadows: 'contact',
      shadowStretch: 1,
      exposure: 1.1,
      contrast: 1.1,
      vignette: 0.9,
    },
  },
  camera: {
    pitch: d2r(12),
    yaw: d2r(-4),
    fov: 0.72,
    aim: { x: 0.1, y: 0.1, z: 0.35 },
    feetY: 0.53,
    fitHalfWidth: 3.7,
    fitHeight: 3.6,
    hitPush: 0.06,
    shake: 0.08,
    roll: 0,
  },
  sky: {
    day: {
      zenith: '#8fc3f2',
      horizon: '#ffe6d2',
      below: '#d9b8c9',
      sunGlow: 0.25,
      sunColor: '#fff6dc',
      clouds: 9,
      cloudColor: '#ffffff',
      sunDisc: true,
      farHills: true,
      fog: [40, 110],
      motes: 0,
    },
    dusk: {
      zenith: '#7c74c9',
      horizon: '#ffbf97',
      below: '#9a6f8f',
      sunGlow: 0.7,
      sunColor: '#ffd9a0',
      clouds: 7,
      cloudColor: '#ffd8e8',
      sunDisc: true,
      farHills: true,
      fog: [35, 100],
      motes: 0,
    },
    night: {
      zenith: '#262b66',
      horizon: '#6a66b3',
      below: '#312f5e',
      sunGlow: 0.2,
      sunColor: '#fff6d6',
      clouds: 5,
      cloudColor: '#8d87c4',
      sunDisc: true,
      farHills: true,
      fog: [35, 100],
      motes: 40,
    },
  },
  ground: { rimDarken: 0.3, stageRing: 0.05, propShare: 1, saturation: 1.1 },
  motion: { exaggeration: 1, hitStop: 80, knockback: 0.8, idleBob: 0.04 },
  fx: {
    style: 'soft',
    density: 1,
    size: 1.1,
    speedLines: 0,
    impactRing: true,
    burstRays: false,
    flash: 0.7,
    trail: true,
    chargeAura: true,
  },
  hud: 'storybook',
};

/**
 * B — Saturday Morning Smackdown. Kirby / Splatoon juice: a low, wide camera
 * that pushes in and shakes, a bold two-tone sky with action rays on the
 * hit, a cool rim light so the toys pop, hard shards and speed lines, a
 * chunky comic HUD. The fiercest; the most moving parts.
 */
const B: Direction = {
  id: 'B',
  name: 'Saturday Morning Smackdown',
  tagline: 'Low camera, big squash, speed lines and a comic-book HUD. Fierce and funny.',
  lights: {
    day: {
      key: { dir: [-0.6, -0.9, 0.5], color: '#fff3e0', intensity: 2.2 },
      second: { dir: [0.35, -0.3, -0.9], color: '#8fd0ff', intensity: 0.9 },
      environment: 0.8,
      shadows: 'map',
      shadowStretch: 1,
      exposure: 1.1,
      contrast: 1.22,
      vignette: 0.5,
    },
    dusk: {
      key: { dir: [-0.85, -0.5, 0.45], color: '#ffb46e', intensity: 2.1 },
      second: { dir: [0.4, -0.3, -0.9], color: '#9d8cff', intensity: 1.0 },
      environment: 0.6,
      shadows: 'map',
      shadowStretch: 1,
      exposure: 1.08,
      contrast: 1.25,
      vignette: 0.6,
    },
    night: {
      key: { dir: [-0.55, -0.9, 0.5], color: '#c9d4ff', intensity: 1.5 },
      second: { dir: [0.45, -0.3, -0.85], color: '#ff9f6a', intensity: 0.9 },
      environment: 0.45,
      shadows: 'map',
      shadowStretch: 1,
      exposure: 1.12,
      contrast: 1.25,
      vignette: 0.7,
    },
  },
  camera: {
    pitch: d2r(9),
    yaw: d2r(5),
    fov: 0.84,
    aim: { x: 0.05, y: 0.2, z: 0.35 },
    feetY: 0.55,
    fitHalfWidth: 4.1,
    fitHeight: 3.7,
    hitPush: 0.08,
    shake: 0.22,
    roll: d2r(2.5),
  },
  sky: {
    day: {
      zenith: '#4fa6f0',
      horizon: '#fff0b8',
      below: '#b58fb0',
      sunGlow: 0.15,
      sunColor: '#ffffff',
      clouds: 6,
      cloudColor: '#ffffff',
      sunDisc: false,
      farHills: true,
      fog: [45, 120],
      motes: 0,
    },
    dusk: {
      zenith: '#5a4fc4',
      horizon: '#ff9f6c',
      below: '#7a4e7a',
      sunGlow: 0.6,
      sunColor: '#ffd37a',
      clouds: 5,
      cloudColor: '#ffc6d6',
      sunDisc: true,
      farHills: true,
      fog: [40, 110],
      motes: 0,
    },
    night: {
      zenith: '#1a1f5c',
      horizon: '#5d5bc0',
      below: '#2a2850',
      sunGlow: 0.0,
      sunColor: '#ffffff',
      clouds: 4,
      cloudColor: '#7a74b8',
      sunDisc: true,
      farHills: true,
      fog: [40, 110],
      motes: 30,
    },
  },
  ground: { rimDarken: 0.3, stageRing: 0, propShare: 0.9, saturation: 1.2 },
  motion: { exaggeration: 1.6, hitStop: 120, knockback: 1.3, idleBob: 0.06 },
  fx: {
    style: 'bold',
    density: 1.3,
    size: 1.25,
    speedLines: 14,
    impactRing: true,
    burstRays: true,
    flash: 1.0,
    trail: true,
    chargeAura: true,
  },
  hud: 'comic',
};

/**
 * C — Lantern Hour. Pokémon Let's Go framing with golden-hour light: the
 * camera sits a little behind the player's side, a low warm key from behind
 * the foe throws long soft shadows towards us, a violet fill, haze and motes
 * for depth, glowing effects that bloom, a frosted-glass HUD. Cinematic and
 * lightly spooky at night.
 */
const C: Direction = {
  id: 'C',
  name: 'Lantern Hour',
  tagline: 'Over-the-shoulder framing, golden light, long soft shadows, glowing effects.',
  lights: {
    day: {
      key: { dir: [0.35, -0.6, -0.75], color: '#ffe3b8', intensity: 2.0 },
      second: { dir: [-0.6, -0.6, 0.5], color: '#b8c6ff', intensity: 0.55 },
      environment: 0.85,
      shadows: 'map',
      shadowStretch: 1.7,
      exposure: 1.06,
      contrast: 1.14,
      vignette: 1.1,
    },
    dusk: {
      key: { dir: [0.5, -0.4, -0.75], color: '#ffb070', intensity: 2.1 },
      second: { dir: [-0.6, -0.6, 0.5], color: '#9f8cff', intensity: 0.7 },
      environment: 0.6,
      shadows: 'map',
      shadowStretch: 2.2,
      exposure: 1.04,
      contrast: 1.18,
      vignette: 1.3,
    },
    night: {
      key: { dir: [0.4, -0.6, -0.7], color: '#ffc38a', intensity: 1.4 },
      second: { dir: [-0.6, -0.6, 0.5], color: '#7d86ff', intensity: 0.8 },
      environment: 0.4,
      shadows: 'map',
      shadowStretch: 1.8,
      exposure: 1.1,
      contrast: 1.18,
      vignette: 1.5,
    },
  },
  camera: {
    pitch: d2r(11),
    yaw: d2r(-14),
    fov: 0.74,
    aim: { x: 0.35, y: 0.1, z: 0.5 },
    feetY: 0.52,
    fitHalfWidth: 3.9,
    fitHeight: 3.6,
    hitPush: 0.1,
    shake: 0.12,
    roll: 0,
  },
  sky: {
    day: {
      zenith: '#7fb2ec',
      horizon: '#ffe9c4',
      below: '#c9ad9f',
      sunGlow: 0.55,
      sunColor: '#fff2c8',
      clouds: 4,
      cloudColor: '#fff6ec',
      sunDisc: true,
      farHills: true,
      fog: [28, 90],
      motes: 40,
    },
    dusk: {
      zenith: '#5d5aa8',
      horizon: '#ffb27c',
      below: '#6e4f6e',
      sunGlow: 1.0,
      sunColor: '#ffd08a',
      clouds: 4,
      cloudColor: '#ffc9b8',
      sunDisc: true,
      farHills: true,
      fog: [25, 85],
      motes: 60,
    },
    night: {
      zenith: '#171a4a',
      horizon: '#4a4a96',
      below: '#242246',
      sunGlow: 0.4,
      sunColor: '#ffe8b8',
      clouds: 3,
      cloudColor: '#5e5a9a',
      sunDisc: true,
      farHills: true,
      fog: [25, 85],
      motes: 90,
    },
  },
  ground: { rimDarken: 0.26, stageRing: 0, propShare: 1.1, saturation: 1.0 },
  motion: { exaggeration: 1.25, hitStop: 140, knockback: 1.0, idleBob: 0.045 },
  fx: {
    style: 'glow',
    density: 1.15,
    size: 1.0,
    speedLines: 0,
    impactRing: true,
    burstRays: false,
    flash: 1.1,
    trail: true,
    chargeAura: true,
  },
  hud: 'glass',
};

export const DIRECTIONS: Readonly<Record<DirectionId, Direction>> = { A, B, C };

export function directionOf(id: string | null): Direction {
  return (id && DIRECTIONS[id as DirectionId]) || A;
}
