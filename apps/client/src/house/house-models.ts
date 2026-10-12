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
import { HOUSE_COTTAGE, HOUSE_PALETTE } from './house-config.js';
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
      [len, 0.08, d + 0.3],
      [cx + (side * half) / 2, y + rise / 2 + 0.04, z0 + d / 2],
      '#e2b088',
    );
    slope.rotation.z = -side * angle;
    solid.push(slope);
    for (let z = z0 + 0.5; z < z0 + d; z += 1.0) {
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
  const flags = ['#ff9ab8', '#ffd166', '#9ad8ff', '#c9a0ff', '#9fe0a0'];
  for (const [t, drop] of [
    [0.35, 0.55],
    [0.7, 0.5],
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
  solid.push(
    ball(scene, 0.5, [cx - 2.6, -0.1, front - 0.7], '#ff9a3c', [1.1, 0.8, 1.1]),
    ball(scene, 0.38, [cx + 2.8, -0.15, front - 0.9], '#f08a2c', [1.1, 0.8, 1.1]),
  );
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
