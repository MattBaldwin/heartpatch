import type { Body } from '@heartpatch/shared';
import type { Vec3 } from './params.js';

/**
 * The parametric vinyl-toy body (design doc §19): a superellipsoid with a
 * taper, a soft peak, a flattened bottom, and optional pumpkin lobes, a
 * snowman waist, star points and a ghost's scalloped hem (ART_BIBLE §1.2). Points
 * are addressed by `around` (radians from the face, positive towards +x) and
 * `up` (−π/2 bottom to π/2 top), the same angles parts are placed with.
 *
 * The face looks along −z (towards a camera with the default heading), and
 * the bottom sits on y = 0.
 */

/** Sign-preserving power: keeps the superellipsoid symmetric. */
function spow(x: number, e: number): number {
  return x < 0 ? -Math.pow(-x, e) : Math.pow(x, e);
}

/** Stops finite differences reaching the poles, where `around` has no effect. */
const POLE_LIMIT = Math.PI / 2 - 1e-3;
const EPS = 1e-4;

export function surfacePoint(body: Body, around: number, up: number): Vec3 {
  const [x, yc, z, cu] = rawPoint(body, around, up);
  let y: number;
  if (body.points) {
    // Stretch the star back to [0, height], standing on its two lower points.
    // The lowest sliver is flattened, so the points' tips are flat feet
    // that every detail level puts exactly on the ground.
    const [low, high] = starSpan(body);
    const feet = low + STAR_FEET * (high - low);
    y = Math.max(0, ((yc - feet) / (high - feet)) * body.height);
  } else {
    y = body.height / 2 + yc;
  }
  if (body.hem) {
    // The hem lifts the bottom band between little feet. The lift fades
    // linearly to nothing at the band's top, so the band never folds, and
    // with distance from the middle, so the bottom's middle stays put.
    const band = body.height * HEM_BAND;
    if (y < band) {
      const feet = Math.pow(0.5 + 0.5 * Math.cos(body.hem.count * around), 2);
      const lift = body.hem.depth * body.height * (1 - feet) * cu * cu * cu;
      y += lift * (1 - y / band);
    }
  }
  return [x, y, z];
}

/** The share of a star's height flattened into feet. */
const STAR_FEET = 0.03;

/** The bottom share of a body a hem's scallops reach into. */
const HEM_BAND = 0.35;

/** x, y from the body's middle, z, and the ring's width factor at (around, up). */
function rawPoint(body: Body, around: number, up: number): [number, number, number, number] {
  // Squareness 0 → exponent 1 (an ellipsoid); 1 → 0.5 (a soft box).
  const e = 1 / (1 + body.squareness);
  // The bottom half squares off more, so the squishy sits flat.
  const eb = up < 0 ? e * (1 - body.bottomFlat * 0.75) : e;
  const cu = spow(Math.cos(up), eb);
  const su = spow(Math.sin(up), eb);
  const yn = su; // −1 bottom to 1 top
  // Taper narrows one end smoothly, never widening past `width` or `depth`.
  const towards = body.taper < 0 ? (1 + yn) / 2 : (1 - yn) / 2;
  let radial = 1 - Math.abs(body.taper) * towards * towards;
  if (body.peak > 0 && yn > 0) radial *= 1 - body.peak * yn * yn * Math.sqrt(yn);
  if (body.lobes) {
    const groove = 0.5 - 0.5 * Math.cos(body.lobes.count * around);
    radial *= 1 - body.lobes.depth * groove * cu;
  }
  if (body.waist) {
    const k = (yn - body.waist.at) / body.waist.width;
    radial *= 1 - body.waist.depth * Math.exp(-k * k);
  }
  let x = (body.width / 2) * cu * spow(Math.sin(around), e) * radial;
  const z = -(body.depth / 2) * cu * spow(Math.cos(around), e) * radial;
  const peakLift = body.peak > 0 && yn > 0 ? 1 + body.peak * 0.25 * yn * yn : 1;
  let yc = (body.height / 2) * yn * peakLift;
  if (body.points) {
    // A standing star: pull the outline in between points, measured in the
    // front (x, y) plane with a point straight up.
    const { count, depth } = body.points;
    const phi = Math.atan2(x / (body.width / 2), yc / (body.height / 2));
    const bump = Math.pow(0.5 + 0.5 * Math.cos(count * phi), 2);
    const k = 1 - depth * (1 - bump);
    x *= k;
    yc *= k;
  }
  return [x, yc, z, cu];
}

const spans = new WeakMap<Body, readonly [number, number]>();

/** A star's lowest and highest y (from the middle), found once per body on a fine grid. */
function starSpan(body: Body): readonly [number, number] {
  const known = spans.get(body);
  if (known) return known;
  let low = Infinity;
  let high = -Infinity;
  const steps = 256;
  for (let i = 0; i <= steps; i++) {
    const up = -Math.PI / 2 + (Math.PI * i) / steps;
    for (let j = 0; j < steps; j++) {
      const yc = rawPoint(body, (2 * Math.PI * j) / steps, up)[1];
      if (yc < low) low = yc;
      if (yc > high) high = yc;
    }
  }
  const span = [low, high] as const;
  spans.set(body, span);
  return span;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 1, 0];
}

/** Outward unit normal at a surface point, by central differences. */
export function surfaceNormal(body: Body, around: number, up: number): Vec3 {
  if (up >= POLE_LIMIT) return [0, 1, 0];
  if (up <= -POLE_LIMIT) return [0, -1, 0];
  const dUp = sub(surfacePoint(body, around, up + EPS), surfacePoint(body, around, up - EPS));
  const dAround = sub(surfacePoint(body, around + EPS, up), surfacePoint(body, around - EPS, up));
  let n = normalize(cross(dUp, dAround));
  // Point away from the body's middle, whatever the parameter orientation.
  const centre: Vec3 = [0, body.height / 2, 0];
  if (dot(n, sub(surfacePoint(body, around, up), centre)) < 0) n = [-n[0], -n[1], -n[2]];
  return n;
}

/** Positions, normals and triangle indices. */
export interface MeshArrays {
  readonly positions: number[];
  readonly normals: number[];
  readonly indices: number[];
}

/**
 * A latitude/longitude grid over the body. The seam column is duplicated
 * with identical analytic normals, so there's no visible seam. Run it
 * through `orientTriangles` before use.
 */
export function bodyArrays(body: Body, rings: number): MeshArrays {
  const segments = rings * 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const up = -Math.PI / 2 + (Math.PI * r) / rings;
    for (let s = 0; s <= segments; s++) {
      const around = (2 * Math.PI * s) / segments;
      positions.push(...surfacePoint(body, around, up));
      normals.push(...surfaceNormal(body, around, up));
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return { positions, normals, indices };
}
