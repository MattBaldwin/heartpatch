import type { PartShape } from '@heartpatch/shared';
import { cross, dot, normalize, type MeshArrays } from './body-shape.js';
import type { LodSettings } from './config.js';
import type { AccentMesh, Vec3 } from './params.js';

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
  const capRings = Math.max(3, Math.round(rings / 3)); // v16: 3 at low detail, so a flat end's normals stay true
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

// TUNE: the bent tine's centreline, in lengths of the whole stick.
// Round 11b (#234, v13): a leaf-rake tine, long and straight with a forward
// arc at the tip. v14: a 30° arc then a short straight foot (no J flick).
// v15: a 65° hook over the last ~30%. v16: one smooth, even curve instead:
// straight for the top 40%, then the same 65° turn spread evenly over the
// lower 60%, so head-on the tine visibly foreshortens towards the viewer
// rather than reading as a straight peg with a knob. With the shaft's ~20°
// lean the tip still points a little down (kit test: no J). The section is
// a flat steel strip, its wide side to the front, not a round dowel.
const BENT_STRAIGHT = 0.4; // straight from the root
const BENT_ANGLE = (65 * Math.PI) / 180; // how far the tip turns forward, all in one even curve
const BENT_CURVE = 0.6; // the curve's length: the lower 60% of the tine
const BENT_RADIUS = BENT_CURVE / BENT_ANGLE; // one constant radius: an even curve
const BENT_TUBE = 0.08; // the strip's half-size at the root
const BENT_WIDE = 1.8; // the strip's half-width, in BENT_TUBEs (sideways, faces the viewer)
const BENT_THIN = 0.7; // the strip's half-thickness, in BENT_TUBEs (the bend's plane)
const BENT_TAPER = 0.85; // the tip's size, as a fraction of the root's
const BENT_CHISEL = 0.35; // the shaft's end cap, squashed along the strip (hidden in the toe)
const BENT_LENGTH = BENT_STRAIGHT + BENT_CURVE;

// TUNE (#234 v16): the `bent-toe` accent, a wide flat chisel toe over the
// tine's end in a lighter steel, so head-on each tine ends in a bright toe.
const TOE_LENGTH = 0.13; // along the strip, in lengths of the whole stick
const TOE_FLARE = 1.8; // its full width, as a multiple of the shaft's width there
const TOE_THICK = 2.4; // its full thickness, as a multiple of the shaft's: head-on its flat end is a broad oval, not a sliver
const TOE_CAP = 0.4; // its flat end: the cap's reach in toe half-thicknesses

/**
 * How far the `bent` tine's tip turns (degrees), the share of its length
 * that curves (one even curve to the tip) and the share that runs straight
 * on after the turn (none since v16).
 */
export function bentTip(): { turn: number; hook: number; foot: number } {
  return { turn: (BENT_ANGLE * 180) / Math.PI, hook: BENT_CURVE / BENT_LENGTH, foot: 0 };
}

/** The `bent-toe` accent's width over the shaft's width where it starts, and its share of the tine. */
export function bentToe(): { flare: number; length: number } {
  return { flare: TOE_FLARE, length: TOE_LENGTH / BENT_LENGTH };
}

/**
 * The `bent` strip's own `[width, length, thickness]` before it is fitted
 * to the unit box: the extent of the unfitted mesh. A part sized in these
 * proportions keeps the strip's section and the curve true, whatever its
 * overall scale.
 */
export function bentProportions(): Vec3 {
  const { positions } = bent(12, 16);
  const extent = (k: number): number => {
    const axis = positions.filter((_, i) => i % 3 === k);
    return Math.max(...axis) - Math.min(...axis);
  };
  return [extent(0), extent(1), extent(2)];
}

/** The `bent` centreline point and unit tangent at distance `s` along it. */
function bentAlong(s: number): { c: Vec3; t: Vec3 } {
  if (s <= BENT_STRAIGHT) return { c: [0, s, 0], t: [0, 1, 0] };
  const a = Math.min(s - BENT_STRAIGHT, BENT_CURVE) / BENT_RADIUS;
  return {
    c: [0, BENT_STRAIGHT + BENT_RADIUS * Math.sin(a), BENT_RADIUS * (1 - Math.cos(a))],
    t: [0, Math.cos(a), Math.sin(a)],
  };
}

/** The shaft's taper: its size at `s`, as a fraction of the root's. */
function bentTaper(s: number): number {
  return 1 - (1 - BENT_TAPER) * (s / BENT_LENGTH);
}

/**
 * A flat steel strip growing along +y that curves evenly towards +z (the
 * front) over its lower part and narrows a little towards the tip: a
 * leaf-rake tine. The bend stays in the yz plane, so x (the strip's width)
 * is the same sideways direction all along. Round root, flattened tip.
 */
function bent(rings: number, segments: number): MeshArrays {
  return strip(
    {
      from: 0,
      to: BENT_LENGTH,
      wide: (s) => BENT_TUBE * BENT_WIDE * bentTaper(s),
      thin: (s) => BENT_TUBE * BENT_THIN * bentTaper(s),
      startCap: 1,
      endCap: BENT_CHISEL,
    },
    rings,
    segments,
  );
}

/**
 * The `bent` tine's toe (an accent mesh): a short sleeve over the tine's end
 * that flares quickly to a wide, flat chisel, its flat end facing where the
 * tip points (towards the viewer once the tine curves forward).
 */
function bentToeMesh(rings: number, segments: number): MeshArrays {
  const from = BENT_LENGTH - TOE_LENGTH;
  // 0 where the toe starts (just over the shaft), 1 once it has flared (smoothstep).
  const grown = (s: number): number => {
    const k = Math.min(1, Math.max(0, (s - from) / (TOE_LENGTH * 0.45)));
    return k * k * (3 - 2 * k);
  };
  return strip(
    {
      from,
      to: BENT_LENGTH,
      wide: (s) => BENT_TUBE * BENT_WIDE * bentTaper(from) * (1.05 + (TOE_FLARE - 1.05) * grown(s)),
      thin: (s) => BENT_TUBE * BENT_THIN * bentTaper(from) * (1.1 + (TOE_THICK - 1.1) * grown(s)),
      startCap: 1,
      endCap: TOE_CAP,
    },
    rings,
    segments,
  );
}

interface StripSpec {
  /** Where it starts and ends along the `bent` centreline. */
  readonly from: number;
  readonly to: number;
  /** Its half-width (x) and half-thickness (in the bend's plane) at `s`. */
  readonly wide: (s: number) => number;
  readonly thin: (s: number) => number;
  /** Each round end's reach along the strip, in half-thicknesses (small = flat). */
  readonly startCap: number;
  readonly endCap: number;
}

/** An elliptical tube along the `bent` centreline, with ellipsoidal end caps. */
function strip(spec: StripSpec, rings: number, segments: number): MeshArrays {
  const capRings = Math.max(3, Math.round(rings / 3)); // v16: 3 at low detail, so a flat end's normals stay true
  const bodyRings = rings * 2;
  const count = capRings * 2 + bodyRings;
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i <= count; i++) {
    let s: number;
    let beta: number; // 0 on the strip, ±π/2 at the tips of the round ends
    let cap = 1; // the end cap's reach along the strip, in half-thicknesses
    if (i < capRings) {
      s = spec.from;
      beta = -(Math.PI / 2) * (1 - i / capRings);
      cap = spec.startCap;
    } else if (i > capRings + bodyRings) {
      s = spec.to;
      beta = (Math.PI / 2) * ((i - capRings - bodyRings) / capRings);
      cap = spec.endCap;
    } else {
      s = spec.from + ((spec.to - spec.from) * (i - capRings)) / bodyRings;
      beta = 0;
    }
    const { c, t } = bentAlong(s);
    const w = spec.wide(s);
    const h = spec.thin(s);
    const reach = cap * h;
    // How fast the section widens and thickens along the strip (on the body
    // only): it tips the normals back along the strip where it flares.
    const ds = 1e-4;
    const dw = beta === 0 ? (spec.wide(s + ds) - spec.wide(s - ds)) / (2 * ds) : 0;
    const dh = beta === 0 ? (spec.thin(s + ds) - spec.thin(s - ds)) / (2 * ds) : 0;
    // Perpendicular to the strip in the yz plane: [0, -t.z, t.y].
    const across: Vec3 = [0, -t[2], t[1]];
    for (let k = 0; k <= segments; k++) {
      const phi = (2 * Math.PI * k) / segments;
      // A point on the unit section circle, stretched into the strip's
      // ellipse (and the cap's reach along the strip).
      const sx = Math.sin(phi);
      const sa = -Math.cos(phi);
      const sb = Math.sin(beta);
      const cb = Math.cos(beta);
      positions.push(
        c[0] + cb * sx * w,
        c[1] + sb * reach * t[1] + cb * sa * h * across[1],
        c[2] + sb * reach * t[2] + cb * sa * h * across[2],
      );
      // The section ellipse's gradient, plus the flare's slope along the strip.
      const along = sb / reach - (sx * sx * dw) / w - (sa * sa * dh) / h;
      normals.push(
        ...normalize([
          (cb * sx) / w,
          along * t[1] + (cb * sa * across[1]) / h,
          along * t[2] + (cb * sa * across[2]) / h,
        ]),
      );
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

/** The scale and centre that fit a mesh's bounds into [−0.5, 0.5]³. */
interface Fit {
  readonly scale: Vec3;
  readonly mid: Vec3;
}

function fitOf(mesh: MeshArrays): Fit {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i + k] ?? 0;
      min[k] = Math.min(min[k] ?? v, v);
      max[k] = Math.max(max[k] ?? v, v);
    }
  }
  const axis = (k: number): [number, number] => [
    1 / ((max[k] ?? 1) - (min[k] ?? 0)),
    ((max[k] ?? 0) + (min[k] ?? 0)) / 2,
  ];
  const [x, y, z] = [axis(0), axis(1), axis(2)];
  return { scale: [x[0], y[0], z[0]], mid: [x[1], y[1], z[1]] };
}

/** Moves a mesh by a fit, correcting normals for the stretch. */
function applyFit(mesh: MeshArrays, { scale, mid }: Fit): MeshArrays {
  const positions = mesh.positions.map((v, i) => (v - (mid[i % 3] ?? 0)) * (scale[i % 3] ?? 1));
  const normals: number[] = [];
  for (let i = 0; i < mesh.normals.length; i += 3) {
    // Normals transform by the inverse scale.
    normals.push(
      ...normalize([
        (mesh.normals[i] ?? 0) / scale[0],
        (mesh.normals[i + 1] ?? 0) / scale[1],
        (mesh.normals[i + 2] ?? 0) / scale[2],
      ]),
    );
  }
  return { positions, normals, indices: mesh.indices };
}

/** Scales and centres positions into [−0.5, 0.5]³, correcting normals for the stretch. */
function fitUnitBox(mesh: MeshArrays): MeshArrays {
  return applyFit(mesh, fitOf(mesh));
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

/**
 * Geometry for a two-tone part's second mesh (#234 v16), in its main shape's
 * own unit-box frame, so the same placement matrix puts both in place. It
 * may reach a little outside that box (the toe is wider than the shaft).
 */
export function accentArrays(mesh: AccentMesh, lod: LodSettings): MeshArrays {
  return ACCENTS[mesh](lod);
}

/** One builder per accent mesh: a new `AccentMesh` fails to typecheck here until it has one. */
const ACCENTS: Readonly<Record<AccentMesh, (lod: LodSettings) => MeshArrays>> = {
  'bent-toe': (lod) =>
    orientTriangles(
      applyFit(
        // A few more rings than the shaft at low detail: the flare is short and quick.
        bentToeMesh(Math.max(lod.partRings, 10), lod.partSegments),
        fitOf(bent(lod.partRings, lod.partSegments)),
      ),
    ),
};
