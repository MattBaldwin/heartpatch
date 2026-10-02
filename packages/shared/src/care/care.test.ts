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
      { contentment: 20, percent: 100, full: true },
      { contentment: 20, percent: 100, full: true },
      { contentment: 20, percent: 100, full: true },
      { contentment: 10, percent: 50, full: false },
      { contentment: 5, percent: 25, full: false },
      { contentment: 2, percent: 10, full: false },
      { contentment: 2, percent: 10, full: false },
    ]);
    expect(careGain(pet, 7, CARE_RULES).contentment).toBe(1);
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
  it('follows the XP curve in data', () => {
    expect(xpForLevel(1, GROWTH_RULES)).toBe(0);
    expect(xpForLevel(2, GROWTH_RULES)).toBe(25);
    expect(xpForLevel(5, GROWTH_RULES)).toBe(160);
    expect(xpForLevel(10, GROWTH_RULES)).toBe(585);
    expect(levelForXp(0, GROWTH_RULES)).toBe(1);
    expect(levelForXp(24, GROWTH_RULES)).toBe(1);
    expect(levelForXp(25, GROWTH_RULES)).toBe(2);
    expect(levelForXp(584, GROWTH_RULES)).toBe(9);
    expect(levelForXp(10_000_000, GROWTH_RULES)).toBe(GROWTH_RULES.maxLevel);
  });

  it('levels up, several at once if the XP is there', () => {
    expect(addXp({ level: 1, xp: 0 }, 30, GROWTH_RULES)).toEqual({ level: 2, xp: 30 });
    expect(addXp({ level: 1, xp: 20 }, 160, GROWTH_RULES)).toEqual({ level: 5, xp: 180 });
  });

  it('counts from its level for a squishy that joined above level 1, and never goes down', () => {
    // A befriended level-5 squishy with no XP yet.
    expect(addXp({ level: 5, xp: 0 }, 10, GROWTH_RULES)).toEqual({ level: 5, xp: 170 });
    expect(addXp({ level: 5, xp: 0 }, 0, GROWTH_RULES).level).toBe(5);
  });

  it('shows progress through the level, and none past the top', () => {
    expect(xpProgress({ level: 2, xp: 40 }, GROWTH_RULES)).toEqual({ intoLevel: 15, toNext: 35 });
    expect(xpProgress({ level: 100, xp: 1e6 }, GROWTH_RULES).toNext).toBeNull();
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
