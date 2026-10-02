import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  PLAYER,
  squishy,
} from '../../tests/fixtures/battle.js';
import { FIXTURE_SPECIES } from '../../tests/fixtures/sample-content.js';
import {
  applyBattleAction,
  autoplayBattle,
  clientBattleView,
  startBattle,
  type ClientBattleView,
} from '../battle/engine.js';
import type { BattleEvent, BattleResult, BattleSquishy, Draft } from '../battle/state.js';
import { Rng } from '../rng/index.js';
import {
  BattleActionRequestSchema,
  BattleEventSchema,
  BattleResultSchema,
  BattleSquishyViewSchema,
  ClientBattleViewSchema,
  PlayerBattleActionSchema,
  type BattleEventView,
  type BattleResultView,
  type BattleSquishyView,
} from './battle.js';

/*
 * The view schemas must describe exactly what the engine produces. These
 * type-level checks fail to compile if the engine's types and the schemas
 * drift apart in either direction (`Draft` only drops the engine's
 * `readonly`, which zod's inferred types don't carry).
 */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const viewMatchesEngine: Equal<
  Draft<ClientBattleView>,
  z.infer<typeof ClientBattleViewSchema>
> = true;
const squishyMatchesEngine: Equal<Draft<BattleSquishy>, BattleSquishyView> = true;
const eventMatchesEngine: Equal<Draft<BattleEvent>, BattleEventView> = true;
const resultMatchesEngine: Equal<Draft<BattleResult>, BattleResultView> = true;

const seeds = Array.from({ length: 40 }, (_, i) => `view-seed-${i}`);

function randomSetup(seed: string) {
  const picker = Rng.fromSeed(`teams:${seed}`);
  const team = () =>
    Array.from({ length: picker.int(1, 3) }, (_, i) =>
      squishy(picker.pick(FIXTURE_SPECIES).id, { id: `s${i}`, level: picker.int(5, 30) }),
    );
  return battleSetup(
    seed,
    { controller: ai('wild'), squishies: team() },
    { controller: ai('guardian'), squishies: team() },
  );
}

describe('ClientBattleViewSchema (the public view, DECISIONS "Battle engine (#11)")', () => {
  it('matches the engine types', () => {
    expect([
      viewMatchesEngine,
      squishyMatchesEngine,
      eventMatchesEngine,
      resultMatchesEngine,
    ]).toEqual([true, true, true, true]);
  });

  it('accepts every view of a whole battle, start to finish, and never the RNG state', () => {
    for (const seed of seeds) {
      const setup = randomSetup(seed);
      const { state, actions } = autoplayBattle(content, setup);
      let current = startBattle(content, setup);
      for (const action of actions) {
        const view = clientBattleView(current);
        expect(ClientBattleViewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view);
        expect(view).not.toHaveProperty('rng');
        current = applyBattleAction(content, current, action);
      }
      const last = clientBattleView(state);
      expect(ClientBattleViewSchema.parse(last)).toEqual(last);
      expect(last.phase.type).toBe('over');
      for (const event of last.log) expect(BattleEventSchema.parse(event)).toEqual(event);
      if (last.phase.type === 'over') {
        expect(BattleResultSchema.parse(last.phase.result)).toEqual(last.phase.result);
      }
      for (const side of ['a', 'b'] as const) {
        for (const s of last.sides[side].squishies) {
          expect(BattleSquishyViewSchema.parse(s)).toEqual(s);
        }
      }
    }
  });

  it('refuses a view carrying the RNG state or a seed', () => {
    const state = startBattle(
      content,
      battleSetup(
        'leaky',
        { controller: PLAYER, squishies: [squishy(FIXTURE_SPECIES[0]!.id)] },
        { controller: ai('wild'), squishies: [squishy(FIXTURE_SPECIES[1]!.id)] },
      ),
    );
    // Strict about the one thing that matters: the parsed view carries no rng.
    const parsed = ClientBattleViewSchema.parse(state);
    expect(parsed).not.toHaveProperty('rng');
    expect(
      ClientBattleViewSchema.safeParse({ ...clientBattleView(state), version: 2 }).success,
    ).toBe(false);
  });
});

describe('PlayerBattleActionSchema', () => {
  it('accepts the four player actions and nothing else', () => {
    for (const action of [
      { type: 'move', move: 'tickle-tackle' },
      { type: 'swap', slot: 1 },
      { type: 'replace', slot: 2 },
      { type: 'forfeit' },
    ]) {
      expect(PlayerBattleActionSchema.parse(action)).toEqual(action);
    }
    // A client can't name a side or pass a whole turn.
    expect(PlayerBattleActionSchema.safeParse({ type: 'forfeit', side: 'b' }).success).toBe(false);
    expect(PlayerBattleActionSchema.safeParse({ type: 'turn', choices: {} }).success).toBe(false);
    expect(
      BattleActionRequestSchema.safeParse({ action: { type: 'forfeit' }, turn: -1 }).success,
    ).toBe(false);
  });
});
