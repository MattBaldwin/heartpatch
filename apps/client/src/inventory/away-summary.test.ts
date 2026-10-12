import { EXPLORE_RULES, findAvoidedWords } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { AWAY_TEXT, summaryCount, summaryEntries, summarySentence } from './away-summary.js';
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
      AWAY_TEXT.bagNews(1),
      AWAY_TEXT.bagNews(14),
    ];
    for (const line of lines) {
      expect(findAvoidedWords(line), line).toEqual([]);
      expect(line.split(' ').length, line).toBeLessThanOrEqual(10);
    }
    expect(AWAY_TEXT.bagNews(1)).toBe('Something new in your Bag!');
    expect(AWAY_TEXT.bagNews(14)).toBe('14 new things in your Bag!');
  });
});
