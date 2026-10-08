import {
  activeSeasons,
  GAME_DATA,
  hexToWorld,
  type Hex,
  type PublicTile,
} from '@heartpatch/shared';
import {
  FALLBACK_DRESSING,
  HALLOWEEN,
  MUTED,
  TERRAIN_DRESSING,
  type DressingItem,
  type PropKind,
  type TerrainDressing,
} from './map-config.js';
import { hash01, type PropPlacement } from './map-layout.js';

// Pure terrain dressing (no Babylon), so it's unit-tested: which props grow
// on a tile and where, each tile's small colour and height wobble, whether
// it's drawn muted (wild land), and whether Halloween is on. Every choice is
// hash-seeded from the tile, so every device draws the same patch.

/** A dressing prop: a placement plus its colour multiplier. */
export interface DressingPlacement extends PropPlacement {
  /** Per-instance colour multiplier, sRGB hex. */
  readonly tint: string;
}

export interface DressOptions {
  /** Halloween is on (map-local date): some pumpkins become jack-o'-lanterns. */
  readonly halloween: boolean;
  /**
   * A node standing in the tile's middle (#238: a well, greens, ice): it's
   * placed there, and the other props keep clear of it.
   */
  readonly middle?: PropKind;
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
 * Props for one tile: a hash-seeded count, mix and spots, spread around the
 * middle so they don't poke over the edge. Edge items (reeds, the dock) sit
 * near the rim facing out. Juniper's Gap's centre tile keeps its middle clear
 * for the glowing tree, and a tile with a `middle` node for that node (#238).
 * Home tiles get none (the caller skips them).
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
  const clearMiddle =
    (terrain === 'junipers-gap' && q === 0 && r === 0) || options.middle !== undefined;
  const used = new Set<PropKind>();
  const props: DressingPlacement[] = [];
  if (options.middle !== undefined) {
    props.push({
      kind: options.middle,
      at: { x: centre.x, z: centre.z },
      scale: 1,
      turn: hash01(q, r, 90) * Math.PI * 2,
      tint: '#ffffff',
    });
  }
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
    else spread = 0.26 + 0.16 * roll;
    if (clearMiddle) spread = Math.max(spread, 0.42);
    const lantern = options.halloween && it.kind === 'pumpkin';
    const kind: PropKind =
      lantern && hash01(q, r, 70 + i) < HALLOWEEN.lanterns ? 'jack-o-lantern' : it.kind;
    const [lo, hi] = it.scale;
    const tint = dressing.tints[Math.floor(hash01(q, r, 60 + i) * dressing.tints.length)];
    props.push({
      kind,
      at: {
        x: centre.x + Math.cos(angle) * spread * size,
        z: centre.z + Math.sin(angle) * spread * size,
      },
      scale: lo + (hi - lo) * hash01(q, r, 20 + i),
      // Edge items face outwards (their +z points away from the middle).
      turn: it.edge === true ? Math.PI / 2 - angle : hash01(q, r, 30 + i) * Math.PI * 2,
      tint: tint ?? '#ffffff',
    });
  }
  return props;
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

/** True when a tile is drawn muted: wild land nobody owns. Juniper's Gap always glows in colour. */
export function isMuted(tile: Pick<PublicTile, 'ownerUserId' | 'terrain'>): boolean {
  return tile.ownerUserId === null && tile.terrain !== 'junipers-gap';
}

export type Rgb = readonly [number, number, number];

/** sRGB hex (`#rrggbb`) to 0–1 components. */
export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

const LUMA: Rgb = [0.2126, 0.7152, 0.0722];

/** Soft and grey-ish: keeps `MUTED.saturation` of the colour, dims it by `MUTED.shade`, then washes towards `MUTED.tint`. */
export function muteRgb(c: Rgb): Rgb {
  const l = c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const tint = hexRgb(MUTED.tint);
  const out = c.map((v, i) => {
    const grey = (l + (v - l) * MUTED.saturation) * MUTED.shade;
    return grey + ((tint[i] ?? grey) - grey) * MUTED.wash;
  });
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

/**
 * The colour a tile is drawn in (sRGB 0–1): its look's colour, wobbled, and
 * muted on wild land. `muted` may be a share (0–1): land that misses its
 * owner is drawn part of the way to wild (owner decision 2026-10-06).
 */
export function tileColor(lookColor: string, jitter: TileJitter, muted: boolean | number): Rgb {
  const [r, g, b] = hexRgb(lookColor);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const wobbled: Rgb = [
    clamp(r * jitter.brightness * (1 + jitter.warmth)),
    clamp(g * jitter.brightness),
    clamp(b * jitter.brightness * (1 - jitter.warmth)),
  ];
  const share = muted === true ? 1 : muted === false ? 0 : Math.min(1, Math.max(0, muted));
  if (share === 0) return wobbled;
  const quiet = muteRgb(wobbled);
  if (share === 1) return quiet;
  return [
    wobbled[0] + (quiet[0] - wobbled[0]) * share,
    wobbled[1] + (quiet[1] - wobbled[1]) * share,
    wobbled[2] + (quiet[2] - wobbled[2]) * share,
  ];
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

/** The seasons on for a map, by its local date (shared `activeSeasons`); none if the zone is unreadable. */
export function seasonsOn(timeZone: string, now: Date): string[] {
  try {
    return activeSeasons(GAME_DATA.seasons, localDateIn(timeZone, now)).map((s) => s.id);
  } catch {
    return [];
  }
}

/** True while Halloween is on for a map, by its local date (shared `activeSeasons`). */
export function isHalloween(timeZone: string, now: Date): boolean {
  return seasonsOn(timeZone, now).includes('halloween');
}
