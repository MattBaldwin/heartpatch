import { describe, expect, it } from 'vitest';
import recorded from '../../tests/fixtures/replay-pre-190.json' with { type: 'json' };
import { BATTLE_RULES } from '../data/battle.js';
import { GAME_DATA } from '../data/index.js';
import { hashString } from '../rng/index.js';
import { BattleActionSchema, type BattleAction, type BattleSetup } from '../schemas/battle.js';
import { createBattleContent } from './content.js';
import { battleRecord, clientBattleView, replayBattleRecord } from './engine.js';
import type { BattleResult } from './state.js';

/*
 * #190 added a team format (3-v-1 mini-boss battles) on its own turn path.
 * Every battle without `format` must replay exactly as before (DECISIONS
 * "Battle engine (#11)"). These wild, tile and friendly battles (sips,
 * swaps, replacements, Heart Charms, forfeits) were recorded on main before
 * #190's engine change (de03dbd), with the real game data: the setup,
 * actions, result and hashes of the whole final state and client view.
 * Never regenerate this file: it is the old engine's word on how they went.
 */

interface LoggedBattle {
  readonly name: string;
  readonly setup: BattleSetup;
  readonly actions: BattleAction[];
  readonly contentHash: string;
  readonly result: BattleResult;
  readonly events: number;
  /** `hashString(JSON.stringify(finalState))` on the pre-#190 engine. */
  readonly stateHash: string;
  /** `hashString(JSON.stringify(clientBattleView(finalState)))`. */
  readonly viewHash: string;
}

const logged = recorded as unknown as { contentHash: string; battles: LoggedBattle[] };

// The rules as they were before #190: its `team` and `boss` rows are
// optional and left out of the content hash when absent, so the real game
// data without them hashes exactly as it did on main.
const rulesBefore190 = { ...BATTLE_RULES };
delete rulesBefore190.team;
delete rulesBefore190.boss;
const content = createBattleContent(GAME_DATA, rulesBefore190);

describe('battles logged before the team format (#190) replay byte for byte', () => {
  it('rebuilds main’s content hash from today’s data without the #190 rules', () => {
    expect(content.contentHash).toBe(logged.contentHash);
    const kinds = new Set(logged.battles.map((b) => b.name.split(' ')[0]));
    expect([...kinds]).toEqual(['wild', 'tile', 'friendly']);
  });

  for (const battle of logged.battles) {
    it(`replays "${battle.name}" to the same final state and client view`, () => {
      for (const action of battle.actions) {
        expect(BattleActionSchema.parse(action)).toEqual(action);
      }
      const state = replayBattleRecord(content, { ...battle, log: [] });
      expect(hashString(JSON.stringify(state))).toBe(battle.stateHash);
      expect(hashString(JSON.stringify(clientBattleView(state)))).toBe(battle.viewHash);
      expect(state.log).toHaveLength(battle.events);
      expect(battleRecord(battle.setup, battle.actions, state).result).toEqual(battle.result);
    });
  }
});
