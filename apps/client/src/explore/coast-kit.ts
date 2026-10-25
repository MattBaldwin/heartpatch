import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { SEA, shoreRadius } from './coast-config.js';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { kitMesh, merged, Part } from './kit-mesh.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';
import type { ExtrasContext, Growth } from './land-layout.js';
import type { SpotShape } from './trail-kit.js';
import type { LandOptions } from './explore-land.js';

// The coast's shapes (#621 W1-11), on the meadow's kit: the same vinyl-toy
// primitives, vertex-coloured from a darker foot to a sunlit top (art bible
// §4), one merged mesh each. The sea and its foam are layers placed once; the
// palms, rocks and shells dress the sand; the five search spots are drawn at
// world size. Placement is pure and seeded, like the trail's and the cave's.

type Layers = NonNullable<LandOptions['extras']>;

/** A small deterministic spread (golden-angle ring), so the foam is the same on every device. */
const spread = (i: number): number => (i * 0.61803398875) % 1;

/** Radii (past the shoreline) where the sea's colour is set; between them it blends smoothly. */
const SEA_RINGS = [-1, 0, 1, 2, 3.5, 5, 7, 10, 14, 22] as const;

/**
 * The open sea: one disc whose vertex colour fades from the pale shallows at
 * the shore to the deep blue far out, so no ring of colour shows a hard edge
 * (the camera stands near the old shallows' rim and saw it as a straight seam).
 */
export function buildSea(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-sea', () => {
    const rs = shoreRadius();
    const shallow = Color3.FromHexString(SEA.shallows).toLinearSpace();
    const deep = Color3.FromHexString(SEA.deep).toLinearSpace();
    const radii = [0, ...SEA_RINGS.map((r) => rs + r), SEA.radius];
    const around = 48;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    radii.forEach((r, ring) => {
      // Pale until the shoreline, then a smooth fade to deep over `shallowReach` × 3.
      const t = Math.min(1, Math.max(0, (r - rs) / (SEA.shallowReach * 3)));
      const k = t * t * (3 - 2 * t);
      for (let n = 0; n < around; n++) {
        const a = (n / around) * Math.PI * 2;
        positions.push(Math.cos(a) * r, SEA.level, Math.sin(a) * r);
        colors.push(
          shallow.r + (deep.r - shallow.r) * k,
          shallow.g + (deep.g - shallow.g) * k,
          shallow.b + (deep.b - shallow.b) * k,
          1,
        );
      }
      if (ring === 0) return;
      for (let n = 0; n < around; n++) {
        const a0 = (ring - 1) * around + n;
        const a1 = (ring - 1) * around + ((n + 1) % around);
        const b0 = ring * around + n;
        const b1 = ring * around + ((n + 1) % around);
        indices.push(a0, b0, a1, a1, b0, b1, a0, a1, b0, a1, b1, b0);
      }
    });
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.normals = positions.map((_, n) => (n % 3 === 1 ? 1 : 0));
    data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
    data.indices = indices;
    return merged([new Part(data)]);
  });
}

/**
 * A flat, wavy band round the shoreline, `from`…`to` out from `radius` (the
 * edges wobble so it reads as a lapping wave, not a ring). Both windings, so
 * it shows whichever way the material culls.
 */
function wavyBand(radius: number, from: number, to: number, y: number, phase: number): Part {
  const n = 120;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const wobble = (w: number) =>
      0.16 * Math.sin(7 * a + phase + w) + 0.1 * Math.sin(13 * a + 2 * phase - w);
    const rIn = radius + from + wobble(0);
    const rOut = radius + to + wobble(1.7);
    positions.push(
      Math.cos(a) * rIn,
      y,
      Math.sin(a) * rIn,
      Math.cos(a) * rOut,
      y,
      Math.sin(a) * rOut,
    );
    if (k < n) {
      const i = k * 2;
      indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3, i, i + 2, i + 1, i + 2, i + 3, i + 1);
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = positions.map((_, k) => (k % 3 === 1 ? 1 : 0));
  return new Part(data);
}

/** The surf line: a pale wash and a white wavy foam band round the shoreline (hidden where the sand is higher). */
export function buildFoam(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-foam', () => {
    const rs = shoreRadius();
    return merged([
      flat(
        wavyBand(rs, SEA.foamBand.from - 0.3, SEA.foamBand.to + 0.7, SEA.level + 0.008, 0.6),
        SEA.wash,
      ),
      flat(wavyBand(rs, SEA.foamBand.from, SEA.foamBand.to, SEA.level + 0.02, 0), SEA.foam),
    ]);
  });
}

/** A palm: a leaning trunk in segments and a crown of drooping fronds. */
export function buildPalm(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-palms', () => {
    const parts: Part[] = [];
    const segments = 5;
    let x = 0;
    for (let i = 0; i < segments; i++) {
      const y = 0.26 + i * 0.5;
      x += 0.07;
      parts.push(
        shaded(
          cylinder(0.56, 0.2 - i * 0.015, 0.25 - i * 0.015, 7, [x, y, 0], [0, 0, -0.14]),
          '#8a6a4a',
          '#c19a6b',
          y - 0.28,
          y + 0.28,
        ),
      );
    }
    const top: [number, number, number] = [x + 0.04, segments * 0.5 + 0.1, 0];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      // Turned about its own middle before it is painted, so it points out from the crown.
      const frond = sphere(
        1.25,
        5,
        [top[0] + Math.cos(a) * 0.5, top[1] - 0.12, Math.sin(a) * 0.5],
        [1, 0.14, 0.34],
      );
      frond.rotation.y = -a;
      parts.push(shaded(frond, '#4f9a58', '#8fd47a', top[1] - 0.3, top[1] + 0.1));
    }
    parts.push(flat(sphere(0.2, 4, [top[0] - 0.08, top[1] - 0.1, 0.08]), '#6b4a2b'));
    parts.push(flat(sphere(0.2, 4, [top[0] + 0.1, top[1] - 0.14, -0.06]), '#6b4a2b'));
    return merged(parts);
  });
}

/** Sea rocks: smooth pale stone with a wet, dark foot and a few pinky barnacle specks. */
export function buildSeaRocks(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-rocks', () =>
    merged([
      shaded(sphere(1.0, 6, [0, 0.22, 0], [1.2, 0.62, 1]), '#6f6a6c', '#cfc6bd', 0, 0.6),
      shaded(sphere(0.6, 5, [0.55, 0.14, 0.25], [1.1, 0.7, 1]), '#6c6769', '#c7beb5', 0, 0.35),
      shaded(sphere(0.4, 4, [-0.5, 0.1, -0.2], [1, 0.7, 1.1]), '#75706f', '#d3cabf', 0, 0.25),
      flat(sphere(0.1, 3, [0.12, 0.5, 0.18], [1, 0.5, 1]), '#f4d7d0'),
      flat(sphere(0.08, 3, [-0.18, 0.46, -0.1], [1, 0.5, 1]), '#f4d7d0'),
    ]),
  );
}

/** A log washed up and left to bleach, with a knot and a stub of branch. */
export function buildDriftLog(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-driftlogs', driftLog);
}

function driftLog(): Part {
  const log: LogShape = {
    length: 1.6,
    top: 0.3,
    bottom: 0.34,
    at: [0, 0.17, 0],
    tilt: [0, 0, Math.PI / 2],
  };
  return merged([
    shaded(
      cylinder(log.length, log.top, log.bottom, 8, log.at, log.tilt),
      '#a8957a',
      '#e2d3b9',
      0,
      0.34,
    ),
    logCap(log, 'bottom', '#efe2c8'),
    shaded(
      cylinder(0.4, 0.07, 0.12, 5, [-0.2, 0.42, 0.05], [0.5, 0, 0.2]),
      '#a8957a',
      '#d9c9ad',
      0.3,
      0.6,
    ),
  ]);
}

/** A tiny shell: a cream or pink flattened bead, scattered over the sand. */
export function buildShellBits(scene: Scene): Mesh {
  return kitMesh(scene, 'coast-shell-bits', () =>
    merged([
      shaded(sphere(0.16, 4, [0, 0.03, 0], [1.1, 0.4, 1]), '#f2b6c4', '#ffe3e8', 0, 0.08),
      shaded(sphere(0.12, 4, [0.18, 0.025, 0.08], [1.2, 0.4, 1]), '#f3d9b8', '#fff4e2', 0, 0.06),
      shaded(sphere(0.1, 3, [-0.12, 0.02, 0.12], [1.1, 0.4, 1]), '#d9e7ef', '#f7fcff', 0, 0.05),
    ]),
  );
}

/** `count` places in a ring `from`…`to` tile-sizes out within a bearing range. */
function ring(
  ctx: ExtrasContext,
  count: number,
  from: number,
  to: number,
  scale: [number, number],
  bearing: [number, number],
): Growth[] {
  const out: Growth[] = [];
  const between = (lo: number, hi: number) => lo + ctx.rand() * (hi - lo);
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const angle = (between(bearing[0], bearing[1]) * Math.PI) / 180;
    const d = between(ctx.size * from, ctx.size * to);
    const x = Math.cos(angle) * d;
    const z = Math.sin(angle) * d;
    // The camera looks towards +z: nothing tall stands between it and the tile.
    if (z < -ctx.size * 0.5 && Math.abs(x) < ctx.size * 1.5) continue;
    out.push({ x, z, yaw: ctx.rand() * Math.PI * 2, scale: between(scale[0], scale[1]) });
  }
  return out;
}

/** Whether a place is clear of every spot's collider by `gap` more. */
const clear = (ctx: ExtrasContext, g: Growth, gap: number): boolean =>
  !ctx.colliders.some((k) => (g.x - k.x) ** 2 + (g.z - k.z) ** 2 < (k.r + gap) ** 2);

function coastPlace(ctx: ExtrasContext): Readonly<Record<string, readonly Growth[]>> {
  // Palms across the middle of the back, so a trunk stays in view whatever the
  // phone's width (off to the side, a trunk could leave the frame while its
  // fronds hung in, which read as floating).
  const palms = [
    ...ring(ctx, 1, 0.98, 1.04, [0.9, 1.15], [68, 82]),
    ...ring(ctx, 1, 0.98, 1.04, [0.9, 1.15], [98, 112]),
    ...ring(ctx, 1, 0.98, 1.04, [0.8, 1.0], [84, 96]),
  ];
  for (const p of palms) ctx.shade(p.x, p.z, 0.9 * p.scale, 3 * p.scale);
  // Sea rocks standing in the surf, a few on the sand's rim.
  const rocks = [
    ...ring(ctx, 5, 1.05, 1.22, [0.7, 1.3], [0, 180]),
    ...ring(ctx, 3, 0.96, 1.02, [0.5, 0.8], [0, 180]),
  ];
  for (const r of rocks) ctx.shade(r.x, r.z, 0.9 * r.scale, 0.6 * r.scale);
  // Driftwood on the sand round the rim, off the spots.
  const logs = ring(ctx, 4, 0.8, 0.98, [0.8, 1.2], [0, 360]).filter((g) => clear(ctx, g, 0.9));
  for (const l of logs) ctx.shade(l.x, l.z, 0.7 * l.scale, 0.3 * l.scale);
  // Shells scattered on the sand inside the tile, never on a spot.
  const shells = ring(ctx, 36, 0.1, 0.9, [0.8, 1.3], [0, 360]).filter((g) => clear(ctx, g, 0.35));
  // The sea and its foam: one place each, at the middle (they are built round it).
  const middle = [{ x: 0, z: 0, yaw: 0, scale: 1 }];
  return {
    sea: middle,
    foam: middle,
    palms,
    'sea-rocks': rocks,
    'drift-logs': logs,
    'shell-bits': shells,
  };
}

/** The coast's own layers, in the shape `ExploreLand` takes. */
export const COAST_EXTRAS: Layers = {
  place: coastPlace,
  layers: {
    sea: { build: buildSea },
    foam: { build: buildFoam },
    palms: { build: buildPalm, sway: 0.02 }, // TUNE: a gentle sea breeze
    'sea-rocks': { build: buildSeaRocks },
    'drift-logs': { build: buildDriftLog },
    'shell-bits': { build: buildShellBits },
  },
};

// ── The five search spots, world size, foot at the origin ─────────────

/** A shell pile: a ridged scallop, a spiral conch and a sand dollar. */
function buildShells(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'coast-spot-shells', () => {
    const parts: Part[] = [
      shaded(sphere(0.9, 7, [0, 0.0, 0], [1.1, 0.22, 1]), '#e3cf9f', '#f4e6bf', -0.05, 0.12),
      // The scallop: a flattened fan with ridges.
      shaded(
        sphere(0.62, 6, [-0.1, 0.17, 0.05], [1.1, 0.34, 0.9]),
        '#f0a3b6',
        '#ffd9e1',
        0.08,
        0.3,
      ),
    ];
    for (let i = -2; i <= 2; i++) {
      parts.push(
        flat(
          cylinder(
            0.5,
            0.02,
            0.05,
            4,
            [-0.1 + i * 0.1, 0.27, 0.05 - Math.abs(i) * 0.02],
            [0.9, 0, -i * 0.22],
          ),
          '#f7bfcc',
        ),
      );
    }
    // The conch: a rounded cone with a pink lip.
    parts.push(
      shaded(
        cylinder(0.5, 0.08, 0.36, 7, [0.38, 0.22, -0.12], [0.4, 0.5, 0.9]),
        '#e4a77a',
        '#fbe0c2',
        0.0,
        0.5,
      ),
    );
    parts.push(flat(sphere(0.2, 4, [0.52, 0.13, -0.05], [1.2, 0.7, 1]), '#f59fb0'));
    // A sand dollar.
    parts.push(
      shaded(sphere(0.36, 6, [0.05, 0.05, -0.38], [1, 0.22, 1]), '#e9ddc4', '#fbf4e4', 0.0, 0.1),
    );
    return merged(parts);
  });
  return { mesh, glint: 0.4 };
}

/** A log's size and pose, as `cylinder` takes them: diameters, a position and a tilt. */
interface LogShape {
  length: number;
  top: number;
  bottom: number;
  at: [number, number, number];
  tilt: [number, number, number];
}

/**
 * A point `t` along a log's axis (-0.5 = its top end, 0.5 = its bottom end),
 * rotated with the log's own tilt, and the log's diameter there. End caps and
 * rope hang off this, so they follow the log however it is yawed.
 */
export function logPoint(
  log: LogShape,
  t: number,
): { at: [number, number, number]; diameter: number } {
  const turn = Quaternion.RotationYawPitchRoll(log.tilt[1], log.tilt[0], log.tilt[2]);
  const offset = new Vector3(0, -t * log.length, 0).rotateByQuaternionToRef(turn, new Vector3());
  return {
    at: [log.at[0] + offset.x, log.at[1] + offset.y, log.at[2] + offset.z],
    diameter: log.top + (log.bottom - log.top) * (t + 0.5),
  };
}

/** A pale disc closing a log's `end`, a hair outside it and a bit narrower. */
function logCap(log: LogShape, end: 'top' | 'bottom', color: string): Part {
  const { at, diameter } = logPoint(
    log,
    end === 'top' ? -0.5 - 0.01 / log.length : 0.5 + 0.01 / log.length,
  );
  return flat(cylinder(0.02, diameter * 0.8, diameter * 0.8, 8, at, log.tilt), color);
}

/** Driftwood: two bleached logs crossed, with a knotted branch and a bit of rope. */
function buildDriftwood(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'coast-spot-driftwood', () => {
    const lower: LogShape = {
      length: 1.5,
      top: 0.34,
      bottom: 0.4,
      at: [0, 0.2, 0],
      tilt: [0, 0.35, Math.PI / 2],
    };
    const upper: LogShape = {
      length: 1.1,
      top: 0.26,
      bottom: 0.3,
      at: [0.1, 0.46, 0.05],
      tilt: [0, -0.6, Math.PI / 2],
    };
    const rope = logPoint(upper, 0.1);
    return merged([
      shaded(
        cylinder(lower.length, lower.top, lower.bottom, 8, lower.at, lower.tilt),
        '#a8957a',
        '#e5d6bb',
        0,
        0.4,
      ),
      shaded(
        cylinder(upper.length, upper.top, upper.bottom, 8, upper.at, upper.tilt),
        '#b6a387',
        '#eadcc2',
        0.3,
        0.6,
      ),
      logCap(lower, 'bottom', '#f1e5cd'),
      shaded(
        cylinder(0.5, 0.07, 0.14, 5, [-0.3, 0.52, -0.12], [0.6, 0, 0.3]),
        '#a8957a',
        '#dccdb1',
        0.35,
        0.8,
      ),
      // A loop of rope round the top log, a bit wider than the log there.
      flat(
        cylinder(0.05, rope.diameter * 1.3, rope.diameter * 1.3, 8, rope.at, upper.tilt),
        '#c8a46a',
      ),
    ]);
  });
  return { mesh, glint: 0.6 };
}

/** A crab hole: a dug-out mound with a dark hole, and a little crab peeking out. */
function buildCrabHole(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'coast-spot-crab-hole', () => {
    const parts: Part[] = [
      shaded(sphere(1.0, 7, [0, 0.0, 0], [1.1, 0.34, 1]), '#d8bd86', '#f0dca8', -0.05, 0.2),
      flat(sphere(0.34, 5, [0, 0.14, 0], [1.1, 0.3, 1]), '#5a4630'),
    ];
    // Sand pushed out of the hole in little clumps.
    for (const [x, z, d] of [
      [0.34, 0.2, 0.16],
      [-0.32, 0.18, 0.14],
      [0.06, -0.36, 0.15],
      [-0.18, 0.36, 0.12],
    ] as const) {
      parts.push(
        shaded(sphere(d, 4, [x, 0.12, z], [1.1, 0.6, 1]), '#d2b67e', '#f2e0b0', 0.05, 0.2),
      );
    }
    // The crab, beside the hole: a round red body, two eye stalks and two claws.
    parts.push(
      shaded(sphere(0.26, 5, [0.46, 0.2, -0.1], [1.3, 0.7, 1]), '#e8543f', '#ff8a6b', 0.1, 0.34),
    );
    for (const side of [-1, 1] as const) {
      parts.push(
        flat(cylinder(0.12, 0.025, 0.025, 4, [0.55, 0.38, -0.1 + side * 0.06]), '#e8543f'),
      );
      parts.push(flat(sphere(0.07, 3, [0.55, 0.45, -0.1 + side * 0.06]), '#ffffff'));
      parts.push(flat(sphere(0.035, 3, [0.58, 0.45, -0.1 + side * 0.06]), '#2a2030'));
      parts.push(
        shaded(
          sphere(0.16, 4, [0.46, 0.22, -0.1 + side * 0.24], [1, 0.8, 0.9]),
          '#e8543f',
          '#ff8a6b',
          0.1,
          0.3,
        ),
      );
    }
    return merged(parts);
  });
  return { mesh, glint: 0.5 };
}

/** A tide pool: a ring of dark, wet rocks round clear turquoise water, with a starfish. */
function buildTidePool(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'coast-spot-tide-pool', () => {
    const parts: Part[] = [
      shaded(sphere(1.5, 8, [0, -0.03, 0], [1, 0.1, 1]), '#d8bd86', '#ecd9a6', -0.05, 0.05),
      flat(cylinder(0.04, 0.95, 0.95, 14, [0, 0.07, 0]), '#5fd0d8'),
      flat(cylinder(0.03, 0.6, 0.6, 12, [0.05, 0.095, 0]), '#8fe8e6'),
    ];
    const rocks = 9;
    for (let i = 0; i < rocks; i++) {
      const a = (i / rocks) * Math.PI * 2;
      const d = 0.26 + spread(i * 3 + 2) * 0.16;
      parts.push(
        shaded(
          sphere(d, 5, [Math.cos(a) * 0.52, d * 0.22, Math.sin(a) * 0.52], [1.2, 0.7, 1]),
          '#575257',
          '#a8a0a2',
          0,
          d * 0.5,
        ),
      );
    }
    // A pink starfish on the pool's floor, and a bubble or two.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = sphere(
        0.3,
        4,
        [0.1 + Math.cos(a) * 0.14, 0.115, -0.1 + Math.sin(a) * 0.14],
        [1.2, 0.18, 0.4],
      );
      arm.rotation.y = -a;
      parts.push(flat(arm, '#ff8fa8'));
    }
    parts.push(flat(sphere(0.18, 4, [0.1, 0.13, -0.1], [1, 0.4, 1]), '#ff7a96'));
    parts.push(flat(sphere(0.1, 4, [-0.3, 0.2, 0.2]), '#e6fbff'));
    parts.push(flat(sphere(0.07, 4, [-0.22, 0.34, 0.24]), '#e6fbff'));
    return merged(parts);
  });
  return { mesh, glint: 0.4 };
}

/**
 * One kelp ribbon: a flat strip rising from the pool's middle, leaning out
 * towards bearing `a`, swaying side to side along a sine, narrowing to a
 * soft tip. Both windings, so it shows from either side.
 */
function kelpRibbon(a: number, height: number, swing: number, phase: number): Part {
  const levels = 12;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const out = [Math.cos(a), Math.sin(a)] as const;
  const across = [-Math.sin(a), Math.cos(a)] as const;
  for (let k = 0; k <= levels; k++) {
    const t = k / levels;
    const sway = Math.sin(t * Math.PI * 2.6 + phase) * swing * (0.5 + t);
    const reach = 0.14 + t * 0.34;
    const half = 0.085 * (1 - t * 0.7);
    // The strip twists a little as it rises, so it catches the light.
    const twist = Math.sin(t * Math.PI * 2 + phase) * 0.6;
    const cx = out[0] * reach + across[0] * sway;
    const cz = out[1] * reach + across[1] * sway;
    const dx = (across[0] * Math.cos(twist) + out[0] * Math.sin(twist)) * half;
    const dz = (across[1] * Math.cos(twist) + out[1] * Math.sin(twist)) * half;
    const y = 0.1 + t * height;
    positions.push(cx - dx, y, cz - dz, cx + dx, y, cz + dz);
    normals.push(out[0], 0, out[1], out[0], 0, out[1]);
    if (k < levels) {
      const i = k * 2;
      indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3, i, i + 2, i + 1, i + 2, i + 3, i + 1);
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  // The kit's other parts carry UVs; a merge needs every part to have the same attributes.
  data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
  data.indices = indices;
  return new Part(data);
}

/** A kelp bed: wavy golden-brown ribbons rooted in a little pool of clear water. */
function buildKelpBed(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'coast-spot-kelp-bed', () => {
    const parts: Part[] = [
      shaded(sphere(1.7, 8, [0, -0.03, 0], [1, 0.1, 1]), '#d8bd86', '#ecd9a6', -0.05, 0.05),
      flat(cylinder(0.04, 1.2, 1.2, 14, [0, 0.07, 0]), '#4fb9c4'),
      flat(cylinder(0.03, 0.9, 0.9, 12, [0.02, 0.095, 0]), '#79d6d6'),
    ];
    // A few wet rocks at the pool's edge.
    for (const [x, z, d] of [
      [0.55, 0.15, 0.3],
      [-0.5, -0.2, 0.26],
      [0.1, 0.55, 0.22],
    ] as const) {
      parts.push(
        shaded(sphere(d, 5, [x, d * 0.22, z], [1.2, 0.7, 1]), '#575257', '#a8a0a2', 0, d * 0.5),
      );
    }
    // A loose fan of smooth, waving ribbons that lean out over the water.
    const fronds = 7;
    for (let i = 0; i < fronds; i++) {
      const a = (i / fronds) * Math.PI * 2 + 0.3;
      const h = 0.95 + (i % 3) * 0.22;
      parts.push(
        shaded(
          kelpRibbon(a, h, 0.1 + (i % 2) * 0.05, i * 1.3),
          '#7a6a2a',
          i % 2 ? '#d6c25a' : '#c2b24c',
          0.1,
          0.1 + h,
        ),
      );
      if (i % 3 === 0) {
        parts.push(
          flat(sphere(0.1, 4, [Math.cos(a) * 0.5, 0.1 + h * 0.85, Math.sin(a) * 0.5]), '#e0ad3c'),
        );
      }
    }
    return merged(parts);
  });
  return { mesh, glint: 0.5 };
}

/** The coast's search spots, drawn in the kit's style (`biome-dressing.ts` adds them to the biome spots). */
export const COAST_SPOTS: Readonly<Record<string, (scene: Scene) => SpotShape>> = {
  shells: buildShells,
  driftwood: buildDriftwood,
  'crab-hole': buildCrabHole,
  'tide-pool': buildTidePool,
  'kelp-bed': buildKelpBed,
};
