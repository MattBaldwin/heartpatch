import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { HouseExterior } from '@heartpatch/shared';
import { linear, merged, painted } from '../map/map-props.js';
import { HOUSE_COTTAGE, HOUSE_GROWN, HOUSE_PALETTE } from './house-config.js';
import type { WallHole } from './house-layout.js';

/*
 * The house's procedural parts (#381 plan §1c "Asset and part list"):
 * vinyl-toy furniture and shell pieces from a few primitives, painted with
 * vertex colours so a room's pieces merge into one mesh per material (one
 * draw call), and the little cottage the home base shows on the Heart Seed
 * tile. No files, no textures (art bible §4). Each builder returns parts in
 * world units; the scene merges them.
 */

export type Vec = readonly [number, number, number];

/** Parts of a fixture: matte-vinyl solids, and glowing bits (lamps, flames) lit from inside. */
export interface Parts {
  readonly solid: Mesh[];
  readonly glow: Mesh[];
}

export function box(scene: Scene, size: Vec, at: Vec, hex: string, rotY = 0): Mesh {
  const m = CreateBox('house-part', { width: size[0], height: size[1], depth: size[2] }, scene);
  m.position.set(...at);
  m.rotation.y = rotY;
  return painted(m, hex);
}

export function ball(
  scene: Scene,
  d: number,
  at: Vec,
  hex: string,
  s: Vec = [1, 1, 1],
  segments = 10,
): Mesh {
  const m = CreateSphere('house-part', { diameter: d, segments }, scene);
  m.position.set(...at);
  m.scaling.set(...s);
  return painted(m, hex);
}

export function tube(
  scene: Scene,
  h: number,
  dTop: number,
  dBottom: number,
  at: Vec,
  hex: string,
  tessellation = 12,
): Mesh {
  const m = CreateCylinder(
    'house-part',
    { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation },
    scene,
  );
  m.position.set(...at);
  return painted(m, hex);
}

/** A flat disc lying on the floor. */
export function floorDisc(scene: Scene, r: number, at: Vec, hex: string, s: Vec = [1, 1, 1]): Mesh {
  const d = CreateDisc('house-part', { radius: r, tessellation: 40 }, scene);
  d.rotation.x = Math.PI / 2;
  d.position.set(...at);
  d.scaling.set(...s);
  return painted(d, hex);
}

/**
 * Paints a glowing part its glow colour, drawn unlit (lit from inside) by
 * the scene's one glow material. Colours stay as given, never scaled past
 * 1: a vertex colour past white clips to a pale cream (render check, PR B1).
 */
export function glowing(mesh: Mesh, hex: string): Mesh {
  const c = linear(hex);
  const count = mesh.getTotalVertices();
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/** Paints a mesh with a vertical ramp (its local y from `y0` to `y1`), baked after its transform. */
export function ramp(mesh: Mesh, y0: number, y1: number, bottom: string, top: string): Mesh {
  mesh.bakeCurrentTransformIntoVertices();
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const n = pos.length / 3;
  const colors = new Float32Array(n * 4);
  const a = linear(bottom);
  const b = linear(top);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, ((pos[i * 3 + 1] ?? 0) - y0) / (y1 - y0 || 1)));
    colors.set([a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1], i * 4);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

// ── The shell ────────────────────────────────────────────────────────

/**
 * A wall slab from `u = 0` to `length` along local x, standing on y = 0,
 * centred on z = 0, with rectangular holes (doors, windows) left open.
 */
export function wallPieces(
  scene: Scene,
  length: number,
  height: number,
  thick: number,
  holes: readonly WallHole[],
  hex: string,
): Mesh[] {
  const parts: Mesh[] = [];
  const sorted = [...holes].filter((h) => h.y - h.h / 2 < height).sort((a, b) => a.u - b.u);
  let u0 = 0;
  for (const hole of sorted) {
    const l = Math.max(0, hole.u - hole.w / 2);
    const r = Math.min(length, hole.u + hole.w / 2);
    if (l - u0 > 0.001)
      parts.push(box(scene, [l - u0, height, thick], [(u0 + l) / 2, height / 2, 0], hex));
    const below = hole.y - hole.h / 2;
    const above = height - (hole.y + hole.h / 2);
    if (below > 0.001)
      parts.push(box(scene, [r - l, below, thick], [(l + r) / 2, below / 2, 0], hex));
    if (above > 0.001)
      parts.push(box(scene, [r - l, above, thick], [(l + r) / 2, height - above / 2, 0], hex));
    u0 = r;
  }
  if (length - u0 > 0.001)
    parts.push(box(scene, [length - u0, height, thick], [(u0 + length) / 2, height / 2, 0], hex));
  return parts;
}

/** A window's frame, sill and cross bars, in wall-local units (like `wallPieces`). */
export function windowFrame(scene: Scene, hole: WallHole, thick: number): Mesh[] {
  const c = HOUSE_PALETTE.frame;
  const { u, y, w, h } = hole;
  return [
    box(scene, [w + 0.24, 0.12, thick + 0.08], [u, y + h / 2 + 0.06, 0], c),
    box(scene, [w + 0.24, 0.16, thick + 0.26], [u, y - h / 2 - 0.08, 0], c),
    box(scene, [0.12, h, thick + 0.08], [u - w / 2 - 0.06, y, 0], c),
    box(scene, [0.12, h, thick + 0.08], [u + w / 2 + 0.06, y, 0], c),
    box(scene, [0.07, h, 0.07], [u, y, 0], c),
    box(scene, [w, 0.07, 0.07], [u, y, 0], c),
  ];
}

/** Floor boards over a rectangle, in three alternating tones, top at `y`. */
export function floorPlanks(
  scene: Scene,
  x0: number,
  z0: number,
  w: number,
  d: number,
  y: number,
): Mesh[] {
  const tones = HOUSE_PALETTE.planks;
  const n = Math.max(1, Math.round(w / 0.4)); // TUNE: plank width
  return Array.from({ length: n }, (_, i) =>
    box(
      scene,
      [w / n - 0.02, 0.16, d],
      [x0 + (w / n) * (i + 0.5), y - 0.08, z0 + d / 2],
      tones[i % 3] ?? '#c98b5a',
    ),
  );
}

/** A gable roof over a rectangle, eaves at `y`, outside colour; lifted off in the entry glide. */
export function gableRoof(
  scene: Scene,
  x0: number,
  z0: number,
  w: number,
  d: number,
  y: number,
): Mesh[] {
  const rise = Math.min(1.8, w * 0.32); // TUNE
  const half = w / 2;
  const len = Math.hypot(half, rise) + 0.35;
  const angle = Math.atan2(rise, half);
  const parts: Mesh[] = [];
  for (const side of [-1, 1]) {
    const slope = box(
      scene,
      [len, 0.14, d + 0.5],
      [x0 + half + (side * half) / 2, y + rise / 2, z0 + d / 2],
      '#9a5a52',
    );
    slope.rotation.z = -side * angle;
    parts.push(slope);
  }
  parts.push(box(scene, [0.22, 0.22, d + 0.55], [x0 + half, y + rise, z0 + d / 2], '#7a4440'));
  return parts;
}

/**
 * The roof seen from inside at kid height (the approved captures): a warm
 * wooden gable with rafters, a ridge beam and tie beams, the back gable
 * filled in, two strings of bunting and a hanging lantern. Eaves at `y`.
 */
export function roofInside(
  scene: Scene,
  x0: number,
  z0: number,
  w: number,
  d: number,
  y: number,
  /** How far the roof reaches out over the porch in front, metres. */
  overhang = 0,
): Parts {
  const rise = Math.min(1.8, w * 0.28); // TUNE
  const half = w / 2;
  const len = Math.hypot(half, rise) + 0.2;
  const angle = Math.atan2(rise, half);
  const cx = x0 + half;
  const solid: Mesh[] = [];
  for (const side of [-1, 1]) {
    const slope = box(
      scene,
      [len, 0.08, d + 0.3 + overhang],
      [cx + (side * half) / 2, y + rise / 2 + 0.04, z0 + (d - overhang) / 2],
      '#e2b088',
    );
    slope.rotation.z = -side * angle;
    solid.push(slope);
    for (let z = z0 + 0.5 - overhang; z < z0 + d; z += 1.0) {
      const rafter = box(
        scene,
        [len, 0.12, 0.1],
        [cx + (side * half) / 2, y + rise / 2 - 0.04, z],
        '#a8754e',
      );
      rafter.rotation.z = -side * angle;
      solid.push(rafter);
    }
  }
  solid.push(box(scene, [0.2, 0.2, d + 0.3], [cx, y + rise - 0.08, z0 + d / 2], '#8a5a39'));
  for (const t of [0.3, 0.62])
    solid.push(box(scene, [w, 0.16, 0.16], [cx, y + 0.02, z0 + d * t], '#9a6a46'));
  // The back gable: a wall triangle, its base on the eaves.
  const gable = CreateDisc(
    'house-part',
    { radius: 1, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  gable.rotation.z = Math.PI / 2; // a corner pointing up
  const sy = rise / 1.5;
  gable.scaling.set(sy, w / 1.732, 1); // rotated: local x is up
  gable.position.set(cx, y + 0.5 * sy, z0 + d - 0.13);
  solid.push(painted(gable, HOUSE_PALETTE.wallTop));
  // A toy shelf and three framed squishy doodles in the back gable, above the sign.
  const back = z0 + d - 0.16;
  const shelfY = y + 0.2;
  solid.push(box(scene, [w * 0.55, 0.06, 0.22], [cx, shelfY, back], '#8d5a3b'));
  const toyHex = ['#ff7aa2', '#ffd166', '#9ad8ff', '#c9a0ff', '#9fe0a0'];
  toyHex.forEach((hex, i) => {
    const tx = cx - w * 0.22 + (w * 0.44 * i) / 4;
    solid.push(
      i % 2
        ? box(scene, [0.16, 0.16, 0.16], [tx, shelfY + 0.11, back], hex, 0.4)
        : ball(scene, 0.2, [tx, shelfY + 0.13, back], hex, [1, 0.9, 1], 8),
    );
  });
  ['#ffb3c8', '#bfe3ff', '#ffe29a'].forEach((hex, i) => {
    const fx = cx + (i - 1) * Math.min(0.75, w * 0.14);
    const fy = y + rise * (i === 1 ? 0.62 : 0.42);
    const fz = z0 + d - 0.18;
    solid.push(
      box(scene, [0.4, 0.34, 0.04], [fx, fy, fz], '#fff6ec'),
      box(scene, [0.32, 0.26, 0.02], [fx, fy, fz - 0.025], hex),
      ball(scene, 0.17, [fx, fy - 0.02, fz - 0.04], '#ffffff', [1.1, 0.9, 0.3], 8),
      ball(scene, 0.03, [fx - 0.035, fy, fz - 0.07], '#3b2a3f', [1, 1, 1], 4),
      ball(scene, 0.03, [fx + 0.035, fy, fz - 0.07], '#3b2a3f', [1, 1, 1], 4),
    );
  });
  const flags = ['#ff9ab8', '#ffd166', '#9ad8ff', '#c9a0ff', '#9fe0a0'];
  for (const [t, drop] of [
    [0.5, 0.5],
    [0.8, 0.45],
  ] as const) {
    const n = Math.max(6, Math.round(w / 0.32));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const sag = 0.35 * (1 - Math.pow((u - 0.5) * 2, 2));
      const flag = CreateDisc(
        'house-part',
        { radius: 0.12, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      flag.rotation.z = -Math.PI / 2; // a point hanging down
      flag.position.set(x0 + 0.15 + (w - 0.3) * u, y + drop - sag, z0 + d * t);
      solid.push(painted(flag, flags[i % flags.length] ?? '#ff9ab8'));
    }
  }
  const ly = y + rise - 1.1;
  solid.push(box(scene, [0.02, 1.0, 0.02], [cx, ly + 0.6, z0 + d * 0.5], '#5a4a52'));
  const lantern = glowing(
    CreateSphere('house-part', { diameter: 0.34, segments: 12 }, scene),
    '#ffd9a0',
  );
  lantern.position.set(cx, ly, z0 + d * 0.5);
  lantern.scaling.set(1, 1.15, 1);
  return { solid, glow: [lantern] };
}

// ── Furniture ───────────────────────────────────────────────────────

/** A bed's frame, mattress, pillow and headboard (the blanket is its own part, coloured per bed). */
export function bedFrame(scene: Scene): Mesh[] {
  return [
    box(scene, [1.5, 0.32, 1.1], [0, 0.16, 0], '#8a5a39'),
    box(scene, [1.42, 0.14, 1.02], [0, 0.38, 0], '#fff2e3'),
    ball(scene, 0.42, [0, 0.5, 0.33], '#ffffff', [1.6, 0.5, 0.9]),
    box(scene, [1.5, 0.6, 0.12], [0, 0.3, 0.49], '#8a5a39'),
  ];
}

/** A bed's blanket, white (each bed's colour rides on its instance). */
export function bedBlanket(scene: Scene): Mesh[] {
  return [box(scene, [1.42, 0.1, 0.62], [0, 0.48, -0.14], '#ffffff')];
}

/** A hearth facing +z in local units: stone surround, mantel, firebox, log and a layered flame. */
export function hearth(scene: Scene, wide: boolean): Parts {
  const w = wide ? 3.0 : 1.9;
  const h = wide ? 2.5 : 1.7;
  const log = tube(scene, 0.62, 0.17, 0.17, [0, 0.12, 0.4], '#6b4a30', 7);
  log.rotation.z = Math.PI / 2;
  const tongue = (d: number, at: Vec, stretch: number, lean: number, hex: string) => {
    const t = glowing(CreateSphere('house-part', { diameter: d, segments: 10 }, scene), hex);
    t.position.set(...at);
    t.scaling.set(1, stretch, 0.75);
    t.rotation.z = lean;
    return t;
  };
  return {
    solid: [
      box(scene, [w, h, 0.55], [0, h / 2, 0], '#a79a90'),
      box(scene, [w + 0.3, 0.16, 0.72], [0, h + 0.08, 0.1], '#8d5a3b'),
      box(scene, [w * 0.55, h * 0.55, 0.3], [0, h * 0.3, 0.25], '#3a2a2a'),
      box(scene, [w + 0.4, 0.04, 1.1], [0, 0.02, 0.4], '#a07e6c'),
      log,
    ],
    glow: [
      tongue(0.34, [0, 0.55, 0.36], 2.0, 0, '#ff7a32'),
      tongue(0.26, [-0.22, 0.46, 0.37], 1.6, 0.25, '#ff7a32'),
      tongue(0.26, [0.22, 0.47, 0.36], 1.7, -0.25, '#ff7a32'),
      tongue(0.26, [0, 0.5, 0.42], 1.8, 0, '#ffc04d'),
      tongue(0.2, [-0.15, 0.44, 0.43], 1.5, 0.2, '#ffc04d'),
      tongue(0.2, [0.15, 0.45, 0.42], 1.5, -0.2, '#ffc04d'),
      tongue(0.14, [0, 0.42, 0.47], 1.6, 0, '#fff2c0'),
    ],
  };
}

/** The hearth's size (for placing it and what stands round it). */
export const hearthSize = (wide: boolean) => ({ w: wide ? 3.0 : 1.9, h: wide ? 2.5 : 1.7 });

/** A table lamp standing on `y`, its shade glowing. */
export function tableLamp(scene: Scene, x: number, z: number, y: number, shade: string): Parts {
  return {
    solid: [
      tube(scene, 0.06, 0.3, 0.3, [x, y + 0.03, z], '#7a4a2e'),
      tube(scene, 0.5, 0.05, 0.07, [x, y + 0.3, z], '#7a4a2e'),
    ],
    glow: [
      glowing(
        CreateCylinder(
          'house-part',
          { height: 0.36, diameterTop: 0.28, diameterBottom: 0.44, tessellation: 16 },
          scene,
        ),
        shade,
      ),
      glowing(CreateSphere('house-part', { diameter: 0.12, segments: 8 }, scene), '#fff2c8'),
    ].map((m, i) => {
      m.position.set(x, y + (i === 0 ? 0.72 : 0.56), z);
      return m;
    }),
  };
}

/** A round braided rug: rings of colour, like a rag rug. */
export function braidedRug(scene: Scene, x: number, z: number, r: number, y = 0): Mesh[] {
  const rings = ['#fff0e6', '#e97a9b', '#ffd1a8', '#c9a0ff', '#ff9ab8', '#fff0e6', '#e97a9b'];
  return rings.map((hex, i) =>
    floorDisc(scene, r * (1 - i / rings.length), [x, y + 0.012 + i * 0.002, z], hex),
  );
}

/** A round side table. */
export function sideTable(scene: Scene, x: number, z: number, y = 0, d = 0.9): Mesh[] {
  return [
    tube(scene, 0.07, d, d, [x, y + 0.62, z], '#a06a44', 16),
    tube(scene, 0.58, 0.1, 0.15, [x, y + 0.3, z], '#8a5a39', 8),
    tube(scene, 0.05, 0.45, 0.45, [x, y + 0.03, z], '#8a5a39', 12),
  ];
}

/** A cocoa mug (pink, with a handle). */
export function mug(scene: Scene, x: number, y: number, z: number): Mesh[] {
  const handle = CreateTorus(
    'house-part',
    { diameter: 0.15, thickness: 0.033, tessellation: 10 },
    scene,
  );
  handle.rotation.y = Math.PI / 2;
  handle.position.set(x + 0.11, y + 0.1, z);
  return [tube(scene, 0.2, 0.18, 0.16, [x, y + 0.1, z], '#ff9ab8'), painted(handle, '#ff9ab8')];
}

/** A potted plant. */
export function plant(scene: Scene, x: number, z: number, y = 0): Mesh[] {
  return [
    tube(scene, 0.36, 0.38, 0.28, [x, y + 0.18, z], '#d9a26b', 10),
    ball(scene, 0.62, [x, y + 0.66, z], '#5fa85a', [1, 1.1, 1]),
    ball(scene, 0.44, [x + 0.22, y + 0.84, z + 0.1], '#7cc46f'),
    ball(scene, 0.4, [x - 0.2, y + 0.88, z - 0.1], '#6db863'),
  ];
}

/** Toys on the floor at `y`: a pink ball, an open picture book with a heart, a little block. */
export function toys(
  scene: Scene,
  spots: { ball: [number, number]; book: [number, number]; block: [number, number] },
  y = 0,
): Mesh[] {
  const [bx, bz] = spots.ball;
  const [kx, kz] = spots.book;
  const [cx, cz] = spots.block;
  const page = (side: number) =>
    box(scene, [0.17, 0.012, 0.22], [kx + side * 0.085, y + 0.03, kz], '#fff6ec', side * 0.08);
  return [
    ball(scene, 0.26, [bx, y + 0.13, bz], '#ff7aa2'),
    box(scene, [0.38, 0.03, 0.26], [kx, y + 0.015, kz], '#8fc5ff'),
    page(-1),
    page(1),
    ball(scene, 0.07, [kx + 0.09, y + 0.04, kz], '#ff7aa2', [1, 0.25, 0.9], 6),
    box(scene, [0.17, 0.17, 0.17], [cx, y + 0.085, cz], '#ffd166', 0.5),
  ];
}

/** A shelf with framed squishy doodles, facing -z in local units. */
export function photoShelf(scene: Scene, w: number, frames: readonly string[]): Mesh[] {
  const parts = [box(scene, [w, 0.07, 0.26], [0, 0, 0], '#8d5a3b')];
  const step = w / (frames.length + 1);
  frames.forEach((hex, i) => {
    const fx = -w / 2 + step * (i + 1);
    parts.push(box(scene, [0.3, 0.26, 0.05], [fx, 0.17, 0], '#fff6ec'));
    parts.push(box(scene, [0.22, 0.18, 0.02], [fx, 0.17, -0.03], hex));
  });
  return parts;
}

/** The name sign's board (the text is a texture on a plane in front). */
export function signBoard(scene: Scene, width: number): Mesh[] {
  return [
    box(scene, [width, 0.46, 0.08], [0, 0, 0], '#fff6ec'),
    box(scene, [width + 0.08, 0.54, 0.05], [0, 0, 0.02], '#8d5a3b'),
  ];
}

// ── Outside ─────────────────────────────────────────────────────────

/**
 * A soft round pastel tree, foot at the origin: its trunk, and its two
 * crowns shading from a cool foot to white (each tree's crown colour rides
 * on its instance, so the whole ring is one draw call for the trunks and
 * one for the crowns).
 */
export function treeParts(scene: Scene, segments: number): { trunk: Mesh[]; crown: Mesh[] } {
  return {
    trunk: [tube(scene, 1.2, 0.22, 0.32, [0, 0.3, 0], '#9b7a62', 7)],
    crown: [
      ramp(
        ball(scene, 2.2, [0, 1.9, 0], '#ffffff', [1, 0.9, 1], segments),
        0.8,
        3,
        '#8a9a96',
        '#ffffff',
      ),
      ramp(
        ball(scene, 1.5, [0.55, 2.6, -0.2], '#ffffff', [1, 0.9, 1], segments),
        1.8,
        3.4,
        '#93a39c',
        '#ffffff',
      ),
    ],
  };
}

/** The height of a tree at scale 1 (its crown's top). */
export const TREE_TOP = 3.4;

/**
 * The yard's two pumpkins, by the house's front corners: inside the
 * dollhouse frame (it fits the house with margin round it) but out to the
 * side of the kid-height frame, which is only as wide as one room's back
 * wall, so kid height never has one right under its nose.
 */
export function yardPumpkins(
  x0: number,
  x1: number,
  front: number,
): { at: [number, number, number]; d: number; hex: string }[] {
  // TUNE: how far past the house's ends they sit, metres. Room on every
  // level and both viewports: about -1.5 (kid frame) to 0.4 (dollhouse frame).
  const out = 0;
  return [
    { at: [x0 - out, -0.1, front - 0.7], d: 0.5, hex: '#ff9a3c' },
    { at: [x1 + out, -0.15, front - 0.9], d: 0.38, hex: '#f08a2c' },
  ];
}

/** The front yard: a stepping-stone path, two lantern posts (glass glowing), pumpkins, a fence, bushes. */
export function frontYard(
  scene: Scene,
  x0: number,
  x1: number,
  front: number,
): Parts & { lanterns: [number, number][] } {
  const cx = (x0 + x1) / 2;
  const solid: Mesh[] = [];
  const glow: Mesh[] = [];
  const lanterns: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const st = tube(
      scene,
      0.1,
      0.8 - i * 0.04,
      0.8 - i * 0.04,
      [cx + 0.4 * Math.sin(i * 1.7), -0.28, front - 0.8 - i * 0.95],
      i % 2 ? '#c9bcae' : '#b9ab9c',
    );
    st.scaling.z = 0.7;
    solid.push(st);
  }
  for (const x of [cx - 1.6, cx + 1.7]) {
    lanterns.push([x, front - 1.2]);
    const cap = tube(scene, 0.14, 0, 0.3, [x, 1.13, front - 1.2], '#5a4036', 4);
    cap.rotation.y = Math.PI / 4;
    solid.push(
      tube(scene, 0.9, 0.05, 0.07, [x, 0.13, front - 1.2], '#5a4036', 6),
      box(scene, [0.22, 0.04, 0.22], [x, 0.6, front - 1.2], '#5a4036'),
      cap,
    );
    glow.push(glowing(box(scene, [0.3, 0.42, 0.3], [x, 0.83, front - 1.2], '#ffd27a'), '#ffd27a'));
  }
  for (const p of yardPumpkins(x0, x1, front)) {
    solid.push(ball(scene, p.d, p.at, p.hex, [1.1, 0.8, 1.1]));
  }
  const fz = front - 3.4;
  for (let x = x0 - 0.6; x <= x1 + 0.6; x += 0.32) {
    if (Math.abs(x - cx) < 0.7) continue; // the gate gap
    solid.push(box(scene, [0.1, 0.5, 0.05], [x, -0.07, fz], '#fff3e6'));
  }
  const blooms = ['#ffb3c8', '#c9a0ff', '#ffd166', '#9ad8ff'];
  for (let i = 0; i < 10; i++) {
    const x = x0 - 0.3 + ((x1 - x0 + 0.6) * (i + 0.5)) / 10;
    if (Math.abs(x - cx) < 0.9) continue;
    solid.push(ball(scene, 0.55, [x, -0.12, front - 2.6], '#7cb87a', [1, 0.7, 1], 8));
    solid.push(
      ball(scene, 0.16, [x + 0.12, 0.05, front - 2.75], blooms[i % 4] ?? '#ffb3c8', [1, 1, 1], 6),
    );
  }
  return { solid, glow, lanterns };
}

/**
 * A sky dome round the clearing: violet up high to the haze colour at the
 * horizon, vertex-coloured and drawn unlit, so it looks right from any pose.
 */
export function skyDome(scene: Scene, radius: number): Mesh {
  const dome = CreateSphere(
    'house-sky',
    { diameter: radius * 2, segments: 16, sideOrientation: Mesh.BACKSIDE },
    scene,
  );
  const pos = dome.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const n = pos.length / 3;
  const colors = new Float32Array(n * 4);
  const stops: [number, string][] = [
    [-0.2, HOUSE_PALETTE.haze],
    [0.05, HOUSE_PALETTE.haze],
    [0.2, '#f3ae98'],
    [0.4, '#d99bb0'],
    [0.65, '#8d78b8'],
    [1, '#4e4a96'],
  ]; // TUNE: dusk from the horizon up
  for (let i = 0; i < n; i++) {
    const t = (pos[i * 3 + 1] ?? 0) / radius;
    let j = 0;
    while (j < stops.length - 2 && t > (stops[j + 1]?.[0] ?? 1)) j += 1;
    const [ta, ha] = stops[j] ?? stops[0] ?? [0, '#ffffff'];
    const [tb, hb] = stops[j + 1] ?? [1, ha];
    const k = Math.min(1, Math.max(0, (t - ta) / (tb - ta || 1)));
    const a = linear(ha);
    const b = linear(hb);
    colors.set([a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k, 1], i * 4);
  }
  dome.setVerticesData(VertexBuffer.ColorKind, colors);
  dome.isPickable = false;
  return dome;
}

// ── The cottage on the Heart Seed tile (home base) ──────────────────

/**
 * The little cottage the home base draws by the Heart Seed (#381), bigger
 * per level's exterior: a hut, a hut with a wing, a two-storey loft, and the
 * heart-tree house with a pink canopy over it. About a metre and a half
 * across at its biggest, foot at the origin, door facing -z (the camera).
 */
export function buildCottage(scene: Scene, exterior: HouseExterior): Mesh {
  const c = HOUSE_COTTAGE;
  const wallC = c.wall;
  const roofC = c.roof;
  const trim = c.trim;
  const parts: Mesh[] = [];
  const house = (x: number, w: number, d: number, h: number, roof: string) => {
    parts.push(box(scene, [w, h, d], [x, h / 2, 0], wallC));
    // A 45° roof; the gable ends are a diamond whose lower half hides in the walls.
    const rise = w / 2;
    const len = Math.hypot(w / 2, rise) + 0.08;
    for (const side of [-1, 1]) {
      const slope = box(
        scene,
        [len, 0.07, d + 0.14],
        [x + (side * w) / 4, h + rise / 2 + 0.03, 0],
        roof,
      );
      slope.rotation.z = -side * (Math.PI / 4);
      parts.push(slope);
    }
    const gable = box(scene, [w / Math.SQRT2, w / Math.SQRT2, d - 0.02], [x, h, 0], wallC);
    gable.rotation.z = Math.PI / 4;
    parts.push(gable);
  };
  const door = (x: number) => parts.push(box(scene, [0.18, 0.28, 0.04], [x, 0.14, -0.31], trim));
  const window_ = (x: number, y: number) =>
    parts.push(box(scene, [0.15, 0.15, 0.04], [x, y, -0.31], c.window));
  switch (exterior) {
    case 'hut':
      house(0, 0.7, 0.6, 0.45, roofC);
      door(0);
      break;
    case 'wing':
      house(-0.2, 0.7, 0.6, 0.45, roofC);
      house(0.38, 0.5, 0.56, 0.36, c.wingRoof);
      door(-0.2);
      window_(0.38, 0.22);
      break;
    case 'loft':
      house(-0.15, 0.8, 0.6, 0.75, roofC);
      house(0.45, 0.45, 0.56, 0.36, c.wingRoof);
      door(-0.15);
      window_(-0.15, 0.55);
      window_(0.45, 0.22);
      break;
    case 'heart-tree': {
      house(-0.1, 1.0, 0.62, 0.8, c.heartRoof);
      house(0.62, 0.45, 0.56, 0.4, c.wingRoof);
      door(-0.1);
      window_(-0.32, 0.58);
      window_(0.12, 0.58);
      parts.push(tube(scene, 0.9, 0.14, 0.2, [-0.75, 0.45, 0.25], c.trunk, 8));
      parts.push(ball(scene, 0.85, [-0.75, 1.1, 0.25], c.canopy[0], [1, 0.85, 1], 12));
      parts.push(ball(scene, 0.55, [-0.48, 1.35, 0.3], c.canopy[1], [1, 0.85, 1], 10));
      break;
    }
  }
  return merged(`house-cottage-${exterior}`, parts);
}

// ── The grown rooms (#381 B3) ───────────────────────────────────────
//
// Pieces for the Playroom, the Kitchen loft and the Heart Hall, built at the
// origin with their front toward local -z (the open front of the dollhouse)
// and placed by the room builders. Boxes and low-segment rounds only
// (`HOUSE_GROWN.segments`/`sides`): at the top level all three rooms share
// what the low tier has left.

const G = HOUSE_GROWN;

/** A flat round facing local -z (a plate on its edge, a painted dot): 8 sides, both faces. */
function flatDisc(scene: Scene, d: number, at: Vec, hex: string): Mesh {
  const m = CreateDisc(
    'house-part',
    { radius: d / 2, tessellation: 8, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  m.position.set(...at);
  return painted(m, hex);
}

/** A play mat of coloured squares, `n` × `n`, lying on y = 0. */
export function playMat(scene: Scene, n = 3): Mesh[] {
  const cell = G.playroom.matCell;
  const half = (n * cell) / 2;
  const parts = [box(scene, [n * cell + 0.12, 0.02, n * cell + 0.12], [0, 0.01, 0], '#fff6ec')];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      parts.push(
        box(
          scene,
          [cell - 0.04, 0.025, cell - 0.04],
          [-half + cell * (i + 0.5), 0.015, -half + cell * (j + 0.5)],
          G.playroom.mat[(i + j * n) % G.playroom.mat.length] ?? '#ffb3c8',
        ),
      );
  return parts;
}

/** A toy chest with its lid propped open and a heart on the front. */
export function toyChest(scene: Scene): Mesh[] {
  const c = G.playroom;
  // The lid stands open, leaning back from its hinge on the back edge.
  const lid = box(scene, [1.06, 0.62, 0.08], [0, 0.88, 0.42], c.chestLid);
  lid.rotation.x = 0.5;
  const heart = box(scene, [0.14, 0.14, 0.02], [0, 0.32, -0.31], '#ff7aa2');
  heart.rotation.z = Math.PI / 4;
  return [
    box(scene, [1.0, 0.56, 0.6], [0, 0.32, 0], c.chest),
    box(scene, [1.04, 0.06, 0.64], [0, 0.07, 0], '#8d5a3b'),
    lid,
    heart,
    flatDisc(scene, 0.1, [-0.05, 0.37, -0.31], '#ff7aa2'),
    flatDisc(scene, 0.1, [0.05, 0.37, -0.31], '#ff7aa2'),
    // Toys peeking out over the rim.
    box(scene, [0.24, 0.24, 0.24], [-0.24, 0.63, 0], '#9ad8ff', 0.3),
    box(scene, [0.2, 0.2, 0.2], [0.18, 0.64, 0.05], '#ffd166', 0.5),
  ];
}

/** A striped play tent (a six-sided cone) with a dark doorway and a flag on top. */
export function playTent(scene: Scene): Mesh[] {
  const c = G.playroom;
  const h = 1.55;
  const flag = CreateDisc(
    'house-part',
    { radius: 0.13, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  flag.position.set(0.1, h + 0.2, 0);
  const door = CreateDisc(
    'house-part',
    { radius: 0.36, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  door.rotation.z = Math.PI / 2; // a point up
  door.scaling.set(1.4, 1, 1);
  door.position.set(0, 0.36, -0.5);
  door.rotation.x = 0.33; // lean with the canvas
  return [
    tube(scene, h, 0, 1.45, [0, h / 2, 0], c.tent, 6),
    // Three bands round the cone, a little proud of the canvas.
    ...[0.3, 0.68, 1.06].map((y) => {
      // Flush with the canvas (a painted band, not a ledge).
      const at = (yy: number) => 1.45 * (1 - yy / h) + 0.01;
      return tube(scene, 0.13, at(y + 0.065), at(y - 0.065), [0, y, 0], c.tentStripe, 6);
    }),
    tube(scene, 0.4, 0.03, 0.03, [0, h + 0.1, 0], '#8d5a3b', 4),
    painted(flag, '#ff9ab8'),
    painted(door, '#6a4f7a'),
  ];
}

/** A star night-light standing on a little block (the star glows): two triangles, point to point. */
export function starLight(scene: Scene): Parts {
  const star = [0, Math.PI].map((turn) => {
    const t = CreateDisc(
      'house-part',
      { radius: 0.26, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    );
    t.rotation.z = Math.PI / 2 + turn; // one point up, one down
    t.position.set(0, 0.46, -0.005 * (turn ? 1 : 0));
    return glowing(t, G.playroom.nightLight);
  });
  return {
    solid: [
      box(scene, [0.3, 0.1, 0.2], [0, 0.05, 0], '#c9a0ff'),
      box(scene, [0.04, 0.16, 0.04], [0, 0.18, 0], '#8d5a3b'),
    ],
    glow: star,
  };
}

/** A little iron stove on legs, its fire glowing through the door, a pot on top and a pipe up to `pipe` metres. */
export function stove(scene: Scene, pipe: number): Parts {
  const c = G.kitchen;
  const solid = [
    box(scene, [0.9, 0.7, 0.62], [0, 0.5, 0], c.stove),
    box(scene, [0.98, 0.06, 0.7], [0, 0.88, 0], '#2f2a36'),
    tube(scene, pipe - 0.9, 0.16, 0.16, [0, 0.9 + (pipe - 0.9) / 2, 0.18], c.stove, G.sides),
    // A round pot with a lid, a knob and a handle.
    tube(scene, 0.26, 0.4, 0.34, [-0.16, 1.04, -0.06], c.pot, 12),
    tube(scene, 0.04, 0.36, 0.42, [-0.16, 1.19, -0.06], c.pot, 12),
    box(scene, [0.07, 0.06, 0.07], [-0.16, 1.24, -0.06], '#2f2a36'),
    box(scene, [0.22, 0.04, 0.05], [0.12, 1.08, -0.06], '#2f2a36'),
  ];
  for (const [lx, lz] of [
    [-0.36, -0.24],
    [0.36, -0.24],
    [-0.36, 0.24],
    [0.36, 0.24],
  ] as const)
    solid.push(box(scene, [0.08, 0.16, 0.08], [lx, 0.08, lz], '#2f2a36'));
  return {
    solid,
    glow: [box(scene, [0.42, 0.28, 0.02], [0, 0.48, -0.31], c.stoveFire)],
  };
}

/** A kitchen counter `w` wide, with cupboard doors on its front. */
export function counter(scene: Scene, w: number): Mesh[] {
  const c = G.kitchen;
  const parts = [
    box(scene, [w, 0.86, 0.6], [0, 0.43, 0], c.counter),
    box(scene, [w + 0.06, 0.06, 0.66], [0, 0.89, -0.01], c.counterTop),
  ];
  const doors = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < doors; i++) {
    const dx = -w / 2 + (w * (i + 0.5)) / doors;
    parts.push(
      box(scene, [w / doors - 0.1, 0.62, 0.02], [dx, 0.45, -0.31], '#fff2e3'),
      box(scene, [0.05, 0.05, 0.04], [dx + (i % 2 ? -0.1 : 0.1), 0.62, -0.33], c.counterTop),
    );
  }
  return parts;
}

/** A round table with a cloth, a pie in the middle and two stools behind it (residents stand in front). */
export function kitchenTable(scene: Scene): Mesh[] {
  const c = G.kitchen;
  const s = G.sides;
  return [
    tube(scene, 0.06, 1.0, 1.0, [0, 0.7, 0], c.table, s),
    tube(scene, 0.12, 1.08, 1.12, [0, 0.66, 0], c.cloth, s),
    tube(scene, 0.62, 0.12, 0.16, [0, 0.33, 0], c.table, s),
    tube(scene, 0.04, 0.5, 0.5, [0, 0.02, 0], c.table, s),
    tube(scene, 0.1, 0.38, 0.42, [0, 0.78, 0], c.pie, s),
    tube(scene, 0.03, 0.3, 0.3, [0, 0.84, 0], '#d9603f', s),
    tube(scene, 0.42, 0.34, 0.3, [-0.55, 0.21, 0.62], c.table, s),
    tube(scene, 0.42, 0.34, 0.3, [0.55, 0.21, 0.62], c.table, s),
  ];
}

/** Two wall shelves `w` wide, lined with jars and plates (against a wall at local +z). */
export function kitchenShelves(scene: Scene, w: number): Mesh[] {
  const c = G.kitchen;
  const parts: Mesh[] = [];
  [1.35, 1.85].forEach((y, row) => {
    parts.push(box(scene, [w, 0.05, 0.26], [0, y, 0], c.shelf));
    const n = Math.max(3, Math.floor(w / 0.42));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / n;
      const hex = c.jars[(i + row * 2) % c.jars.length] ?? '#ffd166';
      parts.push(
        (i + row) % 3 === 2
          ? tube(scene, 0.07, 0.3, 0.26, [x, y + 0.06, -0.03], '#fff6ec', 8) // a stack of white plates
          : tube(scene, 0.22, 0.14, 0.16, [x, y + 0.14, 0], hex, 6),
      );
    }
  });
  return parts;
}

/**
 * The Heart Hall's gallery: a deck `w` wide and `depth` deep standing out
 * from a back wall at local +z, its floor at y = 0 (the scene lifts it to
 * the second storey), with a railing of posts and gold caps along its front
 * and two posts holding it up from `below` metres down.
 */
export function gallery(scene: Scene, w: number, depth: number, below: number): Mesh[] {
  const c = G.hall;
  const front = -depth / 2;
  const parts = [
    box(scene, [w, 0.18, depth], [0, -0.09, 0], c.deck),
    box(scene, [w, 0.22, 0.08], [0, -0.13, front - 0.02], c.rail),
    box(scene, [w, 0.08, 0.1], [0, 0.86, front + 0.06], c.rail),
    box(scene, [w, 0.03, 0.12], [0, 0.915, front + 0.06], c.gold),
  ];
  const posts = Math.max(2, Math.round(w / 1.0));
  const span = w - 0.1; // the end posts stand just clear of the side walls
  for (let i = 0; i <= posts; i++) {
    const x = -span / 2 + (span * i) / posts;
    parts.push(box(scene, [0.07, 0.82, 0.07], [x, 0.41, front + 0.06], c.rail));
  }
  // Posts under the front edge, a third of the way in from each end (clear of the stairs).
  for (const x of [-w * 0.3, w * 0.3])
    parts.push(
      tube(scene, below, 0.18, 0.2, [x, -below / 2, front + 0.05], c.rail, G.sides),
      box(scene, [0.22, 0.08, 0.22], [x, -below + 0.04, front + 0.05], c.gold),
    );
  return parts;
}

/**
 * Stairs `width` wide climbing `rise` metres over `run` toward local +z,
 * starting at the origin: chunky steps, a side board and a handrail with a
 * gold knob at the bottom.
 */
export function stairs(
  scene: Scene,
  width: number,
  rise: number,
  run: number,
  steps: number,
): Mesh[] {
  const c = G.hall;
  const sh = rise / steps;
  const sd = run / steps;
  const parts: Mesh[] = [];
  for (let i = 0; i < steps; i++)
    parts.push(
      box(scene, [width, sh * (i + 1), sd], [0, (sh * (i + 1)) / 2, sd * (i + 0.5)], c.deck),
    );
  const len = Math.hypot(run, rise);
  const tilt = -Math.atan2(rise, run);
  const rail = box(scene, [0.08, 0.08, len], [-width / 2, rise / 2 + 0.85, run / 2], c.rail);
  rail.rotation.x = tilt;
  parts.push(
    rail,
    // The newel post at the bottom, with a gold cap.
    box(scene, [0.12, 0.96, 0.12], [-width / 2, 0.48, 0.1], c.rail),
    box(scene, [0.18, 0.07, 0.18], [-width / 2, 0.99, 0.1], c.gold),
  );
  return parts;
}

/** Where the Heart Tree's crown heart sits, `h` tall: its height and how far in front of the trunk. */
export function heartTreeCrown(h: number): { y: number; z: number; r: number } {
  const r = h * 0.17;
  return { y: h * 0.62 + r * 0.9, z: -r * 0.66 - 0.04, r };
}

/**
 * The Heart Tree, `h` tall, growing up through the hall: a tapering trunk
 * with two boughs, a heart-shaped crown of pink rounds facing local -z with
 * a glowing gold heart at its heart, and gold sparkles round it.
 */
export function heartTree(scene: Scene, h: number): Parts {
  const c = G.hall;
  const trunkH = h * 0.62;
  const { y: top, z: front, r } = heartTreeCrown(h);
  const boughs = [-1, 1].map((side) => {
    const b = tube(scene, h * 0.3, 0.12, 0.2, [side * 0.35, trunkH * 0.82, 0], c.trunk, G.sides);
    b.rotation.z = -side * 0.7;
    return b;
  });
  // A heart: two lobes and a point below, flattened front to back.
  // Its top tucked inside the lobes (render check r3: a wider top showed as pink wings).
  const point = tube(scene, r * 1.8, r * 2.0, 0.05, [0, top - r * 1.2, 0], c.crown[0], 6);
  point.scaling.z = 0.55;
  const solid = [
    tube(scene, trunkH, 0.36, 0.6, [0, trunkH / 2, 0], c.trunk, G.sides),
    ...boughs,
    ball(scene, r * 2.1, [-r * 0.72, top, 0], c.crown[0], [1, 1, 0.62], G.segments),
    ball(scene, r * 2.1, [r * 0.72, top, 0], c.crown[2], [1, 1, 0.62], G.segments),
    point,
    // Roots spreading on the floor, with a gold ring round them.
    tube(scene, 0.12, 1.5, 1.6, [0, 0.06, 0], '#8a6a52', G.sides),
    tube(scene, 0.08, 1.75, 1.75, [0, 0.04, 0], c.gold, G.sides),
  ];
  const heart = goldHeart(scene, r * 0.9);
  for (const m of heart) m.position.addInPlaceFromFloats(0, top - r * 0.1, front);
  const glow: Mesh[] = [...heart];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    // A little diamond: a box stood on its corner.
    const s = glowing(CreateBox('house-part', { size: 0.1 }, scene), c.sparkle);
    s.rotation.set(Math.PI / 4, 0, Math.PI / 4);
    s.position.set(
      Math.cos(a) * r * 1.9,
      top + Math.sin(a * 1.3) * r * 1.1,
      Math.sin(a) * r * 0.7 - 0.2,
    );
    glow.push(s);
  }
  return { solid, glow };
}

/** A paper lantern hanging `drop` metres on its cord below y = 0, glowing, with gold caps. */
export function hangingLantern(scene: Scene, drop: number): Parts {
  const c = G.hall;
  const lamp = glowing(
    CreateCylinder(
      'house-part',
      { height: 0.36, diameterTop: 0.22, diameterBottom: 0.22, tessellation: 6 },
      scene,
    ),
    c.lantern,
  );
  lamp.position.set(0, -drop, 0);
  return {
    solid: [
      box(scene, [0.02, drop - 0.2, 0.02], [0, -(drop - 0.2) / 2, 0], '#5a4a52'),
      tube(scene, 0.05, 0.16, 0.26, [0, -drop + 0.2, 0], c.gold, 6),
      tube(scene, 0.05, 0.26, 0.16, [0, -drop - 0.2, 0], c.gold, 6),
    ],
    glow: [lamp],
  };
}

/** A glowing gold heart facing local -z, `size` metres across: two lobes and a point. */
export function goldHeart(scene: Scene, size: number): Mesh[] {
  const hex = G.hall.gold;
  const r = size * 0.28;
  const lobe = (x: number) => {
    const m = glowing(
      CreateDisc(
        'house-part',
        { radius: r, tessellation: 10, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      ),
      hex,
    );
    m.position.set(x, r * 0.5, 0);
    return m;
  };
  const point = glowing(
    CreateDisc(
      'house-part',
      { radius: size * 0.5, tessellation: 4, sideOrientation: Mesh.DOUBLESIDE },
      scene,
    ),
    hex,
  );
  point.scaling.set(0.92, 0.85, 1);
  point.position.set(0, -r * 0.35, 0.002);
  return [lobe(-r * 0.8), lobe(r * 0.8), point];
}

/** A few toy blocks, a ball-ish block and a book, cheap enough for the top level (Snug's `toys` are rounder). */
export function toyBlocks(scene: Scene): Mesh[] {
  const book = box(scene, [0.34, 0.04, 0.26], [0.9, 0.02, 0.3], '#7fb2e5', 0.3);
  return [
    box(scene, [0.22, 0.22, 0.22], [0, 0.11, 0], '#ffd166', 0.2),
    box(scene, [0.2, 0.2, 0.2], [0.24, 0.1, 0.05], '#9fe0a0', -0.3),
    box(scene, [0.18, 0.18, 0.18], [0.1, 0.31, 0.02], '#ff9ab8', 0.6),
    book,
    box(scene, [0.3, 0.02, 0.22], [0.9, 0.05, 0.3], '#fff6ec', 0.3),
  ];
}

/** An oval rug with a gold edge, lying on y = 0. */
export function ovalRug(scene: Scene, rx: number, rz: number): Mesh[] {
  const c = G.hall;
  return [
    floorDisc(scene, 1, [0, 0.012, 0], c.rugEdge, [rx, rz, 1]),
    floorDisc(scene, 1, [0, 0.016, 0], c.rug, [rx - 0.14, rz - 0.14, 1]),
  ];
}
