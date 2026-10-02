/**
 * TEST FIXTURES ONLY. Battle content built from the fixture species and
 * moves, plus small builders for battle setups.
 */
import {
  createBattleContent,
  ELEMENT_MATRIX,
  FEELING_MATRIX,
  SYNERGY_TABLE,
  type BattleAiPolicy,
  type BattleRules,
  type BattleController,
  type BattleSetup,
  type BattleSquishySetup,
  type BattleState,
} from '../../src/index.js';
import { FIXTURE_MOVES, FIXTURE_SPECIES } from './sample-content.js';

export const FIXTURE_BATTLE_DATA = {
  species: FIXTURE_SPECIES,
  moves: FIXTURE_MOVES,
  elementMatrix: ELEMENT_MATRIX,
  feelingMatrix: FEELING_MATRIX,
  synergy: SYNERGY_TABLE,
};

/**
 * A pinned copy of the battle rules, so tuning `BATTLE_RULES` doesn't move
 * the numbers these tests (and the golden replay) expect.
 */
export const FIXTURE_BATTLE_RULES: BattleRules = {
  teamSize: 3,
  maxTurns: 50,
  stats: { levelDivisor: 50, flat: 5, hpPerLevel: 1, hpFlat: 10 },
  damage: {
    levelDivisor: 2.5,
    levelOffset: 2,
    powerDivisor: 50,
    flat: 2,
    minimum: 1,
    varianceMin: 0.9,
    varianceMax: 1.1,
  },
  statStages: { maxStages: 4, perStage: 0.5 },
  status: {
    dizzy: { minTurns: 2, maxTurns: 4, skipChance: 33, clearsOnSwap: true },
    sleepy: { minTurns: 1, maxTurns: 3, skipChance: 100, clearsOnSwap: false },
  },
  effectiveness: [
    { id: 'super', atLeast: 1.5, line: 'Super cozy!' },
    { id: 'good', atLeast: 1.2, line: 'Ooh, nice one!' },
    { id: 'normal', atLeast: 0.85 },
    { id: 'weak', atLeast: 0, line: 'Just a little boop.' },
  ],
  xp: { perOpponentLevel: 4, winMultiplier: 1.5, minimum: 5 },
  ai: {
    wild: {
      focus: 1,
      damage: 1,
      heal: 1,
      healBelow: 50,
      boost: 0.15,
      status: 0.3,
      swap: 0,
      swapBelow: 0,
    },
    guardian: {
      focus: 3,
      damage: 1,
      heal: 1.5,
      healBelow: 40,
      boost: 0.15,
      status: 0.4,
      swap: 0.5,
      swapBelow: 30,
    },
    aggressive: {
      focus: 4,
      damage: 1.5,
      heal: 0.5,
      healBelow: 25,
      boost: 0.1,
      status: 0.2,
      swap: 0,
      swapBelow: 0,
    },
    defensive: {
      focus: 3,
      damage: 0.8,
      heal: 2.5,
      healBelow: 60,
      boost: 0.25,
      status: 0.6,
      swap: 1,
      swapBelow: 50,
    },
    balanced: {
      focus: 2,
      damage: 1,
      heal: 1.5,
      healBelow: 45,
      boost: 0.15,
      status: 0.4,
      swap: 0.6,
      swapBelow: 35,
    },
  },
};

export const FIXTURE_BATTLE_CONTENT = createBattleContent(
  FIXTURE_BATTLE_DATA,
  FIXTURE_BATTLE_RULES,
);

const shortName = (speciesId: string) => speciesId.replace(/^fixture-/, '');

/** A squishy setup; the id defaults to `<side>-<species>`. */
export function squishy(
  speciesId: string,
  extra: Partial<BattleSquishySetup> = {},
): BattleSquishySetup {
  return { id: shortName(speciesId), speciesId, level: 10, ...extra };
}

export const PLAYER: BattleController = { type: 'player' };
export const ai = (policy: BattleAiPolicy): BattleController => ({ type: 'ai', policy });

/** A setup with unique ids per side (`a:` / `b:` prefixes). */
export function battleSetup(
  seed: string,
  a: { controller?: BattleController; squishies: BattleSquishySetup[] },
  b: { controller?: BattleController; squishies: BattleSquishySetup[] },
): BattleSetup {
  const side = (prefix: string, s: typeof a) => ({
    controller: s.controller ?? PLAYER,
    squishies: s.squishies.map((q) => ({ ...q, id: `${prefix}:${q.id}` })),
  });
  return { seed, sides: { a: side('a', a), b: side('b', b) } };
}

/** Freezes a value and everything inside it, to prove nothing writes to it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** A copy of `state` with the active squishy on `side` changed (for setting up scenarios). */
export function patchActive(
  state: BattleState,
  side: 'a' | 'b',
  patch: Partial<BattleState['sides']['a']['squishies'][number]>,
): BattleState {
  const s = state.sides[side];
  return {
    ...state,
    sides: {
      ...state.sides,
      [side]: {
        ...s,
        squishies: s.squishies.map((q, i) => (i === s.active ? { ...q, ...patch } : q)),
      },
    },
  };
}
