import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { PropKind } from './map-config.js';

// Procedural vinyl-toy props for the map (design doc §19): every kind is a
// few primitives, painted with vertex colours and merged into one mesh, so a
// kind is one draw call however many tiles it grows on. Re-exported from
// map-scene.ts, where they started.

export function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

/** Paints a builder mesh one colour (for merging parts into one vertex-coloured mesh). */
export function painted(mesh: Mesh, hex: string): Mesh {
  const c = linear(hex);
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

export function merged(name: string, parts: Mesh[]): Mesh {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  if (!mesh) throw new Error(`could not build ${name}`);
  mesh.name = name;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/**
 * How finely a prop is built (#318): `high` near the camera, `low` for the
 * zoomed-out map, where a prop is a few pixels across.
 */
export type PropDetail = 'high' | 'low';

/** Sphere segments by diameter (world units). TUNE */
export function sphereSegments(diameter: number, detail: PropDetail = 'high'): number {
  const segments = diameter >= 0.25 ? 10 : diameter >= 0.18 ? 7 : diameter >= 0.08 ? 5 : 3;
  return detail === 'high' ? segments : Math.max(2, Math.ceil(segments / 2)); // TUNE
}

/** Round parts' sides at low detail (#318), as a share of the high-detail count. TUNE */
const LOW_TESSELLATION = 0.6;

/** A built prop: its mesh, and its contact shadow's diameter (0: none, e.g. on water). */
export interface BuiltProp {
  mesh: Mesh;
  shadow: number;
}

/** Procedural vinyl-toy props (design doc §19), one mesh per kind. */
export function buildProp(scene: Scene, kind: PropKind, detail: PropDetail = 'high'): BuiltProp {
  const at = (
    m: Mesh,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    turn?: { x?: number; y?: number; z?: number },
  ): Mesh => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    if (turn) m.rotation.set(turn.x ?? 0, turn.y ?? 0, turn.z ?? 0);
    return m;
  };
  // Fewer segments for smaller parts: a tiny bloom drawn on hundreds of
  // tiles needn't be as round as a canopy (triangles cost on mobile GPUs).
  const sphere = (d: number) =>
    CreateSphere(`${kind}-part`, { diameter: d, segments: sphereSegments(d, detail) }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 10) =>
    CreateCylinder(
      `${kind}-part`,
      {
        height: h,
        diameterTop: top,
        diameterBottom: bottom,
        tessellation:
          detail === 'high'
            ? tessellation
            : Math.max(4, Math.round(tessellation * LOW_TESSELLATION)),
      },
      scene,
    );
  const box = (w: number, h: number, d: number) =>
    CreateBox(`${kind}-part`, { width: w, height: h, depth: d }, scene);
  const done = (parts: Mesh[], shadow: number): BuiltProp => ({
    mesh: merged(kind, parts),
    shadow,
  });
  // TUNE: every size and colour below.
  switch (kind) {
    case 'tree':
      return done(
        [
          painted(at(cylinder(0.18, 0.05, 0.07), 0, 0.09, 0), '#b98a6a'),
          painted(at(sphere(0.28), 0, 0.28, 0, 1, 1.1, 1), '#6cc58a'),
        ],
        0.2,
      );
    case 'old-tree':
      return done(
        [
          painted(at(cylinder(0.24, 0.06, 0.09), 0, 0.12, 0), '#9c7258'),
          painted(at(sphere(0.34), 0, 0.33, 0), '#4f9a72'),
          painted(at(sphere(0.22), 0, 0.5, 0), '#5aa87e'),
        ],
        0.24,
      );
    case 'rock':
      return done([painted(at(sphere(0.22), 0, 0.05, 0, 1.25, 0.7, 1), '#cbbfae')], 0.18);
    case 'peak':
      return done(
        [
          painted(at(cylinder(0.4, 0.06, 0.42), 0, 0.2, 0), '#a99cc4'),
          painted(at(sphere(0.12), 0, 0.39, 0, 1, 0.7, 1), '#ffffff'),
        ],
        0.28,
      );
    case 'pumpkin':
      return done(
        [
          painted(at(sphere(0.18), 0, 0.07, 0, 1.25, 0.8, 1.25), '#ff9a3c'),
          painted(at(cylinder(0.06, 0.02, 0.03), 0, 0.15, 0), '#6aa84f'),
        ],
        0.16,
      );
    case 'pine':
      return done(
        [
          painted(at(cylinder(0.1, 0.04, 0.05), 0, 0.05, 0), '#a8795c'),
          painted(at(cylinder(0.2, 0, 0.3), 0, 0.18, 0), '#4fae7d'),
          painted(at(cylinder(0.17, 0, 0.23), 0, 0.29, 0), '#5bbd88'),
          painted(at(cylinder(0.14, 0, 0.15), 0, 0.4, 0), '#6bcb94'),
        ],
        0.2,
      );
    case 'tall-tree':
      return done(
        [
          painted(at(cylinder(0.28, 0.045, 0.065), 0, 0.14, 0), '#c0916e'),
          painted(at(sphere(0.22), 0, 0.42, 0, 1, 1.55, 1), '#86d27c'),
          painted(at(sphere(0.12), 0.06, 0.32, 0.04), '#79c873'),
        ],
        0.18,
      );
    case 'stump':
      return done(
        [
          painted(at(cylinder(0.08, 0.13, 0.15), 0, 0.04, 0), '#b98a6a'),
          painted(at(cylinder(0.012, 0.11, 0.11), 0, 0.083, 0), '#ecd0a6'),
          painted(at(sphere(0.04), 0.07, 0.02, 0.03, 1, 0.5, 1), '#7fcf8a'),
        ],
        0.16,
      );
    case 'log':
      return done(
        [
          painted(
            at(cylinder(0.3, 0.09, 0.09), 0, 0.045, 0, 1, 1, 1, { z: Math.PI / 2 }),
            '#a77d5f',
          ),
          painted(
            at(cylinder(0.31, 0.07, 0.07), 0, 0.045, 0, 1, 1, 1, { z: Math.PI / 2 }),
            '#e3c39c',
          ),
          painted(at(sphere(0.05), 0.05, 0.1, 0.01, 1, 0.55, 1), '#ff8f9c'),
          painted(at(cylinder(0.03, 0.012, 0.016), 0.05, 0.08, 0.01), '#fff4e6'),
        ],
        0.22,
      );
    case 'bush':
      return done(
        [
          painted(at(sphere(0.16), 0, 0.07, 0), '#6fc47f'),
          painted(at(sphere(0.13), 0.07, 0.06, 0.03), '#7dd08a'),
          painted(at(sphere(0.12), -0.06, 0.055, -0.02), '#74c985'),
          painted(at(sphere(0.03), 0.03, 0.13, 0.05), '#ff7fa8'),
          painted(at(sphere(0.03), -0.05, 0.1, 0.05), '#ff7fa8'),
        ],
        0.2,
      );
    case 'grass': {
      const blades: Mesh[] = [];
      const lean = 0.28;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const h = 0.11 + 0.03 * ((i * 7) % 3);
        blades.push(
          painted(
            at(cylinder(h, 0, 0.035, 5), Math.cos(a) * 0.025, h / 2, Math.sin(a) * 0.025, 1, 1, 1, {
              x: Math.sin(a) * lean,
              z: -Math.cos(a) * lean,
            }),
            i % 2 === 0 ? '#8fd47a' : '#7cc56c',
          ),
        );
      }
      return done(blades, 0.1);
    }
    case 'flowers': {
      const parts: Mesh[] = [];
      const blooms = ['#ff9fc6', '#ffe27a', '#c9a7ff'];
      blooms.forEach((color, i) => {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const x = Math.cos(a) * 0.045;
        const z = Math.sin(a) * 0.045;
        const h = 0.09 + 0.025 * i;
        parts.push(painted(at(cylinder(h, 0.01, 0.012, 5), x, h / 2, z), '#7cc56c'));
        // Blooms are seen from above: a soft disc and a dot read as a flower.
        parts.push(painted(at(cylinder(0.018, 0.065, 0.05, 7), x, h, z), color));
        parts.push(painted(at(cylinder(0.012, 0.022, 0.022, 5), x, h + 0.012, z), '#fff6d8'));
      });
      parts.push(painted(at(cylinder(0.012, 0.09, 0.1, 7), 0, 0.006, 0), '#86d27c'));
      return done(parts, 0.12);
    }
    case 'mushroom':
      return done(
        [
          painted(at(cylinder(0.06, 0.035, 0.045), 0, 0.03, 0), '#fff4e6'),
          painted(at(sphere(0.11), 0, 0.065, 0, 1, 0.6, 1), '#ff6f7d'),
          painted(at(sphere(0.022), 0.025, 0.09, 0.01), '#ffffff'),
          painted(at(sphere(0.02), -0.02, 0.088, 0.025), '#ffffff'),
        ],
        0.09,
      );
    case 'lily-pad':
      return done(
        [
          painted(at(cylinder(0.012, 0.17, 0.17, 14), 0, 0.006, 0), '#7fcf8a'),
          painted(at(cylinder(0.012, 0.1, 0.1, 12), 0.12, 0.004, 0.06), '#8fd994'),
          painted(at(sphere(0.045), 0.03, 0.025, 0.02, 1, 0.8, 1), '#ffb3d1'),
          painted(at(sphere(0.02), 0.03, 0.04, 0.02), '#fff1a8'),
        ],
        0,
      );
    case 'reeds': {
      const parts: Mesh[] = [];
      const spots = [
        [0, 0, 0.3],
        [0.04, 0.03, 0.24],
        [-0.035, 0.025, 0.27],
        [0.01, -0.04, 0.2],
      ] as const;
      spots.forEach(([x, z, h], i) => {
        parts.push(painted(at(cylinder(h, 0.012, 0.018, 5), x, h / 2, z), '#7fbf6a'));
        if (i < 3)
          parts.push(painted(at(cylinder(0.06, 0.028, 0.028, 8), x, h - 0.02, z), '#9a6a4a'));
      });
      return done(parts, 0.1);
    }
    case 'stones':
      return done(
        [
          painted(at(sphere(0.11), 0, 0.01, 0, 1, 0.45, 1), '#ddd6cc'),
          painted(at(sphere(0.09), 0.1, 0.008, 0.06, 1, 0.45, 1), '#cfc6ba'),
          painted(at(sphere(0.08), -0.08, 0.008, 0.08, 1, 0.45, 1), '#e4ddd2'),
        ],
        0,
      );
    case 'dock':
      // Built along +z from the middle, so its turn points it out over the water.
      return done(
        [
          painted(at(box(0.13, 0.022, 0.26), 0, 0.035, 0.08), '#c99a6e'),
          painted(at(box(0.135, 0.024, 0.02), 0, 0.036, 0.0), '#b3845c'),
          painted(at(box(0.135, 0.024, 0.02), 0, 0.036, 0.1), '#b3845c'),
          painted(at(cylinder(0.08, 0.025, 0.025, 8), 0.055, 0.02, 0.2), '#a77d5f'),
          painted(at(cylinder(0.08, 0.025, 0.025, 8), -0.055, 0.02, 0.2), '#a77d5f'),
        ],
        0,
      );
    case 'snow-peak':
      return done(
        [
          painted(at(cylinder(0.48, 0.06, 0.46), 0, 0.24, 0), '#b3a6cf'),
          painted(at(cylinder(0.16, 0.05, 0.21), 0, 0.4, 0), '#ffffff'),
          painted(at(sphere(0.08), 0, 0.48, 0, 1, 0.6, 1), '#ffffff'),
        ],
        0.3,
      );
    case 'crystal': {
      const parts: Mesh[] = [];
      const shards = [
        [0, 0, 0.18, 0, '#e7c8ff'],
        [0.045, 0.02, 0.12, 0.35, '#c8b8ff'],
        [-0.04, 0.025, 0.1, -0.4, '#ffd6f5'],
      ] as const;
      for (const [x, z, h, tilt, color] of shards) {
        parts.push(
          painted(at(cylinder(h, 0.05, 0.06, 6), x, h / 2, z, 1, 1, 1, { z: tilt }), color),
        );
        parts.push(
          painted(
            at(cylinder(0.05, 0, 0.05, 6), x - Math.sin(tilt) * h, h + 0.02, z, 1, 1, 1, {
              z: tilt,
            }),
            color,
          ),
        );
      }
      return done(parts, 0.12);
    }
    case 'well':
      // A little wooden well with a pink roof and a bucket (#238). Few
      // segments: there's one on every lake.
      return done(
        [
          painted(at(cylinder(0.1, 0.2, 0.22, 6), 0, 0.05, 0), '#b8b2c2'),
          painted(at(cylinder(0.012, 0.15, 0.15, 6), 0, 0.1, 0), '#6fb6e8'),
          painted(at(box(0.03, 0.22, 0.03), -0.09, 0.2, 0), '#9a6234'),
          painted(at(box(0.03, 0.22, 0.03), 0.09, 0.2, 0), '#9a6234'),
          painted(
            at(cylinder(0.12, 0, 0.3, 4), 0, 0.36, 0, 1, 1, 0.75, { y: Math.PI / 4 }),
            '#d0628f',
          ),
          painted(at(box(0.05, 0.05, 0.05), 0, 0.2, 0), '#d39a5c'),
        ],
        0, // its stone base sits on the ground
      );
    case 'greens-patch': {
      // A leafy mound with grass tufts and a clover (#238). Three-sided
      // blades and few segments, so a forest full of them stays cheap.
      const parts: Mesh[] = [painted(at(cylinder(0.05, 0.24, 0.32, 6), 0, 0.02, 0), '#6fbf63')];
      const tufts = [
        [-0.08, 0.04, 1],
        [0.07, 0.05, 1.2],
        [0.01, -0.08, 1.05],
      ] as const;
      for (const [tx, tz, size] of tufts) {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + tx * 10;
          const h = 0.17 * size;
          parts.push(
            painted(
              at(
                cylinder(h, 0, 0.06, 3),
                tx + Math.cos(a) * 0.02,
                0.03 + h / 2,
                tz + Math.sin(a) * 0.02,
                1,
                1,
                1,
                {
                  x: Math.sin(a) * 0.4,
                  z: -Math.cos(a) * 0.4,
                },
              ),
              i % 2 === 0 ? '#4f9a52' : '#5fae5c',
            ),
          );
        }
      }
      // A clover: three flat leaves.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        parts.push(
          painted(
            at(
              cylinder(0.02, 0.07, 0.07, 5),
              0.09 + Math.cos(a) * 0.035,
              0.055,
              -0.06 + Math.sin(a) * 0.035,
            ),
            '#8fd47a',
          ),
        );
      }
      return done(parts, 0); // the mound is its own footing
    }
    case 'ice-crystals': {
      // A cluster of icy blue spires (#238), cooler than Glimmer's pink crystal.
      const parts: Mesh[] = [];
      const shards = [
        [0, 0, 0.34, 0, '#bfe6ff'],
        [0.08, 0.04, 0.24, 0.3, '#d8f0ff'],
        [-0.08, 0.03, 0.2, -0.35, '#a8dcff'],
      ] as const;
      for (const [x, z, h, tilt, color] of shards) {
        parts.push(
          painted(at(cylinder(h, 0.08, 0.09, 5), x, h / 2, z, 1, 1, 1, { z: tilt }), color),
        );
        parts.push(
          painted(
            at(cylinder(0.09, 0, 0.08, 5), x - Math.sin(tilt) * h, h + 0.04, z, 1, 1, 1, {
              z: tilt,
            }),
            color,
          ),
        );
      }
      return done(parts, 0.16);
    }
    case 'hay-bale':
      return done(
        [
          painted(
            at(cylinder(0.16, 0.14, 0.14, 14), 0, 0.07, 0, 1, 1, 1, { z: Math.PI / 2 }),
            '#f0d27a',
          ),
          painted(
            at(cylinder(0.015, 0.145, 0.145, 14), 0.04, 0.07, 0, 1, 1, 1, { z: Math.PI / 2 }),
            '#d9b45c',
          ),
          painted(
            at(cylinder(0.015, 0.145, 0.145, 14), -0.04, 0.07, 0, 1, 1, 1, { z: Math.PI / 2 }),
            '#d9b45c',
          ),
        ],
        0.18,
      );
    case 'pumpkin-patch':
      // A big carved pumpkin with two little ones, so it reads apart from the farm plot.
      return done(
        [
          painted(at(sphere(0.26), 0, 0.1, 0, 1.25, 0.82, 1.25), '#ff8a2a'),
          painted(at(cylinder(0.08, 0.025, 0.04), 0, 0.22, 0), '#5f9a46'),
          painted(
            at(cylinder(0.014, 0.06, 0.06, 3), -0.06, 0.13, 0.155, 1, 1, 1, { x: Math.PI / 2 }),
            '#ffe08a',
          ),
          painted(
            at(cylinder(0.014, 0.06, 0.06, 3), 0.06, 0.13, 0.155, 1, 1, 1, { x: Math.PI / 2 }),
            '#ffe08a',
          ),
          painted(at(sphere(0.13), 0, 0.07, 0.148, 1, 0.32, 0.25), '#ffe08a'),
          painted(at(sphere(0.13), 0.2, 0.05, -0.08, 1.2, 0.8, 1.2), '#ffa64d'),
          painted(at(sphere(0.11), -0.19, 0.04, -0.1, 1.2, 0.8, 1.2), '#ff9a3c'),
          painted(at(sphere(0.1), 0.05, 0.02, 0.2, 1.6, 0.25, 0.9, { y: 0.5 }), '#6aa84f'),
        ],
        0.3,
      );
    case 'leaf-pile': {
      // A heap of autumn leaves (owner: it must read as leaves, not a pie):
      // a low mound under real leaf shapes, maple (three fanned lobes and a
      // stem) and oak (a long leaf with round bumps), and a few loose ones
      // blown off around the base. Leaves are flattened spheres, so this is
      // still one merged, vertex-coloured mesh.
      const flat = (
        d: number,
        x: number,
        y: number,
        z: number,
        w: number,
        l: number,
        yaw: number,
        tilt: number,
      ) => at(sphere(d), x, y, z, w, 0.12, l, { x: tilt, y: yaw });
      // A maple leaf: a round palm with five pointed lobes fanned around it, and a short stem.
      const maple = (
        x: number,
        y: number,
        z: number,
        yaw: number,
        tilt: number,
        size: number,
        color: string,
      ): Mesh[] => [
        painted(flat(size * 0.5, x, y, z, 1, 1, yaw, tilt), color),
        ...[-1.2, -0.6, 0, 0.6, 1.2].map((a) =>
          painted(
            flat(
              size * 0.7,
              x + Math.sin(yaw + a) * size * 0.28,
              y,
              z + Math.cos(yaw + a) * size * 0.28,
              0.34,
              a === 0 ? 1.15 : Math.abs(a) > 1 ? 0.8 : 1,
              yaw + a,
              tilt,
            ),
            color,
          ),
        ),
        painted(
          at(
            cylinder(size * 0.3, 0.008, 0.008, 4),
            x - Math.sin(yaw) * size * 0.3,
            y,
            z - Math.cos(yaw) * size * 0.3,
            1,
            1,
            1,
            { x: Math.PI / 2, y: yaw },
          ),
          '#8a5530',
        ),
      ];
      const oak = (
        x: number,
        y: number,
        z: number,
        yaw: number,
        tilt: number,
        size: number,
        color: string,
      ): Mesh[] => [
        painted(flat(size, x, y, z, 0.42, 1, yaw, tilt), color),
        ...[-1, 1].flatMap((side) =>
          [-0.18, 0.14].map((along) =>
            painted(
              flat(
                size * 0.36,
                x + Math.sin(yaw) * size * along + Math.cos(yaw) * side * size * 0.2,
                y,
                z + Math.cos(yaw) * size * along - Math.sin(yaw) * side * size * 0.2,
                1,
                1,
                yaw,
                tilt,
              ),
              color,
            ),
          ),
        ),
      ];
      return done(
        [
          // The mound is mostly hidden: leaves sit on it in layers.
          painted(at(sphere(0.28), 0, 0.02, 0, 1.15, 0.34, 1.05), '#a85a2a'),
          ...maple(-0.08, 0.05, 0.08, 0.4, -0.35, 0.17, '#d9442b'),
          ...oak(0.1, 0.05, 0.07, 2.4, -0.3, 0.16, '#e2a33a'),
          ...maple(0.11, 0.05, -0.07, 2.2, 0.3, 0.16, '#f08a2e'),
          ...oak(-0.1, 0.05, -0.08, 5.2, 0.35, 0.15, '#b8742f'),
          ...maple(0.0, 0.085, -0.02, 1.2, 0.05, 0.17, '#f4c04a'),
          ...maple(-0.03, 0.1, 0.05, 3.6, -0.1, 0.15, '#e05a2a'),
          ...oak(0.05, 0.1, 0.0, 0.3, 0.1, 0.14, '#d9442b'),
          ...maple(0.03, 0.115, -0.04, 5.4, 0.1, 0.13, '#ffb43c'),
          ...maple(0.0, 0.035, 0.15, 0.1, -0.5, 0.15, '#f08a2e'),
          ...oak(0.02, 0.035, -0.15, 3.2, 0.5, 0.14, '#d9442b'),
          // Loose leaves blown off around the base.
          ...maple(0.28, 0.006, 0.12, 0.9, 0, 0.13, '#d9442b'),
          ...oak(-0.27, 0.006, 0.1, 2.6, 0, 0.12, '#f4c04a'),
          ...maple(-0.12, 0.006, -0.27, 5.0, 0, 0.12, '#f08a2e'),
          ...oak(0.18, 0.006, -0.24, 3.8, 0, 0.11, '#b8742f'),
        ],
        0.26,
      );
    }
    case 'trading-post':
      // The trading post's hut (#269): cream walls, a plum roof, a pink door,
      // a signpost with a heart and a lantern on a pole. One per post, four a
      // map, so a few more parts than most props are fine.
      return done(
        [
          painted(at(box(0.27, 0.18, 0.22), 0, 0.09, 0), '#f6d7a8'),
          painted(
            at(cylinder(0.15, 0, 0.36, 4), 0, 0.255, 0, 1, 1, 0.82, { y: Math.PI / 4 }),
            '#7a2d55',
          ),
          painted(at(box(0.075, 0.11, 0.012), 0, 0.055, 0.112), '#b8487a'),
          painted(at(box(0.02, 0.2, 0.02), 0.2, 0.1, 0.06), '#8a5a3a'),
          painted(at(box(0.13, 0.065, 0.016), 0.2, 0.2, 0.06), '#fff8ec'),
          painted(at(sphere(0.035), 0.2, 0.2, 0.072, 1, 1, 0.4), '#ff6f9f'),
          painted(at(box(0.018, 0.2, 0.018), -0.19, 0.1, 0.07), '#8a5a3a'),
          painted(at(sphere(0.06), -0.19, 0.215, 0.07), '#ffc94d'),
        ],
        0.36,
      );
    case 'jack-o-lantern':
      // A grinning pumpkin; its material glows (brighter at night).
      return done(
        [
          painted(at(sphere(0.2), 0, 0.08, 0, 1.25, 0.82, 1.25), '#ff8a2a'),
          painted(at(cylinder(0.06, 0.02, 0.03), 0, 0.17, 0), '#5f9a46'),
          painted(
            at(cylinder(0.012, 0.045, 0.045, 3), -0.045, 0.1, 0.118, 1, 1, 1, { x: Math.PI / 2 }),
            '#ffe08a',
          ),
          painted(
            at(cylinder(0.012, 0.045, 0.045, 3), 0.045, 0.1, 0.118, 1, 1, 1, { x: Math.PI / 2 }),
            '#ffe08a',
          ),
          painted(at(sphere(0.1), 0, 0.055, 0.112, 1, 0.32, 0.25), '#ffe08a'),
        ],
        0.18,
      );
  }
}

/**
 * The wild-squishy marker (#209): a rustling tuft of three glossy leaves on a
 * soft cream disc, so it reads on any terrain. Every tuft is the same (no
 * species, CLAUDE.md rule 6); one merged mesh, drawn with thin instances.
 * About 0.26 tall before `WILD_MARKER.scale`. TUNE: every size and colour.
 */
export function buildWildTuft(scene: Scene): Mesh {
  const leaf = (height: number, lean: number, turn: number, hex: string): Mesh => {
    const m = CreateSphere('wild-tuft-leaf', { diameter: 1, segments: 6 }, scene);
    m.scaling.set(0.07, height, 0.035);
    m.position.y = height / 2;
    m.bakeCurrentTransformIntoVertices();
    // Pivots at its base now: lean out from the middle, so the leaves fan open.
    m.rotation.set(0, turn, lean);
    return painted(m, hex);
  };
  const disc = CreateCylinder(
    'wild-tuft-disc',
    { height: 0.014, diameter: 0.26, tessellation: 16 },
    scene,
  );
  disc.position.y = 0.007;
  return merged('wild-tuft', [
    painted(disc, '#fff4dc'),
    leaf(0.26, 0, 0, '#8fcf7a'),
    leaf(0.2, 0.55, 0.35, '#78b866'),
    leaf(0.2, -0.55, -0.35, '#78b866'),
  ]);
}
