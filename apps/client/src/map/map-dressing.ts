import { activeSeasons, GAME_DATA, hexToWorld, type Hex } from '@heartpatch/shared';
import {
  FALLBACK_DRESSING,
  HALLOWEEN,
  CLAIMED,
  TERRAIN_DRESSING,
  type DressingItem,
  type PropKind,
  type TerrainDressing,
} from './map-config.js';
import { hash01, type PropPlacement } from './map-layout.js';

// Pure terrain dressing (no Babylon), so it's unit-tested: which props grow
// on a tile and where (in clumps), its ground clutter, the flourishes on
// claimed land, each tile's small colour and height wobble, and whether
// Halloween is on. Every choice is hash-seeded from the tile, so every device
// draws the same patch.

/** A dressing prop: a placement plus its colour multiplier. */
export interface DressingPlacement extends PropPlacement {
  /** Per-instance colour multiplier, sRGB hex. */
  readonly tint: string;
}

export interface DressOptions {
  /** Halloween is on (map-local date): some pumpkins become jack-o'-lanterns. */
  readonly halloween: boolean;
}

/** What grows on `terrain` (a terrain this client doesn't know gets the meadow's). */
export function dressingOf(terrain: string): TerrainDressing {
  return TERRAIN_DRESSING[terrain] ?? FALLBACK_DRESSING;
}

function pick(items: readonly DressingItem[], roll: number): DressingItem | undefined {
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  let left = roll * total;
  for (const it of items) {
    left -= it.weight;
    if (left < 0) return it;
  }
  return items[items.length - 1];
}

/**
 * Props for one tile, in natural clumps: a hash-seeded number of clumps, each
 * one kind with `DressingItem.clump` members huddled around its spot, spread
 * around the middle so they stay on the tile. Edge items (reeds, the dock)
 * sit near the rim facing out. A lead (a mountain's peak) stands alone in the
 * middle. Juniper's Gap's centre tile keeps its middle clear for the glowing
 * tree. Home tiles get none (the caller skips them).
 */
export function dressTile(
  tile: Hex,
  terrain: string,
  size: number,
  options: DressOptions,
): DressingPlacement[] {
  const dressing = dressingOf(terrain);
  const { q, r } = tile;
  const [min, max] = dressing.count;
  const count = min + Math.floor(hash01(q, r, 1) * (max - min + 1));
  const centre = hexToWorld(tile, size);
  const start = hash01(q, r, 2) * Math.PI * 2;
  const clearMiddle = terrain === 'junipers-gap' && q === 0 && r === 0;
  const used = new Set<PropKind>();
  const props: DressingPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const lead = i === 0 && dressing.lead !== undefined;
    const pool = lead
      ? (dressing.lead ?? [])
      : dressing.items.filter((it) => !(it.single === true && used.has(it.kind)));
    const it = pick(pool, hash01(q, r, 40 + i));
    if (!it) continue;
    used.add(it.kind);
    const angle = start + (i * Math.PI * 2) / count + (hash01(q, r, 50 + i) - 0.5) * 0.5;
    const roll = hash01(q, r, 10 + i);
    // TUNE: spots as a fraction of the hex size.
    let spread: number;
    if (it.edge === true) spread = 0.46 + 0.08 * roll;
    else if (lead || count === 1) spread = 0.1 * roll;
    else spread = 0.24 + 0.14 * roll;
    if (clearMiddle) spread = Math.max(spread, 0.42);
    const [lo, hi] = it.scale;
    const tint = dressing.tints[Math.floor(hash01(q, r, 60 + i) * dressing.tints.length)];
    const [cMin, cMax] = lead || it.single === true ? [1, 1] : (it.clump ?? [1, 1]);
    const members = cMin + Math.floor(hash01(q, r, 80 + i) * (cMax - cMin + 1));
    const spot = {
      x: centre.x + Math.cos(angle) * spread * size,
      z: centre.z + Math.sin(angle) * spread * size,
    };
    for (let m = 0; m < members; m++) {
      const salt = 200 + i * 16 + m;
      // The first member on the spot, the rest huddled around it.
      const off = m === 0 ? 0 : (0.09 + 0.06 * hash01(q, r, salt)) * size; // TUNE
      const a = hash01(q, r, salt + 7) * Math.PI * 2;
      const at = { x: spot.x + Math.cos(a) * off, z: spot.z + Math.sin(a) * off };
      // Keep the clump on its tile.
      const dx = at.x - centre.x;
      const dz = at.z - centre.z;
      const d = Math.hypot(dx, dz);
      const limit = (it.edge === true ? 0.56 : 0.52) * size;
      // …and out of Juniper's Gap's middle, where the glowing tree stands.
      const floor = clearMiddle ? 0.42 * size : 0;
      if (d > limit || (d < floor && d > 0)) {
        const to = d > limit ? limit : floor;
        at.x = centre.x + (dx / d) * to;
        at.z = centre.z + (dz / d) * to;
      }
      const lantern =
        options.halloween && it.kind === 'pumpkin' && hash01(q, r, salt + 3) < HALLOWEEN.lanterns;
      props.push({
        kind: lantern ? 'jack-o-lantern' : it.kind,
        at,
        // Clump members a little smaller than their leader, for a natural look.
        scale: (lo + (hi - lo) * hash01(q, r, salt + 11)) * (m === 0 ? 1 : 0.8),
        // Edge items face outwards (their +z points away from the middle).
        turn: it.edge === true ? Math.PI / 2 - angle : hash01(q, r, salt + 13) * Math.PI * 2,
        tint: tint ?? '#ffffff',
      });
    }
  }
  return props;
}

/**
 * Tiny ground clutter over the whole tile (tufts, clover, pebbles, petals):
 * many small instances, out to near the edge since the ground is continuous
 * now. None on home tiles or water (the caller skips them).
 */
export function clutterTile(tile: Hex, terrain: string, size: number): DressingPlacement[] {
  const { clutter, tints } = dressingOf(terrain);
  const { q, r } = tile;
  const [min, max] = clutter.count;
  const count = min + Math.floor(hash01(q, r, 300) * (max - min + 1));
  const centre = hexToWorld(tile, size);
  const out: DressingPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const it = pick(clutter.items, hash01(q, r, 310 + i));
    if (!it) continue;
    // Even spread over the hex's area (square root for uniform density). TUNE
    const d = Math.sqrt(hash01(q, r, 330 + i)) * 0.82 * size;
    const a = hash01(q, r, 350 + i) * Math.PI * 2;
    const [lo, hi] = it.scale;
    out.push({
      kind: it.kind,
      at: { x: centre.x + Math.cos(a) * d, z: centre.z + Math.sin(a) * d },
      scale: lo + (hi - lo) * hash01(q, r, 370 + i),
      turn: hash01(q, r, 390 + i) * Math.PI * 2,
      tint: tints[Math.floor(hash01(q, r, 410 + i) * tints.length)] ?? '#ffffff',
    });
  }
  return out;
}

/**
 * Flourishes on a claimed tile (owner decision 2026-10-05): sometimes a
 * glowing lantern on a post, and a clump or two of flowers, so owned land
 * looks tended. Hash-seeded per tile: the same flourishes every time it's
 * owned. None on water.
 */
export function flourishTile(tile: Hex, size: number): DressingPlacement[] {
  const { q, r } = tile;
  const centre = hexToWorld(tile, size);
  const out: DressingPlacement[] = [];
  const at = (salt: number, spread: number) => {
    const a = hash01(q, r, salt) * Math.PI * 2;
    return { x: centre.x + Math.cos(a) * spread * size, z: centre.z + Math.sin(a) * spread * size };
  };
  if (hash01(q, r, 500) < CLAIMED.lanternChance) {
    out.push({
      kind: 'lantern',
      at: at(501, 0.5),
      scale: 1,
      turn: hash01(q, r, 502) * Math.PI * 2,
      tint: '#ffffff',
    });
  }
  const [min, max] = CLAIMED.flowerClumps;
  const clumps = min + Math.floor(hash01(q, r, 510) * (max - min + 1));
  for (let i = 0; i < clumps; i++) {
    const spot = at(520 + i, 0.3 + 0.2 * hash01(q, r, 530 + i));
    for (let m = 0; m < 3; m++) {
      const a = hash01(q, r, 540 + i * 4 + m) * Math.PI * 2;
      const off = m === 0 ? 0 : 0.08 * size;
      out.push({
        kind: 'flowers',
        at: { x: spot.x + Math.cos(a) * off, z: spot.z + Math.sin(a) * off },
        scale: 1.1 + 0.3 * hash01(q, r, 560 + i * 4 + m),
        turn: a,
        tint: '#ffffff',
      });
    }
  }
  return out;
}

/** A tile's small wobble from its terrain's look: brightness, warmth and height. */
export interface TileJitter {
  /** Multiplies the colour (around 1). */
  readonly brightness: number;
  /** Shifts red up and blue down (or the other way), a fraction. */
  readonly warmth: number;
  /** Added to the tile's height, world units. */
  readonly height: number;
}

/**
 * Small per-tile differences so neighbouring tiles of one terrain don't look
 * stamped out. Juniper's Gap's centre and terrains with no jitter (water)
 * stay level.
 */
export function tileJitter(tile: Hex, terrain: string): TileJitter {
  const { jitter } = dressingOf(terrain);
  const centred = (salt: number) => hash01(tile.q, tile.r, salt) * 2 - 1;
  return {
    brightness: 1 + centred(80) * jitter.color,
    warmth: centred(81) * jitter.color * 0.5,
    height: jitter.height === 0 ? 0 : centred(82) * jitter.height,
  };
}

export type Rgb = readonly [number, number, number];

/** sRGB hex (`#rrggbb`) to 0–1 components. */
export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** The colour a tile is drawn in (sRGB 0–1): its ground colour, wobbled. */
export function tileColor(lookColor: string, jitter: TileJitter): Rgb {
  const [r, g, b] = hexRgb(lookColor);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const wobbled: Rgb = [
    clamp(r * jitter.brightness * (1 + jitter.warmth)),
    clamp(g * jitter.brightness),
    clamp(b * jitter.brightness * (1 - jitter.warmth)),
  ];
  return wobbled;
}

/** Today's date in `timeZone` as `YYYY-MM-DD` (the device's own zone if that one is unknown). */
export function localDateIn(timeZone: string, now: Date): string {
  const format = (zone?: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      ...(zone ? { timeZone: zone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  try {
    return format(timeZone);
  } catch {
    return format();
  }
}

/** True while Halloween is on for a map, by its local date (shared `activeSeasons`). */
export function isHalloween(timeZone: string, now: Date): boolean {
  try {
    return activeSeasons(GAME_DATA.seasons, localDateIn(timeZone, now)).some(
      (s) => s.id === 'halloween',
    );
  } catch {
    return false;
  }
}
