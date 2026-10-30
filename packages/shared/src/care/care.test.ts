import { describe, expect, it } from 'vitest';
import { CARE_ACTIONS } from '../data/care-actions.js';
import { CARE_RULES, GROWTH_RULES } from '../data/care.js';
import { GAME_DATA } from '../data/index.js';
import { SPECIES } from '../data/species.js';
import { findAvoidedWords } from '../data/avoided-words.js';
import { HOUSE_DATA } from '../data/house.js';
import { residentDrainPercent } from '../house/index.js';
import {
  checkCareRules,
  checkGrowthRules,
  foodPercentFor,
  type CareRules,
} from '../schemas/data/care.js';
import {
  careCoins,
  careGain,
  contentmentAfterCare,
  fedWith,
  contentmentAt,
  heldMs,
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

describe('fedWith (#621 W1-8b)', () => {
  const feed = CARE_ACTIONS.find((a) => a.id === 'feed')!;

  it('feeds only things in the bag that are food, Treats as the plain feed', () => {
    const resources = new Set(GAME_DATA.resources.map((r) => r.id));
    for (const food of Object.keys(CARE_RULES.foods ?? {}))
      expect(resources.has(food), food).toBe(true);
    expect(CARE_RULES.foods).toMatchObject({ treats: 100, pies: 150 });
    expect(resources.has('frosty-treats')).toBe(true);
    expect(feed.cost).toEqual({ treats: 1 });
  });

  it('gives a food its percent of the action, paid one for one in that food', () => {
    expect(fedWith(feed, 'pies', CARE_RULES)).toEqual({ contentment: 30, cost: { pies: 1 } });
    expect(fedWith(feed, 'treats', CARE_RULES)).toEqual({
      contentment: feed.contentment,
      cost: feed.cost,
    });
    expect(fedWith({ contentment: 7, cost: { treats: 2 } }, 'pies', CARE_RULES)).toEqual({
      contentment: 10,
      cost: { pies: 2 },
    });
  });

  it("won't pay with a non-food, or for care that isn't paid in one food", () => {
    expect(fedWith(feed, 'timber', CARE_RULES)).toBeNull();
    expect(fedWith(feed, 'pies', { foods: undefined })).toBeNull();
    for (const id of ['pet', 'play', 'heart-snack', 'heart-tea']) {
      expect(
        fedWith(
          CARE_ACTIONS.find((a) => a.id === id)!,
          'pies',
          CARE_RULES,
        ),
        id,
      ).toBeNull();
    }
    expect(
      fedWith({ contentment: 20, cost: { treats: 1, pies: 1 } }, 'pies', CARE_RULES),
    ).toBeNull();
  });

  it('then falls off through the day like any feed', () => {
    const pie = { ...feed, ...fedWith(feed, 'pies', CARE_RULES)! };
    expect([0, 3, 4, 9].map((n) => careGain(pie, n, CARE_RULES).contentment)).toEqual([
      30, 15, 7, 3,
    ]);
  });

  it('rejects a food worth nothing', () => {
    expect(checkCareRules({ ...CARE_RULES, foods: { pies: 0 } }).join('\n')).toContain('foods');
    const bad = { 'frosty-treats': { percent: 100, elements: { frost: 0 } } };
    expect(checkCareRules({ ...CARE_RULES, foods: bad }).join('\n')).toContain('foods');
    const notAnElement = { 'frosty-treats': { percent: 100, elements: { lava: 150 } } };
    expect(checkCareRules({ ...CARE_RULES, foods: notAnElement }).join('\n')).toContain('foods');
  });

  it('feeds Frosty Treats at 150 % to a Frost squishy, 100 % to any other (#735)', () => {
    expect(CARE_RULES.foods?.['frosty-treats']).toEqual({ percent: 100, elements: { frost: 150 } });
    const frosty = { contentment: 30, cost: { 'frosty-treats': 1 } };
    expect(fedWith(feed, 'frosty-treats', CARE_RULES, 'frost')).toEqual(frosty);
    for (const element of ['fire', 'water', undefined] as const) {
      expect(fedWith(feed, 'frosty-treats', CARE_RULES, element), element).toEqual({
        ...frosty,
        contentment: feed.contentment,
      });
    }
    // Pies and Treats don't care about elements.
    for (const element of ['frost', 'fire', undefined] as const) {
      expect(fedWith(feed, 'pies', CARE_RULES, element)).toEqual({
        contentment: 30,
        cost: { pies: 1 },
      });
      expect(fedWith(feed, 'treats', CARE_RULES, element)).toEqual({
        contentment: feed.contentment,
        cost: feed.cost,
      });
    }
  });

  it('reads a food rule for an element, else its plain percent', () => {
    expect(foodPercentFor(150)).toBe(150);
    expect(foodPercentFor(150, 'frost')).toBe(150);
    const rule = { percent: 100, elements: { frost: 150 } };
    expect(foodPercentFor(rule)).toBe(100);
    expect(foodPercentFor(rule, 'frost')).toBe(150);
    expect(foodPercentFor(rule, 'fire')).toBe(100);
  });
});

describe('contentmentAt', () => {
  const full = { contentment: 100, since: at(0) };

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
    expect(contentmentAt({ contentment: 50, since: at(0) }, at(72), rules)).toBe(20);
  });

  it('starts at the baseline for a squishy nobody has cared for yet', () => {
    expect(contentmentAt({ contentment: 0, since: null }, at(5), CARE_RULES)).toBe(0);
  });

  it('ignores a clock that went backwards', () => {
    expect(contentmentAt(full, at(-3), CARE_RULES)).toBe(100);
  });

  it('caps care at full and builds on the decayed value', () => {
    expect(contentmentAfterCare(full, at(0), 20, CARE_RULES)).toBe(100);
    expect(contentmentAfterCare(full, at(12), 20, CARE_RULES)).toBe(70);
  });
});

describe('contentment held by a job (#376)', () => {
  const full = { contentment: 100, since: at(0) };
  const ms = (hours: number) => at(hours).getTime();

  it('holds steady over a span that covers the whole time', () => {
    expect(contentmentAt(full, at(12), CARE_RULES, [{ fromMs: ms(0), toMs: null }])).toBe(100);
  });

  it('drifts only over the time no span covers', () => {
    // Held 0–6h, drifting 6–12h: six hours of drift, a quarter of the range.
    const held = [{ fromMs: ms(0), toMs: ms(6) }];
    expect(contentmentAt(full, at(12), CARE_RULES, held)).toBe(75);
    // A span from before the checkpoint only counts from the checkpoint on.
    expect(contentmentAt(full, at(12), CARE_RULES, [{ fromMs: ms(-5), toMs: ms(6) }])).toBe(75);
  });

  it('never raises contentment', () => {
    const low = { contentment: 30, since: at(0) };
    expect(contentmentAt(low, at(48), CARE_RULES, [{ fromMs: ms(0), toMs: null }])).toBe(30);
  });

  it('counts each moment once, however spans overlap', () => {
    const spans = [
      { fromMs: ms(4), toMs: ms(8) },
      { fromMs: ms(0), toMs: ms(5) },
      { fromMs: ms(6), toMs: ms(7) },
    ];
    expect(heldMs(ms(0), ms(10), spans)).toBe(8 * HOUR);
    expect(heldMs(ms(2), ms(3), spans)).toBe(HOUR);
    expect(heldMs(ms(9), ms(10), spans)).toBe(0);
  });

  it('is whole numbers, the same on every engine, at odd millisecond counts', () => {
    const odd = { contentment: 97, since: new Date(1_760_000_000_123) };
    const now = new Date(1_760_000_000_123 + 7 * HOUR + 1_234_567);
    const held = [{ fromMs: 1_760_000_000_123 + 999, toMs: 1_760_000_000_123 + 2 * HOUR + 7 }];
    const value = contentmentAt(odd, now, CARE_RULES, held);
    expect(Number.isInteger(value)).toBe(true);
    // 26_434_567ms since, 7_199_008ms held: floor(19_235_559 * 100 / 86_400_000) = 22.
    expect(value).toBe(97 - 22);
  });

  it('builds care on the held value', () => {
    expect(
      contentmentAfterCare(full, at(12), 20, CARE_RULES, [{ fromMs: ms(0), toMs: null }]),
    ).toBe(100);
    const half = { contentment: 50, since: at(0) };
    expect(
      contentmentAfterCare(half, at(12), 20, CARE_RULES, [{ fromMs: ms(0), toMs: null }]),
    ).toBe(70);
  });
});

describe("a house resident's slower drain (#381 perk)", () => {
  const full = { contentment: 100, since: at(0) };
  const ms = (hours: number) => at(hours).getTime();
  const perk = residentDrainPercent(HOUSE_DATA.rules, true);

  it('fades a resident at rest at half the rate: 24 h is half the drop', () => {
    expect(perk).toBe(50);
    const drop = 100 - contentmentAt(full, at(24), CARE_RULES);
    const residentDrop = 100 - contentmentAt(full, at(24), CARE_RULES, [], perk);
    expect(drop).toBe(100);
    expect(residentDrop).toBe(drop / 2);
    expect(contentmentAt(full, at(12), CARE_RULES, [], perk)).toBe(75);
  });

  it('still holds a resident on a fitting job (zero × anything)', () => {
    expect(contentmentAt(full, at(12), CARE_RULES, [{ fromMs: ms(0), toMs: null }], perk)).toBe(
      100,
    );
    // Held 0–6h, then six hours of drift at half the rate: an eighth of the range.
    const held = [{ fromMs: ms(0), toMs: ms(6) }];
    expect(contentmentAt(full, at(12), CARE_RULES, held, perk)).toBe(88);
  });

  it('is the same as before for anyone else (100 %), whole numbers only', () => {
    expect(residentDrainPercent(HOUSE_DATA.rules, false)).toBe(100);
    const odd = { contentment: 97, since: new Date(1_760_000_000_123) };
    const now = new Date(1_760_000_000_123 + 7 * HOUR + 1_234_567);
    expect(contentmentAt(odd, now, CARE_RULES, [], 100)).toBe(contentmentAt(odd, now, CARE_RULES));
    const value = contentmentAt(odd, now, CARE_RULES, [], perk);
    // floor(26_434_567 * 100 * 50 / (86_400_000 * 100)) = 15.
    expect(value).toBe(97 - 15);
  });

  it('builds care on the slower-faded value', () => {
    expect(contentmentAfterCare(full, at(12), 20, CARE_RULES, [], perk)).toBe(95);
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

  it('holds a standalone species to befriendNoEvolutionLevel, not a final form', () => {
    const rules = { befriendBelowEvolution: 1, befriendNoEvolutionLevel: 15 };
    expect(befriendedLevel('pebble', 40, steps, rules)).toBe(15);
    expect(befriendedLevel('pebble', 9, steps, rules)).toBe(9);
    // A final form (`cloud`) is not standalone: it keeps its level.
    expect(befriendedLevel('cloud', 40, steps, rules)).toBe(40);
    // Without the field, or without the main cap, a standalone species keeps its level.
    expect(befriendedLevel('pebble', 40, steps, cap)).toBe(40);
    expect(befriendedLevel('pebble', 40, steps, { befriendNoEvolutionLevel: 15 })).toBe(40);
  });

  it('shipped standalone cap sits between the earliest and the middle first evolution', () => {
    const into = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
    const firsts = SPECIES.filter((s) => !into.has(s.id) && s.evolutions.length > 0)
      .map((s) => Math.min(...s.evolutions.map((e) => e.level)))
      .sort((a, b) => a - b);
    const cap = GROWTH_RULES.befriendNoEvolutionLevel ?? 0;
    // Never stricter than the strictest evolver would be, never looser than a typical one.
    expect(cap).toBeGreaterThanOrEqual(firsts[0]! - (GROWTH_RULES.befriendBelowEvolution ?? 0));
    expect(cap).toBeLessThanOrEqual(firsts[Math.floor(firsts.length / 2)]!);
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
