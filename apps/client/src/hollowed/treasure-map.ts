import {
  HEX_DIRECTIONS,
  hexDistance,
  hexKey,
  hexToWorld,
  worldToHex,
  type Hex,
} from '@heartpatch/shared';
import { TREASURE_MAP } from './hollowed-config.js';

// The cellar key's treasure map (#306, owner decision 2026-10-22): this
// patch's world drawn as it was before the Hollow Man, in old ink on
// parchment. The same land and terrain shapes as the map view's tiles, and
// nothing anyone made since: no Hollow tint, no claims, no players, no
// buildings. It shows the part of the patch round the Hollow and the key, big
// enough to read on a phone; its rim fades into the paper, and the shore is
// drawn only where the patch really ends. The key's tile wears an ✕, with a
// dotted trail to it from the Hollow's square. Drawn with 2D canvas at the device's pixel ratio (never
// pixelated), no image assets. `planTreasureMap` is pure, so its layout is
// unit-tested; `paintTreasureMap` only draws the plan.

/** The old land a tile shows on the map: its terrain then, in the map's few inks. */
export type OldLand =
  'meadow' | 'forest' | 'old-forest' | 'hills' | 'mountains' | 'lake' | 'pumpkins' | 'gap';

/**
 * A terrain as the old map draws it. Cleared land, trading posts and any
 * terrain this client doesn't know were plain meadow before anyone came.
 */
export function oldLand(terrain: string): OldLand {
  switch (terrain) {
    case 'forest':
    case 'old-forest':
    case 'hills':
    case 'mountains':
    case 'lake':
      return terrain;
    case 'pumpkin-fields':
      return 'pumpkins';
    case 'junipers-gap':
      return 'gap';
    default:
      return 'meadow';
  }
}

export interface MapHex {
  /** Its middle on the canvas, CSS pixels. */
  readonly x: number;
  readonly y: number;
  readonly land: OldLand;
  /** The sides with no land beyond (0–5, `hexCorners` order): the coast. */
  readonly coast: readonly number[];
  /** Stable 0–1 per tile, so its doodles sit the same way every time. */
  readonly seed: number;
  /** On the drawing's rim: drawn faded, fading into the paper. */
  readonly rim: boolean;
}

export interface TreasureMapPlan {
  readonly width: number;
  readonly height: number;
  /** A tile's corner distance, CSS pixels. */
  readonly radius: number;
  readonly hexes: readonly MapHex[];
  /** The key's tile middle, or null when it's off the map's tiles. */
  readonly key: { readonly x: number; readonly y: number } | null;
  /** The Hollow's square, where the trail starts, or null. */
  readonly start: { readonly x: number; readonly y: number } | null;
}

const SQRT3 = Math.sqrt(3);

/** A pointy-top hex's six corners round (x, y) on the canvas (y down), side i between corners i and i + 1. */
export function hexCorners(x: number, y: number, radius: number): { x: number; y: number }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: x + radius * Math.cos(a), y: y + radius * Math.sin(a) };
  });
}

/**
 * Which side of a hex faces each neighbour direction (`HEX_DIRECTIONS`
 * order): the side whose middle points the same way on the canvas.
 */
const SIDE_OF: readonly number[] = HEX_DIRECTIONS.map((d) => {
  const w = hexToWorld(d, 1);
  const angle = (Math.atan2(-w.z, w.x) * 180) / Math.PI; // canvas y is world -z (north up)
  return ((Math.round(angle / 60) % 6) + 6) % 6;
});

/** Stable 0–1 from a tile's place. */
function seedOf(h: Hex): number {
  const n = Math.imul(h.q, 73856093) ^ Math.imul(h.r, 19349663);
  return ((n >>> 0) % 10007) / 10007;
}

/**
 * The tiles the map shows: every one within `TREASURE_MAP.around` steps of
 * both the Hollow's square and the key (round the middle between them), and
 * how far out that reaches. All of them when the key isn't on the patch.
 */
export function mapWindow(
  tiles: readonly (Hex & { readonly terrain: string })[],
  marks: { readonly key: Hex; readonly start: Hex | null },
): { tiles: (Hex & { readonly terrain: string })[]; centre: Hex; reach: number } | null {
  const land = new Set(tiles.map(hexKey));
  if (!land.has(hexKey(marks.key))) return null;
  const from = marks.start ?? marks.key;
  const a = hexToWorld(marks.key, 1);
  const b = hexToWorld(from, 1);
  const centre = worldToHex({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, 1);
  const reach =
    Math.max(hexDistance(centre, marks.key), hexDistance(centre, from)) + TREASURE_MAP.around;
  return { tiles: tiles.filter((t) => hexDistance(t, centre) <= reach), centre, reach };
}

/**
 * Lays the map out to fit `maxWidth` × `maxHeight` CSS pixels (keeping the
 * land's shape, with a parchment margin), north up like the map view.
 */
export function planTreasureMap(
  tiles: readonly (Hex & { readonly terrain: string })[],
  marks: { readonly key: Hex; readonly start: Hex | null },
  box: { readonly maxWidth: number; readonly maxHeight: number },
): TreasureMapPlan {
  const pad = TREASURE_MAP.margin;
  const area = mapWindow(tiles, marks);
  const shown = area?.tiles ?? tiles;
  const placed = shown.map((t) => {
    const w = hexToWorld(t, 1);
    return { tile: t, x: w.x, y: -w.z };
  });
  if (placed.length === 0) {
    return {
      width: box.maxWidth,
      height: box.maxHeight,
      radius: 0,
      hexes: [],
      key: null,
      start: null,
    };
  }
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const half = SQRT3 / 2;
  const minX = Math.min(...xs) - half;
  const maxX = Math.max(...xs) + half;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;
  const scale = Math.min(
    (box.maxWidth - pad * 2) / (maxX - minX),
    (box.maxHeight - pad * 2) / (maxY - minY),
  );
  const width = Math.round((maxX - minX) * scale + pad * 2);
  const height = Math.round((maxY - minY) * scale + pad * 2);
  const at = (x: number, y: number) => ({
    x: (x - minX) * scale + pad,
    y: (y - minY) * scale + pad,
  });

  const land = new Set(tiles.map(hexKey));
  const hexes = placed.map(({ tile, x, y }) => {
    const coast: number[] = [];
    HEX_DIRECTIONS.forEach((d, i) => {
      if (!land.has(hexKey({ q: tile.q + d.q, r: tile.r + d.r }))) coast.push(SIDE_OF[i] ?? i);
    });
    return {
      ...at(x, y),
      land: oldLand(tile.terrain),
      coast: coast.sort(),
      seed: seedOf(tile),
      rim: area !== null && hexDistance(tile, area.centre) === area.reach,
    };
  });
  const inside = new Set(shown.map(hexKey));
  const mark = (h: Hex | null) => {
    if (!h || !inside.has(hexKey(h))) return null;
    const w = hexToWorld(h, 1);
    return at(w.x, -w.z);
  };
  return { width, height, radius: scale, hexes, key: mark(marks.key), start: mark(marks.start) };
}

/** The old map's inks: each land's wash, and its doodles' ink. sRGB. */
const INK = TREASURE_MAP.ink;

/** Draws `plan` into `canvas` at `dpr` (its CSS size is the plan's). */
export function paintTreasureMap(
  canvas: HTMLCanvasElement,
  plan: TreasureMapPlan,
  dpr: number,
): void {
  const ratio = Math.max(1, Math.min(dpr, TREASURE_MAP.maxDpr));
  canvas.width = Math.round(plan.width * ratio);
  canvas.height = Math.round(plan.height * ratio);
  canvas.style.width = `${String(plan.width)}px`;
  canvas.style.height = `${String(plan.height)}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, plan.width, plan.height);
  parchment(ctx, plan);
  waves(ctx, plan);
  for (const h of plan.hexes) wash(ctx, h, plan.radius);
  for (const h of plan.hexes) doodle(ctx, h, plan.radius);
  rim(ctx, plan);
  coastline(ctx, plan);
  compass(ctx, plan);
  if (plan.key) {
    if (plan.start) trail(ctx, plan.start, plan.key, plan.radius);
    cross(ctx, plan.key, plan.radius);
  }
}

/** The paper: a warm wash, darker toward its soft, wobbly edge, with a couple of old stains. */
function parchment(ctx: CanvasRenderingContext2D, plan: TreasureMapPlan): void {
  const { width: w, height: h } = plan;
  const r = Math.min(18, w * 0.06);
  ctx.save();
  ctx.beginPath();
  // A wobbly rounded edge, the same every time.
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wobble = Math.sin(t * 37.7) * 1.2 + Math.sin(t * 91.3) * 0.8;
    const p = roundedRectPoint(w, h, r, t, 2 + wobble);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  const fill = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.2,
    w / 2,
    h / 2,
    Math.hypot(w, h) * 0.6,
  );
  fill.addColorStop(0, INK.paper);
  fill.addColorStop(0.7, INK.paperMid);
  fill.addColorStop(1, INK.paperEdge);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  for (const [sx, sy, sr] of [
    [0.82, 0.2, 0.16],
    [0.14, 0.78, 0.12],
  ] as const) {
    const stain = ctx.createRadialGradient(w * sx, h * sy, 0, w * sx, h * sy, Math.min(w, h) * sr);
    stain.addColorStop(0, 'rgb(150 105 50 / 0%)');
    stain.addColorStop(0.8, 'rgb(150 105 50 / 8%)');
    stain.addColorStop(1, 'rgb(150 105 50 / 0%)');
    ctx.fillStyle = stain;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = INK.edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** A point round a rounded rectangle inset by `inset`, `t` 0–1 of the way round. */
function roundedRectPoint(
  w: number,
  h: number,
  r: number,
  t: number,
  inset: number,
): { x: number; y: number } {
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const straight = 2 * (x1 - x0 - 2 * r) + 2 * (y1 - y0 - 2 * r);
  const arc = (Math.PI / 2) * r;
  const total = straight + 4 * arc;
  let d = t * total;
  const sides: [number, (u: number) => { x: number; y: number }][] = [
    [x1 - x0 - 2 * r, (u) => ({ x: x0 + r + u, y: y0 })],
    [arc, (u) => corner(x1 - r, y0 + r, -Math.PI / 2 + u / r)],
    [y1 - y0 - 2 * r, (u) => ({ x: x1, y: y0 + r + u })],
    [arc, (u) => corner(x1 - r, y1 - r, u / r)],
    [x1 - x0 - 2 * r, (u) => ({ x: x1 - r - u, y: y1 })],
    [arc, (u) => corner(x0 + r, y1 - r, Math.PI / 2 + u / r)],
    [y1 - y0 - 2 * r, (u) => ({ x: x0, y: y1 - r - u })],
    [arc, (u) => corner(x0 + r, y0 + r, Math.PI + u / r)],
  ];
  function corner(cx: number, cy: number, a: number) {
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  for (const [length, at] of sides) {
    if (d <= length) return at(Math.max(0, d));
    d -= length;
  }
  return { x: x0 + r, y: y0 };
}

/** A few ink ripples on the sea round the island. */
function waves(ctx: CanvasRenderingContext2D, plan: TreasureMapPlan): void {
  const s = Math.max(4, plan.radius * 0.5);
  ctx.save();
  ctx.strokeStyle = INK.sea;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  const spots = [
    [0.08, 0.14],
    [0.9, 0.62],
    [0.12, 0.5],
    [0.86, 0.9],
    [0.5, 0.95],
  ] as const;
  for (const [fx, fy] of spots) {
    const x = plan.width * fx;
    const y = plan.height * fy;
    if (plan.hexes.some((h) => Math.hypot(h.x - x, h.y - y) < plan.radius * 1.6)) continue;
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x - s / 2, y - s / 2, x, y);
    ctx.quadraticCurveTo(x + s / 2, y + s / 2, x + s, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** A tile's soft wash of its old land's colour. */
function wash(ctx: CanvasRenderingContext2D, h: MapHex, radius: number): void {
  const corners = hexCorners(h.x, h.y, radius * 1.02);
  ctx.beginPath();
  corners.forEach((c, i) => {
    if (i === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
  ctx.closePath();
  ctx.fillStyle = INK.land[h.land];
  ctx.fill();
  ctx.strokeStyle = INK.grid;
  ctx.lineWidth = Math.max(0.5, radius * 0.04);
  ctx.stroke();
}

/** The little ink drawings that say what each land is: trees, humps, peaks, ripples. */
function doodle(ctx: CanvasRenderingContext2D, h: MapHex, radius: number): void {
  const s = radius;
  const jx = (h.seed - 0.5) * s * 0.3;
  const jy = (((h.seed * 7) % 1) - 0.5) * s * 0.2;
  const x = h.x + jx;
  const y = h.y + jy;
  ctx.save();
  ctx.strokeStyle = INK.doodle;
  ctx.fillStyle = INK.doodle;
  ctx.lineWidth = Math.max(0.8, s * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tree = (tx: number, ty: number, size: number) => {
    ctx.beginPath();
    ctx.arc(tx, ty - size * 0.35, size * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = INK.tree;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tx, ty - size * 0.05);
    ctx.lineTo(tx, ty + size * 0.25);
    ctx.stroke();
  };
  switch (h.land) {
    case 'forest':
      tree(x - s * 0.28, y + s * 0.05, s * 0.7);
      tree(x + s * 0.25, y + s * 0.15, s * 0.6);
      break;
    case 'old-forest':
      tree(x - s * 0.3, y + s * 0.1, s * 0.85);
      tree(x + s * 0.3, y, s * 0.8);
      break;
    case 'hills':
      for (const dx of [-0.3, 0.25]) {
        ctx.beginPath();
        ctx.arc(x + s * dx, y + s * 0.15, s * 0.28, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      break;
    case 'mountains': {
      const peak = (px: number, size: number) => {
        ctx.beginPath();
        ctx.moveTo(px - size * 0.5, y + s * 0.3);
        ctx.lineTo(px, y - size * 0.55);
        ctx.lineTo(px + size * 0.5, y + s * 0.3);
        ctx.fillStyle = INK.peak;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - size * 0.18, y - size * 0.2);
        ctx.lineTo(px, y - size * 0.55);
        ctx.lineTo(px + size * 0.18, y - size * 0.2);
        ctx.stroke();
      };
      peak(x - s * 0.18, s * 0.85);
      peak(x + s * 0.35, s * 0.55);
      break;
    }
    case 'lake':
      ctx.strokeStyle = INK.sea;
      for (const dy of [-0.15, 0.2]) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.35, y + s * dy);
        ctx.quadraticCurveTo(x - s * 0.17, y + s * (dy - 0.14), x, y + s * dy);
        ctx.quadraticCurveTo(x + s * 0.17, y + s * (dy + 0.14), x + s * 0.35, y + s * dy);
        ctx.stroke();
      }
      break;
    case 'pumpkins':
      for (const [dx, dy] of [
        [-0.25, 0.05],
        [0.2, 0.18],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(x + s * dx, y + s * dy, s * 0.17, s * 0.13, 0, 0, Math.PI * 2);
        ctx.fillStyle = INK.pumpkin;
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'gap':
      star(ctx, x, y, s * 0.3);
      break;
    case 'meadow':
      if (h.seed < 0.45) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.12, y + s * 0.1);
        ctx.lineTo(x - s * 0.06, y - s * 0.06);
        ctx.moveTo(x + s * 0.02, y + s * 0.1);
        ctx.lineTo(x + s * 0.08, y - s * 0.08);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

/** A little four-point star (Juniper's Gap, the compass). */
function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const d = i % 2 === 0 ? r : r * 0.32;
    if (i === 0) ctx.moveTo(x + d * Math.cos(a), y + d * Math.sin(a));
    else ctx.lineTo(x + d * Math.cos(a), y + d * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill();
}

/** The drawing's rim fades into the paper, so the cut never reads as a shore. */
function rim(ctx: CanvasRenderingContext2D, plan: TreasureMapPlan): void {
  ctx.save();
  ctx.fillStyle = INK.paperMid;
  ctx.globalAlpha = TREASURE_MAP.rimFade;
  for (const h of plan.hexes) {
    if (!h.rim) continue;
    ctx.beginPath();
    hexCorners(h.x, h.y, plan.radius * 1.06).forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The island's shore: a bold ink line along every side with no land beyond. */
function coastline(ctx: CanvasRenderingContext2D, plan: TreasureMapPlan): void {
  ctx.save();
  ctx.strokeStyle = INK.coast;
  ctx.lineWidth = Math.max(1.4, plan.radius * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const h of plan.hexes) {
    const corners = hexCorners(h.x, h.y, plan.radius * 1.02);
    for (const side of h.coast) {
      const a = corners[side];
      const b = corners[(side + 1) % 6];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** A small compass rose in the top-left corner, north up. */
function compass(ctx: CanvasRenderingContext2D, plan: TreasureMapPlan): void {
  const r = Math.max(10, Math.min(18, plan.width * 0.045));
  const x = r + 10;
  const y = r + 12;
  ctx.save();
  ctx.fillStyle = INK.doodle;
  ctx.strokeStyle = INK.doodle;
  star(ctx, x, y, r);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `900 ${String(Math.round(r * 0.75))}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('N', x, y - r - 1);
  ctx.restore();
}

/** The dotted trail from the Hollow's square to the key, in a soft curve. */
function trail(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
): void {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend = 0.25;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  ctx.save();
  ctx.strokeStyle = INK.trail;
  ctx.lineWidth = Math.max(1.6, radius * 0.16);
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, Math.max(4, radius * 0.45)]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(cx, cy, to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Where it starts: a little ring on the Hollow's square.
  ctx.lineWidth = Math.max(1.2, radius * 0.12);
  ctx.beginPath();
  ctx.arc(from.x, from.y, Math.max(3, radius * 0.38), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** The ✕ on the key's tile, on a warm gold glow. */
function cross(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, radius: number): void {
  const r = Math.max(7, radius * 0.75);
  ctx.save();
  const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, r * 2.2);
  glow.addColorStop(0, INK.glow);
  glow.addColorStop(1, 'rgb(255 205 90 / 0%)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  // A pale underline first, so the ✕ reads on any land.
  for (const [style, width] of [
    [INK.paper, r * 0.62],
    [INK.cross, r * 0.36],
  ] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(at.x - r * 0.6, at.y - r * 0.6);
    ctx.lineTo(at.x + r * 0.6, at.y + r * 0.6);
    ctx.moveTo(at.x + r * 0.6, at.y - r * 0.6);
    ctx.lineTo(at.x - r * 0.6, at.y + r * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}
