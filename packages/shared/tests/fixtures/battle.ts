/**
 * TEST FIXTURES ONLY. Battle content built from the fixture species and
 * moves, plus small builders for battle setups.
 */
import {
  createBattleContent,
  type ElementMatrix,
  type FeelingMatrix,
  type SynergyTable,
  type BattleAiPolicy,
  type BattleRules,
  type BattleController,
  type BattleSetup,
  type BattleSquishySetup,
  type BattleState,
} from '../../src/index.js';
import { FIXTURE_MOVES, FIXTURE_SPECIES } from './sample-content.js';

/*
 * Pinned copies of the matrices, so tuning the shipped tables doesn't move
 * the numbers these tests (and the golden replay) expect.
 */
const FIXTURE_ELEMENT_MATRIX: ElementMatrix = {
  fire: { fire: 1, water: 0.5, leaf: 2, frost: 2, spark: 1, stone: 0.5, shadow: 1, light: 1 },
  water: { fire: 2, water: 1, leaf: 0.5, frost: 1, spark: 0.5, stone: 2, shadow: 1, light: 1 },
  leaf: { fire: 0.5, water: 2, leaf: 1, frost: 0.5, spark: 1, stone: 2, shadow: 1, light: 1 },
  frost: { fire: 0.5, water: 1, leaf: 2, frost: 1, spark: 1, stone: 1, shadow: 2, light: 0.5 },
  spark: { fire: 1, water: 2, leaf: 1, frost: 1, spark: 1, stone: 0.5, shadow: 0.5, light: 2 },
  stone: { fire: 2, water: 0.5, leaf: 0.5, frost: 1, spark: 2, stone: 1, shadow: 1, light: 1 },
  shadow: { fire: 1, water: 1, leaf: 1, frost: 0.5, spark: 2, stone: 1, shadow: 1, light: 2 },
  light: { fire: 1, water: 1, leaf: 1, frost: 2, spark: 0.5, stone: 1, shadow: 2, light: 1 },
};

const FIXTURE_FEELING_MATRIX: FeelingMatrix = {
  joy: { joy: 1, cozy: 1, brave: 1.25, silly: 0.8, sleepy: 1.25, spooky: 0.8 },
  cozy: { joy: 1, cozy: 1, brave: 0.8, silly: 1.25, sleepy: 0.8, spooky: 1.25 },
  brave: { joy: 0.8, cozy: 1.25, brave: 1, silly: 0.8, sleepy: 1.25, spooky: 1 },
  silly: { joy: 1.25, cozy: 0.8, brave: 1.25, silly: 1, sleepy: 1, spooky: 0.8 },
  sleepy: { joy: 0.8, cozy: 1.25, brave: 0.8, silly: 1, sleepy: 1, spooky: 1.25 },
  spooky: { joy: 1.25, cozy: 0.8, brave: 1, silly: 1.25, sleepy: 0.8, spooky: 1 },
};

const FIXTURE_SYNERGY_TABLE: SynergyTable = {
  fire: { joy: 1, cozy: 1.2, brave: 1, silly: 1, sleepy: 0.85, spooky: 1 },
  water: { joy: 1, cozy: 1, brave: 0.85, silly: 1.2, sleepy: 1, spooky: 1 },
  leaf: { joy: 1, cozy: 1.2, brave: 1, silly: 1, sleepy: 1, spooky: 0.85 },
  frost: { joy: 1, cozy: 0.85, brave: 1.2, silly: 1, sleepy: 1, spooky: 1 },
  spark: { joy: 1.2, cozy: 1, brave: 1, silly: 1, sleepy: 0.85, spooky: 1 },
  stone: { joy: 1, cozy: 1, brave: 1, silly: 0.85, sleepy: 1.2, spooky: 1 },
  shadow: { joy: 0.85, cozy: 1, brave: 1, silly: 1, sleepy: 1, spooky: 1.2 },
  light: { joy: 1.2, cozy: 1, brave: 1, silly: 1, sleepy: 1, spooky: 0.85 },
};

export const FIXTURE_BATTLE_DATA = {
  species: FIXTURE_SPECIES,
  moves: FIXTURE_MOVES,
  elementMatrix: FIXTURE_ELEMENT_MATRIX,
  feelingMatrix: FIXTURE_FEELING_MATRIX,
  synergy: FIXTURE_SYNERGY_TABLE,
  resources: [],
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
  capture: {
    atFull: 15,
    nearlyOut: 90,
    rarity: { common: 100, uncommon: 85, rare: 70, epic: 55, legendary: 40, secret: 40 },
  },
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
  items: { usesEach: 1 },
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
