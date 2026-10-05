import { GAME_DATA, hexToWorld, type PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HEX_SIZE, TERRAIN_DRESSING, TERRAIN_LOOKS } from './map-config.js';
import {
  dressingOf,
  dressTile,
  hexRgb,
  isHalloween,
  isMuted,
  localDateIn,
  muteRgb,
  tileColor,
  tileJitter,
} from './map-dressing.js';
import { testView, userId } from './test-view.js';

const OFF = { halloween: false };
const ON = { halloween: true };

/** Every terrain tile of a real generated map (no home tiles). */
const wildTiles = testView().tiles.filter((t) => t.homeSlot === null);

function saturation([r, g, b]: readonly number[]): number {
  const hi = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const lo = Math.min(r ?? 0, g ?? 0, b ?? 0);
  return hi === 0 ? 0 : (hi - lo) / hi;
}

describe('terrain dressing data', () => {
  it('dresses every terrain in the game data, and gives each a look', () => {
    for (const terrain of GAME_DATA.terrains) {
      expect(TERRAIN_DRESSING[terrain.id], terrain.id).toBeDefined();
      expect(TERRAIN_LOOKS[terrain.id], terrain.id).toBeDefined();
      expect(dressingOf(terrain.id).items.length, terrain.id).toBeGreaterThan(0);
    }
  });

  it('dresses meadows and lakes too (they used to be bare)', () => {
    const kinds = (terrain: string) => new Set(dressingOf(terrain).items.map((i) => i.kind));
    expect(kinds('meadow')).toEqual(new Set(['flowers', 'grass', 'mushroom', 'bush']));
    expect(kinds('lake')).toEqual(new Set(['lily-pad', 'reeds', 'stones', 'dock']));
  });

  it("gives a terrain this client doesn't know the meadow's dressing", () => {
    expect(dressingOf('crystal-caves')).toBe(dressingOf('meadow'));
  });
});

describe('dressTile', () => {
  it('is the same on every call (same spots on every device)', () => {
    for (const tile of wildTiles.slice(0, 50)) {
      expect(dressTile(tile, tile.terrain, HEX_SIZE, OFF)).toEqual(
        dressTile(tile, tile.terrain, HEX_SIZE, OFF),
      );
    }
  });

  it('keeps each tile within its count range and its props on the tile', () => {
    for (const tile of wildTiles) {
      const { count } = dressingOf(tile.terrain);
      const props = dressTile(tile, tile.terrain, HEX_SIZE, OFF);
      expect(props.length).toBeGreaterThanOrEqual(count[0]);
      expect(props.length).toBeLessThanOrEqual(count[1]);
      const c = hexToWorld(tile, HEX_SIZE);
      for (const p of props) {
        expect(Math.hypot(p.at.x - c.x, p.at.z - c.z)).toBeLessThan(HEX_SIZE * 0.56);
        expect(p.tint).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('mixes kinds within each terrain from its own list', () => {
    const seen = new Map<string, Set<string>>();
    for (const tile of wildTiles) {
      for (const p of dressTile(tile, tile.terrain, HEX_SIZE, OFF)) {
        const allowed = dressingOf(tile.terrain);
        const kinds = [...(allowed.lead ?? []), ...allowed.items].map((i) => i.kind);
        expect(kinds).toContain(p.kind);
        let set = seen.get(tile.terrain);
        if (!set) seen.set(tile.terrain, (set = new Set()));
        set.add(p.kind);
      }
    }
    // A real map shows variety: several kinds on each common terrain.
    for (const terrain of ['meadow', 'forest', 'hills', 'lake', 'mountains']) {
      expect(seen.get(terrain)?.size ?? 0, terrain).toBeGreaterThanOrEqual(3);
    }
  });

  it('crowns every mountain tile with a peak near its middle', () => {
    for (const tile of wildTiles.filter((t) => t.terrain === 'mountains')) {
      const [first] = dressTile(tile, tile.terrain, HEX_SIZE, OFF);
      expect(['peak', 'snow-peak']).toContain(first?.kind);
      const c = hexToWorld(tile, HEX_SIZE);
      expect(Math.hypot(first!.at.x - c.x, first!.at.z - c.z)).toBeLessThan(HEX_SIZE * 0.11);
    }
  });

  it('puts edge items near the rim and at most one dock per tile', () => {
    let docks = 0;
    for (const tile of wildTiles.filter((t) => t.terrain === 'lake')) {
      const props = dressTile(tile, tile.terrain, HEX_SIZE, OFF);
      const c = hexToWorld(tile, HEX_SIZE);
      expect(props.filter((p) => p.kind === 'dock').length).toBeLessThanOrEqual(1);
      for (const p of props.filter((p) => p.kind === 'dock' || p.kind === 'reeds')) {
        expect(Math.hypot(p.at.x - c.x, p.at.z - c.z)).toBeGreaterThan(HEX_SIZE * 0.45);
      }
      docks += props.filter((p) => p.kind === 'dock').length;
    }
    expect(docks).toBeGreaterThan(0);
  });

  it("keeps the middle of Juniper's Gap clear for its glowing tree", () => {
    const centre = { q: 0, r: 0 };
    for (const p of dressTile(centre, 'junipers-gap', HEX_SIZE, OFF)) {
      expect(Math.hypot(p.at.x, p.at.z)).toBeGreaterThanOrEqual(HEX_SIZE * 0.42 - 1e-9);
    }
  });

  it("turns some pumpkins into jack-o'-lanterns while Halloween is on, and only then", () => {
    const fields = wildTiles.filter((t) => t.terrain === 'pumpkin-fields');
    const kinds = (options: { halloween: boolean }) =>
      fields.flatMap((t) => dressTile(t, t.terrain, HEX_SIZE, options).map((p) => p.kind));
    const off = kinds(OFF);
    const on = kinds(ON);
    expect(off).not.toContain('jack-o-lantern');
    expect(on).toContain('jack-o-lantern');
    // Some still plain pumpkins, and the same spots either way.
    expect(on).toContain('pumpkin');
    expect(on).toHaveLength(off.length);
    // Nothing else changes with the season.
    for (const tile of wildTiles.filter((t) => t.terrain !== 'pumpkin-fields').slice(0, 80)) {
      expect(dressTile(tile, tile.terrain, HEX_SIZE, ON)).toEqual(
        dressTile(tile, tile.terrain, HEX_SIZE, OFF),
      );
    }
  });
});

describe('tile wobble', () => {
  it('is stable and small, and differs between neighbours', () => {
    const tiles = wildTiles.filter((t) => t.terrain === 'meadow').slice(0, 40);
    const jitters = tiles.map((t) => tileJitter(t, t.terrain));
    expect(tiles.map((t) => tileJitter(t, t.terrain))).toEqual(jitters);
    for (const j of jitters) {
      expect(Math.abs(j.brightness - 1)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(j.height)).toBeLessThanOrEqual(0.012);
    }
    expect(new Set(jitters.map((j) => j.brightness)).size).toBeGreaterThan(30);
  });

  it('keeps water level', () => {
    for (const tile of wildTiles.filter((t) => t.terrain === 'lake')) {
      expect(tileJitter(tile, 'lake').height).toBe(0);
    }
  });
});

describe('wild land is muted, owned land in full colour', () => {
  const tile = (over: Partial<PublicTile>): Pick<PublicTile, 'ownerUserId' | 'terrain'> => ({
    ownerUserId: null,
    terrain: 'meadow',
    ...over,
  });

  it('mutes land nobody owns, never owned land or the glowing Gap', () => {
    expect(isMuted(tile({}))).toBe(true);
    expect(isMuted(tile({ ownerUserId: userId(1) }))).toBe(false);
    expect(isMuted(tile({ terrain: 'junipers-gap' }))).toBe(false);
  });

  it('draws a muted tile with less colour but keeps terrains apart', () => {
    const level = { brightness: 1, warmth: 0, height: 0 };
    for (const [id, look] of Object.entries(TERRAIN_LOOKS)) {
      const full = tileColor(look.color, level, false);
      const muted = tileColor(look.color, level, true);
      expect(full).toEqual(hexRgb(look.color));
      expect(saturation(muted), id).toBeLessThan(saturation(full));
    }
    // A muted meadow and a muted lake still differ (the hex read stays clear).
    const meadow = muteRgb(hexRgb(TERRAIN_LOOKS['meadow']!.color));
    const lake = muteRgb(hexRgb(TERRAIN_LOOKS['lake']!.color));
    expect(Math.abs(meadow[2] - lake[2])).toBeGreaterThan(0.05);
  });

  it('follows ownership in a real view: only the home rings are in colour', () => {
    const view = testView(2);
    const coloured = view.tiles.filter((t) => !isMuted(t));
    // Two home rings of 7, plus the Gap's tiles.
    const gap = view.tiles.filter((t) => t.terrain === 'junipers-gap').length;
    expect(coloured).toHaveLength(14 + gap);
  });
});

describe('Halloween by the map’s local date', () => {
  it('reads the date in the map’s time zone', () => {
    const now = new Date('2026-11-10T05:00:00Z');
    expect(localDateIn('America/Los_Angeles', now)).toBe('2026-11-09');
    expect(localDateIn('Pacific/Kiritimati', now)).toBe('2026-11-10');
  });

  it('is on inside the window (2026 runs to 9 November) and off outside', () => {
    expect(isHalloween('America/New_York', new Date('2026-10-31T18:00:00Z'))).toBe(true);
    expect(isHalloween('America/New_York', new Date('2026-08-15T12:00:00Z'))).toBe(false);
    // The last day in one zone is already the day after in another.
    const edge = new Date('2026-11-10T05:00:00Z');
    expect(isHalloween('America/Los_Angeles', edge)).toBe(true);
    expect(isHalloween('Pacific/Kiritimati', edge)).toBe(false);
  });

  it("falls back to the device's zone for a zone it doesn't know", () => {
    expect(() => isHalloween('Not/AZone', new Date())).not.toThrow();
    expect(localDateIn('Not/AZone', new Date('2026-06-15T12:00:00Z'))).toMatch(/^2026-06-1[456]$/);
  });
});
