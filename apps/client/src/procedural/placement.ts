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

/** The matrix that takes a unit-box part primitive to its place on the body. */
export function partMatrix(
  body: Body,
  bodyScale: Vec3,
  part: Pick<PartParams, 'surface' | 'sink' | 'lift' | 'flip'>,
  placement: PartPlacement,
): Mat4 {
  const f = surfaceFrame(body, bodyScale, placement.around, placement.up);
  const outwards = scaled(f.side, placement.side);
  const [width, length, thickness] = placement.size;
  let x: Vec3;
  let y: Vec3;
  let z: Vec3;
  let centre: Vec3;
  if (part.surface) {
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
  return [
    ...scaled(x, width),
    0,
    ...scaled(y, length),
    0,
    ...scaled(z, thickness),
    0,
    ...centre,
    1,
  ];
}
