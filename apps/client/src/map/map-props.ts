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

/** Sphere segments by diameter (world units). TUNE */
export function sphereSegments(diameter: number): number {
  if (diameter >= 0.25) return 10;
  if (diameter >= 0.18) return 7;
  if (diameter >= 0.08) return 5;
  return 3;
}

/** A built prop: its mesh, and its contact shadow's diameter (0: none, e.g. on water). */
export interface BuiltProp {
  mesh: Mesh;
  shadow: number;
}

/** Procedural vinyl-toy props (design doc §19), one mesh per kind. */
export function buildProp(scene: Scene, kind: PropKind): BuiltProp {
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
    CreateSphere(`${kind}-part`, { diameter: d, segments: sphereSegments(d) }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 10) =>
    CreateCylinder(
      `${kind}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
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
    case 'leaf-pile':
      // A crunchy heap of autumn leaves, with a few on top.
      return done(
        [
          painted(at(sphere(0.3), 0, 0.03, 0, 1.2, 0.42, 1.1), '#e8913a'),
          painted(at(sphere(0.18), -0.07, 0.08, 0.03, 1, 0.5, 1), '#d9542f'),
          painted(at(sphere(0.16), 0.08, 0.08, -0.03, 1, 0.5, 1), '#f2c14e'),
          painted(at(sphere(0.12), 0.01, 0.12, 0.06, 1.3, 0.3, 0.8, { y: 0.6 }), '#c4562e'),
          painted(at(sphere(0.1), -0.02, 0.14, -0.05, 1.4, 0.3, 0.7, { y: -0.4 }), '#ffd166'),
        ],
        0.22,
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
