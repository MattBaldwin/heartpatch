import { hexKey, type HexKey, type PublicTile } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testView } from './test-view.js';
import { wildMarkers } from './wild-markers.js';

const view = testView();
const byKey = new Map<HexKey, PublicTile>(view.tiles.map((t) => [hexKey(t), t]));
const tileAt = (key: HexKey) => byKey.get(key);
const [a, b, c] = view.tiles;

describe('wildMarkers', () => {
  it('marks each hinted tile once, in the server’s order (nearest first)', () => {
    const hints = [c!, a!, b!, a!].map(({ q, r }) => ({ q, r }));
    const markers = wildMarkers(hints, tileAt);
    expect(markers.map((m) => m.key)).toEqual([hexKey(c!), hexKey(a!), hexKey(b!)]);
    expect(markers[0]).toMatchObject({ q: c!.q, r: c!.r });
  });

  it('draws nothing for a tile the map on screen doesn’t have (a stale reply)', () => {
    expect(wildMarkers([{ q: 999, r: 999 }], tileAt)).toEqual([]);
    expect(wildMarkers([], tileAt)).toEqual([]);
  });

  it('carries nothing about who is there: every tuft is the same (rule 6)', () => {
    const [marker] = wildMarkers([{ q: a!.q, r: a!.r }], tileAt);
    expect(Object.keys(marker!).sort()).toEqual(['key', 'phase', 'q', 'r']);
  });

  it('gives each tile its own sway phase, the same on every redraw', () => {
    const hints = view.tiles.slice(0, 40).map(({ q, r }) => ({ q, r }));
    const first = wildMarkers(hints, tileAt);
    expect(wildMarkers(hints, tileAt)).toEqual(first);
    for (const m of first) {
      expect(m.phase).toBeGreaterThanOrEqual(0);
      expect(m.phase).toBeLessThan(Math.PI * 2);
    }
    expect(new Set(first.map((m) => m.phase.toFixed(3))).size).toBeGreaterThan(30);
  });
});
