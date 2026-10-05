import type { EffectKind } from './choreography.js';

/*
 * Battle effects (owner decision 2026-10-05): Lantern Hour's hot white cores
 * with coloured halos that bloom, plus Saturday Morning Smackdown's bigger
 * impact stars and speed lines. Pure: an effect becomes a list of particles,
 * and a particle's place and size are a pure function of time, so the pool
 * (effects.ts) only copies numbers into instance buffers and a replay looks
 * the same. Every element has its own signature (shape, motion, colours and
 * a flourish), so a fire boop never reads like a water one. Kid-safe:
 * boops, bonks, sparkles and hearts; nothing sharp-red or scary.
 */

/** Pooled particle meshes: one thin-instanced mesh each. */
export type ParticleShape =
  'puff' | 'halo' | 'shard' | 'leaf' | 'star' | 'heart' | 'ring' | 'line' | 'drop';

export const PARTICLE_SHAPES: readonly ParticleShape[] = [
  'puff',
  'halo',
  'shard',
  'leaf',
  'star',
  'heart',
  'ring',
  'line',
  'drop',
];

/** How a particle moves (see `particleAt`). */
export type ParticleMotion =
  /** Thrown out, falls under gravity (splashes, chips, confetti). */
  | 'ballistic'
  /** Floats up with a wiggle (embers, bubbles, sparkles). */
  | 'rise'
  /** Drifts and swings down like a leaf. */
  | 'flutter'
  /** Jitters fast along its path (sparks). */
  | 'zap'
  /** Spirals out and up around where it started (shadow, auras). */
  | 'swirl'
  /** Hangs about, pulsing (twinkles). */
  | 'twinkle'
  /** Circles over a head (dizzy stars). */
  | 'orbit'
  /** Swells and pops (a hit's flash). */
  | 'pop'
  /** A ground ring that grows and thins. */
  | 'ring'
  /** A speed line: a fixed radial spot in the camera plane, streaking outwards. */
  | 'speedline'
  /** A sky ray: a long wedge from the hit, behind the fight, in the camera plane. */
  | 'ray'
  /** Flies to a target on a low arc (a hex's bolt). */
  | 'throw'
  /** The Heart Charm: a high throw, then hopeful wobbles on the ground. */
  | 'charm';

/** An element's signature: how its bits look and move, and its flourish on a hit. */
export interface ElementFx {
  /** sRGB hex colours, picked in turn. */
  readonly colors: readonly [string, string, string];
  /** The near-white core that blooms. */
  readonly core: string;
  readonly shape: ParticleShape;
  readonly motion: ParticleMotion;
  /** A burst's speed out, lift and gravity (world units/s, /s²), and the bits' size (× height). */
  readonly burst: { speed: number; up: number; gravity: number; size: number; life: number };
  /** A second flourish on impact. */
  readonly flourish: 'ring' | 'sparkle' | 'dust' | 'none';
}

/** Keyed by element id (packages/shared/src/data/elements.ts); unknown ones look like light. */
export const ELEMENT_FX: Readonly<Record<string, ElementFx>> = {
  // Embers float up and wink out; the flash is hot.
  fire: {
    colors: ['#ff7a3d', '#ffb347', '#ffe066'],
    core: '#fff3c4',
    shape: 'puff',
    motion: 'rise',
    burst: { speed: 3.2, up: 2.6, gravity: 0, size: 0.26, life: 720 },
    flourish: 'none',
  }, // TUNE
  // Droplets arc up and splash down, with a ring on the ground.
  water: {
    colors: ['#4fbef5', '#9fe3ff', '#ffffff'],
    core: '#eafaff',
    shape: 'drop',
    motion: 'ballistic',
    burst: { speed: 3.4, up: 4.4, gravity: 9, size: 0.24, life: 760 },
    flourish: 'ring',
  }, // TUNE
  // Leaves whirl out and flutter down.
  leaf: {
    colors: ['#5fbf7a', '#9be36f', '#d9f27a'],
    core: '#f2ffd6',
    shape: 'leaf',
    motion: 'flutter',
    burst: { speed: 3.2, up: 2.2, gravity: 1.2, size: 0.3, life: 900 },
    flourish: 'none',
  }, // TUNE
  // Frost: slow glassy shards and a twinkle of ice.
  frost: {
    colors: ['#bfe9ff', '#ffffff', '#93cdf5'],
    core: '#ffffff',
    shape: 'shard',
    motion: 'ballistic',
    burst: { speed: 2.6, up: 2.4, gravity: 3, size: 0.24, life: 820 },
    flourish: 'sparkle',
  }, // TUNE
  // Sparks zap about fast and short.
  spark: {
    colors: ['#ffe94d', '#fff6b0', '#ffd23d'],
    core: '#ffffff',
    shape: 'shard',
    motion: 'zap',
    burst: { speed: 5.2, up: 1.8, gravity: 0, size: 0.2, life: 520 },
    flourish: 'none',
  }, // TUNE
  // Stone: chunky chips thrown out heavily, with dust.
  stone: {
    colors: ['#b8a58f', '#d4c7b5', '#97856f'],
    core: '#f4ecdf',
    shape: 'shard',
    motion: 'ballistic',
    burst: { speed: 3.0, up: 3.6, gravity: 13, size: 0.32, life: 700 },
    flourish: 'dust',
  }, // TUNE
  // Shadow: violet wisps swirl out and up.
  shadow: {
    colors: ['#7b5cc4', '#a98bea', '#5a438f'],
    core: '#e6d8ff',
    shape: 'puff',
    motion: 'swirl',
    burst: { speed: 1.6, up: 1.6, gravity: 0, size: 0.3, life: 800 },
    flourish: 'none',
  }, // TUNE
  // Light: stars rise and twinkle.
  light: {
    colors: ['#fff3a6', '#ffffff', '#ffd6f0'],
    core: '#ffffff',
    shape: 'star',
    motion: 'rise',
    burst: { speed: 2.6, up: 2.8, gravity: 0, size: 0.24, life: 760 },
    flourish: 'sparkle',
  }, // TUNE
};

export const FALLBACK_ELEMENT = 'light';

export function elementFx(element: string | null): ElementFx {
  const fx = ELEMENT_FX[element ?? FALLBACK_ELEMENT] ?? ELEMENT_FX[FALLBACK_ELEMENT];
  if (!fx) throw new Error('the fallback element look is missing');
  return fx;
}

/** Colours of the cartoon extras. */
export const EXTRAS = {
  stars: ['#fff1a8', '#ffffff', '#ffd86b'],
  dust: ['#f4ead9', '#e9dcc6', '#fffaf0'],
  droop: ['#b9b0c9', '#a59cb8', '#d3cce0'],
  sleepy: ['#c9c2ff', '#e3ddff', '#b3e0ff'],
  hearts: ['#ff8fb8', '#ffb3cf', '#ff6f9f'],
  charm: '#ff7fae',
  flash: '#ffffff',
  rays: ['#fff6d8', '#ffe9b0'],
} as const; // TUNE

/** The impact's cartoon extras: stars, speed lines and sky rays (B), sized for the owner's "light" brief. */
export const IMPACT = {
  stars: 7, // TUNE
  starSize: 0.3, // TUNE: × the squishy's height
  speedLines: 10, // TUNE: small, round the hit
  /** Sky rays only on a super hit (the strongest tier), never with reduced motion. */
  rays: 12, // TUNE
  raysAtStrength: 1.4, // TUNE
} as const;

/** Where things are, in world units. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One particle, fully described at spawn; it never changes after. */
export interface Particle {
  readonly shape: ParticleShape;
  /** sRGB hex. */
  readonly color: string;
  /** ms on the battle clock; drawn from here (`life` long). */
  readonly born: number;
  readonly life: number;
  readonly motion: ParticleMotion;
  readonly origin: Point;
  /** Velocity, world units per second (`throw`, `charm`: unused). */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** World units per second², downwards. */
  readonly gravity: number;
  readonly size: number;
  /** A per-particle number in [0, 1) for wiggles and spins. */
  readonly seed: number;
  /** `throw` and `charm` fly here; `orbit` circles over it at `vx` radius. */
  readonly target?: Point;
  /** For speed lines and rays: angle in the camera plane, and the length. */
  readonly angle?: number;
  readonly length?: number;
}

/** Where to spawn an effect and how strongly. */
export interface EmitAt {
  readonly kind: EffectKind;
  readonly element: string | null;
  readonly strength: number;
  /** The battle clock now, ms. */
  readonly now: number;
  /** Middle of the squishy it's about, and its height. */
  readonly at: Point;
  readonly height: number;
  /** For bolts and charms: where it goes (the other fighter's middle, the thrower). */
  readonly to?: Point;
  /** For trails: where the dasher's middle is at a time (the trail follows the dash). */
  readonly path?: (t: number) => Point;
  /** For trails and statuses: how long, ms. */
  readonly duration?: number;
  /** A per-spawn salt, so two bursts never line up. */
  readonly salt: number;
  /** `charm`: the squishy wants to be friends. */
  readonly caught?: boolean;
  /** Reduced motion: thinner, no flash, no speed lines or rays. */
  readonly reduced: boolean;
}

/** A fast seeded hash in [0, 1): deterministic, so a replay looks the same. */
export function rand(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/** The particles for one effect. */
export function emit(e: EmitAt): Particle[] {
  const out: Particle[] = [];
  const dens = e.reduced ? 0.6 : 1;
  const n = (count: number) => Math.max(1, Math.round(count * dens));
  const r = (i: number, k: number) => rand(e.salt * 131 + i, k);
  const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;
  const fx = elementFx(e.element);
  const h = e.height;
  const s = Math.max(0.3, e.strength);
  const add = (p: Particle) => out.push(p);
  const burst = (
    count: number,
    shape: ParticleShape,
    colors: readonly string[],
    motion: ParticleMotion,
    speed: number,
    up: number,
    gravity: number,
    size: number,
    life: number,
    origin: Point = e.at,
    delay = 0,
    halos = false,
  ) => {
    for (let i = 0; i < count; i++) {
      const a = TAU * (i / count + r(i, 1) * 0.3);
      const v = speed * (0.6 + 0.6 * r(i, 2));
      const base: Particle = {
        shape,
        color: pick(colors, i),
        born: e.now + delay + r(i, 3) * 40,
        life: life * (0.75 + 0.5 * r(i, 4)),
        motion,
        origin,
        vx: Math.cos(a) * v,
        vy: up * (0.5 + r(i, 5)),
        vz: Math.sin(a) * v * 0.7,
        gravity,
        size: size * (0.7 + 0.6 * r(i, 6)),
        seed: r(i, 9),
      };
      add(base);
      // Every other coloured bit gets a soft halo that blooms.
      if (halos && i % 2 === 0) {
        add({
          ...base,
          shape: 'halo',
          color: pick(colors, i + 1),
          life: life * 0.8,
          size: size * 1.9,
        });
      }
    }
  };

  switch (e.kind) {
    case 'charge': {
      // Wind-up: bits of the element rise from a ring around the attacker's feet.
      const count = n(14);
      for (let i = 0; i < count; i++) {
        const a = TAU * ((i + r(i, 1) * 0.5) / count);
        const rr = h * (0.55 + 0.25 * r(i, 2));
        add({
          shape: i % 2 === 0 ? 'halo' : fx.shape,
          color: pick(fx.colors, i),
          born: e.now + r(i, 3) * 160,
          life: 520 * (0.8 + 0.4 * r(i, 4)),
          motion: 'rise',
          origin: {
            x: e.at.x + Math.cos(a) * rr,
            y: e.at.y - h * 0.45,
            z: e.at.z + Math.sin(a) * rr * 0.8 - 0.3,
          },
          vx: 0,
          vy: 1.6 + r(i, 5),
          vz: 0,
          gravity: 0,
          size: 0.15 * h * (0.8 + 0.5 * r(i, 6)),
          seed: r(i, 9),
        });
      }
      burst(n(5), 'star', [fx.core, '#ffffff'], 'rise', 0.6, 1.8, 0, 0.1 * h, 520, {
        x: e.at.x,
        y: e.at.y - h * 0.3,
        z: e.at.z - h * 0.5,
      });
      break;
    }
    case 'trail': {
      // Bits of the element stream behind the dash; the path is where the dasher's middle is.
      const count = n(12);
      const duration = e.duration ?? 190;
      for (let i = 0; i < count; i++) {
        // Spread evenly along the dash (its travel eases in), not evenly in time.
        const born = e.now + duration * ((i + 0.5) / count) ** (1 / 1.6);
        const where = e.path ? e.path(born) : e.at;
        add({
          shape: 'halo',
          color: pick(fx.colors, i),
          born,
          life: 380 * (0.8 + 0.4 * r(i, 4)),
          motion: fx.motion === 'ballistic' ? 'rise' : fx.motion === 'zap' ? 'zap' : 'rise',
          origin: {
            x: where.x + (r(i, 1) - 0.5) * 0.4 * h,
            y: where.y + (r(i, 2) - 0.3) * 0.5 * h,
            z: where.z + (r(i, 3) - 0.5) * 0.4 * h,
          },
          vx: (r(i, 5) - 0.5) * 0.6,
          vy: 0.6,
          vz: (r(i, 6) - 0.5) * 0.6,
          gravity: 0,
          size: 0.16 * h * (0.8 + 0.4 * r(i, 7)),
          seed: r(i, 9),
        });
      }
      break;
    }
    case 'flash':
      // A white pop where it lands (never with reduced motion: the plan leaves it out).
      add({
        shape: 'puff',
        color: EXTRAS.flash,
        born: e.now,
        life: 110,
        motion: 'pop',
        origin: e.at,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        size: 0.6 * h * Math.min(1.5, s),
        seed: 0,
      });
      break;
    case 'impact': {
      const at = e.at;
      const b = fx.burst;
      // The element's own burst, with halos and a few hot cores ...
      burst(
        n(14 * Math.min(1.6, s)),
        fx.shape,
        fx.colors,
        fx.motion,
        b.speed * s,
        b.up,
        b.gravity,
        b.size * h,
        b.life,
        at,
        0,
        true,
      );
      // ... biased towards the camera, so it isn't lost inside the squishy ...
      out.forEach((p, i) => {
        if (p.born >= e.now && p.motion === fx.motion) out[i] = { ...p, vz: p.vz - 1.6 };
      });
      burst(n(6), 'star', [fx.core, '#ffffff', fx.core], 'rise', 2.0, 2.4, 0, 0.14 * h, 600);
      // ... the element's flourish ...
      if (fx.flourish === 'ring') {
        add({
          shape: 'ring',
          color: fx.core,
          born: e.now,
          life: 420,
          motion: 'ring',
          origin: { x: at.x, y: 0.06, z: at.z },
          vx: 0,
          vy: 0,
          vz: 0,
          gravity: 0,
          size: 1.1 * h * s,
          seed: 0,
        });
      } else if (fx.flourish === 'sparkle') {
        burst(
          n(8),
          'star',
          [fx.core, '#ffffff', pick(fx.colors, 1)],
          'twinkle',
          1.2,
          1.2,
          0,
          0.12 * h,
          900,
          at,
          60,
        );
      } else if (fx.flourish === 'dust') {
        burst(n(8), 'puff', EXTRAS.dust, 'ballistic', 2.2, 1.0, 3, 0.22 * h, 560, {
          x: at.x,
          y: 0.1,
          z: at.z,
        });
      }
      // ... the cartoon impact stars (B's big ones) ...
      burst(
        n(IMPACT.stars),
        'star',
        EXTRAS.stars,
        'ballistic',
        3.4 * s,
        3.2,
        6,
        IMPACT.starSize * h,
        650,
      );
      // ... speed lines round the hit, and sky rays behind a super hit.
      if (!e.reduced) {
        for (let i = 0; i < IMPACT.speedLines; i++) {
          const a = (i / IMPACT.speedLines) * TAU + r(i, 11) * 0.3;
          add({
            shape: 'line',
            color: i % 3 === 0 ? '#ffffff' : pick(fx.colors, i),
            born: e.now + r(i, 12) * 30,
            life: 240 + r(i, 13) * 100,
            motion: 'speedline',
            origin: at,
            vx: 0,
            vy: 0,
            vz: 0,
            gravity: 0,
            size: 0.06 * h,
            seed: r(i, 9),
            angle: a,
            length: h * (0.7 + 0.6 * r(i, 14)),
          });
        }
        if (s >= IMPACT.raysAtStrength) {
          for (let i = 0; i < IMPACT.rays; i++) {
            add({
              shape: 'line',
              color: pick(EXTRAS.rays, i),
              born: e.now,
              life: 320,
              motion: 'ray',
              origin: at,
              vx: 0,
              vy: 0,
              vz: 0,
              gravity: 0,
              size: 0.2 * h,
              seed: r(i, 9),
              angle: (i / IMPACT.rays) * TAU + 0.1,
              length: 3.2 * h,
            });
          }
        }
      }
      break;
    }
    case 'bolt': {
      // A ball of the element flies to the other side on a low arc, with a few bits trailing.
      const to = e.to ?? e.at;
      for (let i = 0; i < n(6); i++) {
        add({
          shape: i === 0 ? 'halo' : fx.shape,
          color: i === 0 ? fx.core : pick(fx.colors, i),
          born: e.now + i * 25,
          life: 420,
          motion: 'throw',
          origin: e.at,
          target: to,
          vx: 0,
          vy: 0,
          vz: 0,
          gravity: 0,
          size: (i === 0 ? 0.42 : 0.18) * h,
          seed: r(i, 9),
        });
      }
      burst(
        n(8),
        fx.shape,
        fx.colors,
        fx.motion,
        fx.burst.speed * 0.6,
        fx.burst.up * 0.6,
        fx.burst.gravity * 0.5,
        fx.burst.size * h * 0.7,
        520,
        to,
        400,
        true,
      );
      break;
    }
    case 'aura':
      // The element swirls up around the squishy.
      burst(
        n(16),
        fx.shape,
        fx.colors,
        'swirl',
        1.4,
        1.6,
        0,
        0.18 * h,
        760,
        { x: e.at.x, y: 0.2, z: e.at.z },
        0,
        true,
      );
      break;
    case 'sparkle':
      burst(
        n(12),
        'star',
        ['#fff1a8', '#ffffff', '#ffd6f0'],
        'rise',
        1.2,
        1.8,
        0,
        0.16 * h,
        820,
        { x: e.at.x, y: e.at.y - h * 0.3, z: e.at.z },
        0,
        true,
      );
      break;
    case 'droop':
      burst(n(6), 'puff', EXTRAS.droop, 'ballistic', 0.6, -0.4, 1.2, 0.18 * h, 700, {
        x: e.at.x,
        y: e.at.y + h * 0.4,
        z: e.at.z - h * 0.3,
      });
      break;
    case 'dizzy': {
      const over = { x: e.at.x, y: e.at.y + h * 0.62, z: e.at.z };
      for (let i = 0; i < 4; i++) {
        add({
          shape: 'star',
          color: pick(EXTRAS.stars, i),
          born: e.now,
          life: e.duration ?? 1400,
          motion: 'orbit',
          origin: over,
          target: over,
          vx: 0.4 * h,
          vy: 0,
          vz: i / 4,
          gravity: 0,
          size: 0.15 * h,
          seed: r(i, 9),
        });
      }
      break;
    }
    case 'sleepy':
      burst(n(5), 'puff', EXTRAS.sleepy, 'rise', 0.3, 0.9, 0, 0.16 * h, 1300, {
        x: e.at.x + h * 0.3,
        y: e.at.y + h * 0.4,
        z: e.at.z - h * 0.2,
      });
      break;
    case 'dust':
      burst(n(7), 'puff', EXTRAS.dust, 'ballistic', 1.9, 0.9, 3, 0.2 * h, 550, {
        x: e.at.x,
        y: 0.1,
        z: e.at.z,
      });
      break;
    case 'charm': {
      // Thrown from the Keeper (`to`) to the squishy's feet, then wobbles there.
      const from = e.to ?? e.at;
      add({
        shape: 'heart',
        color: EXTRAS.charm,
        born: e.now,
        life: e.duration ?? 1500,
        motion: 'charm',
        origin: from,
        target: { x: e.at.x, y: 0.15, z: e.at.z },
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        size: 0.45 * h,
        seed: 0,
      });
      // A sparkle swirl while the squishy is drawn in.
      burst(
        n(10),
        'halo',
        ['#ffd6f0', '#ffffff', '#ff9fc6'],
        'swirl',
        1.2,
        1.4,
        0,
        0.14 * h,
        900,
        { x: e.at.x, y: 0.2, z: e.at.z },
        (e.duration ?? 1500) * 0.37,
      );
      break;
    }
    case 'confetti':
      burst(n(12), 'heart', EXTRAS.hearts, 'ballistic', 2.4, 4.6, 6, 0.18 * h, 1100);
      burst(n(8), 'star', EXTRAS.stars, 'ballistic', 2.6, 5, 6, 0.14 * h, 1000);
      break;
  }
  return out;
}

/** A particle's place and shape at a moment (reused: the pool keeps one). */
export interface ParticleState {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tumble: number;
  /** Lines face the camera: `roll` is their angle in the camera plane and `x` their radial distance. */
  billboard: boolean;
  roll: number;
}

/** Writes where `p` is at `now` into `out`; false when it isn't alive. */
export function particleAt(p: Particle, now: number, out: ParticleState): boolean {
  const age = now - p.born;
  if (age < 0 || age >= p.life) return false;
  const u = age / p.life;
  const t = age / 1000;
  const grow = Math.min(1, u / 0.05);
  const fade = u > 0.66 ? 1 - (u - 0.66) / 0.34 : 1;
  let scale = p.size * grow * fade;
  let x = p.origin.x + p.vx * t;
  let y = p.origin.y + p.vy * t - 0.5 * p.gravity * t * t;
  let z = p.origin.z + p.vz * t;
  let yaw = p.seed * TAU + t * 4;
  let tumble = p.seed * 3 + t * 6;
  out.billboard = false;
  out.roll = 0;
  out.sx = out.sy = out.sz = 1;
  switch (p.motion) {
    case 'ballistic':
      y = Math.max(0.05, y);
      break;
    case 'rise':
      x += Math.sin(t * 9 + p.seed * TAU) * 0.08;
      z += Math.cos(t * 7 + p.seed * TAU) * 0.06;
      break;
    case 'flutter':
      x += Math.sin(t * 6 + p.seed * TAU) * 0.35 * Math.min(1, t * 2);
      y = Math.max(0.05, y);
      tumble = Math.sin(t * 6 + p.seed * TAU) * 1.1;
      break;
    case 'zap': {
      const k = Math.floor(age / 40);
      x += (rand(k, Math.floor(p.seed * 1e6)) - 0.5) * 0.35;
      y += (rand(k + 7, Math.floor(p.seed * 1e6)) - 0.5) * 0.35;
      break;
    }
    case 'swirl': {
      const a = p.seed * TAU + t * 5;
      const radius = 0.35 + 0.9 * u;
      x = p.origin.x + Math.cos(a) * radius;
      z = p.origin.z + Math.sin(a) * radius * 0.8;
      y = p.origin.y + p.vy * t;
      break;
    }
    case 'twinkle':
      x = p.origin.x + p.vx * 0.25 + Math.sin(t * 3 + p.seed * TAU) * 0.1;
      y = p.origin.y + p.vy * 0.25 + t * 0.3;
      z = p.origin.z + p.vz * 0.25;
      scale = p.size * fade * (0.55 + 0.45 * Math.abs(Math.sin(t * 9 + p.seed * TAU)));
      break;
    case 'orbit': {
      const a = (p.vz + t * 0.9) * TAU;
      x = p.origin.x + Math.cos(a) * p.vx;
      z = p.origin.z + Math.sin(a) * p.vx * 0.6;
      y = p.origin.y + Math.sin(a * 2) * 0.05;
      scale = p.size;
      break;
    }
    case 'pop':
      scale = p.size * (u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65) * (u < 0.35 ? 1 : 1.15);
      break;
    case 'ring': {
      const e = 1 - (1 - u) ** 2;
      scale = p.size * (0.3 + 2.2 * e);
      out.sy = Math.max(0.05, 1 - u) * 0.4;
      yaw = 0;
      tumble = 0;
      break;
    }
    case 'speedline': {
      // Sits a little out from the hit, streaks outwards, fades.
      out.billboard = true;
      out.roll = p.angle ?? 0;
      const e = 1 - (1 - u) ** 2;
      const len = (p.length ?? 1) * (0.4 + 0.6 * e) * (1 - u * 0.5);
      const dist = (p.length ?? 1) * (0.55 + 1.1 * e);
      out.sx = len;
      out.sy = p.size * (1 - u);
      out.sz = p.size * (1 - u);
      scale = 1;
      x = dist;
      y = 0;
      z = 0;
      yaw = 0;
      tumble = 0;
      break;
    }
    case 'ray': {
      out.billboard = true;
      out.roll = p.angle ?? 0;
      const e = 1 - (1 - u) ** 3;
      out.sx = (p.length ?? 1) * e;
      out.sy = p.size * (1 - u) * (0.6 + 0.4 * Math.sin(p.seed * TAU + t * 20));
      out.sz = 0.02;
      scale = 1;
      x = (p.length ?? 1) * e * 0.5 + 1.6;
      y = 0;
      z = 0;
      yaw = 0;
      tumble = 0;
      break;
    }
    case 'throw': {
      const to = p.target ?? p.origin;
      x = p.origin.x + (to.x - p.origin.x) * u;
      z = p.origin.z + (to.z - p.origin.z) * u;
      y = p.origin.y + (to.y - p.origin.y) * u + Math.sin(Math.PI * u) * 0.6;
      scale = p.size * grow;
      break;
    }
    case 'charm': {
      const to = p.target ?? p.origin;
      const flight = 0.37;
      const f = Math.min(1, u / flight);
      x = p.origin.x + (to.x - p.origin.x) * f;
      z = p.origin.z + (to.z - p.origin.z) * f;
      y = p.origin.y + (to.y - p.origin.y) * f + Math.sin(Math.PI * f) * 2.4;
      scale = p.size * grow;
      yaw = f * TAU * 1.5;
      tumble = 0;
      if (f >= 1) {
        const w = (u - flight) / (1 - flight);
        y = to.y + Math.abs(Math.sin(w * Math.PI * 3)) * 0.14 * (1 - w * 0.5);
        tumble = Math.sin(w * Math.PI * 6) * 0.4 * (1 - w * 0.5);
        yaw = 0;
        scale = p.size * (w > 0.9 ? 1 - (w - 0.9) / 0.1 : 1 + 0.08 * Math.sin(w * Math.PI * 6));
      }
      break;
    }
  }
  out.x = x;
  out.y = y;
  out.z = z;
  if (!out.billboard) {
    out.sx *= scale;
    out.sy *= scale;
    out.sz *= scale;
  }
  out.yaw = yaw;
  out.tumble = tumble;
  return true;
}
