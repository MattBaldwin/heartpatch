import { describe, expect, it } from 'vitest';
import { FIXTURE_POTION_CONTENT as content } from '../../tests/fixtures/battle.js';
import recorded from '../../tests/fixtures/pre-403-potion-battles.json' with { type: 'json' };
import { hashString } from '../rng/index.js';
import { BattleActionSchema, type BattleAction, type BattleSetup } from '../schemas/battle.js';
import { battleRecord, replayBattleRecord } from './engine.js';
import type { BattleResult } from './state.js';

/*
 * #403 made a potion a free sip that rides along with a move. Battles
 * logged before it used the bare `item` choice (a sip that took the whole
 * turn), and must replay exactly as they were played (DECISIONS "Battle
 * engine (#11)"). These were recorded on main before #403's engine change
 * (393b257): the setup, actions, result and a hash of the whole final
 * state, byte for byte. Never regenerate this file: it is the old engine's
 * word on how these battles went.
 */

interface LoggedBattle {
  readonly name: string;
  readonly setup: BattleSetup;
  readonly actions: BattleAction[];
  readonly contentHash: string;
  readonly result: BattleResult;
  /** Events in the final state's log. */
  readonly events: number;
  /** `hashString(JSON.stringify(finalState))` on the pre-#403 engine. */
  readonly stateHash: string;
}

const logged = recorded as unknown as { contentHash: string; battles: LoggedBattle[] };

describe('battles logged before the free sip (#403) replay byte for byte', () => {
  it('was recorded with this content, and holds bare potion turns of every kind', () => {
    expect(logged.contentHash).toBe(content.contentHash);
    const sips = new Set(
      logged.battles.flatMap((b) =>
        b.actions.flatMap((a) =>
          a.type === 'turn'
            ? Object.values(a.choices).flatMap((c) => (c.type === 'item' ? [c.item] : []))
            : [],
        ),
      ),
    );
    expect([...sips].sort()).toEqual([
      'fixture-brave-brew',
      'fixture-cozy-cocoa',
      'fixture-hearty-soup',
    ]);
  });

  for (const battle of logged.battles) {
    it(`replays "${battle.name}" to the same final state`, () => {
      // Old action logs still pass today's boundary schema.
      for (const action of battle.actions) {
        expect(BattleActionSchema.parse(action)).toEqual(action);
      }
      // The stored record keeps its log too; the replay never reads it.
      const state = replayBattleRecord(content, { ...battle, log: [] });
      expect(hashString(JSON.stringify(state))).toBe(battle.stateHash);
      expect(state.log).toHaveLength(battle.events);
      expect(battleRecord(battle.setup, battle.actions, state).result).toEqual(battle.result);
    });
  }
});
