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

export const FIXTURE_BATTLE_CONTENT = createBattleContent(FIXTURE_BATTLE_DATA);

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
