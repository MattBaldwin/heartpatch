import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import { WATER_COLORS } from './lake-config.js';

// The lake's shapes on the meadow's kit (#335 art reset): the same
// vinyl-toy language (smooth icospheres, a darker foot rising to a sunlit
// tip, baked into vertex colours), thin-instanced, one draw call a kind,
// world units with the foot at the origin. Only what the meadow doesn't
// have: kelp, coral, a fish, a bubble, and the two lake search spots.

type Part = Mesh;

// TEMPORARY copies of land-kit.ts's private helpers, until the meadow lane
// exports them (the coordinator's plan); then these go and this imports them.
const srgb = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

function shaded(mesh: Part, bottom: string, top: string, y0: number, y1: number): Part {
  mesh.bakeCurrentTransformIntoVertices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const a = srgb(bottom);
  const b = srgb(top);
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1] ?? 0;
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
    const k = t * t * (3 - 2 * t);
    colors.set([a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, 1], i * 4);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

const flat = (mesh: Part, hex: string): Part => shaded(mesh, hex, hex, 0, 1);

function sphere(
  scene: Scene,
  d: number,
  segments: number,
  at: [number, number, number],
  s: [number, number, number] = [1, 1, 1],
): Part {
  const subdivisions = segments <= 4 ? 1 : segments <= 6 ? 2 : segments <= 8 ? 3 : 4;
  const m = CreateIcoSphere('kit', { radius: d / 2, subdivisions, flat: false }, scene);
  m.position.set(...at);
  m.scaling.set(...s);
  return m;
}

function cylinder(
  scene: Scene,
  h: number,
  top: number,
  bottom: number,
  tessellation: number,
  at: [number, number, number],
  tilt: [number, number, number] = [0, 0, 0],
): Part {
  const m = CreateCylinder(
    'kit',
    { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
    scene,
  );
  m.position.set(...at);
  m.rotation.set(...tilt);
  return m;
}

/**
 * A kelp clump: three tapering, leaning stalks of flattened blobs, each with
 * a little float bulb at the tip, 1.3 to 2.1 tall. Sways from its tip on the
 * terrain plugin.
 */
export function buildKelp(scene: Scene): Mesh {
  const parts: Part[] = [];
  const stalks: { height: number; lean: [number, number]; at: [number, number] }[] = [
    { height: 2.1, lean: [0.18, 0.05], at: [0, 0] },
    { height: 1.7, lean: [-0.15, 0.12], at: [0.22, 0.1] },
    { height: 1.3, lean: [0.05, -0.16], at: [-0.2, -0.08] },
  ];
  stalks.forEach(({ height, lean, at }, i) => {
    const [foot, tip] = WATER_COLORS.kelp[i % WATER_COLORS.kelp.length] ?? ['#2c7f66', '#6fd09a'];
    const links = 5;
    for (let k = 0; k < links; k++) {
      const t = k / (links - 1);
      const y = 0.1 + t * (height - 0.2);
      const d = 0.3 - t * 0.14;
      const blob = sphere(
        scene,
        d,
        6,
        [at[0] + lean[0] * t * t * height, y, at[1] + lean[1] * t * t * height],
        [1, (height / links) * 3.4, 0.4],
      );
      parts.push(shaded(blob, foot, tip, 0, height));
    }
    const bulb = sphere(scene, 0.14, 3, [
      at[0] + lean[0] * height,
      height - 0.04,
      at[1] + lean[1] * height,
    ]);
    parts.push(flat(bulb, '#ffd9a0'));
  });
  return merged('lake-kelp', parts);
}

/** A coral cluster: rounded fingers in pink, orange and lilac, 0.3 to 0.7 tall. */
export function buildCoral(scene: Scene): Mesh {
  const fingers: [number, number, number, number, number][] = [
    // x, z, height, lean x, lean z
    [0, 0, 0.7, 0.06, 0],
    [0.2, 0.1, 0.5, 0.2, 0.05],
    [-0.2, 0.06, 0.55, -0.18, 0],
    [0.04, -0.2, 0.4, 0, -0.18],
    [-0.08, 0.22, 0.34, -0.04, 0.2],
    [0.28, -0.12, 0.3, 0.2, -0.1],
  ];
  const parts: Part[] = [];
  fingers.forEach(([x, z, h, lx, lz], i) => {
    const hex = WATER_COLORS.coral[i % WATER_COLORS.coral.length] ?? '#ff8fb0';
    const finger = cylinder(
      scene,
      h,
      0.1,
      0.17,
      7,
      [x + lx * 0.5, h / 2, z + lz * 0.5],
      [lz, 0, -lx],
    );
    parts.push(shaded(finger, '#b0607e', hex, 0, h));
    parts.push(shaded(sphere(scene, 0.1, 6, [x + lx, h, z + lz]), hex, hex, 0, 1));
  });
  parts.push(
    shaded(sphere(scene, 0.62, 6, [0, 0.02, 0], [1, 0.4, 1]), '#a8587a', '#e98aa8', -0.1, 0.2),
  );
  return merged('lake-coral', parts);
}

/**
 * A fish, white so each instance can carry its own colour (an instance
 * colour times the vertex colours), with dark eyes and pale fins. Faces +z.
 */
export function buildFish(scene: Scene): Mesh {
  const parts: Part[] = [
    shaded(sphere(scene, 0.34, 7, [0, 0, 0], [0.62, 0.9, 1.5]), '#d9d9d9', '#ffffff', -0.15, 0.15),
    flat(sphere(scene, 0.22, 5, [0, 0, -0.27], [0.18, 1, 1.1]), '#ffe6c8'),
    flat(sphere(scene, 0.16, 5, [0, 0.12, 0.02], [0.14, 1, 1.5]), '#ffe6c8'),
    flat(sphere(scene, 0.05, 3, [0.095, 0.04, 0.17]), '#24323f'),
    flat(sphere(scene, 0.05, 3, [-0.095, 0.04, 0.17]), '#24323f'),
  ];
  return merged('lake-fish', parts);
}

/** A bubble: a small pale ball (unlit; the drift shader grows and pops it). */
export function buildBubble(scene: Scene): Mesh {
  return merged('lake-bubbles', [flat(sphere(scene, 1, 6, [0, 0, 0]), '#ffffff')]);
}

/**
 * A soft dark spot on the sand under something (a flat fan, alpha 0.5 in the
 * middle to 0 at the rim), radius 1: the water's version of the meadow's
 * painted contact shade, for what the ground texture was painted before.
 */
export function buildContact(scene: Scene): Mesh {
  const sides = 14;
  const positions = [0, 0, 0];
  const colors = [0.08, 0.2, 0.22, 0.5];
  const indices: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    positions.push(Math.cos(a), 0, Math.sin(a));
    colors.push(0.08, 0.2, 0.22, 0);
    indices.push(0, 1 + ((i + 1) % sides), 1 + i);
  }
  const mesh = new Mesh('lake-contact', scene);
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.normals = positions.map((_, i) => (i % 3 === 1 ? 1 : 0));
  data.applyToMesh(mesh);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/**
 * The lake's two search spots, sized to their colliders, with how high the
 * glint floats (world units). Null: not a lake spot.
 */
export function buildLakeSpotProp(
  scene: Scene,
  kind: string,
): { mesh: Mesh; glint: number } | null {
  switch (kind) {
    case 'pond': {
      // A bubble spring: a ring of pale pebbles round a dip in the sand, bubbles rising.
      const parts: Part[] = [
        shaded(
          sphere(scene, 0.8, 8, [0, -0.02, 0], [1, 0.22, 1]),
          '#6fa3a0',
          '#a8d6cf',
          -0.05,
          0.1,
        ),
      ];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        parts.push(
          shaded(
            sphere(scene, 0.15, 6, [Math.cos(a) * 0.42, 0.04, Math.sin(a) * 0.42], [1.2, 0.6, 1]),
            '#b9b09f',
            '#eee6d6',
            0,
            0.1,
          ),
        );
      }
      for (const [x, y, z, d] of [
        [0.02, 0.2, 0, 0.16],
        [-0.04, 0.42, 0.02, 0.12],
        [0.03, 0.62, -0.02, 0.1],
        [-0.01, 0.8, 0.01, 0.07],
      ] as const) {
        parts.push(flat(sphere(scene, d, 6, [x, y, z]), '#e6fbff'));
      }
      return { mesh: merged('lake-spot-spring', parts), glint: 1.05 };
    }
    case 'reeds': {
      // A reed bed: slim, leaning blades with a few brown tips, tied at the foot with sand.
      const [foot, tip] = WATER_COLORS.reed;
      const parts: Part[] = [
        shaded(sphere(scene, 0.6, 6, [0, 0, 0], [1, 0.3, 1]), '#b8a47a', '#e0cf9e', -0.05, 0.12),
      ];
      const blades = 9;
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2 + 0.4;
        const h = 1.0 + (i % 3) * 0.22;
        const lean = 0.1 + (i % 2) * 0.1;
        const blade = cylinder(
          scene,
          h,
          0.02,
          0.07,
          5,
          [Math.cos(a) * (0.1 + lean * h * 0.5), h / 2, Math.sin(a) * (0.1 + lean * h * 0.5)],
          [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
        );
        parts.push(shaded(blade, foot, tip, 0, h));
        if (i % 3 === 0) {
          parts.push(
            flat(
              sphere(
                scene,
                0.12,
                4,
                [Math.cos(a) * (0.1 + lean * h), h - 0.1, Math.sin(a) * (0.1 + lean * h)],
                [1, 2.4, 1],
              ),
              '#8a5a3c',
            ),
          );
        }
      }
      return { mesh: merged('lake-spot-reeds', parts), glint: 1.55 };
    }
    default:
      return null;
  }
}
