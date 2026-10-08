import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged, painted } from './map-props.js';

// Fence segments (#203, the owner-approved second mockup): one look per
// material and level, built from a few primitives, painted with vertex
// colours and merged into one mesh. Every segment is the same length (a hex
// edge), so each look is built once, at that length, and drawn with thin
// instances along every edge that has one. Local space: the segment runs
// along x from -length/2 to +length/2 on the ground (y = 0); +z is the
// tile's side.

/** The looks this client draws; an unknown fence id falls back to the Palisade's. */
export type FenceLook =
  | 'hedge'
  | 'moat'
  | 'stone-wall'
  | 'emberwood-palisade'
  | 'glimmer-rail'
  | 'lantern-fence'
  | 'bramble-hedge'
  | 'ice-wall';

const LOOKS: ReadonlySet<string> = new Set<FenceLook>([
  'hedge',
  'moat',
  'stone-wall',
  'emberwood-palisade',
  'glimmer-rail',
  'lantern-fence',
  'bramble-hedge',
  'ice-wall',
]);

export function fenceLook(buildingId: string): FenceLook {
  return LOOKS.has(buildingId) ? (buildingId as FenceLook) : 'emberwood-palisade';
}

/**
 * One fence look at `level` (1–3; higher levels add pieces), `length` world
 * units long. TUNE: every size and colour.
 */
export function buildFence(scene: Scene, buildingId: string, level: number, length: number): Mesh {
  const look = fenceLook(buildingId);
  const lv = Math.max(1, Math.min(3, Math.round(level)));
  const name = `fence-${look}-${String(lv)}`;
  /** This level's value from a level 1–3 list. */
  const byLevel = <T>(values: readonly [T, T, T]): T => values[lv - 1] ?? values[0];
  const half = length / 2;
  const parts: Mesh[] = [];
  const at = (
    m: Mesh,
    x: number,
    y: number,
    z: number,
    turn?: { x?: number; y?: number; z?: number },
  ): Mesh => {
    m.position.set(x, y, z);
    if (turn) m.rotation.set(turn.x ?? 0, turn.y ?? 0, turn.z ?? 0);
    return m;
  };
  const add = (m: Mesh, color: string) => parts.push(painted(m, color));
  const box = (w: number, h: number, d: number) =>
    CreateBox(`${name}-part`, { width: w, height: h, depth: d }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 6) =>
    CreateCylinder(
      `${name}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
      scene,
    );
  // Icospheres keep a border of many segments cheap: 20 triangles for a bead,
  // 80 for a bush.
  const sphere = (d: number) =>
    CreateIcoSphere(`${name}-part`, { radius: d / 2, subdivisions: d < 0.08 ? 1 : 2 }, scene);
  /** `n` evenly spaced points along the segment, ends included. */
  const along = (n: number) => Array.from({ length: n }, (_, i) => -half + (length * i) / (n - 1));
  /** A rail: a long thin box at height `y`. */
  const rail = (y: number, color: string, thick = 0.022) =>
    add(at(box(length, thick, thick), 0, y, 0), color);
  /** Wooden posts at `xs`, `h` tall. */
  const posts = (xs: readonly number[], h: number, color: string, d = 0.04) => {
    for (const x of xs) add(at(cylinder(h, d, d * 1.1), x, h / 2, 0), color);
  };

  switch (look) {
    case 'emberwood-palisade': {
      // Rounded log stakes; rope bands at level 2; ember lamps at level 3.
      const h = byLevel([0.13, 0.15, 0.17]);
      for (const x of along(9)) {
        add(at(cylinder(h, 0.034, 0.038), x, h / 2, 0), '#a8693a');
        add(at(sphere(0.036), x, h, 0), '#b9784a');
      }
      if (lv >= 2) {
        rail(h * 0.35, '#e9d4a6', 0.016);
        rail(h * 0.7, '#e9d4a6', 0.016);
      }
      if (lv === 3) for (const x of along(3)) add(at(sphere(0.05), x, h + 0.04, 0), '#ffb14a');
      break;
    }
    case 'stone-wall': {
      // Stacked round stones; cap stones at level 2; Glimmer studs at level 3.
      const rows = lv === 1 ? 2 : 3;
      const rowH = 0.045;
      for (let row = 0; row < rows; row++) {
        const xs = along(row % 2 === 0 ? 5 : 4);
        xs.forEach((x, i) => {
          const w = length / (row % 2 === 0 ? 4.4 : 3.4);
          add(
            at(box(w, rowH, 0.08), x, rowH / 2 + row * rowH, 0),
            (i + row) % 2 ? '#a19bab' : '#b8b2c2',
          );
        });
      }
      if (lv >= 2) add(at(box(length + 0.02, 0.02, 0.095), 0, rows * rowH + 0.01, 0), '#8e8899');
      if (lv === 3)
        for (const x of along(4)) add(at(sphere(0.03), x, rows * rowH + 0.03, 0), '#ffe76a');
      break;
    }
    case 'hedge': {
      // A leafy row; flowers at level 2; topiary balls and berries at level 3.
      const h = byLevel([0.1, 0.13, 0.15]);
      for (const x of along(6)) {
        const ball = at(sphere(0.12), x, h * 0.55, 0);
        ball.scaling.set(1, h / 0.1, 0.9);
        add(ball, byLevel(['#5fa05c', '#4f9a52', '#3f8c4a']));
      }
      if (lv >= 2)
        for (const x of along(5)) add(at(sphere(0.026), x + 0.03, h * 0.9, 0.04), '#fff6a8');
      if (lv === 3) {
        for (const x of along(3)) add(at(sphere(0.07), x, h + 0.04, 0), '#3f8c4a');
        for (const x of along(4)) add(at(sphere(0.024), x, h + 0.02, -0.04), '#c9a7ff');
      }
      break;
    }
    case 'moat': {
      // A shallow channel; stone banks and lily pads at level 2; a fountain at 3.
      const w = byLevel([0.07, 0.09, 0.12]);
      add(at(box(length, 0.022, w), 0, 0.012, 0), '#6fb6e8');
      add(at(box(length * 0.9, 0.024, w * 0.4), 0, 0.014, -w * 0.15), '#a8dcff');
      if (lv >= 2) {
        add(at(box(length, 0.03, 0.025), 0, 0.015, w / 2 + 0.012), '#b9b3c2');
        add(at(box(length, 0.03, 0.025), 0, 0.015, -w / 2 - 0.012), '#b9b3c2');
        for (const x of along(3))
          add(at(cylinder(0.008, 0.045, 0.045, 7), x * 0.8, 0.026, 0.01), '#5fa05c');
      }
      if (lv === 3) {
        add(at(cylinder(0.04, 0.035, 0.045, 7), 0, 0.03, 0), '#e8f6ff');
        add(at(sphere(0.03), 0, 0.07, 0), '#ffffff');
      }
      break;
    }
    case 'glimmer-rail': {
      // A rail with Glimmer studs; a second rail at level 2; sparks at level 3.
      const xs = along(4);
      posts(xs, 0.13, '#9a6234', 0.034);
      rail(0.09, '#b07a46');
      if (lv >= 2) rail(0.045, '#b07a46');
      for (const x of xs) add(at(sphere(0.034), x, 0.14, 0), '#ffe76a');
      if (lv === 3) for (const x of along(7)) add(at(sphere(0.022), x, 0.11, 0), '#fff27a');
      break;
    }
    case 'lantern-fence': {
      // Posts with lanterns; fairy lights at level 2; big lanterns at level 3.
      const xs = along(4);
      posts(xs, 0.14, '#7a4a24', 0.03);
      rail(0.08, '#8b5a30', 0.018);
      const lamp = lv === 3 ? 0.06 : 0.045;
      for (const x of xs) add(at(box(lamp, lamp * 1.2, lamp), x, 0.14 + lamp * 0.6, 0), '#ffd96a');
      if (lv >= 2) {
        along(9).forEach((x, i) => {
          if (i % 3 === 0) return;
          add(at(sphere(0.02), x, 0.11, 0), ['#ffe76a', '#ffb3d9', '#a8dcff'][i % 3] ?? '#ffe76a');
        });
      }
      break;
    }
    case 'bramble-hedge': {
      // A tangle of purple brambles; curly twigs at level 2; blossoms at level 3.
      const h = byLevel([0.09, 0.11, 0.12]);
      along(8).forEach((x, i) => {
        const tilt = i % 2 === 0 ? 0.5 : -0.5;
        add(at(cylinder(h * 1.3, 0.012, 0.026, 5), x, h * 0.55, 0, { z: tilt }), '#5d3f7a');
      });
      const body = at(box(length, h * 0.6, 0.07), 0, h * 0.3, 0);
      add(body, '#6b4890');
      if (lv >= 2) {
        along(6).forEach((x, i) =>
          add(
            at(cylinder(0.07, 0.008, 0.014, 4), x, h * 0.85, 0, { z: i % 2 ? 0.9 : -0.9 }),
            '#8f6bb8',
          ),
        );
      }
      if (lv === 3) for (const x of along(5)) add(at(sphere(0.03), x, h + 0.015, 0), '#d7a8ff');
      break;
    }
    case 'ice-wall': {
      // Chunky ice blocks; icicles at level 2; crystal spires at level 3.
      const h = byLevel([0.1, 0.12, 0.14]);
      along(5).forEach((x, i) =>
        add(at(box(length / 4.6, h, 0.08), x * 0.92, h / 2, 0), i % 2 ? '#bfe6ff' : '#d8f0ff'),
      );
      if (lv >= 2) {
        for (const x of along(7)) {
          add(at(cylinder(0.04, 0.018, 0, 4), x * 0.9, h - 0.015, 0.042), '#e9f8ff');
        }
      }
      if (lv === 3)
        for (const x of along(3))
          add(at(cylinder(0.09, 0, 0.05, 5), x * 0.8, h + 0.045, 0), '#a8dcff');
      break;
    }
  }
  return merged(name, parts);
}
