import type { EffectKind } from './choreography.js';

/*
 * The look of battle effects (owner decision 2026-10-04): fire trails and
 * embers, water splashes, leaf whirls, frost shards, spark zaps, stone
 * chips, shadow swirls and light sparkles, plus the cartoon extras (impact
 * stars, dust puffs, dizzy stars, sleepy bubbles, hearts). Pure: an effect
 * becomes a list of particles, and a particle's place and size are a pure
 * function of time, so the pool (effects.ts) only copies numbers into
 * instance buffers. Kid-safe: bright, round and bouncy; nothing sharp-red
 * or scary.
 */

/** Pooled particle meshes: one thin-instanced mesh each. */
export type ParticleShape = 'puff' | 'shard' | 'leaf' | 'star' | 'heart';

export const PARTICLE_SHAPES: readonly ParticleShape[] = ['puff', 'shard', 'leaf', 'star', 'heart'];

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
  /** Flies to a target on a low arc (a hex's bolt). */
  | 'throw'
  /** The Heart Charm: a high throw, then hopeful wobbles on the ground. */
  | 'charm';

export interface ElementFx {
  /** sRGB hex colours, picked in turn. */
  readonly colors: readonly [string, string, string];
  readonly shape: ParticleShape;
  /** How its burst moves; trails and auras follow from it. */
  readonly motion: ParticleMotion;
}

/** Keyed by element id (packages/shared/src/data/elements.ts); unknown ones look like light. */
export const ELEMENT_FX: Readonly<Record<string, ElementFx>> = {
  fire: { colors: ['#ff7a3d', '#ffb347', '#ffe066'], shape: 'puff', motion: 'rise' }, // TUNE
  water: { colors: ['#4fbef5', '#9fe3ff', '#ffffff'], shape: 'puff', motion: 'ballistic' }, // TUNE
  leaf: { colors: ['#5fbf7a', '#9be36f', '#3fa66a'], shape: 'leaf', motion: 'flutter' }, // TUNE
  frost: { colors: ['#bfe9ff', '#ffffff', '#93cdf5'], shape: 'shard', motion: 'ballistic' }, // TUNE
  spark: { colors: ['#ffe94d', '#fff6b0', '#ffd23d'], shape: 'shard', motion: 'zap' }, // TUNE
  stone: { colors: ['#b8a58f', '#d4c7b5', '#97856f'], shape: 'shard', motion: 'ballistic' }, // TUNE
  shadow: { colors: ['#7b5cc4', '#a98bea', '#5a438f'], shape: 'puff', motion: 'swirl' }, // TUNE
  light: { colors: ['#fff3a6', '#ffffff', '#ffd6f0'], shape: 'star', motion: 'twinkle' }, // TUNE
};

export const FALLBACK_ELEMENT = 'light';

export function elementFx(element: string | null): ElementFx {
  const fx = ELEMENT_FX[element ?? FALLBACK_ELEMENT] ?? ELEMENT_FX[FALLBACK_ELEMENT];
  if (!fx) throw new Error('the fallback element look is missing');
  return fx;
}

/** Colours and shapes of the cartoon extras. */
const EXTRAS = {
  stars: ['#fff1a8', '#ffffff', '#ffd86b'],
  dust: ['#f4ead9', '#e9dcc6', '#fffaf0'],
  droop: ['#b9b0c9', '#a59cb8', '#d3cce0'],
  sleepy: ['#c9c2ff', '#e3ddff', '#b3e0ff'],
  hearts: ['#ff8fb8', '#ffb3cf', '#ff6f9f'],
  flash: ['#ffffff', '#fffbe8', '#ffffff'],
} as const; // TUNE

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
  /** Velocity, world units per second (`throw`: unused). */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** World units per second², downwards. */
  readonly gravity: number;
  readonly size: number;
  /** A per-particle number in [0, 1) for wiggles and spins. */
  readonly seed: number;
  /** `throw` flies here; `orbit` circles over it at `vx` radius. */
  readonly target?: Point;
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
  /** For bolts, charms and trails: where it goes (the other fighter's middle). */
  readonly to?: Point;
  /** For trails: where the fighter will be at time `t` (it moves while the trail streams). */
  readonly path?: (t: number) => Point;
  /** How long a trail streams, or a Heart Charm stays out, ms. */
  readonly duration?: number;
  /** The ground's colour for dust (sRGB hex). */
  readonly dust?: string;
  /** Fewer particles (low quality tier, reduced motion). */
  readonly share: number;
}

/** A tiny repeatable hash in [0, 1): the same effect always scatters the same way. */
export function rand(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/** The particles for one effect cue. `salt` varies the scatter between cues. */
export function emit(e: EmitAt, salt: number): Particle[] {
  const out: Particle[] = [];
  const n = (count: number) => Math.max(1, Math.round(count * e.share));
  const r = (i: number, k: number) => rand(salt * 131 + i, k);
  const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;
  const fx = elementFx(e.element);
  const s = e.strength;
  const h = e.height;
  const add = (p: Omit<Particle, 'seed'> & { seed?: number }, i: number) =>
    out.push({ ...p, seed: p.seed ?? r(i, 9) });

  /** A burst of `count` going out in all directions at `speed`, with `up` lift. */
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
  ) => {
    for (let i = 0; i < count; i++) {
      const a = TAU * (i / count + r(i, 1) * 0.3);
      const v = speed * (0.6 + 0.6 * r(i, 2));
      add(
        {
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
        },
        i,
      );
    }
  };

  switch (e.kind) {
    case 'impact': {
      // The element's own burst where the hit lands...
      const count = n(12 * Math.min(1.6, s));
      const speed = fx.motion === 'zap' ? 5 : fx.motion === 'swirl' ? 1.6 : 3.4;
      const up = fx.motion === 'rise' ? 2.2 : fx.motion === 'ballistic' ? 4 : 1.5;
      const gravity = fx.motion === 'ballistic' ? 9 : fx.motion === 'flutter' ? 1.2 : 0;
      burst(count, fx.shape, fx.colors, fx.motion, speed * s, up, gravity, 0.22 * h, 700);
      // ...and cartoon impact stars, bigger for a super hit.
      burst(n(5 * s), 'star', EXTRAS.stars, 'ballistic', 3.2 * s, 3, 6, 0.24 * h, 600);
      break;
    }
    case 'flash':
      add(
        {
          shape: 'puff',
          color: EXTRAS.flash[0],
          born: e.now,
          life: 160 + 60 * s,
          motion: 'pop',
          origin: e.at,
          vx: 0,
          vy: 0,
          vz: 0,
          gravity: 0,
          size: 0.75 * h * Math.min(1.5, s),
        },
        0,
      );
      break;
    case 'trail': {
      // Element bits left behind along the dash.
      const count = n(10);
      const duration = e.duration ?? 200;
      for (let i = 0; i < count; i++) {
        const born = e.now + (duration * i) / count;
        const where = e.path ? e.path(born) : e.at;
        add(
          {
            shape: fx.shape,
            color: pick(fx.colors, i),
            born,
            life: 420 * (0.8 + 0.4 * r(i, 4)),
            motion: fx.motion === 'ballistic' ? 'rise' : fx.motion,
            origin: {
              x: where.x + (r(i, 1) - 0.5) * 0.4 * h,
              y: where.y + (r(i, 2) - 0.3) * 0.5 * h,
              z: where.z + (r(i, 3) - 0.5) * 0.4 * h,
            },
            vx: (r(i, 5) - 0.5) * 0.6,
            vy: 0.6,
            vz: (r(i, 6) - 0.5) * 0.6,
            gravity: 0,
            size: 0.18 * h * (0.8 + 0.4 * r(i, 7)),
          },
          i,
        );
      }
      break;
    }
    case 'bolt': {
      // A ball of the element flies over, with a few bits trailing it.
      const to = e.to ?? e.at;
      const count = n(5);
      for (let i = 0; i < count; i++) {
        add(
          {
            shape: i === 0 ? 'puff' : fx.shape,
            color: pick(fx.colors, i),
            born: e.now + i * 35,
            life: 420,
            motion: 'throw',
            origin: e.at,
            target: to,
            vx: 0,
            vy: 0,
            vz: 0,
            gravity: 0,
            size: (i === 0 ? 0.32 : 0.18) * h,
          },
          i,
        );
      }
      // It bursts when it gets there.
      burst(
        n(8),
        fx.shape,
        fx.colors,
        fx.motion,
        2.4,
        2,
        fx.motion === 'ballistic' ? 7 : 0,
        0.18 * h,
        600,
        to,
        420,
      );
      break;
    }
    case 'aura':
      burst(n(12), fx.shape, fx.colors, 'swirl', 1.2, 1.4, 0, 0.18 * h, 900, {
        x: e.at.x,
        y: e.at.y - h * 0.4,
        z: e.at.z,
      });
      break;
    case 'sparkle':
      burst(n(12), 'star', ['#fff3a6', '#ffffff', '#ffd6f0'], 'rise', 0.9, 1.6, 0, 0.17 * h, 1000);
      break;
    case 'droop':
      burst(n(7), 'puff', EXTRAS.droop, 'ballistic', 0.8, 0.6, 2.5, 0.16 * h, 800, {
        x: e.at.x,
        y: e.at.y + h * 0.45,
        z: e.at.z,
      });
      break;
    case 'dizzy': {
      const count = n(4);
      const over = { x: e.at.x, y: e.at.y + h * 0.65, z: e.at.z };
      for (let i = 0; i < count; i++) {
        add(
          {
            shape: 'star',
            color: pick(EXTRAS.stars, i),
            born: e.now,
            life: 1400,
            motion: 'orbit',
            origin: over,
            target: over,
            // Radius, and where on the circle it starts.
            vx: 0.38 * h,
            vy: 0,
            vz: i / count,
            gravity: 0,
            size: 0.16 * h,
          },
          i,
        );
      }
      break;
    }
    case 'sleepy':
      burst(n(5), 'puff', EXTRAS.sleepy, 'rise', 0.25, 0.7, 0, 0.14 * h, 1300, {
        x: e.at.x,
        y: e.at.y + h * 0.5,
        z: e.at.z,
      });
      break;
    case 'dust': {
      const ground = { x: e.at.x, y: 0.1, z: e.at.z };
      const color = e.dust ?? EXTRAS.dust[0];
      burst(n(7), 'puff', [color, ...EXTRAS.dust], 'ballistic', 1.8, 0.9, 3, 0.2 * h, 500, ground);
      break;
    }
    case 'charm': {
      // The Heart Charm: thrown in an arc, it bobs while it decides.
      const from = e.to ?? e.at;
      add(
        {
          shape: 'heart',
          color: '#ff7fae',
          born: e.now,
          life: e.duration ?? 1250,
          motion: 'charm',
          origin: from,
          target: { x: e.at.x, y: e.at.y, z: e.at.z },
          vx: 0,
          vy: 0,
          vz: 0,
          gravity: 0,
          size: 0.42 * h,
        },
        0,
      );
      break;
    }
    case 'confetti':
      burst(n(10), 'heart', EXTRAS.hearts, 'ballistic', 2.2, 4.5, 6, 0.16 * h, 1100);
      burst(n(8), 'star', EXTRAS.stars, 'ballistic', 2.6, 5, 6, 0.14 * h, 1000);
      break;
  }
  return out;
}

/** A particle's place, size and spin at a moment (written into, never allocated). */
export interface ParticleState {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tumble: number;
}

/** The share of a Heart Charm's time spent flying; the rest it wobbles while it decides. */
export const THROW_FLIGHT = 0.36; // TUNE: lands as the squishy is drawn in (CHOREO.charm)

/**
 * Where particle `p` is at `now`, written into `out`. False when it isn't
 * alive (not born yet, or done): then `out` is left alone.
 */
export function particleAt(p: Particle, now: number, out: ParticleState): boolean {
  const age = now - p.born;
  if (age < 0 || age >= p.life) return false;
  const u = age / p.life;
  const t = age / 1000;
  // Pop in over the first tenth, shrink away over the last third.
  const grow = Math.min(1, u / 0.1);
  const fade = u > 0.66 ? 1 - (u - 0.66) / 0.34 : 1;
  let scale = p.size * grow * fade;
  let x = p.origin.x + p.vx * t;
  let y = p.origin.y + p.vy * t - 0.5 * p.gravity * t * t;
  let z = p.origin.z + p.vz * t;
  let yaw = p.seed * TAU + t * 4;
  let tumble = p.seed * 3 + t * 6;
  switch (p.motion) {
    case 'ballistic':
      // Bounce-free: never below the ground.
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
      scale *= 0.65 + 0.35 * Math.sin(t * 18 + p.seed * TAU);
      x = p.origin.x + p.vx * t * 0.4;
      y = p.origin.y + p.vy * t * 0.4;
      z = p.origin.z + p.vz * t * 0.4;
      break;
    case 'orbit': {
      const a = (p.vz + t * 0.9) * TAU;
      x = p.origin.x + Math.cos(a) * p.vx;
      z = p.origin.z + Math.sin(a) * p.vx * 0.6;
      y = p.origin.y + Math.sin(a * 2) * 0.05;
      break;
    }
    case 'pop':
      // Swells fast, then pops away.
      scale = p.size * (u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65) * (u < 0.35 ? 1 : 1.15);
      break;
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
      const f = Math.min(1, u / THROW_FLIGHT);
      x = p.origin.x + (to.x - p.origin.x) * f;
      z = p.origin.z + (to.z - p.origin.z) * f;
      y = p.origin.y + (to.y - p.origin.y) * f + Math.sin(Math.PI * f) * 2.2;
      scale = p.size * grow;
      yaw = f * TAU * 1.5;
      tumble = 0;
      if (f >= 1) {
        // Down by the squishy: three hopeful wobbles, then it opens.
        const w = (u - THROW_FLIGHT) / (1 - THROW_FLIGHT);
        y = to.y + Math.abs(Math.sin(w * Math.PI * 3)) * 0.12 * (1 - w);
        tumble = Math.sin(w * Math.PI * 6) * 0.45 * (1 - w);
        yaw = 0;
        scale = p.size * (w > 0.88 ? 1 - (w - 0.88) / 0.12 : 1);
      }
      break;
    }
  }
  out.x = x;
  out.y = y;
  out.z = z;
  out.scale = Math.max(0, scale);
  out.yaw = yaw;
  out.tumble = tumble;
  return true;
}
