import { describe, expect, it } from 'vitest';
import { battleSetup, squishy } from '../../tests/fixtures/battle.js';
import {
  FIXTURE_BACKUP as backup,
  FIXTURE_BONK as bonk,
  FIXTURE_EFFECT_DATA,
  FIXTURE_EFFECT_RULES,
  FIXTURE_FLAT_EFFECT_CONTENT as flat,
  FIXTURE_SPARK_SHOWER,
  member,
  patchSlot,
  sturdy,
  teamSetup,
  turnLog,
} from '../../tests/fixtures/team-battle.js';
import type { BattleChoice } from '../schemas/battle.js';
import { moveEffectProblems, type Move } from '../schemas/data/moves.js';
import type { Species } from '../schemas/data/species.js';
import { createBattleContent, type BattleContent } from './content.js';
import { applyBattleAction, startBattle } from './engine.js';
import { damageBeforeVariance } from './formulas.js';
import type { BattleState } from './state.js';

const act = (
  using: BattleContent,
  state: BattleState,
  choices: { a?: BattleChoice; b?: BattleChoice },
) => applyBattleAction(using, state, { type: 'turn', choices });

const trickgourd = FIXTURE_EFFECT_DATA.species.find((s) => s.id === 'fixture-trickgourd')!;

/** Fixture content plus `moves` and a boss species that knows only `bossMoves`. */
function withBoss(bossMoves: string[], moves: Move[] = []): BattleContent {
  const boss: Species = { ...trickgourd, id: 'fixture-askgourd', moves: bossMoves };
  return createBattleContent(
    {
      ...FIXTURE_EFFECT_DATA,
      species: [...FIXTURE_EFFECT_DATA.species, boss],
      moves: [...FIXTURE_EFFECT_DATA.moves, ...moves],
    },
    FIXTURE_EFFECT_RULES,
  );
}

const bossTurn = (using: BattleContent, seed: string, team: number) => {
  const state = startBattle(
    using,
    teamSetup(
      seed,
      Array.from({ length: team }, (_, slot) =>
        member(slot, 'fixture-bonkbun', { stats: sturdy(1) }),
      ),
      { speciesId: 'fixture-askgourd' },
    ),
  );
  return act(using, state, {
    a: {
      type: 'team',
      picks: Array.from({ length: team }, (_, slot) => ({ slot, move: 'fixture-bonk' })),
    },
  });
};

describe('assist (#234)', () => {
  it('resolves the called move at its place in the effects list, with the user’s stats and the move’s element, no stance of its own', () => {
    const state = startBattle(
      flat,
      battleSetup(
        'assist',
        { squishies: [squishy('fixture-helperbun', { stats: sturdy(90) })] },
        { squishies: [squishy('fixture-bonkbun', { stats: sturdy(30) })] },
      ),
    );
    const user = state.sides.a.squishies[0]!;
    const foe = state.sides.b.squishies[0]!;
    const next = act(flat, state, {
      a: { type: 'move', move: backup.id },
      b: { type: 'move', move: 'fixture-bonk' },
    });
    const log = turnLog(next, 1);
    // Backup's effects in order: the assist, then its own defense +1.
    expect(log.slice(0, 5)).toEqual([
      `move a0 ${backup.id}`,
      `assist a0 ${bonk.id}`,
      `move a0 ${bonk.id}`,
      'hit b0',
      'stat-change a0',
    ]);
    expect(log.slice(0, 5)).not.toContain('stance a0');
    const hit = next.log.find((e) => e.type === 'hit' && e.side === 'b');
    expect(hit).toMatchObject({
      amount: Math.floor(damageBeforeVariance(flat, bonk, user, foe)),
    });
  });

  it('targets as the parent did; all-foes hits everyone standing', () => {
    const sure: Move = { ...FIXTURE_SPARK_SHOWER, id: 'fixture-sure-shower', accuracy: 100 };
    const shower: Move = {
      ...backup,
      id: 'fixture-backup-shower',
      effects: [{ type: 'assist', move: sure.id }],
    };
    const showerContent = withBoss([shower.id], [sure, shower]);
    const all = turnLog(bossTurn(showerContent, 'all', 3), 1);
    const from = all.indexOf(`assist b0 ${sure.id}`);
    expect(all.slice(from + 1, from + 5)).toEqual([
      `move b0 ${sure.id}`,
      'hit a0',
      'hit a1',
      'hit a2',
    ]);

    const one = turnLog(bossTurn(withBoss([backup.id]), 'one', 3), 1);
    const at = one.indexOf(`assist b0 ${bonk.id}`);
    expect(one[at + 1]).toBe(`move b0 ${bonk.id}`);
    expect(one[at + 2]).toMatch(/^hit a[012]$/);
    expect(one[at + 3]).not.toMatch(/^hit/);
  });

  it('calls nobody in when the parent already tuckered out every foe', () => {
    const bonkThenCall: Move = {
      ...bonk,
      id: 'fixture-bonk-backup',
      accuracy: 100,
      effects: [{ type: 'assist', move: bonk.id }],
    };
    const using = withBoss([bonkThenCall.id], [bonkThenCall]);
    let state = startBattle(
      using,
      teamSetup('tuckered', [member(0, 'fixture-bonkbun', { stats: sturdy(1) })], {
        speciesId: 'fixture-askgourd',
      }),
    );
    state = patchSlot(state, 'a', 0, { energy: 1 });
    const next = act(using, state, {
      a: { type: 'team', picks: [{ slot: 0, move: 'fixture-bonk' }] },
    });
    const log = turnLog(next, 1);
    expect(log.slice(0, 2)).toEqual([`move b0 ${bonkThenCall.id}`, 'hit a0']);
    expect(next.sides.a.squishies[0]!.energy).toBe(0);
    expect(log.filter((e) => e.startsWith('assist') || e === `move b0 ${bonk.id}`)).toEqual([]);
  });

  it('never nests (data check refuses)', () => {
    const outer: Move = {
      ...backup,
      id: 'fixture-outer',
      effects: [{ type: 'assist', move: backup.id }],
    };
    const known = new Map([...FIXTURE_EFFECT_DATA.moves, outer].map((m) => [m.id, m]));
    expect(moveEffectProblems(outer, known)).toEqual([
      `assist can't call in "${backup.id}": it assists or winds up itself`,
    ]);
    // The engine ignores a nested assist even if the check was skipped.
    const log = turnLog(bossTurn(withBoss([outer.id], [outer]), 'nest', 1), 1);
    expect(log.filter((e) => e.startsWith('assist'))).toEqual([`assist b0 ${backup.id}`]);
    expect(log).not.toContain(`move b0 ${bonk.id}`);
  });
});
