import { EXPLORE_RULES, findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  AWAY_TEXT,
  flightPath,
  onScreen,
  spreadStarts,
  staggerMs,
  summaryCount,
  summaryEntries,
  summarySentence,
} from './away-summary.js';
import { itemIcon } from './item-icons.js';

describe('summaryEntries', () => {
  it('adds up what landed per item, in the bag order, after one chip for training', () => {
    const entries = summaryEntries(
      [{ items: { emberwood: 4, stone: 3 } }, { items: { stone: 2, water: 2 } }],
      [
        { name: 'Glimmerock', xp: 2 },
        { name: 'Emberbun', xp: 4 },
      ],
    );
    expect(entries).toEqual([
      {
        kind: 'trained',
        squishies: [
          { name: 'Glimmerock', xp: 2 },
          { name: 'Emberbun', xp: 4 },
        ],
        xp: 6,
      },
      {
        kind: 'item',
        id: 'stone',
        amount: 5,
        icon: itemIcon('stone'),
        name: 'Stone',
        chip: '+5',
        line: `${itemIcon('stone')} +5 Stone`,
      },
      {
        kind: 'item',
        id: 'emberwood',
        amount: 4,
        icon: itemIcon('emberwood'),
        name: 'Emberwood',
        chip: '+4',
        line: `${itemIcon('emberwood')} +4 Emberwood`,
      },
      {
        kind: 'item',
        id: 'water',
        amount: 2,
        icon: itemIcon('water'),
        name: 'Water',
        chip: '+2',
        line: `${itemIcon('water')} +2 Water`,
      },
    ]);
  });

  it('leaves out nothing-at-all and has no training chip when nobody trained', () => {
    expect(summaryEntries([{ items: { timber: 0 } }], [])).toEqual([]);
    expect(summaryEntries([{ items: { timber: 5 } }], []).map((e) => e.kind)).toEqual(['item']);
  });

  it('counts a tool in whole tools, as its pop-up line does', () => {
    const shovel = EXPLORE_RULES.tools.find((t) => t.id === 'shovel');
    if (!shovel) throw new Error('no shovel');
    const [entry] = summaryEntries([{ items: { shovel: shovel.uses * 2 } }], []);
    expect(entry).toMatchObject({ kind: 'item', amount: 2, chip: '+2' });
    expect(entry?.kind === 'item' && entry.line).toContain('2 new Shovels');
  });
});

describe('summaryCount', () => {
  it('counts the things that landed, not the training', () => {
    const entries = summaryEntries(
      [{ items: { stone: 3, emberwood: 4, water: 2, greens: 3, 'witch-dust': 2 } }],
      [{ name: 'Glimmerock', xp: 2 }],
    );
    expect(summaryCount(entries)).toBe(14);
    expect(summaryCount([])).toBe(0);
  });
});

describe('summarySentence', () => {
  it('says it all in one line for screen readers', () => {
    expect(summarySentence([{ items: { timber: 5 } }], [{ name: 'Glimmerock', xp: 2 }])).toBe(
      `${itemIcon('timber')} +5 Timber! 🎯 Glimmerock trained: +2 XP!`,
    );
    expect(summarySentence([], [])).toBe('');
  });
});

describe('AWAY_TEXT', () => {
  it('is short and kind', () => {
    const lines = [
      AWAY_TEXT.tagAway,
      AWAY_TEXT.tagNow,
      AWAY_TEXT.more(3),
      AWAY_TEXT.cardTagAway,
      AWAY_TEXT.cardTagNow,
      AWAY_TEXT.cardTitle,
      AWAY_TEXT.training,
      AWAY_TEXT.xp(2),
      AWAY_TEXT.nice,
      AWAY_TEXT.bagNews,
    ];
    for (const line of lines) {
      expect(findAvoidedWords(line), line).toEqual([]);
      expect(line.split(' ').length, line).toBeLessThanOrEqual(10);
    }
  });
});

describe('flightPath', () => {
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  it('starts where the thing landed and ends in its place in the banner', () => {
    const path = flightPath({ x: 200, y: 400 }, { x: 120, y: 150 }, 12);
    expect(path).toHaveLength(13);
    expect(path[0]).toEqual({ x: 200, y: 400 });
    expect(path.at(-1)?.x).toBeCloseTo(120);
    expect(path.at(-1)?.y).toBeCloseTo(150);
  });

  it('always heads for its target, whichever way it goes (no chip swings off the other way)', () => {
    const from = { x: 195, y: 420 };
    for (const to of [
      { x: 40, y: 150 },
      { x: 360, y: 150 },
      { x: 195, y: 140 },
      { x: 60, y: 600 },
      { x: 380, y: 430 },
    ]) {
      const left = flightPath(from, to, 24).map((p) => distance(p, to));
      for (let i = 1; i < left.length; i++) {
        expect(left[i], `${JSON.stringify(to)} step ${String(i)}`).toBeLessThan(
          left[i - 1] ?? Infinity,
        );
      }
    }
  });
});

describe('spreadStarts', () => {
  const chip = { width: 56, height: 30 };
  const phone = { top: 200, left: 0, right: 320, bottom: 568 };
  const overlap = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    gap: number,
  ): boolean => Math.abs(a.x - b.x) < chip.width + gap && Math.abs(a.y - b.y) < chip.height + gap;

  it('leaves chips that are already apart where they are', () => {
    const spots = [
      { x: 60, y: 300 },
      { x: 200, y: 300 },
      { x: 130, y: 400 },
    ];
    expect(spreadStarts(spots, [chip, chip, chip], 4, phone)).toEqual(spots);
  });

  it('spreads chips from one tile, or close tiles, so none covers another, on screen and under the banner', () => {
    // A 320-point phone: six chips from tiles narrower than a chip.
    const spots = [
      { x: 150, y: 300 },
      { x: 150, y: 300 },
      { x: 170, y: 310 },
      { x: 130, y: 320 },
      { x: 160, y: 290 },
      { x: 150, y: 300 },
    ];
    const starts = spreadStarts(
      spots,
      spots.map(() => chip),
      4,
      phone,
    );
    for (const [i, a] of starts.entries()) {
      for (const b of starts.slice(i + 1)) expect(overlap(a, b, 4)).toBe(false);
      expect(a.x - chip.width / 2).toBeGreaterThanOrEqual(phone.left);
      expect(a.x + chip.width / 2).toBeLessThanOrEqual(phone.right);
      expect(a.y - chip.height / 2).toBeGreaterThanOrEqual(phone.top);
      // Near its own tile: within a few chips.
      expect(Math.hypot(a.x - (spots[i]?.x ?? 0), a.y - (spots[i]?.y ?? 0))).toBeLessThan(200);
    }
  });
});

describe('staggerMs', () => {
  it('sends chips 70 ms apart, but all within 300 ms however many', () => {
    expect(staggerMs(1, 70, 300)).toBe(0);
    expect(staggerMs(3, 70, 300)).toBe(70);
    expect(staggerMs(10, 70, 300) * 9).toBeCloseTo(300);
  });
});

describe('onScreen', () => {
  it('takes a tile on screen and gives up one panned past the edge', () => {
    expect(onScreen({ x: 195, y: 400 }, 390, 844)).toBe(true);
    expect(onScreen({ x: -10, y: 400 }, 390, 844)).toBe(false);
    expect(onScreen({ x: 195, y: 900 }, 390, 844)).toBe(false);
  });
});
