import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import type { FlowerKind, TreeKind } from './land-layout.js';

// The explore land kit's shapes (#335 art reset): vinyl-toy plants, trees,
// rocks and logs, built from a few primitives (art bible §1.2, §4: world
// props are the same vinyl family, matte-er than squishies). Each is one
// vertex-coloured mesh, thin-instanced (one draw call a kind), in world
// units with its foot at the origin. Colours shade from a darker foot to a
// sunlit top, a baked ambient occlusion that costs nothing per frame.
//
// The lake, trail and cave build on the same kit.

type Part = Mesh;

const srgb = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

/**
 * Paints a part from `bottom` at local height `y0` to `top` at `y1` (world
 * units, after its transform), linear colour.
 */
function shaded(mesh: Part, bottom: string, top: string, y0: number, y1: number): Part {
  mesh.bakeCurrentTransformIntoVertices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const a = srgb(bottom);
  const b = srgb(top);
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1] ?? 0;
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
    const s = t * t * (3 - 2 * t);
    colors.set([a.r + (b.r - a.r) * s, a.g + (b.g - a.g) * s, a.b + (b.b - a.b) * s, 1], i * 4);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

const flat = (mesh: Part, hex: string): Part => shaded(mesh, hex, hex, 0, 1);

/**
 * A round part: a smooth icosphere, far cheaper than a UV sphere for the
 * same roundness (`segments` picks its subdivisions: 20 × n² triangles).
 */
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
 * A grass tuft: six tapered, curved blades, each two quads, darker at the
 * foot. Normals point mostly up, so tufts light like the ground they grow
 * from and melt into it (no hard blade edges). Draw it double-sided.
 */
export function buildTuft(scene: Scene): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const foot = srgb('#86bd6c');
  const mid = srgb('#a2d483');
  const tip = srgb('#c9ec9f');
  const blades = [
    [0, 0.21, 0.0],
    [1.05, 0.17, 0.35],
    [2.1, 0.19, -0.3],
    [3.2, 0.15, 0.4],
    [4.2, 0.18, -0.2],
    [5.3, 0.14, 0.25],
  ] as const;
  for (const [turn, height, bend] of blades) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const base = positions.length / 3;
    // Three rows (foot, middle, tip), two wide then one: the blade leans out as it rises.
    const rows: [number, number, number, ReturnType<typeof srgb>][] = [
      [0, 0.045, 0.02, foot],
      [height * 0.55, 0.034, 0.06 + bend * 0.03, mid],
      [height, 0.0, 0.12 + bend * 0.06, tip],
    ];
    for (const [y, half, out, col] of rows) {
      for (const side of [-1, 1]) {
        const lx = side * half;
        const lz = out;
        positions.push(lx * c - lz * s, y, lx * s + lz * c);
        normals.push(0.25 * -s, 0.95, 0.25 * c);
        colors.push(col.r, col.g, col.b, 1);
      }
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    indices.push(base + 2, base + 4, base + 3, base + 3, base + 4, base + 5);
  }
  const mesh = new Mesh('land-tufts', scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** A flower cluster: three or four on short stems, with a couple of leaves. */
export function buildFlowers(scene: Scene, kind: FlowerKind): Mesh {
  const parts: Part[] = [];
  const stems: [number, number, number][] = [
    [0, 0, 0.22],
    [0.1, 0.06, 0.17],
    [-0.09, 0.07, 0.19],
  ];
  const head = (x: number, z: number, h: number) => {
    switch (kind) {
      case 'daisy': {
        const petals = CreateDisc('kit', { radius: 0.075, tessellation: 9 }, scene);
        petals.rotation.x = Math.PI / 2;
        petals.position.set(x, h, z);
        parts.push(flat(petals, '#fffaf0'));
        parts.push(flat(sphere(scene, 0.06, 3, [x, h + 0.01, z], [1, 0.5, 1]), '#ffc94d'));
        break;
      }
      case 'tulip': {
        const cup = sphere(scene, 0.12, 4, [x, h + 0.03, z], [0.85, 1.2, 0.85]);
        parts.push(shaded(cup, '#e85d8c', '#ff9fc0', h - 0.03, h + 0.07));
        break;
      }
      case 'bell': {
        for (let b = 0; b < 3; b++) {
          const bell = sphere(scene, 0.07, 3, [x + 0.015 * b, h - 0.055 * b, z], [1, 0.9, 1]);
          parts.push(shaded(bell, '#9b86e6', '#c9b8ff', h - 0.12, h + 0.02));
        }
        break;
      }
    }
  };
  for (const [x, z, h] of stems.slice(0, 3)) {
    parts.push(flat(cylinder(scene, h, 0.02, 0.026, 4, [x, h / 2, z]), '#5f9f4f'));
    head(x, z, h);
  }
  // Two leaves at the foot.
  for (const turn of [0.6, 3.6]) {
    const leaf = sphere(
      scene,
      0.12,
      3,
      [Math.cos(turn) * 0.05, 0.03, Math.sin(turn) * 0.05],
      [0.45, 0.2, 1],
    );
    leaf.rotation.y = turn;
    parts.push(shaded(leaf, '#5f9f4f', '#8fcf6f', 0, 0.06));
  }
  return merged(`land-flowers-${kind}`, parts);
}

/** A round bush: soft puffs, darker underneath; `berries` adds little pink berries. */
export function buildBush(scene: Scene, berries: boolean): Mesh {
  const puffs: [number, number, number, number][] = [
    [0, 0.34, 0, 0.78],
    [0.3, 0.26, 0.08, 0.56],
    [-0.28, 0.24, -0.05, 0.6],
    [0.06, 0.24, 0.3, 0.52],
    [-0.04, 0.5, -0.06, 0.5],
  ];
  const parts: Part[] = puffs.map(([x, y, z, d]) =>
    shaded(sphere(scene, d, 7, [x, y, z], [1, 0.82, 1]), '#5d9a58', '#a8dc86', 0.02, 0.7),
  );
  if (berries) {
    const dots: [number, number, number][] = [
      [0.22, 0.48, -0.22],
      [-0.25, 0.42, -0.2],
      [0.02, 0.62, -0.18],
      [0.35, 0.36, -0.08],
      [-0.12, 0.3, -0.33],
    ];
    for (const at of dots) parts.push(flat(sphere(scene, 0.07, 3, at), '#ff7fa8'));
  }
  return merged(berries ? 'land-berry-bushes' : 'land-bushes', parts);
}

/** The trees round the tile, about 2.6 to 3.6 tall. */
export function buildTree(scene: Scene, kind: TreeKind): Mesh {
  const parts: Part[] = [];
  switch (kind) {
    case 'oak': {
      parts.push(
        shaded(cylinder(scene, 1.3, 0.22, 0.36, 8, [0, 0.65, 0]), '#7d5a3f', '#a77a52', 0, 1.3),
      );
      const puffs: [number, number, number, number][] = [
        [0, 2.0, 0, 1.6],
        [0.6, 1.75, 0.15, 1.15],
        [-0.6, 1.7, -0.1, 1.2],
        [0.1, 1.65, 0.6, 1.1],
        [-0.1, 2.55, -0.05, 1.0],
      ];
      for (const [x, y, z, d] of puffs) {
        parts.push(
          shaded(sphere(scene, d, 9, [x, y, z], [1, 0.88, 1]), '#4f8f57', '#9fd884', 1.2, 2.9),
        );
      }
      break;
    }
    case 'birch': {
      parts.push(
        shaded(cylinder(scene, 2.2, 0.12, 0.2, 7, [0, 1.1, 0]), '#d9d2c4', '#fbf6ec', 0, 2.2),
      );
      // A few dark bark marks.
      for (const [y, turn] of [
        [0.5, 0.3],
        [1.0, 2.1],
        [1.45, 4.0],
        [1.8, 1.0],
      ] as const) {
        const mark = sphere(
          scene,
          0.07,
          3,
          [Math.cos(turn) * 0.08, y, Math.sin(turn) * 0.08],
          [1, 0.4, 1],
        );
        parts.push(flat(mark, '#5a524a'));
      }
      const puffs: [number, number, number, number][] = [
        [0, 2.6, 0, 1.1],
        [0.32, 2.2, 0.1, 0.8],
        [-0.3, 2.25, -0.08, 0.85],
        [0.02, 3.05, 0, 0.75],
      ];
      for (const [x, y, z, d] of puffs) {
        parts.push(
          shaded(sphere(scene, d, 8, [x, y, z], [1, 1.15, 1]), '#6fae55', '#c9ec8e', 1.8, 3.3),
        );
      }
      break;
    }
    case 'pine': {
      parts.push(flat(cylinder(scene, 0.7, 0.18, 0.26, 7, [0, 0.35, 0]), '#7d5a3f'));
      const tiers: [number, number, number][] = [
        [0.6, 1.9, 1.25],
        [1.35, 1.5, 1.05],
        [2.05, 1.05, 0.85],
      ];
      for (const [y, d, h] of tiers) {
        parts.push(
          shaded(
            cylinder(scene, h, 0.04, d, 10, [0, y + h / 2, 0]),
            '#3f7f63',
            '#7cc39a',
            y,
            y + h,
          ),
        );
      }
      break;
    }
  }
  return merged(`land-trees-${kind}`, parts);
}

/** A far tree on the hills: a light blob on a stub (a few dozen triangles). */
export function buildFarTree(scene: Scene): Mesh {
  return merged('land-far-trees', [
    flat(cylinder(scene, 0.8, 0.2, 0.3, 5, [0, 0.4, 0]), '#7d5a3f'),
    shaded(sphere(scene, 1.7, 5, [0, 1.6, 0], [1, 1.2, 1]), '#5a9a62', '#9fd28a', 0.8, 2.6),
  ]);
}

/** A rock cluster with a little moss cap. */
export function buildRocks(scene: Scene): Mesh {
  return merged('land-rocks', [
    shaded(sphere(scene, 0.9, 6, [0, 0.2, 0], [1.15, 0.65, 1]), '#9c948a', '#d4cdc2', 0, 0.5),
    shaded(sphere(scene, 0.55, 5, [0.5, 0.12, 0.25], [1.1, 0.7, 1]), '#958d84', '#cfc8bd', 0, 0.3),
    shaded(
      sphere(scene, 0.35, 4, [-0.42, 0.08, -0.2], [1, 0.7, 1.1]),
      '#a39b91',
      '#ddd6cb',
      0,
      0.2,
    ),
    shaded(
      sphere(scene, 0.5, 5, [-0.05, 0.43, 0.05], [1.1, 0.35, 0.9]),
      '#7fb36a',
      '#a9d88c',
      0.35,
      0.5,
    ),
  ]);
}

/** A fallen log with a light cut end and a moss patch. */
export function buildLog(scene: Scene): Mesh {
  const body = cylinder(scene, 1.5, 0.36, 0.4, 10, [0, 0.19, 0], [0, 0, Math.PI / 2]);
  const end = cylinder(scene, 0.02, 0.3, 0.3, 10, [0.76, 0.19, 0], [0, 0, Math.PI / 2]);
  return merged('land-logs', [
    shaded(body, '#6e4f37', '#a07552', 0, 0.38),
    flat(end, '#e8cfa4'),
    shaded(
      sphere(scene, 0.5, 5, [-0.2, 0.36, 0], [1.2, 0.3, 0.7]),
      '#6fa95e',
      '#a9d88c',
      0.3,
      0.45,
    ),
  ]);
}

/** Three little toadstools (lightly spooky, very cute). */
export function buildMushrooms(scene: Scene): Mesh {
  const parts: Part[] = [];
  const caps: [number, number, number, number, string][] = [
    [0, 0, 0.2, 0.2, '#ff7a6b'],
    [0.14, 0.08, 0.13, 0.14, '#ff9a7a'],
    [-0.1, 0.1, 0.1, 0.11, '#ffb38a'],
  ];
  for (const [x, z, h, d, cap] of caps) {
    parts.push(flat(cylinder(scene, h, d * 0.3, d * 0.38, 6, [x, h / 2, z]), '#fff3dc'));
    parts.push(shaded(sphere(scene, d, 6, [x, h, z], [1, 0.6, 1]), cap, cap, 0, 1));
    parts.push(
      flat(sphere(scene, d * 0.18, 3, [x + d * 0.18, h + d * 0.26, z - d * 0.12]), '#fffaf0'),
    );
    parts.push(
      flat(sphere(scene, d * 0.14, 3, [x - d * 0.2, h + d * 0.22, z + d * 0.08]), '#fffaf0'),
    );
  }
  return merged('land-mushrooms', parts);
}

/** A pebble or three, walked over. */
export function buildPebbles(scene: Scene): Mesh {
  return merged('land-pebbles', [
    shaded(sphere(scene, 0.14, 4, [0, 0.02, 0], [1.2, 0.5, 1]), '#b3a999', '#ddd4c6', 0, 0.06),
    shaded(
      sphere(scene, 0.09, 3, [0.12, 0.015, 0.06], [1.2, 0.55, 1]),
      '#aca291',
      '#d8cebf',
      0,
      0.04,
    ),
    shaded(
      sphere(scene, 0.07, 3, [-0.08, 0.01, 0.1], [1.2, 0.55, 1]),
      '#b8ae9e',
      '#e1d8ca',
      0,
      0.03,
    ),
  ]);
}

/** A lantern post: the post and roof (lit like the land) and, separately, its glass (it glows). */
export function buildLamp(scene: Scene): { post: Mesh; glass: Mesh } {
  const post = merged('land-lamps', [
    flat(cylinder(scene, 1.25, 0.08, 0.11, 6, [0, 0.62, 0]), '#6e4f37'),
    flat(cylinder(scene, 0.06, 0.22, 0.22, 6, [0, 1.27, 0]), '#5a3f2c'),
    flat(cylinder(scene, 0.16, 0.02, 0.28, 6, [0, 1.62, 0]), '#7a2d55'),
  ]);
  const glass = merged('land-lamp-glass', [
    flat(sphere(scene, 0.24, 6, [0, 1.42, 0], [1, 1.15, 1]), '#fff3d0'),
  ]);
  return { post, glass };
}

/** A butterfly: two round wings either side of a little body (the drift shader flaps them). */
export function buildButterfly(scene: Scene): Mesh {
  const wing = (side: number, hex: string) => {
    const w = CreateDisc('kit', { radius: 0.09, tessellation: 7 }, scene);
    w.rotation.x = Math.PI / 2;
    w.position.set(side * 0.085, 0, 0);
    w.scaling.set(1, 1.25, 1);
    return flat(w, hex);
  };
  const low = (side: number, hex: string) => {
    const w = CreateDisc('kit', { radius: 0.06, tessellation: 6 }, scene);
    w.rotation.x = Math.PI / 2;
    w.position.set(side * 0.06, 0, -0.08);
    return flat(w, hex);
  };
  const mesh = merged('land-butterflies', [
    wing(-1, '#ffb3d1'),
    wing(1, '#ffb3d1'),
    low(-1, '#ffe08a'),
    low(1, '#ffe08a'),
    flat(sphere(scene, 0.04, 3, [0, 0.005, -0.02], [0.7, 0.7, 2.6]), '#6b4a5e'),
  ]);
  return mesh;
}

/** A tiny glowing mote (pollen by day, a firefly at night). */
export function buildMote(scene: Scene, name: string): Mesh {
  return merged(name, [flat(sphere(scene, 1, 3, [0, 0, 0]), '#ffffff')]);
}

/**
 * The search spots drawn from the kit (the rocks, trees and logs *are* the
 * spots, #291), sized to their colliders, with how high the glint floats
 * (world units). Null: the spot keeps today's shape.
 */
export function buildSpotProp(scene: Scene, kind: string): { mesh: Mesh; glint: number } | null {
  switch (kind) {
    case 'rock': {
      const mesh = merged('land-spot-rock', [
        shaded(sphere(scene, 0.78, 8, [0, 0.2, 0], [1.1, 0.72, 1]), '#9c948a', '#ddd6cb', 0, 0.5),
        shaded(
          sphere(scene, 0.36, 5, [0.36, 0.1, -0.12], [1.1, 0.7, 1]),
          '#958d84',
          '#cfc8bd',
          0,
          0.22,
        ),
        shaded(
          sphere(scene, 0.46, 6, [-0.06, 0.45, 0.05], [1.1, 0.32, 0.95]),
          '#7fb36a',
          '#b2df92',
          0.38,
          0.52,
        ),
      ]);
      return { mesh, glint: 0.75 };
    }
    case 'tree': {
      const mesh = buildTree(scene, 'oak');
      mesh.scaling.setAll(0.72);
      mesh.bakeCurrentTransformIntoVertices();
      mesh.name = 'land-spot-tree';
      return { mesh, glint: 2.3 };
    }
    case 'hollow-log': {
      const body = cylinder(scene, 1.0, 0.44, 0.48, 12, [0, 0.24, 0], [0, 0, Math.PI / 2]);
      const hole = cylinder(scene, 0.03, 0.3, 0.3, 12, [-0.5, 0.24, 0], [0, 0, Math.PI / 2]);
      const rim = cylinder(scene, 0.02, 0.42, 0.42, 12, [-0.505, 0.24, 0], [0, 0, Math.PI / 2]);
      const mesh = merged('land-spot-log', [
        shaded(body, '#6e4f37', '#a07552', 0, 0.48),
        flat(rim, '#e8cfa4'),
        flat(hole, '#3b2a2a'),
        shaded(
          sphere(scene, 0.42, 5, [0.15, 0.46, 0], [1.3, 0.32, 0.8]),
          '#6fa95e',
          '#a9d88c',
          0.4,
          0.52,
        ),
        ...buildMushroomParts(scene, 0.32, 0.46, 0.12),
      ]);
      // The hollow end faces the camera's side a little.
      mesh.rotation.y = -0.5;
      mesh.bakeCurrentTransformIntoVertices();
      return { mesh, glint: 0.8 };
    }
    case 'flower-bed': {
      const parts: Part[] = [];
      // A ring of little stones round a mound of soil, flowers on top.
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        parts.push(
          shaded(
            sphere(scene, 0.13, 4, [Math.cos(a) * 0.36, 0.03, Math.sin(a) * 0.36], [1.2, 0.6, 1]),
            '#b3a999',
            '#e1d8ca',
            0,
            0.06,
          ),
        );
      }
      parts.push(
        shaded(sphere(scene, 0.72, 8, [0, 0, 0], [1, 0.22, 1]), '#8a6446', '#a87b55', -0.05, 0.08),
      );
      const kinds: FlowerKind[] = ['tulip', 'daisy', 'bell', 'tulip', 'daisy'];
      kinds.forEach((k, i) => {
        const f = buildFlowers(scene, k);
        const a = (i / kinds.length) * Math.PI * 2 + 0.3;
        const d = i === 0 ? 0 : 0.18;
        f.position.set(Math.cos(a) * d, 0.05, Math.sin(a) * d);
        f.scaling.setAll(1.3);
        parts.push(f);
      });
      return { mesh: merged('land-spot-flower-bed', parts), glint: 0.7 };
    }
    case 'mound': {
      // Soft, freshly turned earth with crumbs, two pebbles and a sprout: "dig here".
      const parts: Part[] = [
        shaded(
          sphere(scene, 0.86, 8, [0, 0, 0], [1.1, 0.34, 1]),
          '#8a6446',
          '#b58a5f',
          -0.05,
          0.15,
        ),
        shaded(
          sphere(scene, 0.4, 6, [0.06, 0.12, -0.04], [1, 0.45, 1]),
          '#9c7250',
          '#c49a6c',
          0.05,
          0.2,
        ),
        shaded(
          sphere(scene, 0.12, 4, [-0.24, 0.1, 0.1], [1.2, 0.6, 1]),
          '#b3a999',
          '#e1d8ca',
          0.05,
          0.15,
        ),
        shaded(
          sphere(scene, 0.09, 4, [0.3, 0.06, 0.16], [1.2, 0.6, 1]),
          '#aca291',
          '#d8cebf',
          0.03,
          0.1,
        ),
        flat(cylinder(scene, 0.16, 0.012, 0.02, 4, [-0.05, 0.27, 0.02]), '#5f9f4f'),
      ];
      for (const turn of [0.4, 3.3]) {
        const leaf = sphere(
          scene,
          0.11,
          3,
          [-0.05 + Math.cos(turn) * 0.04, 0.35, 0.02 + Math.sin(turn) * 0.04],
          [0.5, 0.2, 1],
        );
        leaf.rotation.y = turn;
        parts.push(shaded(leaf, '#6fb35a', '#a6e080', 0.3, 0.4));
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.3;
        parts.push(
          flat(sphere(scene, 0.06, 3, [Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.4]), '#9c7250'),
        );
      }
      return { mesh: merged('land-spot-mound', parts), glint: 0.7 };
    }
    default:
      return null;
  }
}

function buildMushroomParts(scene: Scene, x: number, y: number, z: number): Part[] {
  const h = 0.11;
  const d = 0.12;
  return [
    flat(cylinder(scene, h, d * 0.3, d * 0.38, 6, [x, y + h / 2, z]), '#fff3dc'),
    shaded(sphere(scene, d, 6, [x, y + h, z], [1, 0.6, 1]), '#ff7a6b', '#ff7a6b', 0, 1),
  ];
}
