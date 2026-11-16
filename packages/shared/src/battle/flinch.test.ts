import { afterEach, describe, expect, it, vi } from 'vitest';
import { battleSetup, squishy } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_EFFECT_CONTENT as content,
  FIXTURE_EFFECT_DATA,
  FIXTURE_EFFECT_RULES,
  FIXTURE_SHOUT,
  member,
  patchSlot,
  sturdy,
  teamSetup,
  turnLog as fullLog,
} from '../../tests/fixtures/team-battle.js';
import { Rng } from '../rng/index.js';
import type { BattleChoice } from '../schemas/battle.js';
import { createBattleContent, type BattleContent } from './content.js';
import { applyBattleAction, startBattle } from './engine.js';
import type { BattleState } from './state.js';

afterEach(() => vi.restoreAllMocks());

/** The turn's log without stances (every move here takes one). */
const turnLog = (state: BattleState, turn: number) =>
  fullLog(state, turn).filter((e) => !e.startsWith('stance'));

/** Shout with an odd flinch chance, so its roll is the only `chance(37)` in a round. */
const ODD = 37;
const oddContent = createBattleContent(
  {
    ...FIXTURE_EFFECT_DATA,
    moves: FIXTURE_EFFECT_DATA.moves.map((m) =>
      m.id === FIXTURE_SHOUT.id ? { ...m, effects: [{ type: 'flinch' as const, chance: ODD }] } : m,
    ),
  },
  FIXTURE_EFFECT_RULES,
);

const act = (
  state: BattleState,
  choices: { a?: BattleChoice; b?: BattleChoice },
  using: BattleContent = content,
) => applyBattleAction(using, state, { type: 'turn', choices });

const shoutVsBonk = {
  a: { type: 'move', move: 'fixture-shout' },
  b: { type: 'move', move: 'fixture-bonk' },
} as const;

const duel = (seed: string, shoutSpeed: number, bonkSpeed: number, using = content) =>
  startBattle(
    using,
    battleSetup(
      seed,
      { squishies: [squishy('fixture-shoutbun', { stats: sturdy(shoutSpeed) })] },
      { squishies: [squishy('fixture-bonkbun', { stats: sturdy(bonkSpeed) })] },
    ),
  );

/** How many flinch rolls (`chance(37)`) `run` makes. */
function flinchRolls(run: () => void): number {
  const chance = vi.spyOn(Rng.prototype, 'chance');
  run();
  const rolls = chance.mock.calls.filter(([percent]) => percent === ODD).length;
  chance.mockRestore();
  return rolls;
}

describe('flinch (#234)', () => {
  it('rolls once and only on a foe that has not acted yet', () => {
    expect(flinchRolls(() => act(duel('first', 90, 30, oddContent), shoutVsBonk, oddContent))).toBe(
      1,
    );

    // Always flinches: the slower foe loses its move.
    const next = act(duel('first', 90, 30), shoutVsBonk);
    expect(turnLog(next, 1)).toEqual(['move a0 fixture-shout', 'hit b0', 'flinch b0']);
  });

  it('a flinch after the foe moved draws nothing and shows nothing', () => {
    expect(
      flinchRolls(() => act(duel('second', 30, 90, oddContent), shoutVsBonk, oddContent)),
    ).toBe(0);
    const next = act(duel('second', 30, 90), shoutVsBonk);
    expect(turnLog(next, 1)).toEqual([
      'move b0 fixture-bonk',
      'hit a0',
      'move a0 fixture-shout',
      'hit b0',
    ]);
    // A foe that swapped had its turn too.
    let swapped = startBattle(
      oddContent,
      battleSetup(
        'swapped',
        { squishies: [squishy('fixture-shoutbun', { stats: sturdy(90) })] },
        {
          squishies: [
            squishy('fixture-bonkbun', { stats: sturdy(30) }),
            squishy('fixture-bonkbun', { id: 'bonkbun-2', stats: sturdy(30) }),
          ],
        },
      ),
    );
    expect(
      flinchRolls(() => {
        swapped = act(swapped, { a: shoutVsBonk.a, b: { type: 'swap', slot: 1 } }, oddContent);
      }),
    ).toBe(0);
    expect(turnLog(swapped, 1)).not.toContain('flinch b1');
  });

  it('a flinched squishy makes no status roll and its status does not tick', () => {
    let state = duel('dizzy', 90, 30);
    state = patchSlot(state, 'b', 0, { status: { id: 'dizzy', turnsLeft: 3 } });
    state = act(state, shoutVsBonk);
    expect(turnLog(state, 1)).toEqual(['move a0 fixture-shout', 'hit b0', 'flinch b0']);
    expect(state.sides.b.squishies[0]!.status).toEqual({ id: 'dizzy', turnsLeft: 3 });
  });

  it('a flinched boss loses its action and shakes nothing off', () => {
    let state = startBattle(
      content,
      teamSetup('boss', [member(0, 'fixture-shoutbun', { stats: sturdy(999) })], {
        speciesId: 'fixture-trickgourd',
      }),
    );
    state = patchSlot(state, 'b', 0, { status: { id: 'dizzy', turnsLeft: 2 } });
    const next = act(state, {
      a: { type: 'team', picks: [{ slot: 0, move: 'fixture-shout' }] },
    });
    expect(turnLog(next, 1)).toEqual(['move a0 fixture-shout', 'hit b0', 'flinch b0']);
    expect(next.sides.b.squishies[0]!.status).toEqual({ id: 'dizzy', turnsLeft: 2 });
  });
});
