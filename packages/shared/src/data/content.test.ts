import { describe, expect, it } from 'vitest';
import { BUILDINGS } from './buildings.js';
import { CARE_RULES } from './care.js';
import { CARE_ACTIONS } from './care-actions.js';
import { CLOTHING } from './clothing.js';
import { HOUSE_DATA } from './house.js';
import { MAP_GEN } from './map-gen.js';
import { MOVES, SPECIES } from './species.js';
import { RECIPES } from './recipes.js';
import { RESOURCES, RETIRED_RESOURCES as RETIRED } from './resources.js';
import { SEASONS } from './seasons.js';
import { GLIMMER_SWAP, SELL_RULES, TRADE_VALUES } from './trading.js';
import { isWater } from '../schemas/data/terrains.js';
import { TERRAINS } from './terrains.js';
import { CELLAR_RULES } from './server/cellar.js';
import { CROOKED_HOUSE_SECRETS } from './server/crooked-house.js';
import { EXPLORE_FINDS } from './server/explore-finds.js';
import { FAR_HOLLOW_SECRETS } from './server/far-hollow.js';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import {
  CELLAR_FINDS,
  FAR_HOLLOW_FINDS,
  HOLLOWED_FINDS,
  HOLLOWED_HELPER_GIFT,
  REKINDLED_DROPS,
} from './server/hollowed-finds.js';
import { HOUSE_GIFTS } from './server/house-gifts.js';
import { PUZZLE_REWARDS } from './server/puzzle-rewards.js';
import { RESCUE_GUARDIANS } from './server/rescue-guardians.js';
import { SECRET_MOVES, SECRET_SPECIES } from './server/secret-species.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { TRICK_OR_TREAT_PRIZES } from './server/trick-or-treat-prizes.js';

describe('decisions encoded in data (docs/DECISIONS.md)', () => {
  it('has the feed, pet and play care actions, plus the Heart Snack and Heart Tea', () => {
    expect(CARE_ACTIONS.map((c) => c.id)).toEqual([
      'feed',
      'pet',
      'play',
      'heart-snack',
      'heart-tea',
    ]);
  });

  it('lets a Hearthfire store up to 8 nights of Emberwood (#277: a full week away)', () => {
    const fire = BUILDINGS.find((b) => b.kind === 'hearthfire');
    expect(fire).toMatchObject({ fuelResource: 'emberwood', maxFuelNights: 8 });
  });

  it('has the four holiday seasons, with Halloween 2026 running to Nov 9', () => {
    expect(SEASONS.map((s) => s.id)).toEqual([
      'halloween',
      'thanksgiving',
      'christmas',
      'new-year',
    ]);
    const halloween = SEASONS.find((s) => s.id === 'halloween');
    expect(halloween?.window).toEqual({ start: '10-01', end: '11-02' });
    expect(halloween?.overrides?.['2026']).toEqual({ start: '10-01', end: '11-09' });
  });

  it('ships the launch roster (#10); fixtures stay in tests/', () => {
    expect(SPECIES.length).toBeGreaterThan(0);
    expect(MOVES.length).toBeGreaterThan(0);
    const ids = [...SPECIES, ...MOVES].map((row) => row.id);
    expect(ids.filter((id) => id.startsWith('fixture-') || id.startsWith('placeholder-'))).toEqual(
      [],
    );
  });

  it('ships no placeholder species in the server data (#87)', () => {
    const tables = [...SPAWN_TABLES, ...GUARDIAN_RULES.tables];
    const ids = [
      ...[...SECRET_SPECIES, ...SECRET_MOVES, ...tables].map((row) => row.id),
      ...[...tables, RESCUE_GUARDIANS].flatMap((t) => t.entries.map((e) => e.species)),
    ];
    expect(ids.filter((id) => id.startsWith('fixture-') || id.startsWith('placeholder-'))).toEqual(
      [],
    );
  });

  it('sizes maps 9 / 11 / 12 / 16 for 2 / 3 / 4 / 6 players (design doc §3, #318)', () => {
    expect(MAP_GEN.layouts.map((l) => [l.players, l.radius])).toEqual([
      [2, 9],
      [3, 11],
      [4, 12],
      [6, 16],
    ]);
  });

  it('has the design doc terrain set plus trading posts (#269), cleared land (#242), the Gap and Wild Isle (#621)', () => {
    expect(TERRAINS.map((t) => t.id)).toEqual([
      'meadow',
      'forest',
      'old-forest',
      'hills',
      'mountains',
      'lake',
      'pumpkin-fields',
      'trading-post',
      'clearing',
      'junipers-gap',
      // Wild Isle (#621), appended so Cozy's order never moves.
      'ocean',
      'river',
      'wild-lake',
      'coast',
    ]);
    expect(TERRAINS.filter(isWater).map((t) => t.id)).toEqual(['ocean', 'river', 'wild-lake']);
  });

  it('guarantees Timber, Stone, Emberwood, a farm plot and the seasonal nodes in every home ring', () => {
    // Pumpkins and a leaf pile: owner decision 2026-10-06 (design-review Q6).
    expect([...MAP_GEN.homeRingNodes].sort()).toEqual([
      'emberwood',
      'magic-fallen-leaves',
      'pumpkins',
      'stone',
      'timber',
      'treats',
    ]);
  });
});

/** Every string and record key anywhere in `tables`: the ids a find or gift table names. */
function idsIn(...tables: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) {
        out.add(k);
        walk(inner);
      }
    }
  };
  tables.forEach(walk);
  return out;
}

describe('every resource has a way in and a way out (#735)', () => {
  // Ways in: gathering (and its extras), a works building, a recipe, or a
  // find, prize or gift table.
  const faucets = new Set<string>([
    ...RESOURCES.filter((r) => r.gather).map((r) => r.id),
    ...RESOURCES.flatMap((r) => r.gather?.extras?.map((e) => e.resource) ?? []),
    ...BUILDINGS.flatMap((b) => (b.kind === 'works' ? [b.makes.resource] : [])),
    ...RECIPES.map((r) => r.output.resource),
    ...idsIn(
      EXPLORE_FINDS,
      HOLLOWED_FINDS,
      CELLAR_FINDS,
      FAR_HOLLOW_FINDS,
      HOLLOWED_HELPER_GIFT,
      REKINDLED_DROPS,
      CELLAR_RULES,
      CROOKED_HOUSE_SECRETS,
      FAR_HOLLOW_SECRETS,
      PUZZLE_REWARDS,
      TRICK_OR_TREAT_PRIZES,
      HOUSE_GIFTS,
    ),
  ]);
  // Ways out: a recipe, a build or upgrade cost, care, fuel, battle, a
  // tool's uses, the house, selling or the Glimmer swap.
  const sinks = new Set<string>([
    ...RECIPES.flatMap((r) => Object.keys(r.inputs)),
    ...BUILDINGS.flatMap((b) => b.levels.flatMap((l) => Object.keys(l.cost))),
    ...BUILDINGS.flatMap((b) => (b.kind === 'hearthfire' ? [b.fuelResource] : [])),
    ...CARE_ACTIONS.flatMap((c) => Object.keys(c.cost ?? {})),
    ...Object.keys(CARE_RULES.foods ?? {}),
    ...RESOURCES.filter((r) => r.battleEffect || r.tool || r.clearTool).map((r) => r.id),
    ...idsIn(HOUSE_DATA),
    ...Object.keys(SELL_RULES.items),
    ...GLIMMER_SWAP.accepts,
  ]);

  it.each(RESOURCES.filter((r) => !RETIRED.includes(r.id)).map((r) => r.id))('%s', (id) => {
    expect(faucets.has(id), `${id} has no way in`).toBe(true);
    expect(sinks.has(id), `${id} has no way out`).toBe(true);
  });

  it.each(RETIRED)('%s is kept for saved bags only: none in, none out, not traded', (id) => {
    const r = RESOURCES.find((x) => x.id === id);
    expect(r, `${id} must stay so saved bags load`).toBeDefined();
    expect(faucets.has(id)).toBe(false);
    expect(r?.tradable).toBe(false);
    expect(TRADE_VALUES.items[id]).toBeUndefined();
    expect(SELL_RULES.items[id]).toBeUndefined();
  });
});

describe('every season has something of its own (#735)', () => {
  const tagged = new Set(
    [...SPECIES, ...SECRET_SPECIES, ...RECIPES, ...CLOTHING].flatMap((x) =>
      x.season ? [x.season] : [],
    ),
  );
  // TODO(#735, 2026-10-30): Christmas and New Year have a window but no
  // species, recipe or clothing yet. Drop each from here as its lane ships.
  const empty = new Set(['christmas', 'new-year']);

  for (const season of SEASONS) {
    it.skipIf(empty.has(season.id))(season.id, () => {
      expect(tagged.has(season.id), `${season.id} has nothing tagged with it`).toBe(true);
    });
  }

  it('the empty list only names seasons that are still empty', () => {
    expect([...empty].filter((id) => tagged.has(id))).toEqual([]);
  });
});
