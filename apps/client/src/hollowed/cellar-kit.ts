import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { box, icoSphere, kitMesh, merged, type Part } from '../explore/kit-mesh.js';
import { cylinder, flat, shaded, sphere } from '../explore/land-kit.js';
import type { SpotShape } from '../explore/trail-kit.js';

// The hidden cellar's shapes (#306, owner decision of 2026-10-22): an
// ancient stone vault in the vinyl-toy style (art bible §1.2: rounded,
// chunky, soft colour), on the explore land kit. Each is one merged,
// vertex-coloured mesh in world units with its foot at the origin and its
// front towards −z (the camera), thin-instanced by the land (one draw call a
// kind). Warm grey stone with moss at the foot, honey candlelight, and
// wooden chests banded in gold.

/** Stone, darker at the foot (shade and moss) to sunlit-warm at the top. */
const STONE = { foot: '#5f5853', top: '#a89c90', light: '#b9ad9f' } as const;
const MOSS = ['#6f8f5a', '#7fa266', '#5f7f4d'] as const;
const WOOD = { dark: '#6b3d24', mid: '#8f5532', light: '#a96a3e' } as const;
const GOLD = { deep: '#d9993a', mid: '#f2b84b', light: '#ffd27a' } as const;

/** A part moved to `at` (applied when it's merged). */
function placed(part: Part, at: [number, number, number]): Part {
  part.position.set(...at);
  return part;
}

/** A part squashed to `sy` of its height about y 0 (applied when it's merged). */
function squashed(part: Part, sy: number): Part {
  part.scaling.set(1, sy, 1);
  return part;
}

/**
 * A soft box (a superellipsoid): flat faces with well-rounded edges, the
 * vinyl-toy block (`round` 0 is a sphere, towards 1 a sharp box). `w`, `h`,
 * `d` across, centred on `at`.
 */
export function softBox(
  w: number,
  h: number,
  d: number,
  at: [number, number, number],
  round = 0.72,
): Part {
  const part = icoSphere({ radius: 1, subdivisions: 3, flat: false });
  const pos = part.data.positions ?? [];
  const e = 1 - round;
  const shape = (v: number) => Math.sign(v) * Math.abs(v) ** e;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = shape(pos[i] ?? 0) * (w / 2) + at[0];
    pos[i + 1] = shape(pos[i + 1] ?? 0) * (h / 2) + at[1];
    pos[i + 2] = shape(pos[i + 2] ?? 0) * (d / 2) + at[2];
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, part.data.indices ?? [], normals);
  part.data.normals = normals;
  return part;
}

/** A chunky stone block in the wall's warm grey, darker at its foot. */
function block(w: number, h: number, d: number, at: [number, number, number], tone: number): Part {
  const foot = tone > 0.5 ? STONE.foot : '#56504b';
  const top = tone > 0.5 ? STONE.light : STONE.top;
  return shaded(softBox(w, h, d, at, 0.6), foot, top, at[1] - h / 2, at[1] + h / 2);
}

/**
 * One bay of the back wall, about 4.2 across and 7 tall: big stacked stone
 * blocks either side of an arched alcove, a pillar on the left with a ribbed
 * arch springing from it towards the vaulted ceiling, and moss at the foot.
 * Bays stand side by side along the wall.
 */
export function buildWallBay(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-wall-bay', () => {
    // The wall behind: a dark back so the gaps between blocks read as mortar.
    const parts: Part[] = [
      placed(flat(box({ width: 4.3, height: 7.2, depth: 0.5 }), '#3a332f'), [0, 3.6, 0.55]),
    ];
    // Big blocks in courses, staggered, each a little different.
    const courses = [
      { y: 0.45, h: 0.95, xs: [-1.55, -0.45, 0.65, 1.7], w: 1.05 },
      { y: 1.4, h: 0.9, xs: [-1.05, 0.1, 1.2], w: 1.12 },
      { y: 2.32, h: 0.92, xs: [-1.55, 1.7], w: 1.0 },
      { y: 3.26, h: 0.9, xs: [-1.1, 1.25], w: 1.15 },
      { y: 4.2, h: 0.95, xs: [-1.55, -0.4, 0.7, 1.75], w: 1.1 },
      { y: 5.16, h: 0.92, xs: [-1.0, 0.15, 1.25], w: 1.12 },
      { y: 6.1, h: 0.95, xs: [-1.55, -0.4, 0.7, 1.75], w: 1.1 },
    ];
    courses.forEach((c, i) => {
      c.xs.forEach((x, j) => {
        const tone = (i * 7 + j * 3) % 5 > 1 ? 1 : 0;
        parts.push(block(c.w * 0.98, c.h * 0.94, 0.62, [x, c.y, 0.2], tone));
      });
    });
    // The alcove: a dark arched niche between the blocks, with a pale rim.
    parts.push(
      placed(flat(box({ width: 1.5, height: 1.9, depth: 0.2 }), '#2a2320'), [0.1, 2.45, 0.42]),
    );
    parts.push(flat(cylinder(0.2, 1.5, 1.5, 18, [0.1, 3.4, 0.42], [Math.PI / 2, 0, 0]), '#2a2320'));
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI * (k / 6);
      parts.push(
        block(0.42, 0.34, 0.5, [0.1 + Math.cos(a) * 0.95, 3.4 + Math.sin(a) * 0.95, 0.15], 1),
      );
    }
    parts.push(block(1.9, 0.32, 0.6, [0.1, 1.45, 0.05], 1)); // the alcove's sill
    // The pillar on the left, standing proud of the wall.
    // Short and stout, so the vault's arches spring low enough to show
    // under the explore camera.
    parts.push(
      shaded(cylinder(3.4, 0.95, 1.1, 10, [-2.1, 1.7, -0.15]), STONE.foot, STONE.light, 0, 3.4),
    );
    parts.push(block(1.3, 0.45, 1.25, [-2.1, 0.22, -0.15], 0));
    parts.push(block(1.35, 0.42, 1.3, [-2.1, 3.5, -0.15], 1));
    // The vault: ribs spring from this pillar and the next one's top and meet
    // over the bay's middle, leaning out over the room like a ceiling.
    for (const side of [-1, 1]) {
      for (let k = 0; k <= 6; k++) {
        const a = (Math.PI / 2) * (k / 6);
        parts.push(
          block(
            0.62,
            0.52,
            0.8,
            [
              side * (2.1 - Math.sin(a) * 2.0),
              3.85 + (1 - Math.cos(a)) * 1.6,
              -0.2 - Math.sin(a) * 0.9,
            ],
            1,
          ),
        );
      }
    }
    // Moss at the foot and in a few cracks.
    const moss: [number, number, number, number][] = [
      [-1.4, 0.08, 0.9, 0],
      [0.9, 0.06, 1.1, 1],
      [-2.3, 0.12, 0.7, 2],
      [1.8, 2.8, 0.45, 1],
      [-0.9, 4.7, 0.4, 0],
    ];
    for (const [x, y, s, c] of moss) {
      parts.push(flat(sphere(s, 4, [x, y, -0.12], [1.3, 0.45, 0.6]), MOSS[c] ?? MOSS[0]));
    }
    return merged(parts);
  });
}

/**
 * A plain stretch of wall for the sides, about 4.2 across and 7 tall: the
 * same stacked blocks, no alcove.
 */
export function buildWallSide(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-wall-side', () => {
    const parts: Part[] = [
      placed(flat(box({ width: 4.3, height: 7.2, depth: 0.5 }), '#3a332f'), [0, 3.6, 0.55]),
    ];
    for (let i = 0; i < 7; i++) {
      const y = 0.45 + i * 0.95;
      const xs = i % 2 === 0 ? [-1.55, -0.45, 0.65, 1.7] : [-1.0, 0.1, 1.2];
      xs.forEach((x, j) => {
        parts.push(block(1.08, 0.88, 0.62, [x, y, 0.2], (i + j) % 3 === 0 ? 0 : 1));
      });
    }
    parts.push(flat(sphere(1.0, 4, [0.4, 0.06, -0.1], [1.4, 0.4, 0.6]), MOSS[1]));
    return merged(parts);
  });
}

/** How high a sconce hangs on its pillar, world units (the Keeper is about 1.2 tall). */
const SCONCE_Y = 2.4; // TUNE

/** An iron wall sconce with a fat honey candle, for a pillar. Its flame is `buildFlame`. */
export function buildSconce(scene: Scene): Mesh {
  const y = SCONCE_Y;
  return kitMesh(scene, 'cellar-sconce', () =>
    merged([
      flat(cylinder(0.12, 0.5, 0.5, 10, [0, y, -0.25]), '#4a3a35'),
      flat(cylinder(0.5, 0.1, 0.1, 6, [0, y - 0.2, -0.05], [0.5, 0, 0]), '#4a3a35'),
      shaded(cylinder(0.42, 0.3, 0.32, 10, [0, y + 0.27, -0.25]), '#e8c99a', '#fff1d6', y, y + 0.5),
    ]),
  );
}

/**
 * A sconce's flame and soft halo, lit from inside (the land's glow layer):
 * a warm teardrop with a pale heart.
 */
export function buildFlame(scene: Scene): Mesh {
  const y = SCONCE_Y;
  return kitMesh(scene, 'cellar-flame', () =>
    merged([
      flat(sphere(0.3, 4, [0, y + 0.62, -0.25], [0.8, 1.5, 0.8]), '#ffb347'),
      flat(sphere(0.16, 4, [0, y + 0.6, -0.27], [0.8, 1.3, 0.8]), '#fff3c4'),
    ]),
  );
}

/** A cluster of three fat candles on the floor, melted together a bit. Flames: `buildCandleFlames`. */
export function buildCandles(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-candles', () =>
    merged([
      flat(sphere(0.9, 5, [0.05, 0.02, 0], [1.2, 0.12, 1]), '#f4dfbf'),
      shaded(cylinder(0.7, 0.3, 0.32, 10, [0, 0.35, 0]), '#e8c99a', '#fff1d6', 0, 0.7),
      shaded(cylinder(0.45, 0.24, 0.26, 10, [0.32, 0.22, 0.1]), '#e8c99a', '#fff1d6', 0, 0.45),
      shaded(cylinder(0.3, 0.2, 0.22, 10, [-0.26, 0.15, 0.14]), '#e8c99a', '#fff1d6', 0, 0.3),
    ]),
  );
}

/** The candle cluster's three flames, lit from inside. */
export function buildCandleFlames(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-candle-flames', () =>
    merged([
      flat(sphere(0.2, 4, [0, 0.82, 0], [0.8, 1.5, 0.8]), '#ffb347'),
      flat(sphere(0.16, 4, [0.32, 0.53, 0.1], [0.8, 1.5, 0.8]), '#ffc266'),
      flat(sphere(0.14, 4, [-0.26, 0.38, 0.14], [0.8, 1.5, 0.8]), '#ffb347'),
    ]),
  );
}

/**
 * The stair back up, about 3 across: chunky stone steps rising away from
 * the camera to a warm doorway in the wall, the daylight up there spilling
 * down (the doorway's glow is `buildDaylight`).
 */
export function buildStairs(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-stairs', () => {
    const parts: Part[] = [];
    for (let i = 0; i < 6; i++) {
      const y = 0.22 + i * 0.42;
      const z = -1.6 + i * 0.6;
      parts.push(block(2.8, 0.44, 0.7, [0, y, z], i % 2));
      // Each step's riser behind it, so no gap shows.
      parts.push(
        placed(flat(box({ width: 2.7, height: y + 0.2, depth: 0.6 }), '#4a433e'), [
          0,
          (y + 0.2) / 2,
          z + 0.1,
        ]),
      );
    }
    // Low side walls along the steps.
    parts.push(block(0.55, 1.6, 4.2, [-1.6, 1.1, 0], 0));
    parts.push(block(0.55, 2.6, 2.2, [1.6, 1.8, 1.1], 0));
    parts.push(flat(sphere(0.8, 4, [-1.45, 0.1, -1.7], [1.1, 0.35, 0.8]), MOSS[0]));
    return merged(parts);
  });
}

/** The doorway at the top of the stair: a soft arch of warm daylight, lit from inside. */
export function buildDaylight(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-daylight', () => {
    const door = flat(box({ width: 2.2, height: 2.0, depth: 0.1 }), '#ffe6a8');
    door.position.set(0, 3.5, 2.0);
    return merged([
      door,
      flat(cylinder(0.1, 2.2, 2.2, 16, [0, 4.5, 2.0], [Math.PI / 2, 0, 0]), '#ffe6a8'),
    ]);
  });
}

/** A worn flagstone, slightly raised, for the floor (rounded, so it reads as vinyl). */
export function buildFlagstone(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-flagstone', () =>
    shaded(softBox(1.5, 0.08, 1.2, [0, 0, 0], 0.55), '#8d8379', '#b0a69a', -0.04, 0.04),
  );
}

// ── Chests ────────────────────────────────────────────────────────────────

/** A small chest's size: its body, and its lid on the hinge at the back top. */
export const SMALL_CHEST = { width: 1.15, depth: 0.78, height: 0.56, lid: 0.34 } as const;
/** The big chest's: grander, and a gem on the front. */
export const BIG_CHEST = { width: 2.0, depth: 1.25, height: 0.95, lid: 0.6 } as const;

interface ChestLook {
  readonly wood: string;
  readonly woodTop: string;
  readonly band: string;
  readonly bandTop: string;
}
const SMALL_LOOK: ChestLook = {
  wood: WOOD.dark,
  woodTop: WOOD.light,
  band: GOLD.deep,
  bandTop: GOLD.light,
};
const BIG_LOOK: ChestLook = {
  wood: '#5a2f4a',
  woodTop: '#8a4a6e',
  band: GOLD.deep,
  bandTop: GOLD.light,
};

function chestBody(
  size: { width: number; depth: number; height: number },
  look: ChestLook,
  big: boolean,
): Part {
  const { width: w, depth: d, height: h } = size;
  const parts: Part[] = [
    // The box, softly rounded, on little feet.
    shaded(softBox(w, h, d, [0, h / 2 + 0.06, 0], 0.78), look.wood, look.woodTop, 0, h),
    placed(flat(box({ width: w * 0.86, height: 0.06, depth: d * 0.82 }), '#2a1a12'), [
      0,
      h + 0.04,
      0,
    ]),
  ];
  // Gold bands round it, and gold corners.
  for (const x of [-w * 0.3, w * 0.3]) {
    parts.push(
      shaded(
        softBox(w * 0.12, h * 0.98, d * 1.06, [x, h / 2 + 0.06, 0], 0.7),
        look.band,
        look.bandTop,
        0,
        h,
      ),
    );
  }
  for (const x of [-w * 0.42, w * 0.42]) {
    parts.push(flat(sphere(0.2, 4, [x, 0.06, -d * 0.38]), look.band));
  }
  // The lock plate on the front.
  parts.push(
    shaded(
      softBox(w * 0.2, h * 0.36, 0.12, [0, h * 0.72, -d * 0.5], 0.6),
      look.band,
      look.bandTop,
      h * 0.5,
      h,
    ),
  );
  parts.push(flat(sphere(1, 4, [0, h * 0.68, -d * 0.55], [0.06, 0.12, 0.04]), '#3a2418'));
  if (big) {
    // Grander: a plinth, and lion-paw feet.
    parts.push(
      shaded(
        softBox(w * 1.14, 0.14, d * 1.14, [0, 0.04, 0], 0.6),
        '#6a5f58',
        '#8a7e74',
        -0.05,
        0.1,
      ),
    );
    for (const x of [-w * 0.42, w * 0.42]) {
      parts.push(flat(sphere(0.36, 4, [x, 0.1, -d * 0.42], [1, 0.7, 1]), GOLD.mid));
    }
  }
  return merged(parts);
}

/**
 * A chest's lid on its own (`CellarChests` swings it open), with its hinge
 * at the origin: it reaches forwards (−z) and up from there, rounded on top.
 */
function chestLid(
  size: { width: number; depth: number; lid: number },
  look: ChestLook,
  big: boolean,
): Part {
  const { width: w, depth: d, lid } = size;
  // A half-round barrel lid, squashed to the lid's height: its bottom half
  // sits inside the box while it's shut.
  const parts: Part[] = [
    squashed(
      shaded(
        cylinder(w * 0.98, d * 1.02, d * 1.02, 16, [0, 0, -d / 2], [0, 0, Math.PI / 2]),
        look.wood,
        look.woodTop,
        -d / 2,
        d / 2,
      ),
      (lid * 2) / d,
    ),
  ];
  for (const x of [-w * 0.3, w * 0.3]) {
    parts.push(
      squashed(
        flat(
          cylinder(w * 0.12, d * 1.08, d * 1.08, 16, [x, 0, -d / 2], [0, 0, Math.PI / 2]),
          look.band,
        ),
        (lid * 2.1) / d,
      ),
    );
  }
  // The hasp hanging over the lock plate.
  parts.push(flat(sphere(1, 4, [0, -0.02, -d * 1.02], [w * 0.12, lid * 0.6, 0.08]), look.bandTop));
  if (big) {
    // A heart gem on top, and a gold crest on the front.
    parts.push(
      shaded(sphere(0.34, 5, [0, lid * 0.92, -d / 2], [1, 0.8, 1]), GOLD.deep, GOLD.light, 0, lid),
    );
    parts.push(flat(sphere(0.3, 5, [0, lid * 0.55, -d * 0.98], [1, 1, 0.45]), '#ff6f91'));
  }
  return merged(parts);
}

/** A small chest's body as a cellar spot (the lid is `CellarChests`'s). */
export function buildSmallChest(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'cellar-chest', () => chestBody(SMALL_CHEST, SMALL_LOOK, false));
  return { mesh, glint: SMALL_CHEST.height + SMALL_CHEST.lid + 0.3 };
}

/** The big chest's body as a cellar spot. */
export function buildBigChest(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'cellar-big-chest', () => chestBody(BIG_CHEST, BIG_LOOK, true));
  return { mesh, glint: BIG_CHEST.height + BIG_CHEST.lid + 0.5 };
}

/** A small chest's lid. */
export function buildSmallLid(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-chest-lid', () => chestLid(SMALL_CHEST, SMALL_LOOK, false));
}

/** The big chest's lid. */
export function buildBigLid(scene: Scene): Mesh {
  return kitMesh(scene, 'cellar-big-chest-lid', () => chestLid(BIG_CHEST, BIG_LOOK, true));
}

/** Where a lid's hinge sits on its chest (local, world units): the back of the top. */
export function hingeOf(big: boolean): { y: number; z: number } {
  const c = big ? BIG_CHEST : SMALL_CHEST;
  return { y: c.height + 0.06, z: c.depth / 2 };
}
