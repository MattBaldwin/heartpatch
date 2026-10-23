// PROTOTYPE ONLY (#306 Crooked House design lane). Never merged: shapes for
// the design mockups, in the vinyl-toy style on the explore kit. Chunky,
// rounded, soft colour; every room is one merged vertex-coloured mesh.
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { box, kitMesh, merged, torus, type Part } from '../../explore/kit-mesh.js';
import { cylinder, shaded, sphere } from '../../explore/land-kit.js';
import { softBox } from '../cellar-kit.js';

/** Hex mixed towards a cool Hollow grey by `1 - joy` (joy 1 is full colour). */
export function joyed(hex: string, joy: number): string {
  const c = Color3.FromHexString(hex);
  const l = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  const g = new Color3(l * 0.86 + 0.06, l * 0.84 + 0.05, l * 0.98 + 0.08);
  const m = Color3.Lerp(g, c, joy);
  return m.toHexString();
}

export type V3 = [number, number, number];

/** A block painted `col` (darker at its foot when `foot` is given), moved to `at`, turned by `rot`. */
export function blk(
  w: number,
  h: number,
  d: number,
  at: V3,
  col: string,
  o: { rot?: V3; foot?: string; round?: number } = {},
): Part {
  const p = o.round === undefined ? box({ width: w, height: h, depth: d }) : softBox(w, h, d, [0, 0, 0], o.round);
  p.position.set(...at);
  if (o.rot) p.rotation.set(...o.rot);
  return shaded(p, o.foot ?? col, col, at[1] - h / 2, at[1] + h / 2);
}

export function ball(d: number, at: V3, col: string, s: V3 = [1, 1, 1]): Part {
  return shaded(sphere(d, 8, at, s), col, col, 0, 1);
}

export function tube(h: number, top: number, bottom: number, at: V3, col: string, tilt: V3 = [0, 0, 0]): Part {
  return shaded(cylinder(h, top, bottom, 14, at, tilt), col, col, 0, 1);
}

export function ring(d: number, thick: number, at: V3, col: string, rot: V3 = [0, 0, 0]): Part {
  const p = torus({ diameter: d, thickness: thick, tessellation: 20 });
  p.position.set(...at);
  p.rotation.set(...rot);
  return shaded(p, col, col, 0, 1);
}

/** One mesh of these parts in `scene`, by a unique `name`. */
export function build(scene: Scene, name: string, parts: readonly Part[]): Mesh {
  return kitMesh(scene, name, () => merged(parts));
}

// Palettes (TUNE), as full-colour; `joyed` greys them.
export const WALL = { paper: '#f3dcd0', paper2: '#e9cfe2', dado: '#c98a7a', wood: '#7a4a33', trim: '#fff1e8' };
export const FLOOR = { board: '#c58b5a', board2: '#b67c4c', rug: '#d94f6d', rug2: '#f7c45a', stone: '#9b948c' };
export const UPH = { arm: '#7cc7a5', cushion: '#ffd166', table: '#8a5a3c', brass: '#f2b84b', gold: '#ffd27a' };

/** A room's shell: floor, skirting, back and side walls (crooked: each leans a little), a stub front wall. */
export function shell(
  w: number,
  d: number,
  joy: number,
  o: { paper?: string; floor?: string; openings?: { side: 'n' | 's' | 'e' | 'w'; at: number; width: number }[]; lean?: number; wallH?: number } = {},
): Part[] {
  const parts: Part[] = [];
  const paper = joyed(o.paper ?? WALL.paper, joy);
  const dado = joyed(WALL.dado, joy);
  const floor = joyed(o.floor ?? FLOOR.board, joy);
  const floor2 = joyed(FLOOR.board2, joy);
  const H = o.wallH ?? 2.3;
  const lean = o.lean ?? 0.045;
  const T = 0.32;
  // Floorboards: strips along x.
  const n = Math.max(4, Math.round(d / 0.55));
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + (i + 0.5) * (d / n);
    parts.push(blk(w + 0.3, 0.18, d / n - 0.03, [0, -0.09, z], i % 2 ? floor : floor2));
  }
  const openings = o.openings ?? [];
  const wallWith = (side: 'n' | 's' | 'e' | 'w'): void => {
    const horizontal = side === 'n' || side === 's';
    const len = horizontal ? w : d;
    const h = side === 's' ? 0.75 : H;
    const gaps = openings.filter((g) => g.side === side).sort((a, b) => a.at - b.at);
    let from = -len / 2;
    const segs: [number, number][] = [];
    for (const g of gaps) {
      segs.push([from, g.at - g.width / 2]);
      from = g.at + g.width / 2;
    }
    segs.push([from, len / 2]);
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      const mid = (a + b) / 2;
      const L = b - a;
      const leanRot: V3 = horizontal
        ? [side === 'n' ? -lean : lean, 0, 0]
        : [0, 0, side === 'e' ? -lean : lean];
      const at: V3 = horizontal
        ? [mid, h / 2, side === 'n' ? d / 2 : -d / 2]
        : [side === 'e' ? w / 2 : -w / 2, h / 2, mid];
      // Dado below, paper above (the papered part), a pale top rail.
      const dh = Math.min(0.9, h);
      parts.push(blk(horizontal ? L : T, dh, horizontal ? T : L, [at[0], dh / 2, at[2]], dado, { rot: leanRot, foot: joyed('#8a5a4c', joy) }));
      if (h > dh + 0.05) {
        parts.push(blk(horizontal ? L : T, h - dh, horizontal ? T : L, [at[0], dh + (h - dh) / 2, at[2]], paper, { rot: leanRot }));
        parts.push(blk(horizontal ? L + 0.1 : T + 0.1, 0.12, horizontal ? T + 0.1 : L + 0.1, [at[0], h, at[2]], joyed(WALL.trim, joy), { rot: leanRot }));
      }
    }
    // Door frames for the gaps: posts and a rounded lintel in dark wood.
    for (const g of gaps) {
      const wood = joyed(WALL.wood, joy);
      const post = (u: number): V3 => (horizontal ? [u, 1.05, side === 'n' ? d / 2 : -d / 2] : [side === 'e' ? w / 2 : -w / 2, 1.05, u]);
      const ph = side === 's' ? 0.85 : 2.1;
      for (const u of [g.at - g.width / 2 - 0.08, g.at + g.width / 2 + 0.08]) {
        const p = post(u);
        parts.push(blk(0.22, ph, 0.22, [p[0], ph / 2, p[2]], wood, { round: 0.5 }));
      }
      if (side !== 's') {
        const p = post(g.at);
        parts.push(blk(horizontal ? g.width + 0.4 : 0.26, 0.28, horizontal ? 0.26 : g.width + 0.4, [p[0], ph + 0.1, p[2]], wood, { round: 0.5 }));
      }
    }
  };
  for (const s of ['n', 's', 'e', 'w'] as const) wallWith(s);
  return parts;
}

/** A door slab in a wall gap: shut (with a big padlock when `locked`) or swung open. */
export function door(at: V3, side: 'n' | 'e' | 'w', width: number, joy: number, state: 'locked' | 'open' | 'shut'): Part[] {
  const wood = joyed('#9a5f3a', joy);
  const panel = joyed('#b8744a', joy);
  const parts: Part[] = [];
  const horizontal = side === 'n';
  const yaw = state === 'open' ? (horizontal ? 1.35 : 0) : 0;
  const swingRot: V3 = state === 'open' ? (horizontal ? [0, -yaw, 0] : [0, side === 'e' ? -1.35 : 1.35, 0]) : [0, 0, 0];
  // The hinge is on the gap's left post; an open door is a slab turned about it.
  const hinge: V3 = horizontal ? [at[0] - width / 2, 0, at[2]] : [at[0], 0, at[2] - width / 2];
  const slab = (w: number, h: number, d: number, off: V3, col: string): Part => {
    const p = box({ width: w, height: h, depth: d });
    // Offset within the door's own frame, then rotate about the hinge, then place.
    const c = Math.cos(swingRot[1]);
    const s = Math.sin(swingRot[1]);
    const ox = off[0] * c + off[2] * s;
    const oz = -off[0] * s + off[2] * c;
    p.position.set(hinge[0] + ox, off[1], hinge[2] + oz);
    p.rotation.set(0, swingRot[1], 0);
    return shaded(p, col, col, 0, 1);
  };
  if (horizontal) {
    parts.push(slab(width, 2.0, 0.12, [width / 2, 1.0, 0], wood));
    parts.push(slab(width * 0.7, 1.4, 0.06, [width / 2, 1.05, -0.08], panel));
  } else {
    parts.push(slab(0.12, 2.0, width, [0, 1.0, width / 2], wood));
    parts.push(slab(0.06, 1.4, width * 0.7, [side === 'e' ? -0.08 : 0.08, 1.05, width / 2], panel));
  }
  if (state === 'locked') {
    // A chunky toy padlock, bright gold even in a grey room (it's the one thing you can't miss).
    const g = UPH.brass;
    const lx = horizontal ? at[0] : at[0] + (side === 'e' ? -0.2 : 0.2);
    const lz = horizontal ? at[2] - 0.2 : at[2];
    parts.push(blk(0.42, 0.4, 0.2, [lx, 0.95, lz], g, { round: 0.6, foot: '#d9993a' }));
    parts.push(ring(0.32, 0.07, [lx, 1.25, lz], '#f7e0a0', [0, 0, 0]));
    parts.push(ball(0.1, [lx, 0.93, lz - 0.1], '#5a3a1a'));
  }
  return parts;
}

/** A tall grandfather clock with a round face; the Brass Key hides behind its little door. */
export function clock(at: V3, joy: number): Part[] {
  const wood = joyed('#6b3d24', joy);
  return [
    blk(0.7, 2.1, 0.5, [at[0], 1.05, at[2]], wood, { round: 0.5, foot: joyed('#4a2a18', joy) }),
    blk(0.85, 0.3, 0.6, [at[0], 2.2, at[2]], wood, { round: 0.6 }),
    ball(0.5, [at[0], 1.75, at[2] - 0.22], joyed('#fff7e6', joy), [1, 1, 0.3]),
    blk(0.04, 0.16, 0.03, [at[0], 1.8, at[2] - 0.3], joyed('#333', joy)),
    blk(0.12, 0.04, 0.03, [at[0] + 0.05, 1.75, at[2] - 0.3], joyed('#333', joy)),
    ball(0.26, [at[0], 0.9, at[2] - 0.2], joyed(UPH.brass, joy), [1, 1, 0.25]),
  ];
}

/** A framed picture on the wall behind, straight or askew (the fix). */
export function picture(at: V3, joy: number, askew: boolean): Part[] {
  const rot: V3 = askew ? [0, 0, 0.32] : [0, 0, 0];
  return [
    blk(1.1, 0.85, 0.08, at, joyed(UPH.gold, joy), { rot, round: 0.4 }),
    blk(0.9, 0.65, 0.1, [at[0], at[1], at[2] - 0.01], joyed('#8fc1e3', joy), { rot }),
    ball(0.28, [at[0] - 0.15, at[1] - 0.05, at[2] - 0.07], joyed('#f7a1c4', joy), [1, 1, 0.2]),
    ball(0.2, [at[0] + 0.2, at[1] + 0.08, at[2] - 0.07], joyed('#ffd166', joy), [1, 1, 0.2]),
  ];
}

/** A squashy armchair, upright or toppled on its side (the fix). */
export function armchair(at: V3, joy: number, toppled: boolean, yaw = 0): Part[] {
  const c = joyed(UPH.arm, joy);
  const cush = joyed(UPH.cushion, joy);
  const parts = [
    blk(1.1, 0.5, 1.0, [0, 0.25, 0], c, { round: 0.65 }),
    blk(1.1, 0.8, 0.3, [0, 0.75, 0.38], c, { round: 0.65 }),
    blk(0.25, 0.65, 0.9, [-0.48, 0.55, 0.02], c, { round: 0.65 }),
    blk(0.25, 0.65, 0.9, [0.48, 0.55, 0.02], c, { round: 0.65 }),
    blk(0.6, 0.18, 0.55, [0, 0.55, -0.05], cush, { round: 0.7 }),
  ];
  // Re-place each part: rotate the whole chair (and tip it over when toppled).
  return parts.map((p) => {
    const pos = p.data.positions ?? [];
    for (let i = 0; i < pos.length; i += 3) {
      let x = pos[i] ?? 0;
      let y = pos[i + 1] ?? 0;
      let z = pos[i + 2] ?? 0;
      if (toppled) {
        // Lie on the right side: rotate about z by -90°, then lift so it rests on the floor.
        const nx = y;
        const ny = -x + 0.55;
        x = nx;
        y = ny;
      }
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const rx = x * cy + z * sy;
      const rz = -x * sy + z * cy;
      pos[i] = rx + at[0];
      pos[i + 1] = y + at[1];
      pos[i + 2] = rz + at[2];
    }
    return p;
  });
}

/** A round rug with a border ring. */
export function rug(at: V3, r: number, joy: number): Part[] {
  return [
    shaded(cylinder(0.05, r * 2, r * 2, 28, [at[0], 0.025, at[2]]), joyed(FLOOR.rug, joy), joyed(FLOOR.rug, joy), 0, 1),
    ring(r * 1.9, 0.12, [at[0], 0.05, at[2]], joyed(FLOOR.rug2, joy), [Math.PI / 2, 0, 0]),
  ];
}

/** A stone fireplace in the back wall: cold (grey logs) or lit (orange logs; flames come separately). */
export function fireplace(at: V3, joy: number, lit: boolean): Part[] {
  const stone = joyed('#aaa198', joy);
  const dark = '#1e1820';
  return [
    blk(2.2, 1.9, 0.5, [at[0], 0.95, at[2] + 0.1], stone, { round: 0.45, foot: joyed('#7a736c', joy) }),
    blk(1.3, 1.2, 0.56, [at[0], 0.6, at[2] + 0.05], dark),
    blk(2.6, 0.22, 0.7, [at[0], 1.95, at[2]], joyed('#c9bfb2', joy), { round: 0.6 }),
    blk(2.4, 0.1, 1.0, [at[0], 0.05, at[2] - 0.45], joyed('#8e867e', joy), { round: 0.5 }),
    tube(0.9, 0.22, 0.22, [at[0] - 0.2, 0.2, at[2] - 0.05], lit ? '#7a4a2a' : joyed('#6b4a3a', 0), [0, 0, Math.PI / 2]),
    tube(0.8, 0.2, 0.2, [at[0] + 0.15, 0.32, at[2] - 0.1], lit ? '#8a5a33' : joyed('#6b4a3a', 0), [0, 0.5, Math.PI / 2]),
  ];
}

/** Flames: a few soft cones, meant for an emissive material (they bloom). */
export function flames(at: V3, scale = 1): Part[] {
  const f: Part[] = [];
  const cones: [number, number, number, number][] = [
    [0, 0.0, 0.5, 0.45],
    [-0.22, 0.04, 0.35, 0.3],
    [0.2, 0.02, 0.4, 0.33],
    [0.05, 0.1, 0.25, 0.22],
  ];
  for (const [dx, dz, h, d] of cones) {
    f.push(tube(h * scale, 0.02, d * scale, [at[0] + dx * scale, at[1] + (h * scale) / 2, at[2] + dz * scale], '#ffb347'));
  }
  return f;
}

/** A floor candelabra: post, three arms, three candles (the flames come separately when lit). */
export function candelabra(at: V3, joy: number): Part[] {
  const brass = joyed(UPH.brass, joy);
  const wax = joyed('#fff4e0', joy);
  const p: Part[] = [tube(1.3, 0.08, 0.3, [at[0], 0.65, at[2]], brass)];
  for (const dx of [-0.3, 0, 0.3]) {
    p.push(tube(0.4, 0.05, 0.05, [at[0] + dx / 2, 1.35, at[2]], brass, [0, 0, Math.PI / 2]));
    p.push(tube(0.35, 0.09, 0.09, [at[0] + dx, 1.5, at[2]], wax));
  }
  return p;
}

/** A side table with a lamp. */
export function sideTable(at: V3, joy: number, lampLit: boolean): Part[] {
  return [
    tube(0.7, 0.1, 0.1, [at[0], 0.35, at[2]], joyed(UPH.table, joy)),
    blk(0.7, 0.08, 0.7, [at[0], 0.72, at[2]], joyed(UPH.table, joy), { round: 0.7 }),
    tube(0.35, 0.07, 0.12, [at[0], 0.93, at[2]], joyed(UPH.brass, joy)),
    tube(0.35, 0.22, 0.4, [at[0], 1.25, at[2]], lampLit ? '#fff0c8' : joyed('#fff0c8', joy)),
  ];
}

/** A chunky key (ring, shaft and bit), gold. */
export function key(at: V3, yaw = 0.4): Part[] {
  const g = '#ffd27a';
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (dx: number, dz: number): V3 => [at[0] + dx * c + dz * s, at[1], at[2] - dx * s + dz * c];
  return [
    ring(0.34, 0.09, p(-0.3, 0), g, [0, yaw, 0]),
    tube(0.62, 0.09, 0.09, p(0.18, 0), g, [0, 0, Math.PI / 2]),
    blk(0.14, 0.12, 0.08, p(0.42, 0.08), g, { round: 0.5 }),
    blk(0.1, 0.1, 0.08, p(0.3, 0.08), g, { round: 0.5 }),
  ].map((part) => part);
}

/** A sparkle star: four thin bars, for an emissive material. */
export function sparkle(at: V3, size: number): Part[] {
  return [
    blk(size, size * 0.18, size * 0.18, at, '#fff6d6', { round: 0.3 }),
    blk(size * 0.18, size, size * 0.18, at, '#fff6d6', { round: 0.3 }),
    blk(size * 0.18, size * 0.18, size, at, '#fff6d6', { round: 0.3 }),
  ];
}

/** A cookie jar on a kitchen counter, lid off (the key was in it). */
export function counterWithJar(at: V3, joy: number): Part[] {
  return [
    blk(2.2, 0.9, 0.7, [at[0], 0.45, at[2]], joyed('#7fb8d8', joy), { round: 0.4 }),
    blk(2.35, 0.1, 0.85, [at[0], 0.95, at[2]], joyed('#f1e8dc', joy), { round: 0.5 }),
    tube(0.55, 0.45, 0.4, [at[0] - 0.5, 1.27, at[2]], joyed('#f7b7c8', joy)),
    tube(0.1, 0.5, 0.5, [at[0] + 0.25, 1.05, at[2] - 0.15], joyed('#f7b7c8', joy), [0.3, 0, 0.4]),
    blk(0.5, 0.5, 0.5, [at[0] + 0.7, 1.25, at[2]], joyed('#8fd3a3', joy), { round: 0.7 }),
  ];
}

/** A cold iron stove with a kettle. */
export function stove(at: V3, joy: number): Part[] {
  return [
    blk(1.4, 1.0, 0.8, [at[0], 0.5, at[2]], joyed('#4a4650', joy), { round: 0.5 }),
    tube(1.6, 0.2, 0.2, [at[0] + 0.4, 1.8, at[2] + 0.2], joyed('#4a4650', joy)),
    tube(0.35, 0.3, 0.4, [at[0] - 0.3, 1.17, at[2] - 0.1], joyed('#d9d4cf', joy)),
  ];
}

/** A wisp of Hollow echo: a dark lavender teardrop with two glowing eyes (eyes come separately). */
export function echoBody(at: V3): Part[] {
  const c = '#2a1f45';
  return [
    ball(0.9, [at[0], at[1], at[2]], c, [1, 1.15, 1]),
    ball(0.5, [at[0] + 0.1, at[1] - 0.45, at[2] + 0.35], c, [1, 0.8, 1.4]),
    ball(0.3, [at[0] + 0.2, at[1] - 0.7, at[2] + 0.75], c),
  ];
}

export function echoEyes(at: V3): Part[] {
  return [
    ball(0.2, [at[0] - 0.18, at[1] + 0.08, at[2] - 0.38], '#e9d9ff', [1, 1.3, 0.6]),
    ball(0.2, [at[0] + 0.18, at[1] + 0.08, at[2] - 0.38], '#e9d9ff', [1, 1.3, 0.6]),
  ];
}

/** The attic: sloped roof beams either side, a plank floor, boxes and a round window. */
export function attic(w: number, d: number): Part[] {
  const parts: Part[] = [];
  const beam = '#8a5a3c';
  const plank = '#a67c52';
  const plank2 = '#98704a';
  const n = Math.round(d / 0.5);
  for (let i = 0; i < n; i++) {
    parts.push(blk(w + 0.4, 0.18, d / n - 0.03, [0, -0.09, -d / 2 + (i + 0.5) * (d / n)], i % 2 ? plank : plank2));
  }
  // The roof slopes: two leaning planes made of beams and dark boards.
  const m = Math.round(d / 0.9);
  for (const side of [-1, 1]) {
    parts.push(blk(0.3, 3.6, d + 0.4, [side * (w / 2 + 0.2), 1.6, 0], '#4a3328', { rot: [0, 0, side * 0.62] }));
    for (let i = 0; i <= m; i++) {
      parts.push(blk(0.32, 3.4, 0.28, [side * (w / 2 - 0.1), 1.55, -d / 2 + i * (d / m)], beam, { rot: [0, 0, side * 0.62], round: 0.4 }));
    }
  }
  // The back wall with a round window, moonlit.
  parts.push(blk(w + 0.6, 3.3, 0.3, [0, 1.6, d / 2 + 0.1], '#4f3c33'));
  parts.push(ring(1.5, 0.18, [0, 2.0, d / 2 - 0.1], beam, [0, 0, 0]));
  parts.push(ball(1.3, [0, 2.0, d / 2 - 0.05], '#9fc4ff', [1, 1, 0.1]));
  parts.push(ball(0.5, [0.25, 2.2, d / 2 - 0.16], '#fff6d6', [1, 1, 0.1]));
  // Dusty boxes and an old trunk.
  parts.push(blk(1.1, 0.8, 0.9, [-w / 2 + 1.1, 0.4, d / 2 - 1.1], '#b89a7a', { round: 0.4 }));
  parts.push(blk(0.8, 0.6, 0.7, [-w / 2 + 1.3, 1.1, d / 2 - 1.0], '#c9ad8c', { round: 0.4 }));
  parts.push(blk(1.4, 0.7, 0.8, [w / 2 - 1.2, 0.35, d / 2 - 1.3], '#7a5a4a', { round: 0.4 }));
  // A lectern with the story page on it.
  parts.push(tube(1.0, 0.14, 0.35, [1.6, 0.5, -0.4], beam));
  parts.push(blk(0.8, 0.08, 0.6, [1.6, 1.02, -0.4], beam, { rot: [-0.5, 0, 0], round: 0.4 }));
  return parts;
}

/** The glowing lore page on the lectern (emissive). */
export function page(at: V3): Part[] {
  return [blk(0.55, 0.03, 0.42, at, '#fff6d6', { rot: [-0.5, 0, 0] })];
}

/** A row of books on a shelf, and the shelf. */
export function bookshelf(at: V3, joy: number, fallen: boolean): Part[] {
  const wood = joyed('#6b3d24', joy);
  const parts = [blk(1.8, 2.2, 0.45, [at[0], 1.1, at[2]], wood, { round: 0.3 })];
  const cols = ['#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#f4a261'];
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 7; i++) {
      const x = at[0] - 0.75 + i * 0.24;
      const y = 0.35 + r * 0.7;
      if (fallen && r === 1 && i > 2) continue;
      parts.push(blk(0.18, 0.45 + (i % 3) * 0.05, 0.3, [x, y + 0.22, at[2] - 0.05], joyed(cols[(i + r) % 6] ?? '#ccc', joy), { round: 0.3 }));
    }
  }
  if (fallen) {
    for (let i = 0; i < 4; i++) {
      parts.push(blk(0.45, 0.16, 0.3, [at[0] - 0.4 + i * 0.3, 0.08 + (i % 2) * 0.12, at[2] - 1.0 - i * 0.25], joyed(cols[i] ?? '#ccc', joy), { rot: [0, i * 0.5, 0], round: 0.3 }));
    }
  }
  return parts;
}
