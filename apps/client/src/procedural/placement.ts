import type { Body } from '@heartpatch/shared';
import { cross, dot, normalize, surfaceNormal, surfacePoint } from './body-shape.js';
import type { PartParams, PartPlacement, Vec3 } from './params.js';

/**
 * Where each part sits on its squishy, as a 4×4 matrix in Babylon's layout
 * (row vectors: rows are the scaled x, y and z axes, then the translation),
 * relative to the squishy's ground point. Pure maths, no Babylon.
 */

export type Mat4 = readonly number[];

const FRONT: Vec3 = [0, 0, -1];

/** Legs lean out at most this far (radians) and sink at most this share into the body. */
const MAX_LEG_SPLAY = (60 * Math.PI) / 180;
const MAX_LEG_SINK = 0.8;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** Removes the part of `v` along unit `n`. */
function flatten(v: Vec3, n: Vec3): Vec3 {
  return add(v, scaled(n, -dot(v, n)));
}

/**
 * The surface frame at a placement: the point, its outward normal, the
 * direction towards the body's top along the surface, and the sideways
 * direction (towards +x on the face).
 */
export function surfaceFrame(
  body: Body,
  bodyScale: Vec3,
  around: number,
  up: number,
): { point: Vec3; normal: Vec3; towardsTop: Vec3; side: Vec3 } {
  const p = surfacePoint(body, around, up);
  const n0 = surfaceNormal(body, around, up);
  const point: Vec3 = [p[0] * bodyScale[0], p[1] * bodyScale[1], p[2] * bodyScale[2]];
  // Normals scale by the inverse of a non-uniform scale.
  const normal = normalize([n0[0] / bodyScale[0], n0[1] / bodyScale[1], n0[2] / bodyScale[2]]);
  let towardsTop = flatten([0, 1, 0], normal);
  // At the very top "towards the top" is undefined: lean towards the back.
  if (len(towardsTop) < 1e-3) towardsTop = flatten([0, 0, 1], normal);
  towardsTop = normalize(towardsTop);
  const side = normalize(cross(normal, towardsTop));
  return { point, normal, towardsTop, side };
}

/** Rotates unit `a` towards unit `b` (perpendicular to it) by `angle`. */
function lean(a: Vec3, b: Vec3, angle: number): Vec3 {
  return normalize(add(scaled(a, Math.cos(angle)), scaled(b, Math.sin(angle))));
}

/** Turns unit `v` about the vertical axis by `angle` (a serpent's side-to-side swing). */
function yawed(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** Bends unit `v` towards straight up (positive) or down by `angle`. */
function pitched(v: Vec3, angle: number): Vec3 {
  let towards = flatten([0, angle >= 0 ? 1 : -1, 0], v);
  if (len(towards) < 1e-6) return v;
  towards = normalize(towards);
  return lean(v, towards, Math.abs(angle));
}

/**
 * The matrix that takes a unit-box part primitive to its place on the body.
 * `offset` moves the host (a torso standing on legs, or a head on the torso)
 * from the squishy's ground point.
 */
export function partMatrix(
  body: Body,
  bodyScale: Vec3,
  part: Pick<PartParams, 'surface' | 'sink' | 'lift' | 'flip'> & { readonly slot?: string },
  placement: PartPlacement,
  offset: Vec3 = [0, 0, 0],
): Mat4 {
  const local = surfaceFrame(body, bodyScale, placement.around, placement.up);
  const f = { ...local, point: add(local.point, offset) };
  const outwards = scaled(f.side, placement.side);
  const [width, length, thickness] = placement.size;
  let x: Vec3;
  let y: Vec3;
  let z: Vec3;
  let centre: Vec3;
  let span = length;
  if (part.slot === 'legs') {
    // Legs grow straight down to the ground from wherever they join, leaning
    // out by `splay`, so a torso's stance sets their length.
    // Splay and sink are capped so a leg always has a finite length.
    const splay = Math.min(Math.abs(placement.splay), MAX_LEG_SPLAY) * Math.sign(placement.splay);
    y = normalize(add([0, -1, 0], scaled(outwards, Math.tan(splay))));
    span = f.point[1] / -y[1] / (1 - Math.min(part.sink, MAX_LEG_SINK));
    let front = flatten(FRONT, y);
    if (len(front) < 1e-3) front = [0, 0, -1];
    z = normalize(front);
    x = cross(y, z);
    centre = add(f.point, scaled(y, span / 2 - part.sink * span));
  } else if (placement.chain) {
    // A chain: piece `index` follows the ones before it, bending and swinging.
    const { index, step, curl, wave, shrink } = placement.chain;
    const start = normalize(lean(f.normal, f.towardsTop, placement.tilt));
    let pieceLen = length; // walk back to the first piece's length
    for (let k = 0; k < index; k++) pieceLen /= shrink;
    let dir = start;
    let c = add(f.point, scaled(dir, pieceLen * (0.5 - part.sink)));
    const swing = [0, 1, 0, -1];
    for (let k = 1; k <= index; k++) {
      const next = pieceLen * shrink;
      dir = pitched(yawed(start, wave * (swing[k % 4] ?? 0)), curl * k);
      c = add(c, scaled(dir, (step * (pieceLen + next)) / 2));
      pieceLen = next;
    }
    y = dir;
    let front = flatten(FRONT, y);
    if (len(front) < 1e-3) front = flatten(scaled(f.towardsTop, -1), y);
    z = normalize(front);
    x = cross(y, z);
    centre = c;
  } else if (part.surface) {
    // Lies on the surface facing out; `splay` turns its top outwards.
    z = f.normal;
    y = lean(f.towardsTop, outwards, placement.splay);
    if (placement.side === 0) y = f.towardsTop;
    x = cross(y, z);
    const out = (thickness / 2) * (1 - part.sink) + part.lift;
    centre = add(f.point, scaled(f.normal, out));
  } else {
    // Grows out along the normal, leaning towards the top and outwards.
    let dir = lean(f.normal, f.towardsTop, placement.tilt);
    if (placement.side !== 0) dir = lean(dir, normalize(flatten(outwards, dir)), placement.splay);
    y = dir;
    // Flat faces (ears, wings) face the front where they can.
    let front = flatten(FRONT, y);
    if (len(front) < 1e-3) front = flatten(scaled(f.towardsTop, -1), y);
    z = normalize(front);
    x = cross(y, z);
    const out = (length / 2) * (1 - part.sink) + part.lift;
    centre = add(f.point, scaled(y, out));
  }
  if (part.flip) {
    // Half a turn about z: upside down, still a rotation.
    x = scaled(x, -1);
    y = scaled(y, -1);
  }
  return [...scaled(x, width), 0, ...scaled(y, span), 0, ...scaled(z, thickness), 0, ...centre, 1];
}
