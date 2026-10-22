import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng/index.js';
import {
  checkFoundSetDrops,
  FoundSetPlaceSchema,
  type FoundSetDropTable,
} from '../../schemas/data/found-set-drops.js';
import { rollFoundSet, rollFoundSets, withFoundItems } from '../../wardrobe/found-set-drops.js';
import { FOUND_SETS, REKINDLED } from '../found-sets.js';
import { REKINDLED_DROPS } from './hollowed-finds.js';

const table = (over: Partial<FoundSetDropTable> = {}): FoundSetDropTable => ({
  set: 'rekindled',
  place: 'village',
  chance: 100,
  entries: [{ weight: 1, clothing: 'lantern-glow-cap' }],
  ...over,
});

describe('the Rekindled drop tables (#306 PR 5, server-only)', () => {
  it('pass their check: every piece and find can drop', () => {
    expect(checkFoundSetDrops(REKINDLED_DROPS, FOUND_SETS)).toEqual([]);
  });

  it('have a table for every Hollowed place, so the puzzles, cellars and far Hollow only call', () => {
    expect(REKINDLED_DROPS.map((t) => t.place)).toEqual(FoundSetPlaceSchema.options);
  });

  it('give the far Hollow twice the village odds and cellars more (plan Q5, Q7)', () => {
    const chance = (place: string) => REKINDLED_DROPS.find((t) => t.place === place)!.chance;
    expect(chance('far-hollow')).toBe(2 * chance('village'));
    expect(chance('cellar')).toBeGreaterThan(chance('village'));
  });

  it('keep the epic piece the rarest', () => {
    const village = REKINDLED_DROPS.find((t) => t.place === 'village')!;
    const weight = (id: string) => village.entries.find((e) => e.clothing === id)!.weight;
    for (const id of REKINDLED.pieces) {
      if (id !== 'joy-lantern-charm')
        expect(weight(id)).toBeGreaterThan(weight('joy-lantern-charm'));
    }
  });

  it('report a stranger, a twice-listed piece, a repeated place and a piece no table drops', () => {
    expect(
      checkFoundSetDrops(
        [
          table({
            entries: [
              { weight: 1, clothing: 'witch-hat' },
              { weight: 1, items: { timber: 1 } },
              { weight: 1, clothing: 'lantern-glow-cap' },
              { weight: 1, clothing: 'lantern-glow-cap' },
            ],
          }),
          table(),
          table({ set: 'moonbeam' }),
        ],
        [REKINDLED],
      ),
    ).toEqual([
      'drops[0].entries[0].clothing: "witch-hat" isn\'t a Rekindled piece',
      'drops[0].entries[1].items: "timber" isn\'t a Rekindled find',
      'drops[0].entries[3].clothing: "lantern-glow-cap" is listed twice',
      'drops[1].place: rekindled has two village tables',
      'drops[2].set: unknown set "moonbeam"',
      'drops: rekindled\'s "ember-patch-jacket" is in no drop table',
      'drops: rekindled\'s "ember-patch-trousers" is in no drop table',
      'drops: rekindled\'s "lantern-glow-boots" is in no drop table',
      'drops: rekindled\'s "joy-lantern-charm" is in no drop table',
      'drops: rekindled\'s "joy-ember" is in no drop table',
      'drops: rekindled\'s "heart-petals" is in no drop table',
    ]);
    expect(
      checkFoundSetDrops(
        [
          table({
            entries: [{ weight: 1, clothing: 'lantern-glow-cap', items: { 'joy-ember': 1 } }],
          }),
        ],
        [REKINDLED],
      )[0],
    ).toContain('an entry is a piece or some finds, not both or neither');
  });
});

describe('rollFoundSet', () => {
  const rng = () => Rng.fromSeed('rekindled-test');

  it('finds the piece, or nothing once it is owned (a piece is found once)', () => {
    expect(rollFoundSet(table(), new Set(), rng())).toEqual({
      clothing: 'lantern-glow-cap',
      items: {},
    });
    expect(rollFoundSet(table(), new Set(['lantern-glow-cap']), rng())).toEqual({
      clothing: null,
      items: {},
    });
  });

  it('finds the set’s own finds, and nothing past its chance', () => {
    const finds = table({ entries: [{ weight: 1, items: { 'joy-ember': 1 } }] });
    expect(rollFoundSet(finds, new Set(), rng()).items).toEqual({ 'joy-ember': 1 });
    expect(rollFoundSet({ ...finds, chance: 0 }, new Set(), rng())).toEqual({
      clothing: null,
      items: {},
    });
  });

  it('keeps an owned piece’s odds as nothing, so the finds’ odds never move', () => {
    const t = table({
      entries: [
        { weight: 1, clothing: 'lantern-glow-cap' },
        { weight: 1, items: { 'heart-petals': 1 } },
      ],
    });
    const r = Rng.fromSeed('odds');
    let petals = 0;
    for (let i = 0; i < 2000; i++) {
      if (rollFoundSet(t, new Set(['lantern-glow-cap']), r).items['heart-petals']) petals++;
    }
    expect(petals / 2000).toBeGreaterThan(0.45);
    expect(petals / 2000).toBeLessThan(0.55);
  });

  it('rolls only the tables for the place, and keeps at most one piece', () => {
    const tables = [
      table({ place: 'cellar', entries: [{ weight: 1, items: { 'joy-ember': 2 } }] }),
      table(),
      table({ set: 'other', entries: [{ weight: 1, clothing: 'other-cap' }] }),
    ];
    expect(rollFoundSets(tables, 'village', new Set(), rng())).toEqual({
      clothing: 'lantern-glow-cap',
      items: {},
    });
    expect(rollFoundSets(tables, 'cellar', new Set(), rng())).toEqual({
      clothing: null,
      items: { 'joy-ember': 2 },
    });
    expect(rollFoundSets(tables, 'puzzle', new Set(), rng())).toEqual({
      clothing: null,
      items: {},
    });
  });
});

describe('withFoundItems', () => {
  it('adds a roll’s finds to the search’s own, without changing either', () => {
    const items = { stone: 1, 'joy-ember': 1 };
    const roll = { clothing: null, items: { 'joy-ember': 1, 'heart-petals': 2 } };
    expect(withFoundItems(items, roll)).toEqual({ stone: 1, 'joy-ember': 2, 'heart-petals': 2 });
    expect(items).toEqual({ stone: 1, 'joy-ember': 1 });
  });
});
