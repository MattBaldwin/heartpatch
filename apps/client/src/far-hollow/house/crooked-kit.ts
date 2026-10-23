import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { CrookedSide, CrookedThingKind } from '@heartpatch/shared';
import { box, merged, torus, type Part } from '../../explore/kit-mesh.js';
import { cylinder, shaded, sphere } from '../../explore/land-kit.js';
import { softBox } from '../../hollowed/cellar-kit.js';

// The Crooked House's shapes (#306 6c), from the owner-approved design's
// prototype: the vinyl-toy kit (art bible §1.2: chunky, rounded, soft
// colour), every room one merged, vertex-coloured mesh in room-local metres
// (x east, z north, the floor at y 0). A dark room is drawn grey
// (`joyed(…, 0)`); a room put right is drawn in full colour.

export type V3 = [number, number, number];

/** Hex mixed towards the Hollow's cool grey by `1 - joy` (joy 1 is full colour). */
export function joyed(hex: string, joy: number): string {
  const c = Color3.FromHexString(hex);
  const l = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  const grey = new Color3(l * 0.86 + 0.06, l * 0.84 + 0.05, l * 0.98 + 0.08);
  return Color3.Lerp(grey, c, Math.min(1, Math.max(0, joy))).toHexString();
}

/** A block painted `col` (darker at its foot when `foot` is given), at `at`, turned by `rot`. */
export function blk(
  w: number,
  h: number,
  d: number,
  at: V3,
  col: string,
  o: { rot?: V3; foot?: string; round?: number } = {},
): Part {
  const p =
    o.round === undefined
      ? box({ width: w, height: h, depth: d })
      : softBox(w, h, d, [0, 0, 0], o.round);
  p.position.set(...at);
  if (o.rot) p.rotation.set(...o.rot);
  return shaded(p, o.foot ?? col, col, at[1] - h / 2, at[1] + h / 2);
}

export function ball(d: number, at: V3, col: string, s: V3 = [1, 1, 1]): Part {
  return shaded(sphere(d, 8, at, s), col, col, 0, 1);
}

export function tube(
  h: number,
  top: number,
  bottom: number,
  at: V3,
  col: string,
  tilt: V3 = [0, 0, 0],
): Part {
  return shaded(cylinder(h, top, bottom, 14, at, tilt), col, col, 0, 1);
}

export function ring(d: number, thick: number, at: V3, col: string, rot: V3 = [0, 0, 0]): Part {
  const p = torus({ diameter: d, thickness: thick, tessellation: 20 });
  p.position.set(...at);
  p.rotation.set(...rot);
  return shaded(p, col, col, 0, 1);
}

// Palettes, as full colour; `joyed` greys them. TUNE: all of them.
const WALL = { dado: '#c98a7a', wood: '#7a4a33', trim: '#fff1e8', foot: '#8a5a4c' };
const FLOOR = { board: '#c58b5a', board2: '#b67c4c', rug: '#d94f6d', rug2: '#f7c45a' };
const UPH = {
  arm: '#7cc7a5',
  cushion: '#ffd166',
  table: '#8a5a3c',
  brass: '#f2b84b',
  gold: '#ffd27a',
};

/** Wall height, thickness and lean (the house is crooked: every wall leans a little). */
export const SHELL = { height: 2.3, nearHeight: 0.75, thick: 0.32, lean: 0.045 } as const; // TUNE

/** A gap in a wall: a doorway, `at` metres along it from the wall's middle. */
export interface WallGap {
  readonly side: CrookedSide;
  readonly at: number;
  readonly width: number;
}

/**
 * A room's shell: floorboards, the back and side walls (dado below, paper
 * above, each leaning a little), a low near (south) wall so the floor is
 * never hidden, and dark wooden frames round the doorways.
 */
export function shell(
  w: number,
  d: number,
  joy: number,
  look: { paper: string; floor?: string | undefined },
  gaps: readonly WallGap[],
): Part[] {
  const parts: Part[] = [];
  const paper = joyed(look.paper, joy);
  const dado = joyed(WALL.dado, joy);
  const floor = joyed(look.floor ?? FLOOR.board, joy);
  const floor2 = joyed(look.floor ? look.floor : FLOOR.board2, joy * 0.92);
  const n = Math.max(4, Math.round(d / 0.55));
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + (i + 0.5) * (d / n);
    parts.push(blk(w + 0.3, 0.18, d / n - 0.03, [0, -0.09, z], i % 2 ? floor : floor2));
  }
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const across = side === 'n' || side === 's';
    const len = across ? w : d;
    const h = side === 's' ? SHELL.nearHeight : SHELL.height;
    const here = gaps.filter((g) => g.side === side).sort((a, b) => a.at - b.at);
    const runs: [number, number][] = [];
    let from = -len / 2;
    for (const g of here) {
      runs.push([from, g.at - g.width / 2]);
      from = g.at + g.width / 2;
    }
    runs.push([from, len / 2]);
    const lean: V3 = across
      ? [side === 'n' ? -SHELL.lean : SHELL.lean, 0, 0]
      : [0, 0, side === 'e' ? -SHELL.lean : SHELL.lean];
    const wallAt = (u: number): V3 =>
      across ? [u, 0, side === 'n' ? d / 2 : -d / 2] : [side === 'e' ? w / 2 : -w / 2, 0, u];
    for (const [a, b] of runs) {
      if (b - a < 0.05) continue;
      const at = wallAt((a + b) / 2);
      const L = b - a;
      const T = SHELL.thick;
      const dh = Math.min(0.9, h);
      parts.push(
        blk(across ? L : T, dh, across ? T : L, [at[0], dh / 2, at[2]], dado, {
          rot: lean,
          foot: joyed(WALL.foot, joy),
        }),
      );
      if (h > dh + 0.05) {
        parts.push(
          blk(across ? L : T, h - dh, across ? T : L, [at[0], dh + (h - dh) / 2, at[2]], paper, {
            rot: lean,
          }),
        );
        parts.push(
          blk(
            across ? L + 0.1 : T + 0.1,
            0.12,
            across ? T + 0.1 : L + 0.1,
            [at[0], h, at[2]],
            joyed(WALL.trim, joy),
            {
              rot: lean,
            },
          ),
        );
      }
    }
    const wood = joyed(WALL.wood, joy);
    const ph = side === 's' ? 0.85 : 2.1;
    for (const g of here) {
      for (const u of [g.at - g.width / 2 - 0.08, g.at + g.width / 2 + 0.08]) {
        const p = wallAt(u);
        parts.push(blk(0.22, ph, 0.22, [p[0], ph / 2, p[2]], wood, { round: 0.5 }));
      }
      if (side !== 's') {
        const p = wallAt(g.at);
        parts.push(
          blk(
            across ? g.width + 0.4 : 0.26,
            0.28,
            across ? 0.26 : g.width + 0.4,
            [p[0], ph + 0.1, p[2]],
            wood,
            { round: 0.5 },
          ),
        );
      }
    }
  }
  return parts;
}

/** A shut door slab across a gap, turned to its wall: the lock's or the sleeper's door. */
export function doorSlab(at: V3, side: CrookedSide, width: number, joy: number): Part[] {
  const across = side === 'n' || side === 's';
  const wood = joyed('#9a5f3a', joy);
  const panel = joyed('#b8744a', joy);
  const inward = side === 'n' || side === 'e' ? -1 : 1;
  return across
    ? [
        blk(width, 2.0, 0.12, [at[0], 1.0, at[2]], wood),
        blk(width * 0.7, 1.4, 0.06, [at[0], 1.05, at[2] + inward * 0.08], panel),
      ]
    : [
        blk(0.12, 2.0, width, [at[0], 1.0, at[2]], wood),
        blk(0.06, 1.4, width * 0.7, [at[0] + inward * 0.08, 1.05, at[2]], panel),
      ];
}

/** A chunky toy padlock, bright gold even in a grey room (the one thing you can't miss). */
export function padlock(at: V3): Part[] {
  return [
    blk(0.42, 0.4, 0.2, [at[0], at[1], at[2]], UPH.brass, { round: 0.6, foot: '#d9993a' }),
    ring(0.32, 0.07, [at[0], at[1] + 0.3, at[2]], '#f7e0a0'),
    ball(0.1, [at[0], at[1] - 0.02, at[2] - 0.1], '#5a3a1a'),
  ];
}

/** A chunky key (ring, shaft and bit), gold. */
export function keyShape(yaw = 0.4): Part[] {
  const g = UPH.gold;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (dx: number, dz: number, y = 0): V3 => [dx * c + dz * s, y, -dx * s + dz * c];
  return [
    ring(0.34, 0.09, p(-0.3, 0), g, [0, yaw, 0]),
    tube(0.62, 0.09, 0.09, p(0.18, 0), g, [0, -yaw, Math.PI / 2]),
    blk(0.14, 0.12, 0.08, p(0.42, 0.08), g, { round: 0.5 }),
    blk(0.1, 0.1, 0.08, p(0.3, 0.08), g, { round: 0.5 }),
  ];
}

/** The Keeper's lantern: a dark iron frame round a glowing glass (the glass is its own mesh). */
export function lanternFrame(): Part[] {
  const iron = '#3b2a22';
  return [
    blk(0.3, 0.06, 0.3, [0, -0.2, 0], iron, { round: 0.5 }),
    blk(0.34, 0.06, 0.34, [0, 0.24, 0], iron, { round: 0.5 }),
    tube(0.3, 0.03, 0.03, [0, 0.4, 0], iron),
    ring(0.22, 0.04, [0, 0.58, 0], iron, [Math.PI / 2, 0, 0]),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => tube(0.44, 0.03, 0.03, [sx * 0.13, 0.02, sz * 0.13], iron)),
    ),
  ];
}

export const lanternGlass = (): Part[] => [
  blk(0.24, 0.36, 0.24, [0, 0.02, 0], '#ffd27a', { round: 0.6 }),
];

/** A round rug with a border ring. */
export function rug(at: V3, r: number, joy: number): Part[] {
  return [
    shaded(
      cylinder(0.05, r * 2, r * 2, 28, [at[0], 0.025, at[2]]),
      joyed(FLOOR.rug, joy),
      joyed(FLOOR.rug, joy),
      0,
      1,
    ),
    // A thin rim lying flat on the rug (an inlay the Keeper stands on, never in).
    ring(r * 1.9, 0.05, [at[0], 0.05, at[2]], joyed(FLOOR.rug2, joy)),
  ];
}

/** Flames: a few soft cones, for a glowing material. */
export function flames(at: V3, scale = 1): Part[] {
  const cones: [number, number, number, number][] = [
    [0, 0.0, 0.5, 0.45],
    [-0.22, 0.04, 0.35, 0.3],
    [0.2, 0.02, 0.4, 0.33],
  ];
  return cones.map(([dx, dz, h, d]) =>
    tube(
      h * scale,
      0.02,
      d * scale,
      [at[0] + dx * scale, at[1] + (h * scale) / 2, at[2] + dz * scale],
      '#ffb347',
    ),
  );
}

/** A room's lamp: a brass stand and a shade, warm once lit. */
export function lampStand(joy: number, lit: boolean): Part[] {
  return [
    tube(1.3, 0.06, 0.28, [0, 0.65, 0], joyed(UPH.brass, joy)),
    tube(0.4, 0.3, 0.55, [0, 1.45, 0], lit ? '#fff0c8' : joyed('#e8dcc8', 0)),
  ];
}

// ── Props ──────────────────────────────────────────────────────────────
// Each prop stands upright at the origin, front towards −z (the camera).
// `posed` turns it crooked by how it's put right: tilted for straighten,
// knocked over for lift, dusty for rub, dark for tap-rhythm and relight.

type PropBuilder = (joy: number) => Part[];

const c = (hex: string, joy: number) => joyed(hex, joy);

const PROPS: Readonly<Record<string, PropBuilder>> = {
  picture: (j) => [
    blk(1.1, 0.85, 0.08, [0, 1.5, 0], c(UPH.gold, j), { round: 0.4 }),
    blk(0.9, 0.65, 0.1, [0, 1.5, -0.01], c('#8fc1e3', j)),
    ball(0.28, [-0.15, 1.45, -0.07], c('#f7a1c4', j), [1, 1, 0.2]),
    ball(0.2, [0.2, 1.58, -0.07], c('#ffd166', j), [1, 1, 0.2]),
  ],
  mirror: (j) => [
    blk(0.8, 1.1, 0.08, [0, 1.4, 0], c(UPH.gold, j), { round: 0.5 }),
    blk(0.62, 0.9, 0.1, [0, 1.4, -0.02], c('#dff3ff', j), { round: 0.5 }),
  ],
  armchair: (j) => [
    blk(1.1, 0.5, 1.0, [0, 0.25, 0], c(UPH.arm, j), { round: 0.65 }),
    blk(1.1, 0.8, 0.3, [0, 0.75, 0.38], c(UPH.arm, j), { round: 0.65 }),
    blk(0.25, 0.65, 0.9, [-0.48, 0.55, 0.02], c(UPH.arm, j), { round: 0.65 }),
    blk(0.25, 0.65, 0.9, [0.48, 0.55, 0.02], c(UPH.arm, j), { round: 0.65 }),
    blk(0.6, 0.18, 0.55, [0, 0.55, -0.05], c(UPH.cushion, j), { round: 0.7 }),
  ],
  chair: (j) => [
    blk(0.55, 0.1, 0.55, [0, 0.48, 0], c('#a86a42', j), { round: 0.5 }),
    blk(0.55, 0.6, 0.1, [0, 0.82, 0.24], c('#a86a42', j), { round: 0.5 }),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => tube(0.46, 0.07, 0.07, [sx * 0.22, 0.23, sz * 0.22], c('#8a5a3c', j))),
    ),
    blk(0.45, 0.08, 0.42, [0, 0.55, -0.02], c('#f28fb0', j), { round: 0.7 }),
  ],
  candelabra: (j) => [
    tube(1.3, 0.08, 0.3, [0, 0.65, 0], c(UPH.brass, j)),
    ...[-0.3, 0, 0.3].flatMap((dx) => [
      tube(0.3, 0.05, 0.05, [dx / 2, 1.35, 0], c(UPH.brass, j), [0, 0, Math.PI / 2]),
      tube(0.35, 0.09, 0.09, [dx, 1.5, 0], c('#fff4e0', j)),
    ]),
  ],
  clock: (j) => [
    blk(0.7, 2.1, 0.5, [0, 1.05, 0], c('#6b3d24', j), { round: 0.5, foot: c('#4a2a18', j) }),
    blk(0.85, 0.3, 0.6, [0, 2.2, 0], c('#6b3d24', j), { round: 0.6 }),
    ball(0.5, [0, 1.75, -0.22], c('#fff7e6', j), [1, 1, 0.3]),
    blk(0.04, 0.16, 0.03, [0, 1.8, -0.3], c('#333333', j)),
    ball(0.26, [0, 0.9, -0.2], c(UPH.brass, j), [1, 1, 0.25]),
  ],
  'flower-pots': (j) => [
    tube(0.5, 0.5, 0.38, [-0.35, 0.25, 0], c('#e76f51', j)),
    ball(0.5, [-0.35, 0.62, 0], c('#6fbf73', j)),
    tube(0.4, 0.42, 0.32, [0.35, 0.2, 0.1], c('#e76f51', j)),
    ball(0.36, [0.35, 0.5, 0.1], c('#f7a1c4', j)),
  ],
  'bird-cage': (j) => [
    tube(1.0, 0.05, 0.05, [0, 0.5, 0], c(UPH.brass, j)),
    ...[0, 1, 2, 3, 4, 5].map((i) =>
      tube(0.7, 0.03, 0.03, [Math.cos(i) * 0.28, 1.35, Math.sin(i) * 0.28], c(UPH.gold, j)),
    ),
    ball(0.64, [0, 1.72, 0], c(UPH.gold, j), [1, 0.4, 1]),
    ball(0.2, [0, 1.25, 0], c('#ffd166', j)),
  ],
  'watering-can': (j) => [
    tube(0.45, 0.42, 0.46, [0, 0.23, 0], c('#7fb8d8', j)),
    tube(0.5, 0.05, 0.08, [0.32, 0.4, 0], c('#7fb8d8', j), [0, 0, -0.9]),
    ring(0.3, 0.05, [-0.1, 0.5, 0], c('#5a9cc0', j), [0, Math.PI / 2, 0]),
  ],
  lamp: (j) => lampStand(j, false),
  runner: (j) => [
    blk(1.0, 0.04, 2.6, [0, 0.02, 0], c('#c94f6d', j)),
    blk(0.7, 0.05, 2.3, [0, 0.03, 0], c('#f7c45a', j)),
  ],
  banister: (j) => [
    ...[0, 1, 2, 3, 4].map((i) =>
      blk(1.3, 0.22, 0.42, [0, 0.11 + i * 0.22, i * 0.44 - 0.9], c('#a67c52', j), { round: 0.3 }),
    ),
    tube(1.6, 0.08, 0.08, [-0.6, 0.9, 0], c('#7a4a33', j), [0.55, 0, 0]),
  ],
  tablecloth: (j) => [
    blk(3.0, 0.12, 1.2, [0, 0.78, 0], c('#8a5a3c', j), { round: 0.5 }),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => tube(0.72, 0.1, 0.1, [sx * 1.3, 0.36, sz * 0.45], c('#8a5a3c', j))),
    ),
    blk(2.6, 0.04, 1.4, [0, 0.86, 0], c('#fff1f4', j)),
  ],
  'soup-bowl': (j) => [
    tube(0.2, 0.42, 0.26, [0, 0.1, 0], c('#f7b7c8', j)),
    tube(0.04, 0.36, 0.36, [0, 0.2, 0], c('#ffb347', j)),
  ],
  'book-pile': (j) =>
    ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6'].map((hex, i) =>
      blk(0.5, 0.14, 0.36, [0, 0.07 + i * 0.14, 0], c(hex, j), {
        rot: [0, i * 0.35, 0],
        round: 0.3,
      }),
    ),
  globe: (j) => [
    tube(0.7, 0.1, 0.34, [0, 0.35, 0], c('#6b3d24', j)),
    ball(0.6, [0, 1.0, 0], c('#7fb8d8', j)),
    ball(0.3, [0.12, 1.1, -0.18], c('#6fbf73', j), [1, 0.8, 0.5]),
    ring(0.72, 0.04, [0, 1.0, 0], c(UPH.brass, j), [0, 0, 0.4]),
  ],
  'reading-lamps': (j) => [
    blk(1.2, 0.7, 0.6, [0, 0.35, 0], c('#6b3d24', j), { round: 0.4 }),
    ...[-0.35, 0.35].flatMap((dx) => [
      tube(0.4, 0.04, 0.12, [dx, 0.9, 0], c(UPH.brass, j)),
      tube(0.24, 0.16, 0.3, [dx, 1.18, 0], c('#9fd8a8', j)),
    ]),
  ],
  stove: (j) => [
    blk(1.4, 1.0, 0.8, [0, 0.5, 0], c('#4a4650', j), { round: 0.5 }),
    tube(1.4, 0.2, 0.2, [0.4, 1.7, 0.2], c('#4a4650', j)),
    tube(0.35, 0.3, 0.4, [-0.3, 1.17, -0.1], c('#d9d4cf', j)),
  ],
  tap: (j) => [
    blk(1.4, 0.9, 0.6, [0, 0.45, 0], c('#7fb8d8', j), { round: 0.4 }),
    blk(1.0, 0.12, 0.5, [0, 0.95, 0], c('#f1e8dc', j), { round: 0.5 }),
    tube(0.4, 0.06, 0.06, [0, 1.2, 0.15], c('#c0c4c8', j)),
    tube(0.25, 0.05, 0.05, [0, 1.38, 0.03], c('#c0c4c8', j), [Math.PI / 2, 0, 0]),
  ],
  pans: (j) => [
    tube(0.16, 0.6, 0.55, [0, 0.08, 0], c('#5a5560', j)),
    tube(0.5, 0.06, 0.06, [0.5, 0.1, 0], c('#3b2a22', j), [0, 0, Math.PI / 2]),
    tube(0.14, 0.45, 0.42, [-0.1, 0.24, 0.05], c('#7a6a72', j)),
  ],
  'cookie-jar': (j) => [
    blk(1.2, 0.9, 0.6, [0, 0.45, 0], c('#7fb8d8', j), { round: 0.4 }),
    blk(1.3, 0.1, 0.7, [0, 0.95, 0], c('#f1e8dc', j), { round: 0.5 }),
    tube(0.55, 0.45, 0.4, [0, 1.27, 0], c('#f7b7c8', j)),
    tube(0.1, 0.5, 0.5, [0, 1.6, 0], c('#f7b7c8', j)),
  ],
  mop: (j) => [
    tube(1.5, 0.05, 0.05, [0, 0.85, 0], c('#a67c52', j)),
    ball(0.4, [0, 0.12, 0], c('#e8dcc8', j), [1, 0.5, 1]),
  ],
  bucket: (j) => [
    tube(0.5, 0.52, 0.42, [0, 0.25, 0], c('#7fb8d8', j)),
    ring(0.5, 0.03, [0, 0.55, 0], c('#c0c4c8', j), [0, 0, Math.PI / 2]),
  ],
  'hat-stand': (j) => [
    tube(1.7, 0.07, 0.07, [0, 0.85, 0], c('#6b3d24', j)),
    tube(0.06, 0.5, 0.5, [0, 0.03, 0], c('#6b3d24', j)),
    ball(0.42, [0.1, 1.75, 0], c('#7c6bb8', j), [1, 0.6, 1]),
  ],
  bed: (j) => [
    blk(1.6, 0.5, 2.2, [0, 0.25, 0], c('#8a5a3c', j), { round: 0.4 }),
    blk(1.5, 0.22, 2.0, [0, 0.6, 0.05], c('#fff7e6', j), { round: 0.7 }),
    blk(1.5, 0.14, 1.3, [0, 0.74, -0.35], c('#8fb8e8', j), { round: 0.7 }),
    blk(0.9, 0.2, 0.4, [0, 0.8, 0.8], c('#ffffff', j), { round: 0.8 }),
    blk(1.6, 0.9, 0.16, [0, 0.7, 1.12], c('#8a5a3c', j), { round: 0.4 }),
  ],
  drawers: (j) => [
    blk(1.1, 1.0, 0.55, [0, 0.5, 0], c('#a86a42', j), { round: 0.4 }),
    ...[0.3, 0.62].map((y) => blk(0.9, 0.24, 0.06, [0, y, -0.28], c('#c98a5a', j), { round: 0.5 })),
    ...[0.3, 0.62].map((y) => ball(0.08, [0, y, -0.32], c(UPH.brass, j))),
  ],
  'rocking-horse': (j) => [
    ring(1.2, 0.08, [0, 0.0, 0], c('#a86a42', j), [0, Math.PI / 2, Math.PI / 2]),
    blk(0.9, 0.36, 0.34, [0, 0.62, 0], c('#f7f0e6', j), { round: 0.7 }),
    blk(0.26, 0.4, 0.3, [0.42, 0.92, 0], c('#f7f0e6', j), { round: 0.7 }),
    blk(0.14, 0.3, 0.06, [0.38, 1.0, 0], c('#e76f51', j), { round: 0.6 }),
  ],
  blocks: (j) =>
    ['#e76f51', '#ffd166', '#6fbf73', '#8ecae6'].map((hex, i) =>
      blk(
        0.32,
        0.32,
        0.32,
        [(i % 2) * 0.36 - 0.18, 0.16 + Math.floor(i / 2) * 0.32, 0],
        c(hex, j),
        { round: 0.5 },
      ),
    ),
  mobile: (j) => [
    tube(0.04, 0.9, 0.9, [0, 2.0, 0], c(UPH.brass, j)),
    ...[0, 1, 2, 3].map((i) =>
      ball(
        0.22,
        [Math.cos(i * 1.57) * 0.4, 1.7, Math.sin(i * 1.57) * 0.4],
        c(['#f7a1c4', '#ffd166', '#8ecae6', '#cdb4db'][i] ?? '#fff', j),
      ),
    ),
  ],
  'toy-chest': (j) => [
    blk(1.0, 0.6, 0.6, [0, 0.3, 0], c('#e9a0b8', j), { round: 0.45 }),
    blk(1.05, 0.14, 0.65, [0, 0.64, 0], c('#f7c45a', j), { round: 0.5 }),
  ],
  'piano-lid': (j) => [
    blk(1.6, 1.1, 0.7, [0, 0.55, 0], c('#3b2a3a', j), { round: 0.35 }),
    blk(1.4, 0.06, 0.3, [0, 0.82, -0.42], c('#fff7e6', j)),
    blk(1.6, 0.06, 0.7, [0, 1.13, 0], c('#4a3550', j)),
  ],
  'music-stands': (j) => [
    tube(1.1, 0.04, 0.04, [0, 0.55, 0], c('#3b2a22', j)),
    blk(0.5, 0.36, 0.04, [0, 1.15, 0], c('#3b2a22', j), { rot: [-0.3, 0, 0] }),
    blk(0.4, 0.28, 0.02, [0, 1.17, -0.04], c('#fff7e6', j), { rot: [-0.3, 0, 0] }),
  ],
  'music-box': (j) => [
    blk(0.7, 0.4, 0.5, [0, 0.6, 0], c('#c98a5a', j), { round: 0.4 }),
    tube(0.4, 0.12, 0.3, [0, 0.2, 0], c('#6b3d24', j)),
    ball(0.24, [0, 0.9, 0], c('#ffd166', j)),
  ],
  yarn: (j) => [
    ball(0.4, [-0.2, 0.2, 0], c('#e76f51', j)),
    ball(0.34, [0.25, 0.17, 0.1], c('#8ecae6', j)),
    ball(0.3, [0, 0.15, -0.3], c('#cdb4db', j)),
  ],
  'dress-form': (j) => [
    tube(1.0, 0.05, 0.05, [0, 0.5, 0], c('#3b2a22', j)),
    ball(0.6, [0, 1.25, 0], c('#f7e0c8', j), [1, 1.4, 0.8]),
    tube(0.06, 0.4, 0.4, [0, 0.03, 0], c('#3b2a22', j)),
  ],
  'pin-cushion': (j) => [
    blk(0.9, 0.8, 0.5, [0, 0.4, 0], c('#a86a42', j), { round: 0.4 }),
    ball(0.36, [0, 0.96, 0], c('#e9476f', j), [1, 0.6, 1]),
  ],
  'sewing-basket': (j) => [
    tube(0.4, 0.66, 0.56, [0, 0.2, 0], c('#c9a46a', j)),
    ring(0.5, 0.05, [0, 0.45, 0], c('#a67c52', j), [0, 0, Math.PI / 2]),
  ],
};

/** A thing with no shape of its own yet: a soft crate, so new data still draws. */
const fallbackProp: PropBuilder = (j) => [
  blk(0.7, 0.6, 0.6, [0, 0.3, 0], c('#b89a7a', j), { round: 0.45 }),
];

/** The props the kit draws by name (the data's `prop`). */
export const propNames = (): readonly string[] => Object.keys(PROPS);

/**
 * A crooked thing in place, room-local: upright once put right, else crooked
 * the way it's put right. Wall props (`at` near a wall) keep to the wall.
 */
export function prop(
  name: string,
  kind: CrookedThingKind,
  fixed: boolean,
  joy: number,
  at: readonly [number, number],
): Part {
  // A dusty or dark thing is greyer until it's put right, even in colour.
  const dull = !fixed && (kind === 'rub' || kind === 'tap-rhythm' || kind === 'relight');
  const one = merged((PROPS[name] ?? fallbackProp)(dull ? joy * 0.35 : joy));
  one.position.set(at[0], 0, at[1]);
  if (!fixed && kind === 'straighten') one.rotation.set(0, 0, 0.32);
  if (!fixed && kind === 'lift') {
    // Knocked over onto its side, lying on the floor.
    one.rotation.set(0, 0.6, Math.PI / 2);
    one.position.y = 0.3;
  }
  return one;
}
