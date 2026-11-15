import type { PartShape } from '@heartpatch/shared';
import { cross, dot, normalize, type MeshArrays } from './body-shape.js';
import type { LodSettings } from './config.js';
import type { Vec3 } from './params.js';

/**
 * Part primitives, each filling the unit box [−0.5, 0.5]³ so a part's size
 * is just its scale. Surface parts lie in the xy plane facing +z; sticking-out
 * parts grow along +y. One builder per `PartShape`: a new shape in the shared
 * schema fails to typecheck here until it has one.
 */

/** A lathe profile: radius and height at `t` from the bottom (0) to the top (1). */
type Profile = (t: number) => readonly [r: number, y: number];

function spow(x: number, e: number): number {
  return x < 0 ? -Math.pow(-x, e) : Math.pow(x, e);
}

/** Rounded at the bottom, narrowing to a soft point at the top. */
function pointed(k: number): Profile {
  return (t) => [
    0.5 * spow(Math.sin(Math.PI * t), 0.5) * Math.pow(1 - t, k),
    -0.5 * Math.cos(Math.PI * t),
  ];
}

const PROFILES: Readonly<Record<Exclude<PartShape, 'arc' | 'box' | 'bent'>, Profile>> = {
  ellipsoid: (t) => [0.5 * Math.sin(Math.PI * t), -0.5 * Math.cos(Math.PI * t)],
  // A soft rounded cylinder: a squarish superellipse revolved.
  capsule: (t) => [
    0.5 * spow(Math.sin(Math.PI * t), 0.35),
    -0.5 * spow(Math.cos(Math.PI * t), 0.6),
  ],
  cone: pointed(1.2),
  teardrop: pointed(0.6),
};

/** Revolves a profile around y, with analytic normals from its slope. */
function lathe(profile: Profile, rings: number, segments: number): MeshArrays {
  const positions: number[] = [];
  const normals: number[] = [];
  const eps = 1e-4;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const [r, y] = profile(t);
    let nr: number;
    let ny: number;
    if (i === 0 || i === rings) {
      nr = 0;
      ny = i === 0 ? -1 : 1;
    } else {
      const [r0, y0] = profile(t - eps);
      const [r1, y1] = profile(t + eps);
      const len = Math.hypot(y1 - y0, r1 - r0);
      nr = (y1 - y0) / len;
      ny = -(r1 - r0) / len;
    }
    for (let s = 0; s <= segments; s++) {
      const phi = (2 * Math.PI * s) / segments;
      const sin = Math.sin(phi);
      const cos = Math.cos(phi);
      positions.push(r * sin, y, -r * cos);
      normals.push(nr * sin, ny, -nr * cos);
    }
  }
  return { positions, normals, indices: gridIndices(rings, segments) };
}

/**
 * A curved tube with round ends, its middle at the bottom so it opens
 * upwards like a smile. Analytic normals.
 */
function arc(rings: number, segments: number): MeshArrays {
  const sweep = (120 * Math.PI) / 180; // TUNE: how curved smiles and closed eyes are
  const radius = 1;
  const tube = 0.32;
  const bend = 0.3; // TUNE
  const capRings = Math.max(2, Math.round(rings / 3));
  const bodyRings = rings * 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const total = capRings * 2 + bodyRings;
  for (let i = 0; i <= total; i++) {
    let theta: number;
    let beta: number; // 0 on the tube, ±π/2 at the tips of the round ends
    if (i < capRings) {
      theta = -sweep / 2;
      beta = -(Math.PI / 2) * (1 - i / capRings);
    } else if (i > capRings + bodyRings) {
      theta = sweep / 2;
      beta = (Math.PI / 2) * ((i - capRings - bodyRings) / capRings);
    } else {
      theta = -sweep / 2 + (sweep * (i - capRings)) / bodyRings;
      beta = 0;
    }
    // The ends bend back (−z) so a flat arc hugs a round body instead of
    // its tips standing off it.
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const centre: Vec3 = [radius * sin, radius * (1 - cos), -bend * sin * sin];
    const tangent = normalize([radius * cos, radius * sin, -2 * bend * sin * cos]);
    const across = normalize(cross([0, 0, 1], tangent)); // in the arc's plane
    const outOfPlane = normalize(cross(tangent, across));
    for (let s = 0; s <= segments; s++) {
      const phi = (2 * Math.PI * s) / segments;
      const ring: Vec3 = [
        Math.cos(phi) * across[0] + Math.sin(phi) * outOfPlane[0],
        Math.cos(phi) * across[1] + Math.sin(phi) * outOfPlane[1],
        Math.cos(phi) * across[2] + Math.sin(phi) * outOfPlane[2],
      ];
      const n: Vec3 = normalize([
        Math.sin(beta) * tangent[0] + Math.cos(beta) * ring[0],
        Math.sin(beta) * tangent[1] + Math.cos(beta) * ring[1],
        Math.sin(beta) * tangent[2] + Math.cos(beta) * ring[2],
      ]);
      positions.push(centre[0] + tube * n[0], centre[1] + tube * n[1], centre[2] + tube * n[2]);
      normals.push(...n);
    }
  }
  return { positions, normals, indices: gridIndices(total, segments) };
}

/** How square a `box` is: towards 0 is sharp, 1 is an ellipsoid. TUNE */
const BOX_ROUNDNESS = 0.22;

/**
 * A softly rounded block (a superellipsoid), its flat sides facing ±x, ±y
 * and ±z, so a shallow size is a straight plank instead of a bulging bean.
 * Analytic normals from the superellipsoid's dual.
 */
function box(rings: number, segments: number): MeshArrays {
  const e = BOX_ROUNDNESS;
  const c = (w: number, m: number) => spow(Math.cos(w), m);
  const s = (w: number, m: number) => spow(Math.sin(w), m);
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const v = -Math.PI / 2 + (Math.PI * i) / rings;
    for (let k = 0; k <= segments; k++) {
      const u = (2 * Math.PI * k) / segments;
      positions.push(c(v, e) * s(u, e), s(v, e), -c(v, e) * c(u, e));
      normals.push(
        ...normalize([c(v, 2 - e) * s(u, 2 - e), s(v, 2 - e), -c(v, 2 - e) * c(u, 2 - e)]),
      );
    }
  }
  return { positions, normals, indices: gridIndices(rings, segments) };
}

// TUNE: the bent dowel's centreline, in lengths of the whole stick.
// Round 11b (#234, v13): a leaf-rake tine. Long and straight, then a gentle,
// wide 35° forward arc at the tip with no return curl, tapering to half its
// root thickness at the tip.
const BENT_STRAIGHT = 0.62; // straight from the root
const BENT_RADIUS = 0.5; // the tip's curve
const BENT_ANGLE = (35 * Math.PI) / 180; // how far the tip turns forward
const BENT_TIP = 0.06; // straight again after the bend
const BENT_TUBE = 0.08; // the dowel's radius at the root
const BENT_TAPER = 0.5; // the tip's radius, as a fraction of the root's

/** The `bent` dowel's centreline end point `[y, z]` and its whole length. */
function bentEnd(): { y: number; z: number; total: number } {
  const arcLen = BENT_RADIUS * BENT_ANGLE;
  const y = BENT_STRAIGHT + BENT_RADIUS * Math.sin(BENT_ANGLE) + Math.cos(BENT_ANGLE) * BENT_TIP;
  const z = BENT_RADIUS * (1 - Math.cos(BENT_ANGLE)) + Math.sin(BENT_ANGLE) * BENT_TIP;
  return { y, z, total: BENT_STRAIGHT + arcLen + BENT_TIP };
}

/**
 * The `bent` dowel's own `[width, length, thickness]` before it is fitted
 * to the unit box. A part sized in these proportions keeps the dowel round
 * and the tip a circular arc, whatever its overall scale. The bend never
 * passes 90°, so the centreline's far end is its highest and most forward
 * point; the root's round end adds its radius below, the tip's above.
 */
export function bentProportions(): Vec3 {
  const { y, z } = bentEnd();
  const tip = BENT_TUBE * BENT_TAPER;
  return [2 * BENT_TUBE, y + BENT_TUBE + tip, z + BENT_TUBE + tip];
}

/**
 * A round-ended dowel growing along +y that bends towards +z (the front)
 * near its tip and narrows towards it: a leaf-rake tine. The bend stays in
 * the yz plane, so x is the same sideways direction all along. Analytic
 * normals (the taper's slight slope is ignored, as on `fang`).
 */
function bent(rings: number, segments: number): MeshArrays {
  const arcLen = BENT_RADIUS * BENT_ANGLE;
  const { total } = bentEnd();
  // The centreline point and unit tangent at distance `s` along it.
  const along = (s: number): { c: Vec3; t: Vec3 } => {
    if (s <= BENT_STRAIGHT) return { c: [0, s, 0], t: [0, 1, 0] };
    const a = Math.min(s - BENT_STRAIGHT, arcLen) / BENT_RADIUS;
    const c: Vec3 = [0, BENT_STRAIGHT + BENT_RADIUS * Math.sin(a), BENT_RADIUS * (1 - Math.cos(a))];
    const t: Vec3 = [0, Math.cos(a), Math.sin(a)];
    const rest = s - BENT_STRAIGHT - arcLen;
    return rest > 0 ? { c: [0, c[1] + t[1] * rest, c[2] + t[2] * rest], t } : { c, t };
  };
  const radius = (s: number): number => BENT_TUBE * (1 - (1 - BENT_TAPER) * (s / total));
  const capRings = Math.max(2, Math.round(rings / 3));
  const bodyRings = rings * 2;
  const count = capRings * 2 + bodyRings;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= count; i++) {
    let s: number;
    let beta: number; // 0 on the dowel, ±π/2 at the tips of the round ends
    if (i < capRings) {
      s = 0;
      beta = -(Math.PI / 2) * (1 - i / capRings);
    } else if (i > capRings + bodyRings) {
      s = total;
      beta = (Math.PI / 2) * ((i - capRings - bodyRings) / capRings);
    } else {
      s = (total * (i - capRings)) / bodyRings;
      beta = 0;
    }
    const { c, t } = along(s);
    const r = radius(s);
    // Perpendicular to the dowel in the yz plane: [0, -t.z, t.y].
    const across: Vec3 = [0, -t[2], t[1]];
    for (let k = 0; k <= segments; k++) {
      const phi = (2 * Math.PI * k) / segments;
      const ring: Vec3 = [Math.sin(phi), -Math.cos(phi) * across[1], -Math.cos(phi) * across[2]];
      const n = normalize([
        Math.sin(beta) * t[0] + Math.cos(beta) * ring[0],
        Math.sin(beta) * t[1] + Math.cos(beta) * ring[1],
        Math.sin(beta) * t[2] + Math.cos(beta) * ring[2],
      ]);
      positions.push(c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]);
      normals.push(...n);
    }
  }
  return { positions, normals, indices: gridIndices(count, segments) };
}

function gridIndices(rings: number, segments: number): number[] {
  const indices: number[] = [];
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  return indices;
}

/** Scales and centres positions into [−0.5, 0.5]³, correcting normals for the stretch. */
function fitUnitBox(mesh: MeshArrays): MeshArrays {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i + k] ?? 0;
      min[k] = Math.min(min[k] ?? v, v);
      max[k] = Math.max(max[k] ?? v, v);
    }
  }
  const scale = [0, 1, 2].map((k) => 1 / ((max[k] ?? 1) - (min[k] ?? 0)));
  const mid = [0, 1, 2].map((k) => ((max[k] ?? 0) + (min[k] ?? 0)) / 2);
  const positions = mesh.positions.map((v, i) => (v - (mid[i % 3] ?? 0)) * (scale[i % 3] ?? 1));
  const normals: number[] = [];
  for (let i = 0; i < mesh.normals.length; i += 3) {
    // Normals transform by the inverse scale.
    normals.push(
      ...normalize([
        (mesh.normals[i] ?? 0) / (scale[0] ?? 1),
        (mesh.normals[i + 1] ?? 0) / (scale[1] ?? 1),
        (mesh.normals[i + 2] ?? 0) / (scale[2] ?? 1),
      ]),
    );
  }
  return { positions, normals, indices: mesh.indices };
}

function vertex(values: readonly number[], i: number): Vec3 {
  return [values[i * 3] ?? 0, values[i * 3 + 1] ?? 0, values[i * 3 + 2] ?? 0];
}

/**
 * Drops zero-area triangles (at poles and round ends) and winds every other
 * one so Babylon sees it front-facing from outside: Babylon's face normal is
 * (p1 − p2) × (p3 − p2), which must agree with the vertex normals.
 */
export function orientTriangles(mesh: MeshArrays): MeshArrays {
  const indices: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] ?? 0;
    const b = mesh.indices[t + 1] ?? 0;
    const c = mesh.indices[t + 2] ?? 0;
    const pa = vertex(mesh.positions, a);
    const pb = vertex(mesh.positions, b);
    const pc = vertex(mesh.positions, c);
    const face = cross(
      [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]],
      [pc[0] - pb[0], pc[1] - pb[1], pc[2] - pb[2]],
    );
    if (Math.hypot(face[0], face[1], face[2]) < 1e-12) continue;
    const na = vertex(mesh.normals, a);
    const nb = vertex(mesh.normals, b);
    const nc = vertex(mesh.normals, c);
    const n: Vec3 = [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]];
    if (dot(face, n) >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  }
  return { positions: mesh.positions, normals: mesh.normals, indices };
}

/** Geometry for one part shape at one detail level. */
export function partArrays(shape: PartShape, lod: LodSettings): MeshArrays {
  const mesh =
    shape === 'arc'
      ? arc(lod.partRings, lod.partSegments)
      : shape === 'box'
        ? box(lod.partRings, lod.partSegments)
        : shape === 'bent'
          ? bent(lod.partRings, lod.partSegments)
          : lathe(PROFILES[shape], lod.partRings, lod.partSegments);
  return orientTriangles(fitUnitBox(mesh));
}
