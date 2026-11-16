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
  type BattleState,
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

// ── Move effects (#234) ──────────────────────────────────────────────────
// Their own content (and so their own content hash): adding them to
// FIXTURE_TEAM_DATA would move the golden team battle's pinned bytes.

/** Winds up for a round, then lands a big hit. */
export const FIXTURE_COUNTDOWN: Move = {
  id: 'fixture-countdown',
  name: 'Countdown',
  description: 'One… two… THREE!',
  element: 'stone',
  power: 120,
  accuracy: 100,
  effects: [{ type: 'windup' }],
};

/** A small hit that always makes a slower foe flinch. */
export const FIXTURE_SHOUT: Move = {
  id: 'fixture-shout',
  name: 'Shout',
  description: 'A very loud hello.',
  element: 'stone',
  power: 40,
  accuracy: 100,
  effects: [{ type: 'flinch', chance: 100 }],
};

/** Up to twice as strong when its user is nearly out. */
export const FIXTURE_LAST_STAND: Move = {
  id: 'fixture-last-stand',
  name: 'Last Stand',
  description: 'Hits harder the lower its energy.',
  element: 'stone',
  power: 40,
  accuracy: 100,
  effects: [{ type: 'low-energy', extraPercent: 100 }],
};

/** No hit of its own: calls in a friend's Bonk, then perks up. */
export const FIXTURE_BACKUP: Move = {
  id: 'fixture-backup',
  name: 'Backup',
  description: 'Calls a friend to bonk them.',
  element: 'stone',
  power: 0,
  accuracy: 100,
  effects: [
    { type: 'assist', move: 'fixture-bonk' },
    { type: 'stat', target: 'self', stat: 'defense', stages: 1, chance: 100 },
  ],
};

export const FIXTURE_EFFECT_MOVES: Move[] = [
  FIXTURE_COUNTDOWN,
  FIXTURE_SHOUT,
  FIXTURE_LAST_STAND,
  FIXTURE_BACKUP,
];

export const FIXTURE_EFFECT_SPECIES: Species[] = [
  // Countdown is Big, Bonk Steady (lowest power).
  species('fixture-counterbun', ['fixture-countdown', 'fixture-bonk']),
  species('fixture-shoutbun', ['fixture-shout']),
  species('fixture-helperbun', ['fixture-backup', 'fixture-last-stand']),
  // A boss with all four.
  species(
    'fixture-trickgourd',
    ['fixture-countdown', 'fixture-shout', 'fixture-last-stand', 'fixture-backup'],
    { element: 'stone', feeling: 'brave' },
  ),
];

/** Team rules plus a pinned copy of the Steady/Big stances (#587). */
export const FIXTURE_EFFECT_RULES: BattleRules = {
  ...FIXTURE_TEAM_RULES,
  moveKinds: {
    openPercent: 25,
    guardPercent: 25,
    gentleFloor: 1,
    ai: {
      wild: { open: 0, guard: 0 },
      guardian: { open: 0.25, guard: 0 },
      aggressive: { open: 0, guard: 0 },
      defensive: { open: 0.5, guard: 0.25 },
      balanced: { open: 0.25, guard: 0 },
    },
    overrides: {},
  },
};

export const FIXTURE_EFFECT_DATA = {
  ...FIXTURE_TEAM_DATA,
  species: [...FIXTURE_TEAM_DATA.species, ...FIXTURE_EFFECT_SPECIES],
  moves: [...FIXTURE_TEAM_DATA.moves, ...FIXTURE_EFFECT_MOVES],
};

export const FIXTURE_EFFECT_CONTENT = createBattleContent(
  FIXTURE_EFFECT_DATA,
  FIXTURE_EFFECT_RULES,
);

/** The same, with no damage variance, so a hit's size can be worked out exactly. */
export const FIXTURE_FLAT_EFFECT_CONTENT = createBattleContent(FIXTURE_EFFECT_DATA, {
  ...FIXTURE_EFFECT_RULES,
  damage: { ...FIXTURE_EFFECT_RULES.damage, varianceMin: 1, varianceMax: 1 },
});

/** A copy of `state` with `side`'s squishy in `slot` changed (any format). */
export function patchSlot(
  state: BattleState,
  side: 'a' | 'b',
  slot: number,
  patch: Partial<BattleState['sides']['a']['squishies'][number]>,
): BattleState {
  const s = state.sides[side];
  return {
    ...state,
    sides: {
      ...state.sides,
      [side]: { ...s, squishies: s.squishies.map((q, i) => (i === slot ? { ...q, ...patch } : q)) },
    },
  };
}

/** `state`'s log for `turn`, as compact `type side slot` strings. */
export const turnLog = (state: BattleState, turn: number): string[] =>
  state.log.flatMap((e) =>
    e.turn !== turn || !('side' in e)
      ? []
      : [
          `${e.type} ${e.side}${'slot' in e ? String(e.slot) : ''}${'move' in e ? ` ${e.move}` : ''}`,
        ],
  );
