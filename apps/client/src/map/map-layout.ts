import {
  hexKey,
  hexNeighbors,
  hexToWorld,
  type Hex,
  type HexKey,
  type MapMember,
  type PublicTile,
  type WorldPoint,
} from '@heartpatch/shared';
import type { Bounds } from '../engine/camera/camera-math.js';
import { HEX_SIZE, type PropKind, type TerrainLook } from './map-config.js';

// Pure map layout (no Babylon), so it's unit-tested: where tiles, home bases
// and props go. Everything is derived from what the server sent; the client
// never decides ownership (CLAUDE.md rule 1).

/** A home base: its Heart Seed tile (the middle of the ring) and its slot. */
export interface HomeBase {
  readonly slot: number;
  readonly seed: PublicTile;
}

/**
 * Finds each home base's Heart Seed: the tile whose six neighbours are all
 * in the same home slot (design doc §11: the Heart Seed and its ring).
 */
export function findHomeBases(tiles: readonly PublicTile[]): HomeBase[] {
  const slotAt = new Map<HexKey, number>();
  for (const t of tiles) if (t.homeSlot !== null) slotAt.set(hexKey(t), t.homeSlot);
  const homes: HomeBase[] = [];
  for (const t of tiles) {
    const slot = t.homeSlot;
    if (slot === null) continue;
    if (hexNeighbors(t).every((n) => slotAt.get(hexKey(n)) === slot)) homes.push({ slot, seed: t });
  }
  return homes.sort((a, b) => a.slot - b.slot);
}

/** Each member's home slot, by user id. */
export function slotsByUser(members: readonly MapMember[]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const m of members) if (m.homeSlot !== null) slots.set(m.user.id, m.homeSlot);
  return slots;
}

/**
 * The home slot whose colour tints this tile: its owner's slot, or null for
 * wild land (or an owner the member list doesn't know yet).
 */
export function tintSlot(tile: PublicTile, slots: ReadonlyMap<string, number>): number | null {
  return tile.ownerUserId === null ? null : (slots.get(tile.ownerUserId) ?? null);
}

/** Where the camera may roam: every tile centre is reachable. */
export function mapBounds(tiles: readonly PublicTile[], size: number): Bounds {
  if (tiles.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tiles) {
    const p = hexToWorld(t, size);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * How far out the camera may zoom on a map (#318): `CAMERA.maxDistance` frames
 * a radius-12 patch (tile centres 13.5 units either side of the middle), so a
 * wider map gets the same framing, scaled. Never closer than that.
 */
export function maxZoomFor(bounds: Bounds, maxDistance: number): number {
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  return Math.max(maxDistance, (maxDistance * half) / RADIUS_12_HALF_SPAN);
}

/** Half the width of a radius-12 patch's tile centres (√3 × 12 tiles of `HEX_SIZE`). */
const RADIUS_12_HALF_SPAN = HEX_SIZE * Math.sqrt(3) * 12;

/** Distance from the map centre to its farthest tile corner, for sizing the island. */
export function mapRadius(tiles: readonly PublicTile[], size: number): number {
  let r = 0;
  for (const t of tiles) {
    const p = hexToWorld(t, size);
    r = Math.max(r, Math.sqrt(p.x * p.x + p.z * p.z) + size);
  }
  return r;
}

/** A small, fast integer hash → [0, 1), so props sit in the same spots on every device. */
export function hash01(q: number, r: number, salt: number): number {
  let h = Math.imul(q, 374761393) ^ Math.imul(r, 668265263) ^ Math.imul(salt, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface PropPlacement {
  readonly kind: PropKind;
  /** World position on the tile top. */
  readonly at: WorldPoint;
  readonly scale: number;
  /** Turn about the vertical axis, radians. */
  readonly turn: number;
}

/**
 * Props for one tile: a fixed count and fixed spots per tile (from `hash01`),
 * spread around the middle so they don't poke over the edge. Home bases get
 * none (the caller skips them), so the Heart Seed stands out.
 */
export function propPlacements(tile: PublicTile, look: TerrainLook, size: number): PropPlacement[] {
  return propPlacementsAt(tile, look, size);
}

/** `propPlacements` for any hex (the opening cinematic's world has no map tiles). */
export function propPlacementsAt(tile: Hex, look: TerrainLook, size: number): PropPlacement[] {
  const kind = look.prop;
  if (kind === null) return [];
  const [min, max] = look.propsPerTile;
  const count = min + Math.floor(hash01(tile.q, tile.r, 1) * (max - min + 1));
  const centre = hexToWorld(tile, size);
  const start = hash01(tile.q, tile.r, 2) * Math.PI * 2;
  const props: PropPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const angle = start + (i * Math.PI * 2) / count;
    const spread = count === 1 ? 0.15 : 0.3 + 0.12 * hash01(tile.q, tile.r, 10 + i); // TUNE
    props.push({
      kind,
      at: {
        x: centre.x + Math.cos(angle) * spread * size,
        z: centre.z + Math.sin(angle) * spread * size,
      },
      scale: 0.85 + 0.3 * hash01(tile.q, tile.r, 20 + i), // TUNE
      turn: hash01(tile.q, tile.r, 30 + i) * Math.PI * 2,
    });
  }
  return props;
}
