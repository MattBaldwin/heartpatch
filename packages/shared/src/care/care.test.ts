import { describe, expect, it } from 'vitest';
import { CARE_ACTIONS } from '../data/care-actions.js';
import { CARE_RULES, GROWTH_RULES } from '../data/care.js';
import { findAvoidedWords } from '../data/avoided-words.js';
import { checkCareRules, checkGrowthRules, type CareRules } from '../schemas/data/care.js';
import {
  careCoins,
  careGain,
  contentmentAfterCare,
  contentmentAt,
  moodFor,
  moodLine,
} from './contentment.js';
import {
  addXp,
  battleXpPercent,
  befriendedLevel,
  joiningSpecies,
  carePercent,
  evolutionAt,
  grantedXp,
  habitatPercent,
  levelForXp,
  xpForLevel,
  xpMultiplier,
  xpProgress,
} from './growth.js';

const HOUR = 60 * 60 * 1000;
const at = (hours: number) => new Date(Date.UTC(2026, 9, 2, 12) + hours * HOUR);
const feed = { contentment: 20 };
const pet = { contentment: 10 };

describe('care and growth data', () => {
  it('passes its checks', () => {
    expect(checkCareRules(CARE_RULES)).toEqual([]);
    expect(checkGrowthRules(GROWTH_RULES)).toEqual([]);
  });

  it('matches the design doc defaults (§7)', () => {
    expect(CARE_RULES).toMatchObject({
      maxContentment: 100,
      hoursFullToBaseline: 24,
      fullActionsPerDay: 3,
    });
    expect(GROWTH_RULES).toMatchObject({
      care: { minPercent: 100, maxPercent: 175 },
      habitat: { bothPercent: 175 },
      capPercent: 300,
    });
  });

  it('keeps care cooldowns to a short debounce (decision G)', () => {
    for (const action of CARE_ACTIONS) expect(action.cooldownSeconds).toBeLessThanOrEqual(60);
  });

  it('refuses rules that would give more for later actions, or moods out of order', () => {
    const bad: CareRules = {
      ...CARE_RULES,
      falloffPercents: [10, 50],
      moods: [
        { id: 'calm', atLeast: 10, line: 'Calm.' },
        { id: 'happy', atLeast: 40, line: 'Happy.' },
      ],
    };
    const problems = checkCareRules(bad).join('\n');
    expect(problems).toContain('falloffPercents');
    expect(problems).toContain('moods');
  });

  it('starts a new squishy between the baseline and full', () => {
    expect(CARE_RULES.startContentment).toBeGreaterThan(CARE_RULES.baselineContentment);
    expect(CARE_RULES.startContentment).toBeLessThanOrEqual(CARE_RULES.maxContentment);
    const below = { ...CARE_RULES, baselineContentment: 20, startContentment: 10 };
    expect(checkCareRules(below).join('\n')).toContain('startContentment');
    expect(checkCareRules({ ...CARE_RULES, startContentment: 101 }).join('\n')).toContain(
      'startContentment',
    );
  });

  it('uses no avoided words in mood lines', () => {
    expect(findAvoidedWords(CARE_RULES.moods.map((m) => m.line).join(' '))).toEqual([]);
  });
});

describe('contentmentAt', () => {
  const full = { contentment: 100, lastCaredAt: at(0) };

  it('is the stored value right after care', () => {
    expect(contentmentAt(full, at(0), CARE_RULES)).toBe(100);
  });

  it('slides from full to the baseline over a day', () => {
    expect(contentmentAt(full, at(6), CARE_RULES)).toBe(75);
    expect(contentmentAt(full, at(12), CARE_RULES)).toBe(50);
    expect(contentmentAt(full, at(23), CARE_RULES)).toBe(5);
    expect(contentmentAt(full, at(24), CARE_RULES)).toBe(0);
  });

  it('never goes below the baseline, however many days pass', () => {
    expect(contentmentAt(full, at(24 * 30), CARE_RULES)).toBe(0);
    const rules = { ...CARE_RULES, baselineContentment: 20 };
    expect(contentmentAt(full, at(24 * 3), rules)).toBe(20);
    expect(contentmentAt({ contentment: 50, lastCaredAt: at(0) }, at(72), rules)).toBe(20);
  });

  it('starts at the baseline for a squishy nobody has cared for yet', () => {
    expect(contentmentAt({ contentment: 0, lastCaredAt: null }, at(5), CARE_RULES)).toBe(0);
  });

  it('ignores a clock that went backwards', () => {
    expect(contentmentAt(full, at(-3), CARE_RULES)).toBe(100);
  });

  it('caps care at full and builds on the decayed value', () => {
    expect(contentmentAfterCare(full, at(0), 20, CARE_RULES)).toBe(100);
    expect(contentmentAfterCare(full, at(12), 20, CARE_RULES)).toBe(70);
  });
});

describe('moods', () => {
  it('picks the first band reached, with soft words', () => {
    expect(moodFor(100, CARE_RULES)).toBe('glowing');
    expect(moodFor(75, CARE_RULES)).toBe('glowing');
    expect(moodFor(74, CARE_RULES)).toBe('happy');
    expect(moodFor(10, CARE_RULES)).toBe('calm');
    expect(moodFor(0, CARE_RULES)).toBe('cuddly');
    expect(moodLine('cuddly', CARE_RULES)).toBe('Could use a cuddle!');
  });
});

describe('diminishing returns (decision G)', () => {
  it('gives the first three actions a day in full, then less and less', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => careGain(feed, n, CARE_RULES))).toEqual([
      { contentment: 20, percent: 100, full: true, counts: true },
      { contentment: 20, percent: 100, full: true, counts: true },
      { contentment: 20, percent: 100, full: true, counts: true },
      { contentment: 10, percent: 50, full: false, counts: true },
      { contentment: 5, percent: 25, full: false, counts: true },
      { contentment: 2, percent: 10, full: false, counts: true },
      { contentment: 2, percent: 10, full: false, counts: true },
    ]);
    expect(careGain(pet, 7, CARE_RULES).contentment).toBe(1);
  });

  it('gives a Heart Snack in full on any day, outside the count and with no coins', () => {
    const snack = CARE_ACTIONS.find((a) => a.id === 'heart-snack');
    if (!snack) throw new Error('no heart-snack in the data');
    expect(snack.cost).toEqual({ heartdust: 3 });
    for (const n of [0, 3, 9]) {
      expect(careGain(snack, n, CARE_RULES)).toEqual({
        contentment: snack.contentment,
        percent: 100,
        full: true,
        counts: false,
      });
    }
    expect(careCoins(careGain(snack, 0, CARE_RULES), 0, CARE_RULES)).toBe(0);
  });

  it('pays coins for full actions only, up to the daily cap', () => {
    const full = careGain(pet, 0, CARE_RULES);
    const late = careGain(pet, 3, CARE_RULES);
    expect(careCoins(full, 0, CARE_RULES)).toBe(1);
    expect(careCoins(late, 0, CARE_RULES)).toBe(0);
    expect(careCoins(full, CARE_RULES.dailyCoinCap - 1, CARE_RULES)).toBe(1);
    expect(careCoins(full, CARE_RULES.dailyCoinCap, CARE_RULES)).toBe(0);
    expect(careCoins(full, CARE_RULES.dailyCoinCap + 5, CARE_RULES)).toBe(0);
  });
});

describe('the XP multiplier (design doc §7)', () => {
  const ember = { elements: ['fire' as const], feelings: ['cozy' as const] };
  const fireCozy = { element: 'fire' as const, feeling: 'cozy' as const };
  const fireJoy = { element: 'fire' as const, feeling: 'joy' as const };
  const waterJoy = { element: 'water' as const, feeling: 'joy' as const };

  it('runs care from 1.0× to 1.75×', () => {
    expect(carePercent(0, GROWTH_RULES)).toBe(100);
    expect(carePercent(50, GROWTH_RULES)).toBe(137);
    expect(carePercent(100, GROWTH_RULES)).toBe(175);
  });

  it('gives 1.0× without a habitat or a match, more for one tag, 1.75× for both', () => {
    expect(habitatPercent(null, fireCozy, GROWTH_RULES)).toBe(100);
    expect(habitatPercent(ember, waterJoy, GROWTH_RULES)).toBe(100);
    expect(habitatPercent(ember, fireJoy, GROWTH_RULES)).toBe(135);
    expect(habitatPercent(ember, fireCozy, GROWTH_RULES)).toBe(175);
  });

  it('never goes below 1.0×: neglected squishies still get base XP', () => {
    expect(xpMultiplier(0, null, waterJoy, GROWTH_RULES)).toBe(100);
    expect(grantedXp(30, xpMultiplier(0, null, waterJoy, GROWTH_RULES))).toBe(30);
  });

  it('multiplies care by habitat and caps the whole at 3×', () => {
    expect(xpMultiplier(100, null, fireCozy, GROWTH_RULES)).toBe(175);
    expect(xpMultiplier(0, ember, fireCozy, GROWTH_RULES)).toBe(175);
    expect(xpMultiplier(50, ember, fireJoy, GROWTH_RULES)).toBe(184); // 137 × 135
    expect(xpMultiplier(100, ember, fireCozy, GROWTH_RULES)).toBe(300); // 306 → cap
    expect(grantedXp(30, 300)).toBe(90);
    expect(grantedXp(7, 175)).toBe(12);
  });
});

describe('levels', () => {
  /** A plain curve with no knees, so these tests don't move when data is tuned. */
  const PLAIN = { maxLevel: 100, xpCurve: { perLevel: 20, curve: 5 } };
  /** The same curve with knees at 16 and 30. */
  const KNEED = {
    maxLevel: 100,
    xpCurve: {
      perLevel: 20,
      curve: 5,
      knees: [
        { level: 16, steep: 500 },
        { level: 30, steep: 1500 },
      ],
    },
  };

  it('follows the plain curve', () => {
    expect(xpForLevel(1, PLAIN)).toBe(0);
    expect(xpForLevel(2, PLAIN)).toBe(25);
    expect(xpForLevel(5, PLAIN)).toBe(160);
    expect(xpForLevel(10, PLAIN)).toBe(585);
    expect(levelForXp(0, PLAIN)).toBe(1);
    expect(levelForXp(24, PLAIN)).toBe(1);
    expect(levelForXp(25, PLAIN)).toBe(2);
    expect(levelForXp(584, PLAIN)).toBe(9);
    expect(levelForXp(10_000_000, PLAIN)).toBe(PLAIN.maxLevel);
  });

  it('adds steep × (L − knee)² past each knee, and nothing up to it', () => {
    for (const level of [1, 2, 10, 16]) {
      expect(xpForLevel(level, KNEED)).toBe(xpForLevel(level, PLAIN));
    }
    expect(xpForLevel(17, KNEED)).toBe(xpForLevel(17, PLAIN) + 500);
    expect(xpForLevel(20, KNEED)).toBe(xpForLevel(20, PLAIN) + 500 * 16);
    expect(xpForLevel(30, KNEED)).toBe(xpForLevel(30, PLAIN) + 500 * 196);
    expect(xpForLevel(32, KNEED)).toBe(xpForLevel(32, PLAIN) + 500 * 256 + 1500 * 4);
    // Past the top level, the top level's XP.
    expect(xpForLevel(120, KNEED)).toBe(xpForLevel(100, KNEED));
    expect(levelForXp(xpForLevel(31, KNEED) - 1, KNEED)).toBe(30);
    expect(levelForXp(xpForLevel(31, KNEED), KNEED)).toBe(31);
  });

  it('follows the XP curve in data', () => {
    // TUNE pins (data/care.ts): a change to the curve shows up here.
    expect(xpForLevel(2, GROWTH_RULES)).toBe(40);
    expect(xpForLevel(16, GROWTH_RULES)).toBe(4_800);
    expect(xpForLevel(20, GROWTH_RULES)).toBe(15_600);
    expect(xpForLevel(30, GROWTH_RULES)).toBe(115_400);
    expect(xpForLevel(40, GROWTH_RULES)).toBe(469_200);
    expect(xpForLevel(100, GROWTH_RULES)).toBe(11_076_000);
    expect(levelForXp(xpForLevel(100, GROWTH_RULES) * 2, GROWTH_RULES)).toBe(GROWTH_RULES.maxLevel);
    // Every level costs more than the one before it.
    for (let level = 2; level < GROWTH_RULES.maxLevel; level++) {
      const step = xpForLevel(level + 1, GROWTH_RULES) - xpForLevel(level, GROWTH_RULES);
      expect(step).toBeGreaterThan(
        xpForLevel(level, GROWTH_RULES) - xpForLevel(level - 1, GROWTH_RULES),
      );
    }
  });

  it('levels up, several at once if the XP is there', () => {
    expect(addXp({ level: 1, xp: 0 }, 30, PLAIN)).toEqual({ level: 2, xp: 30 });
    expect(addXp({ level: 1, xp: 20 }, 160, PLAIN)).toEqual({ level: 5, xp: 180 });
  });

  it('counts from its level for a squishy that joined above level 1, and never goes down', () => {
    // A befriended level-5 squishy with no XP yet.
    expect(addXp({ level: 5, xp: 0 }, 10, PLAIN)).toEqual({ level: 5, xp: 170 });
    expect(addXp({ level: 5, xp: 0 }, 0, PLAIN).level).toBe(5);
  });

  it('keeps a squishy levelled on a gentler curve at its level when the curve steepens', () => {
    // A level-40 squishy whose stored XP is the plain curve's level 40.
    const before = { level: 40, xp: xpForLevel(40, PLAIN) };
    expect(levelForXp(before.xp, KNEED)).toBeLessThan(40);
    expect(xpProgress(before, KNEED)).toEqual({
      intoLevel: 0,
      toNext: xpForLevel(41, KNEED) - xpForLevel(40, KNEED),
    });
    // Its next XP counts from the steeper curve's level 40: still level 40, never lower.
    expect(addXp(before, 0, KNEED)).toEqual({ level: 40, xp: xpForLevel(40, KNEED) });
    expect(addXp(before, 100, KNEED)).toEqual({ level: 40, xp: xpForLevel(40, KNEED) + 100 });
  });

  it('shows progress through the level, and none past the top', () => {
    expect(xpProgress({ level: 2, xp: 40 }, PLAIN)).toEqual({ intoLevel: 15, toNext: 35 });
    expect(xpProgress({ level: 100, xp: 1e6 }, PLAIN).toNext).toBeNull();
  });
});

describe('battleXpPercent (owner decision 2026-10-06)', () => {
  const rules = { battleXpFalloff: { fullWinsPerDay: 7, afterPercent: 10 } };

  it("pays in full until the day's wins reach the limit, then a share", () => {
    expect(battleXpPercent(0, rules)).toBe(100);
    expect(battleXpPercent(6, rules)).toBe(100);
    expect(battleXpPercent(7, rules)).toBe(10);
    expect(battleXpPercent(30, rules)).toBe(10);
    expect(battleXpPercent(30, {})).toBe(100);
  });

  it('is on in the shipped data', () => {
    expect(GROWTH_RULES.battleXpFalloff).toEqual({ fullWinsPerDay: 7, afterPercent: 10 });
  });
});

describe('joiningSpecies (owner decision 2026-10-08, #279)', () => {
  // A three-stage chain: the shipped roster has none yet, so the rule is pinned here.
  const steps = [
    { from: 'puff', into: 'mallow', level: 16 },
    { from: 'mallow', into: 'cloud', level: 32 },
    { from: 'puff', into: 'secret-puff', level: 20 },
  ];

  it('joins one evolution back: stage 3 as stage 2, stage 2 as its base form', () => {
    expect(joiningSpecies('cloud', steps)).toBe('mallow');
    expect(joiningSpecies('mallow', steps)).toBe('puff');
    expect(joiningSpecies('secret-puff', steps)).toBe('puff');
  });

  it('keeps a base form, or a species with no evolutions, as itself', () => {
    expect(joiningSpecies('puff', steps)).toBe('puff');
    expect(joiningSpecies('pebble', steps)).toBe('pebble');
  });

  it('caps the level below the joined species’ own next evolution', () => {
    const cap = { befriendBelowEvolution: 1 };
    // A level-40 stage 3 joins as a level-31 stage 2; a stage 2 as a level-15 base.
    expect(befriendedLevel(joiningSpecies('cloud', steps), 40, steps, cap)).toBe(31);
    expect(befriendedLevel(joiningSpecies('mallow', steps), 18, steps, cap)).toBe(15);
  });
});

describe('befriendedLevel (owner decision 2026-10-06)', () => {
  const steps = [
    { from: 'puff', into: 'mallow', level: 16 },
    { from: 'puff', into: 'secret-puff', level: 20 },
    { from: 'mallow', into: 'cloud', level: 32 },
  ];
  const cap = { befriendBelowEvolution: 1 };

  it('joins at most one below its first evolution', () => {
    expect(befriendedLevel('puff', 40, steps, cap)).toBe(15);
    expect(befriendedLevel('puff', 15, steps, cap)).toBe(15);
    expect(befriendedLevel('puff', 6, steps, cap)).toBe(6);
  });

  it('keeps the battle level for a species that never evolves, or without a cap', () => {
    expect(befriendedLevel('cloud', 40, steps, cap)).toBe(40);
    expect(befriendedLevel('puff', 40, steps, {})).toBe(40);
  });

  it('is on in the shipped data', () => {
    expect(GROWTH_RULES.befriendBelowEvolution).toBe(1);
  });
});

describe('evolutionAt (Phase 1: the single next form)', () => {
  const steps = [
    { from: 'puff', into: 'mallow', level: 16 },
    { from: 'mallow', into: 'cloud', level: 32 },
    { from: 'puff', into: 'secret-puff', level: 16 },
    { from: 'puff', into: 'early', level: 20 },
  ];

  it('waits for the threshold', () => {
    expect(evolutionAt('puff', 15, steps)).toBeNull();
    expect(evolutionAt('puff', 16, steps)?.into).toBe('mallow');
  });

  it('takes the lowest level, then the first listed', () => {
    expect(evolutionAt('puff', 40, steps)?.into).toBe('mallow');
  });

  it('only evolves from its own species', () => {
    expect(evolutionAt('mallow', 31, steps)).toBeNull();
    expect(evolutionAt('mallow', 32, steps)?.into).toBe('cloud');
    expect(evolutionAt('nobody', 99, steps)).toBeNull();
  });
});
