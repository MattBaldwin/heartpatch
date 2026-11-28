import {
  hexKey,
  hexNeighbors,
  type HexKey,
  type PublicLine,
  type PublicTile,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { testWildIsle, userId } from '../map/test-view.js';
import { FULL_MASK } from '../roads/road-layout.js';
import {
  armPlacements,
  DEPOT_ID,
  lineJoins,
  linePieces,
  railSides,
  sideDistance,
} from './line-layout.js';

const ME = userId(1);
const THEM = userId(2);
const base = testWildIsle();
const land = base.tiles.filter((t) => t.terrain !== 'ocean' && t.terrain !== 'river');

/** A land tile with six land neighbours, all made mine. */
function patchAround(): { centre: PublicTile; tiles: Map<HexKey, PublicTile> } {
  const byKey = new Map<HexKey, PublicTile>(
    base.tiles.map((t) => [hexKey(t), { ...t, buildings: [...t.buildings] }]),
  );
  const centre = land.find(
    (t) =>
      hexNeighbors(t).every((n) => {
        const x = byKey.get(hexKey(n));
        return x && x.terrain !== 'ocean' && x.terrain !== 'river' && x.homeSlot === null;
      }) && t.homeSlot === null,
  );
  if (!centre) throw new Error('no centre');
  for (const h of [centre, ...hexNeighbors(centre)]) {
    const t = byKey.get(hexKey(h));
    if (t) t.ownerUserId = ME;
  }
  return { centre: byKey.get(hexKey(centre)) ?? centre, tiles: byKey };
}

const line = (
  q: number,
  r: number,
  kind: 'wire' | 'rail',
  extra: Partial<PublicLine> = {},
): PublicLine => ({
  q,
  r,
  kind,
  ownerUserId: ME,
  level: 1,
  ...extra,
});

const building = (buildingId: string) =>
  ({
    id: '0190a8c4-0000-7000-8000-0000000000b1',
    buildingId,
    kind: buildingId === DEPOT_ID ? 'depot' : 'works',
    level: 1,
    spot: 0,
    lit: null,
    safeRadius: null,
  }) as PublicTile['buildings'][number];

describe('wire and rail layout (#874 C4)', () => {
  it('joins my wires to my wires next door, side by side, like roads', () => {
    const { centre, tiles } = patchAround();
    const [n0, , , n3] = hexNeighbors(centre);
    if (!n0 || !n3) throw new Error('no neighbours');
    const pieces = linePieces(
      [line(centre.q, centre.r, 'wire'), line(n0.q, n0.r, 'wire'), line(n3.q, n3.r, 'wire')],
      tiles,
    );
    const mid = pieces.find((p) => p.q === centre.q && p.r === centre.r);
    expect(mid?.mask).toBe(0b001001);
    // The ends each join back to the middle only.
    expect(pieces.find((p) => p.q === n0.q && p.r === n0.r)?.mask).toBe(1 << 3);
  });

  it("never joins my wire to someone else's, or a wire to a rail", () => {
    const { centre, tiles } = patchAround();
    const [n0, n1] = hexNeighbors(centre);
    if (!n0 || !n1) throw new Error('no neighbours');
    const pieces = linePieces(
      [
        line(centre.q, centre.r, 'wire'),
        line(n0.q, n0.r, 'wire', { ownerUserId: THEM }),
        line(n1.q, n1.r, 'rail'),
      ],
      tiles,
    );
    expect(pieces.find((p) => p.q === centre.q && p.r === centre.r)?.mask).toBe(0);
  });

  it('runs a wire into my Windmill and machines, and a rail into my Rail Depot', () => {
    const { centre, tiles } = patchAround();
    const [n0, n1, n2] = hexNeighbors(centre);
    if (!n0 || !n1 || !n2) throw new Error('no neighbours');
    tiles.get(hexKey(n0))?.buildings.push(building('windmill'));
    tiles.get(hexKey(n1))?.buildings.push(building(DEPOT_ID));
    tiles.get(hexKey(n2))?.buildings.push(building('sorter'));
    expect(lineJoins(tiles.values(), 'wire', ME)).toEqual(new Set([hexKey(n0), hexKey(n2)]));
    expect(lineJoins(tiles.values(), 'rail', ME)).toEqual(new Set([hexKey(n1)]));
    // Not someone else's.
    expect(lineJoins(tiles.values(), 'wire', THEM).size).toBe(0);
    const [wire, rail] = linePieces(
      [line(centre.q, centre.r, 'wire'), line(centre.q, centre.r, 'rail')],
      tiles,
    );
    expect(wire?.mask).toBe(0b000101);
    expect(rail?.mask).toBe(0b000010);
  });

  it('lights a wire only when the server says it carries power; rails are never lit', () => {
    const { centre, tiles } = patchAround();
    const [lit, dark, unknown, rail] = linePieces(
      [
        line(centre.q, centre.r, 'wire', { powered: true }),
        line(centre.q, centre.r, 'wire', { powered: false }),
        line(centre.q, centre.r, 'wire'),
        line(centre.q, centre.r, 'rail', { powered: true }),
      ],
      tiles,
    );
    expect([lit?.lit, dark?.lit, unknown?.lit, rail?.lit]).toEqual([true, false, false, false]);
  });

  it('keeps to a ring round a building in the middle, and draws nothing on a tile it does not know', () => {
    const { centre, tiles } = patchAround();
    tiles.get(hexKey(centre))?.buildings.push(building('windmill'));
    const [piece] = linePieces([line(centre.q, centre.r, 'wire')], tiles);
    expect(piece?.ringed).toBe(true);
    expect(linePieces([line(999, 999, 'rail')], tiles)).toEqual([]);
  });

  it('draws a lone rail and a rail end as straight track', () => {
    expect(railSides(0)).toEqual([0, 3]);
    expect(railSides(1 << 4)).toEqual([4, 1]);
    expect(railSides(0b000011)).toEqual([0, 1]);
    expect(railSides(FULL_MASK)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('places arms from the middle, or from the ring round a building, to the side', () => {
    const full = sideDistance(1);
    expect(full).toBeCloseTo(Math.sqrt(3) / 2);
    const [open] = armPlacements([0], false, 0.5, 1);
    expect(open).toMatchObject({ side: 0, from: 0, length: 1 });
    const [ringed] = armPlacements([2], true, 0.5, 1);
    expect(ringed?.from).toBeCloseTo(full * 0.5);
    expect(ringed?.length).toBeCloseTo(0.5);
  });
});
