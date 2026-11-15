/**
 * TEST FIXTURES ONLY. Team battles (#190): the fixture content plus an
 * area move, a boss species and the `team` and `boss` rules, pinned so
 * tuning the shipped rules doesn't move these tests' numbers.
 */
import {
  createBattleContent,
  type BattleRules,
  type BattleSetup,
  type BattleSquishySetup,
  type Move,
  type Species,
} from '../../src/index.js';
import { ai, FIXTURE_BATTLE_DATA, FIXTURE_BATTLE_RULES, PLAYER } from './battle.js';

/** Hits every foe at once. */
export const FIXTURE_SPARK_SHOWER: Move = {
  id: 'fixture-spark-shower',
  name: 'Spark Shower',
  description: 'A fizzy rain of sparks for everyone.',
  element: 'spark',
  power: 50,
  accuracy: 90,
  targets: 'all-foes',
};

/** A plain hit with no effects, so tests can count rolls. */
export const FIXTURE_BONK: Move = {
  id: 'fixture-bonk',
  name: 'Bonk',
  description: 'A soft little bonk.',
  element: 'stone',
  power: 40,
  accuracy: 100,
};

const emberbun = FIXTURE_BATTLE_DATA.species.find((s) => s.id === 'fixture-emberbun')!;
const species = (id: string, moves: string[], extra: Partial<Species> = {}): Species => ({
  ...emberbun,
  id,
  moves,
  ...extra,
});

export const FIXTURE_TEAM_SPECIES: Species[] = [
  // A boss that plays fair: plain hits and an area move.
  species('fixture-grumblegourd', ['fixture-bonk', 'fixture-spark-shower'], {
    element: 'stone',
    feeling: 'brave',
  }),
  // Only plain hits: no status, no stat rolls.
  species('fixture-bonkbun', ['fixture-bonk']),
  // Only the area move.
  species('fixture-sparkbun', ['fixture-spark-shower']),
];

export const FIXTURE_TEAM_RULES: BattleRules = {
  ...FIXTURE_BATTLE_RULES,
  team: { spreadPercent: 60, target: { lowEnergy: 1, alreadyHitPercent: 25 } },
  boss: {
    actionsPerRound: 2,
    statusSkipsPerRound: 1,
    stats: { hp: 300, attack: 100, defense: 110, speed: 100 },
    ai: { ...FIXTURE_BATTLE_RULES.ai.guardian, swap: 0, swapBelow: 0 },
  },
};

export const FIXTURE_TEAM_DATA = {
  ...FIXTURE_BATTLE_DATA,
  species: [...FIXTURE_BATTLE_DATA.species, ...FIXTURE_TEAM_SPECIES],
  moves: [...FIXTURE_BATTLE_DATA.moves, FIXTURE_SPARK_SHOWER, FIXTURE_BONK],
};

export const FIXTURE_TEAM_CONTENT = createBattleContent(FIXTURE_TEAM_DATA, FIXTURE_TEAM_RULES);

/** The same, with no damage variance, so a hit's size can be worked out exactly. */
export const FIXTURE_FLAT_TEAM_CONTENT = createBattleContent(FIXTURE_TEAM_DATA, {
  ...FIXTURE_TEAM_RULES,
  damage: { ...FIXTURE_TEAM_RULES.damage, varianceMin: 1, varianceMax: 1 },
});

/** A team member (side `a`). */
export const member = (
  slot: number,
  speciesId = 'fixture-bonkbun',
  extra: Partial<BattleSquishySetup> = {},
): BattleSquishySetup => ({ id: `a:${slot}`, speciesId, level: 20, ...extra });

/** A team of `team.length` against one boss, played by `controller` on side `a`. */
export function teamSetup(
  seed: string,
  team: BattleSquishySetup[],
  boss: Partial<BattleSquishySetup> = {},
  controller = PLAYER,
): BattleSetup {
  return {
    seed,
    format: { a: team.length as 1 | 2 | 3, b: 1 },
    sides: {
      a: { controller, squishies: team },
      b: {
        controller: ai('guardian'),
        squishies: [
          { id: 'b:boss', speciesId: 'fixture-grumblegourd', level: 20, boss: true, ...boss },
        ],
      },
    },
  };
}

/** Stats with this speed and plenty of energy, so nobody tuckers out in a round or two. */
export const sturdy = (speed: number) => ({ hp: 500, attack: 40, defense: 60, speed });
