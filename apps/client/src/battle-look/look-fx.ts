import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { FxLook } from './directions.js';

/*
 * Battle effects for the look prototypes: one unlit thin-instanced mesh per
 * particle shape, sized once; a particle's place is a pure function of time
 * so a frozen frame is exact and a replay identical. Three "styles" change
 * the language: `soft` (round pastel puffs), `bold` (hard shards, speed
 * lines, big stars), `glow` (near-white cores that bloom, with coloured
 * halos). Kid-safe: boops, bonks, sparkles, hearts; nothing sharp-red.
 */

export type Shape = 'puff' | 'shard' | 'leaf' | 'star' | 'heart' | 'ring' | 'line' | 'drop' | 'halo';
const SHAPES: readonly Shape[] = ['puff', 'shard', 'leaf', 'star', 'heart', 'ring', 'line', 'drop', 'halo'];

const POOL: Readonly<Record<Shape, number>> = {
  puff: 120,
  shard: 80,
  leaf: 60,
  star: 60,
  heart: 24,
  ring: 6,
  line: 40,
  drop: 60,
  halo: 60,
};

export type Motion =
  | 'ballistic'
  | 'rise'
  | 'flutter'
  | 'zap'
  | 'swirl'
  | 'orbit'
  | 'pop'
  | 'ring'
  /** A speed line: fixed radial spot in the camera plane, stretched along its radius. */
  | 'speedline'
  /** A sky ray: a long wedge from the hit, in the camera plane. */
  | 'ray'
  | 'throw'
  | 'charm'
  | 'hover';

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Particle {
  shape: Shape;
  color: string;
  born: number;
  life: number;
  motion: Motion;
  origin: Point;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  size: number;
  seed: number;
  target?: Point;
  /** For speed lines and rays: angle in the camera plane, and the length. */
  angle?: number;
  length?: number;
}

export interface ElementFx {
  readonly colors: readonly [string, string, string];
  /** Near-white core for the glow style. */
  readonly core: string;
  readonly shape: Shape;
  readonly motion: Motion;
}

export const ELEMENT_FX: Readonly<Record<string, ElementFx>> = {
  fire: { colors: ['#ff7a3d', '#ffb347', '#ffe066'], core: '#fff3c4', shape: 'puff', motion: 'rise' },
  water: { colors: ['#4fbef5', '#9fe3ff', '#ffffff'], core: '#eafaff', shape: 'drop', motion: 'ballistic' },
  leaf: { colors: ['#5fbf7a', '#9be36f', '#d9f27a'], core: '#f2ffd6', shape: 'leaf', motion: 'flutter' },
  frost: { colors: ['#bfe9ff', '#ffffff', '#93cdf5'], core: '#ffffff', shape: 'shard', motion: 'ballistic' },
  spark: { colors: ['#ffe94d', '#fff6b0', '#ffd23d'], core: '#ffffff', shape: 'shard', motion: 'zap' },
  stone: { colors: ['#b8a58f', '#d4c7b5', '#97856f'], core: '#f4ecdf', shape: 'shard', motion: 'ballistic' },
  shadow: { colors: ['#7b5cc4', '#a98bea', '#5a438f'], core: '#e6d8ff', shape: 'puff', motion: 'swirl' },
  light: { colors: ['#fff3a6', '#ffffff', '#ffd6f0'], core: '#ffffff', shape: 'star', motion: 'rise' },
};

const STARS = ['#fff1a8', '#ffffff', '#ffd86b'];
const HEARTS = ['#ff8fb8', '#ffb3cf', '#ff6f9f'];
const DIZZY = ['#fff1a8', '#ffffff', '#ffd86b'];

export function rand(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

export type Cue = 'charge' | 'trail' | 'impact' | 'dizzy' | 'charm' | 'charmPop' | 'ko' | 'victory';

export interface Emit {
  cue: Cue;
  element: string | null;
  look: FxLook;
  reduced: boolean;
  now: number;
  /** The fighter it's about: middle and height. */
  at: Point;
  height: number;
  /** Where a throw goes / where a trail streams towards. */
  to?: Point;
  path?: (t: number) => Point;
  duration?: number;
  strength?: number;
  salt: number;
}

/** The particles for one cue. */
export function emit(e: Emit): Particle[] {
  const out: Particle[] = [];
  const look = e.look;
  const dens = look.density * (e.reduced ? 0.6 : 1);
  const n = (count: number) => Math.max(1, Math.round(count * dens));
  const r = (i: number, k: number) => rand(e.salt * 131 + i, k);
  const pick = <T>(list: readonly T[], i: number): T => list[i % list.length] as T;
  const fx = ELEMENT_FX[e.element ?? 'light'] ?? ELEMENT_FX['light']!;
  const h = e.height;
  const s = e.strength ?? 1;
  const sz = look.size;
  const glow = look.style === 'glow';
  const bold = look.style === 'bold';
  const add = (p: Particle) => out.push(p);
  const burst = (
    count: number,
    shape: Shape,
    colors: readonly string[],
    motion: Motion,
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
      add({
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
        size: size * (0.7 + 0.6 * r(i, 6)) * sz,
        seed: r(i, 9),
      });
      // Glow style: every coloured bit has a soft halo and the burst has a few hot cores.
      if (glow && i % 2 === 0) {
        add({
          shape: 'halo',
          color: pick(colors, i + 1),
          born: e.now + delay + r(i, 3) * 40,
          life: life * 0.8,
          motion,
          origin,
          vx: Math.cos(a) * v,
          vy: up * (0.5 + r(i, 5)),
          vz: Math.sin(a) * v * 0.7,
          gravity,
          size: size * 1.9 * sz,
          seed: r(i, 9),
        });
      }
    }
  };

  switch (e.cue) {
    case 'charge': {
      // Wind-up: the element gathers around the attacker.
      if (!look.chargeAura) break;
      // Bits of the element rise from a ring around the attacker's feet.
      const count = n(14);
      for (let i = 0; i < count; i++) {
        const a = TAU * ((i + r(i, 1) * 0.5) / count);
        const rr = h * (0.55 + 0.25 * r(i, 2));
        add({
          shape: glow && i % 2 === 0 ? 'halo' : fx.shape,
          color: pick(fx.colors, i),
          born: e.now + r(i, 3) * 160,
          life: 520 * (0.8 + 0.4 * r(i, 4)),
          motion: 'rise',
          origin: { x: e.at.x + Math.cos(a) * rr, y: e.at.y - h * 0.45, z: e.at.z + Math.sin(a) * rr * 0.8 - 0.3 },
          vx: 0,
          vy: 1.6 + r(i, 5),
          vz: 0,
          gravity: 0,
          size: 0.15 * h * (0.8 + 0.5 * r(i, 6)) * sz,
          seed: r(i, 9),
        });
      }
      if (glow) burst(n(5), 'star', [fx.core, '#ffffff'], 'rise', 0.6, 1.8, 0, 0.1 * h, 520, { x: e.at.x, y: e.at.y - h * 0.3, z: e.at.z - h * 0.5 });
      break;
    }
    case 'trail': {
      if (!look.trail) break;
      const count = n(12);
      const duration = e.duration ?? 190;
      for (let i = 0; i < count; i++) {
        // Spread evenly along the dash (its travel eases in), not evenly in time.
        const born = e.now + duration * ((i + 0.5) / count) ** (1 / 1.6);
        const where = e.path ? e.path(born) : e.at;
        add({
          shape: glow ? 'halo' : bold ? 'shard' : fx.shape,
          color: pick(fx.colors, i),
          born,
          life: 380 * (0.8 + 0.4 * r(i, 4)),
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
          size: 0.16 * h * (0.8 + 0.4 * r(i, 7)) * sz,
          seed: r(i, 9),
          angle: Math.PI,
          length: 0.9 * h,
        });
      }
      break;
    }
    case 'impact': {
      const at = e.at;
      // The flash (a white pop) ...
      if (look.flash > 0 && !e.reduced) {
        add({
          shape: 'puff',
          color: glow ? '#ffffff' : '#fffbe8',
          born: e.now,
          life: 110,
          motion: 'pop',
          origin: at,
          vx: 0,
          vy: 0,
          vz: 0,
          gravity: 0,
          size: 0.55 * h * Math.min(1.5, s) * look.flash,
          seed: 0,
        });
      }
      // ... the element's own burst ...
      const count = n(14 * Math.min(1.6, s));
      const speed = fx.motion === 'zap' ? 5 : fx.motion === 'swirl' ? 1.6 : bold ? 4.4 : 3.4;
      const up = fx.motion === 'rise' ? 2.4 : fx.motion === 'ballistic' ? 4.2 : 1.6;
      const gravity = fx.motion === 'ballistic' ? 9 : fx.motion === 'flutter' ? 1.2 : 0;
      burst(count, bold && fx.shape === 'puff' ? 'shard' : fx.shape, fx.colors, fx.motion, speed * s, up, gravity, 0.27 * h, 720);
      // Bias the burst towards the camera, so it isn't lost inside the squishy.
      for (const p of out) if (p.born >= e.now && p.motion === fx.motion) p.vz -= 1.6;
      if (glow) burst(n(6), 'star', [fx.core, '#ffffff', fx.core], 'rise', 2.0, 2.4, 0, 0.14 * h, 600);
      // ... cartoon stars ...
      burst(n(bold ? 7 : 5), 'star', STARS, 'ballistic', 3.4 * s, 3.2, 6, (bold ? 0.3 : 0.24) * h, 650);
      // ... a ground ring ...
      if (look.impactRing) {
        add({
          shape: 'ring',
          color: glow ? fx.core : pick(fx.colors, 1),
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
      }
      // ... speed lines around the hit (bold), and sky rays behind it.
      if (look.speedLines > 0 && !e.reduced) {
        for (let i = 0; i < look.speedLines; i++) {
          const a = (i / look.speedLines) * TAU + r(i, 11) * 0.3;
          add({
            shape: 'line',
            color: i % 3 === 0 ? '#ffffff' : pick(fx.colors, i),
            born: e.now + r(i, 12) * 30,
            life: 260 + r(i, 13) * 120,
            motion: 'speedline',
            origin: at,
            vx: 0,
            vy: 0,
            vz: 0,
            gravity: 0,
            size: 0.07 * h,
            seed: r(i, 9),
            angle: a,
            length: h * (0.8 + 0.7 * r(i, 14)),
          });
        }
      }
      if (look.burstRays && !e.reduced) {
        for (let i = 0; i < 14; i++) {
          add({
            shape: 'line',
            color: i % 2 === 0 ? '#fff6d8' : pick(fx.colors, 2),
            born: e.now,
            life: 320,
            motion: 'ray',
            // Behind the fight (the pool pushes rays back along the view).
            origin: at,
            vx: 0,
            vy: 0,
            vz: 0,
            gravity: 0,
            size: 0.2 * h,
            seed: r(i, 9),
            angle: (i / 14) * TAU + 0.1,
            length: 3.2 * h,
          });
        }
      }
      break;
    }
    case 'dizzy': {
      const over = { x: e.at.x, y: e.at.y + h * 0.62, z: e.at.z };
      for (let i = 0; i < 4; i++) {
        add({
          shape: 'star',
          color: pick(DIZZY, i),
          born: e.now,
          life: e.duration ?? 1400,
          motion: 'orbit',
          origin: over,
          target: over,
          vx: 0.4 * h,
          vy: 0,
          vz: i / 4,
          gravity: 0,
          size: 0.15 * h * sz,
          seed: r(i, 9),
        });
      }
      break;
    }
    case 'charm': {
      const from = e.to ?? e.at;
      add({
        shape: 'heart',
        color: '#ff7fae',
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
      burst(n(10), glow ? 'halo' : 'star', ['#ffd6f0', '#ffffff', '#ff9fc6'], 'swirl', 1.2, 1.4, 0, 0.14 * h, 900, { x: e.at.x, y: 0.2, z: e.at.z }, 560);
      break;
    }
    case 'charmPop':
      burst(n(12), 'heart', HEARTS, 'ballistic', 2.4, 4.6, 6, 0.18 * h, 1100);
      burst(n(8), 'star', STARS, 'ballistic', 2.6, 5, 6, 0.14 * h, 1000);
      break;
    case 'ko': {
      // A soft puff of dust where it flopped, and dizzy stars.
      burst(n(8), 'puff', ['#f4ead9', '#fffaf0', '#e9dcc6'], 'ballistic', 1.9, 0.9, 3, 0.2 * h, 550, { x: e.at.x, y: 0.1, z: e.at.z });
      break;
    }
    case 'victory':
      burst(n(10), 'heart', HEARTS, 'ballistic', 2.0, 4.5, 6, 0.15 * h, 1100);
      burst(n(10), 'star', STARS, 'ballistic', 2.6, 5, 6, 0.13 * h, 1000);
      break;
  }
  return out;
}

export interface State {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tumble: number;
  /** Rotation about the view axis for lines (speed lines, rays). */
  billboard: boolean;
  roll: number;
}

/** Where particle `p` is at `now`; false when not alive. */
export function particleAt(p: Particle, now: number, out: State): boolean {
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
      // Position along the radial, in the camera plane: the pool resolves `angle` into right/up.
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
    case 'hover':
      y += Math.sin(t * 3 + p.seed * TAU) * 0.1;
      scale = p.size * (0.7 + 0.3 * Math.sin(t * 6 + p.seed * TAU));
      break;
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

interface Pool {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  live: (Particle | null)[];
  count: number;
}

export interface FxStats {
  live: number;
  meshes: number;
}

function buildShape(scene: Scene, shape: Shape): Mesh {
  const bake = (m: Mesh, sx: number, sy: number, sz: number, y = 0): Mesh => {
    m.scaling.set(sx, sy, sz);
    m.position.y = y;
    m.bakeCurrentTransformIntoVertices();
    return m;
  };
  switch (shape) {
    case 'puff':
      return CreateSphere('fx-puff', { diameter: 1, segments: 7 }, scene);
    case 'halo':
      return CreateSphere('fx-halo', { diameter: 1, segments: 6 }, scene);
    case 'shard':
      return bake(CreatePolyhedron('fx-shard', { type: 1, size: 0.5 }, scene), 0.7, 1.5, 0.7);
    case 'leaf':
      return bake(CreateSphere('fx-leaf', { diameter: 1, segments: 6 }, scene), 1, 0.18, 0.55);
    case 'drop':
      return mergeOrThrow('fx-drop', [
        CreateSphere('fx-drop-a', { diameter: 0.8, segments: 7 }, scene),
        (() => {
          const tip = CreateCylinder('fx-drop-b', { height: 0.7, diameterTop: 0, diameterBottom: 0.78, tessellation: 10 }, scene);
          tip.position.y = 0.45;
          return tip;
        })(),
      ]);
    case 'star': {
      const a = bake(CreatePolyhedron('fx-star-a', { type: 1, size: 0.5 }, scene), 1.3, 0.38, 0.3);
      const b = bake(CreatePolyhedron('fx-star-b', { type: 1, size: 0.5 }, scene), 0.38, 1.3, 0.3);
      return mergeOrThrow('fx-star', [a, b]);
    }
    case 'heart': {
      const left = CreateSphere('fx-heart-l', { diameter: 0.56, segments: 10 }, scene);
      left.position.set(-0.17, 0.12, 0);
      const right = CreateSphere('fx-heart-r', { diameter: 0.56, segments: 10 }, scene);
      right.position.set(0.17, 0.12, 0);
      const tip = CreateCylinder('fx-heart-tip', { height: 0.6, diameterTop: 0.86, diameterBottom: 0, tessellation: 16 }, scene);
      tip.position.y = -0.2;
      tip.scaling.z = 0.62;
      return mergeOrThrow('fx-heart', [left, right, tip]);
    }
    case 'ring':
      return CreateTorus('fx-ring', { diameter: 1, thickness: 0.12, tessellation: 28 }, scene);
    case 'line': {
      // A tapered streak of unit length along +x, from the origin outwards.
      const m = CreatePolyhedron('fx-line', { type: 1, size: 0.5 }, scene);
      m.rotation.z = Math.PI / 2;
      m.scaling.set(1, 1, 1);
      m.bakeCurrentTransformIntoVertices();
      m.position.x = 0.5;
      m.bakeCurrentTransformIntoVertices();
      return m;
    }
  }
}

function mergeOrThrow(name: string, parts: Mesh[]): Mesh {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  if (!mesh) throw new Error(`could not build ${name}`);
  mesh.name = name;
  return mesh;
}

export class FxPool {
  readonly #pools = new Map<Shape, Pool>();
  readonly #material: StandardMaterial;
  readonly #colors = new Map<string, readonly [number, number, number]>();
  readonly #state: State = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, yaw: 0, tumble: 0, billboard: false, roll: 0 };
  #camRight = { x: 1, y: 0, z: 0 };
  #camUp = { x: 0, y: 1, z: 0 };
  #camFwd = { x: 0, y: 0, z: 1 };

  constructor(scene: Scene, glow: boolean) {
    const m = new StandardMaterial('fx-mat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    // Glow style: pushed past white so the bloom pass picks the cores up.
    m.emissiveColor = glow ? new Color3(1.35, 1.35, 1.35) : Color3.White();
    m.specularColor = Color3.Black();
    m.fogEnabled = false;
    this.#material = m;
    for (const shape of SHAPES) {
      const mesh = buildShape(scene, shape);
      mesh.material = m;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      const cap = POOL[shape];
      const pool: Pool = {
        mesh,
        matrices: new Float32Array(cap * 16),
        colors: new Float32Array(cap * 4).fill(1),
        live: new Array<Particle | null>(cap).fill(null),
        count: 0,
      };
      hidden(pool.matrices, 0);
      mesh.thinInstanceSetBuffer('matrix', pool.matrices, 16, false);
      mesh.thinInstanceSetBuffer('color', pool.colors, 4, false);
      mesh.thinInstanceCount = 1;
      mesh.setEnabled(false);
      this.#pools.set(shape, pool);
    }
  }

  /** The camera's basis, for billboarded lines. */
  setCamera(right: Vector3, up: Vector3, forward: Vector3): void {
    this.#camRight = { x: right.x, y: right.y, z: right.z };
    this.#camUp = { x: up.x, y: up.y, z: up.z };
    this.#camFwd = { x: forward.x, y: forward.y, z: forward.z };
  }

  spawn(particles: readonly Particle[]): void {
    for (const p of particles) {
      const pool = this.#pools.get(p.shape);
      if (!pool) continue;
      if (pool.count === pool.live.length) {
        pool.live.copyWithin(0, 1);
        pool.count -= 1;
      }
      pool.live[pool.count] = p;
      pool.count += 1;
    }
  }

  clear(): void {
    for (const pool of this.#pools.values()) {
      pool.live.fill(null);
      pool.count = 0;
      pool.mesh.setEnabled(false);
    }
  }

  /** Writes every live particle at `now`; true while any is alive. */
  update(now: number): boolean {
    let alive = false;
    const s = this.#state;
    for (const pool of this.#pools.values()) {
      let keep = 0;
      let drawn = 0;
      for (let i = 0; i < pool.count; i++) {
        const p = pool.live[i];
        if (!p || now >= p.born + p.life) continue;
        pool.live[keep++] = p;
        if (!particleAt(p, now, s)) continue;
        this.#write(pool.matrices, drawn, s, p);
        const c = this.#color(p.color);
        pool.colors[drawn * 4] = c[0];
        pool.colors[drawn * 4 + 1] = c[1];
        pool.colors[drawn * 4 + 2] = c[2];
        drawn++;
      }
      for (let i = keep; i < pool.count; i++) pool.live[i] = null;
      pool.count = keep;
      if (keep > 0) alive = true;
      const on = drawn > 0;
      if (on) {
        pool.mesh.thinInstanceCount = drawn;
        pool.mesh.thinInstanceBufferUpdated('matrix');
        pool.mesh.thinInstanceBufferUpdated('color');
      }
      if (pool.mesh.isEnabled() !== on) pool.mesh.setEnabled(on);
    }
    return alive;
  }

  get stats(): FxStats {
    let live = 0;
    let meshes = 0;
    for (const pool of this.#pools.values()) {
      live += pool.count;
      if (pool.mesh.isEnabled()) meshes++;
    }
    return { live, meshes };
  }

  dispose(): void {
    for (const pool of this.#pools.values()) pool.mesh.dispose();
    this.#pools.clear();
    this.#material.dispose();
  }

  #color(hex: string): readonly [number, number, number] {
    let c = this.#colors.get(hex);
    if (!c) {
      const linear = Color3.FromHexString(hex).toLinearSpace();
      c = [linear.r, linear.g, linear.b];
      this.#colors.set(hex, c);
    }
    return c;
  }

  #write(out: Float32Array, i: number, s: State, p: Particle): void {
    const o = i * 16;
    if (s.billboard) {
      // Axes: x along the radial in the camera plane (right·cos + up·sin), y across it, z towards the camera.
      const R = this.#camRight;
      const U = this.#camUp;
      const F = this.#camFwd;
      const c = Math.cos(s.roll);
      const sn = Math.sin(s.roll);
      const ax = { x: R.x * c + U.x * sn, y: R.y * c + U.y * sn, z: R.z * c + U.z * sn };
      const ay = { x: -R.x * sn + U.x * c, y: -R.y * sn + U.y * c, z: -R.z * sn + U.z * c };
      out[o] = ax.x * s.sx;
      out[o + 1] = ax.y * s.sx;
      out[o + 2] = ax.z * s.sx;
      out[o + 3] = 0;
      out[o + 4] = ay.x * s.sy;
      out[o + 5] = ay.y * s.sy;
      out[o + 6] = ay.z * s.sy;
      out[o + 7] = 0;
      out[o + 8] = F.x * s.sz;
      out[o + 9] = F.y * s.sz;
      out[o + 10] = F.z * s.sz;
      out[o + 11] = 0;
      // The origin plus the radial distance along the line's own axis; rays sit well behind the fight.
      const back = p.motion === 'ray' ? 7 : 0;
      out[o + 12] = p.origin.x + ax.x * s.x + F.x * back;
      out[o + 13] = p.origin.y + ax.y * s.x + F.y * back;
      out[o + 14] = p.origin.z + ax.z * s.x + F.z * back;
      out[o + 15] = 1;
      return;
    }
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    const cx = Math.cos(s.tumble);
    const sx = Math.sin(s.tumble);
    out[o] = cy * s.sx;
    out[o + 1] = 0;
    out[o + 2] = -sy * s.sx;
    out[o + 3] = 0;
    out[o + 4] = sx * sy * s.sy;
    out[o + 5] = cx * s.sy;
    out[o + 6] = sx * cy * s.sy;
    out[o + 7] = 0;
    out[o + 8] = cx * sy * s.sz;
    out[o + 9] = -sx * s.sz;
    out[o + 10] = cx * cy * s.sz;
    out[o + 11] = 0;
    out[o + 12] = s.x;
    out[o + 13] = s.y;
    out[o + 14] = s.z;
    out[o + 15] = 1;
  }
}

function hidden(out: Float32Array, i: number): void {
  out.fill(0, i * 16, i * 16 + 16);
  out[i * 16 + 15] = 1;
}
