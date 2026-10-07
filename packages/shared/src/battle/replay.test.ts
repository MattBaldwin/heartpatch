import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  PLAYER,
  squishy,
} from '../../tests/fixtures/battle.js';
import { FIXTURE_SPECIES } from '../../tests/fixtures/sample-content.js';
import { findAvoidedWords } from '../data/avoided-words.js';
import { Rng } from '../rng/index.js';
import type { BattleAction, BattleController, BattleSetup } from '../schemas/battle.js';
import { BattleAiPolicySchema } from '../schemas/data/battle.js';
import {
  applyBattleAction,
  autoplayBattle,
  legalChoices,
  replayBattle,
  startBattle,
} from './engine.js';
import { benchOf } from './state.js';

const POLICIES = BattleAiPolicySchema.options;

/** A random team and setup, picked by a test-only RNG so every run is the same. */
function randomSetup(seed: string, a: BattleController, b: BattleController): BattleSetup {
  const picker = Rng.fromSeed(`teams:${seed}`);
  const team = () =>
    Array.from({ length: picker.int(1, 3) }, (_, i) =>
      squishy(picker.pick(FIXTURE_SPECIES).id, { id: `s${i}`, level: picker.int(5, 30) }),
    );
  return battleSetup(
    seed,
    { controller: a, squishies: team() },
    { controller: b, squishies: team() },
  );
}

describe('replay (design doc §6: every battle replays from its seed and action log)', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => `seed-${i}`);

  it('reproduces every AI-vs-AI battle exactly, for every policy pairing', () => {
    for (const [i, seed] of seeds.entries()) {
      const setup = randomSetup(
        seed,
        ai(POLICIES[i % POLICIES.length]!),
        ai(POLICIES[Math.floor(i / POLICIES.length) % POLICIES.length]!),
      );
      const { state, actions } = autoplayBattle(content, setup);
      expect(state.phase.type).toBe('over');
      expect(replayBattle(content, setup, actions)).toEqual(state);
      // Stored as JSON and replayed from JSON, too.
      const stored = JSON.parse(JSON.stringify({ setup, actions })) as {
        setup: BattleSetup;
        actions: BattleAction[];
      };
      expect(replayBattle(content, stored.setup, stored.actions)).toEqual(state);
    }
  });

  it('reproduces battles with a player side, including replacements, swaps and captures', () => {
    const kinds = new Set<string>();
    for (const seed of seeds.slice(0, 150)) {
      const setup = randomSetup(seed, PLAYER, ai(POLICIES[seed.length % POLICIES.length]!));
      // The "player" picks with its own RNG, as a person would: outside the battle.
      const player = Rng.fromSeed(`player:${seed}`);
      const actions: BattleAction[] = [];
      let state = startBattle(content, setup);
      while (state.phase.type !== 'over') {
        let action: BattleAction;
        if (state.phase.type === 'replace') {
          action = { type: 'replace', side: 'a', slot: player.pick(benchOf(state, 'a')).slot };
        } else if (player.chance(2)) {
          action = { type: 'forfeit', side: 'a' };
        } else {
          action = { type: 'turn', choices: { a: player.pick(legalChoices(state, 'a')) } };
        }
        kinds.add(action.type === 'turn' ? (action.choices.a?.type ?? '') : action.type);
        actions.push(action);
        state = applyBattleAction(content, state, action);

        // Resuming from a stored mid-battle state changes nothing.
        state = JSON.parse(JSON.stringify(state)) as typeof state;
      }
      expect(replayBattle(content, setup, actions)).toEqual(state);
    }
    expect([...kinds].sort()).toEqual(['capture', 'forfeit', 'move', 'replace', 'swap']);
  });

  it('plays out differently for different seeds', () => {
    const setup = randomSetup('fixed', ai('balanced'), ai('balanced'));
    const logs = new Set(
      seeds
        .slice(0, 20)
        .map((seed) => JSON.stringify(autoplayBattle(content, { ...setup, seed }).state.log)),
    );
    expect(logs.size).toBeGreaterThan(15);
  });

  it('always finishes, with XP for every squishy that came out', () => {
    const reasons = new Set<string>();
    for (const seed of seeds.slice(0, 100)) {
      const setup = randomSetup(seed, ai('wild'), ai('defensive'));
      const { state } = autoplayBattle(content, setup);
      if (state.phase.type !== 'over') throw new Error('not over');
      reasons.add(state.phase.result.reason);
      const joined = (['a', 'b'] as const).flatMap((side) =>
        state.sides[side].squishies.filter((s) => s.joined).map((s) => s.id),
      );
      expect(state.phase.result.xp.map((x) => x.squishyId)).toEqual(joined);
      for (const award of state.phase.result.xp) expect(award.xp).toBeGreaterThanOrEqual(5);
    }
    expect(reasons.has('tuckered-out')).toBe(true);
  });

  it('logs ids, not player-facing text, and its event names avoid style guide §9 words', () => {
    // Stat keys like "attack" are fine in code (style guide §9); the UI words them.
    const ids = new Set<string>([
      ...content.moves.keys(),
      ...content.rules.effectiveness.map((t) => t.id),
      'attack',
      'defense',
      'speed',
      'dizzy',
      'sleepy',
      'a',
      'b',
      'draw',
      'tuckered-out',
      'forfeit',
      'turn-limit',
    ]);
    const types = new Set<string>();
    for (const seed of seeds.slice(0, 50)) {
      const { state } = autoplayBattle(
        content,
        randomSetup(seed, ai('guardian'), ai('aggressive')),
      );
      for (const event of state.log) {
        const { type, ...rest } = event;
        types.add(type);
        for (const value of Object.values(rest)) {
          if (typeof value === 'string') expect(ids).toContain(value);
        }
      }
    }
    expect(types.size).toBeGreaterThan(8);
    expect(findAvoidedWords([...types].join(' '))).toEqual([]);
  });

  it('matches a pinned golden battle, so a change that alters outcomes breaks loudly', () => {
    // Changing this snapshot means stored replays no longer reproduce: only
    // do it on purpose, with a plan for battles already stored.
    const setup = battleSetup(
      'golden',
      {
        controller: ai('balanced'),
        squishies: [squishy('fixture-emberbun'), squishy('fixture-puddlepuff', { level: 12 })],
      },
      {
        controller: ai('guardian'),
        squishies: [squishy('fixture-twirlysprout'), squishy('fixture-pebblesnooze')],
      },
    );
    const { state, actions } = autoplayBattle(content, setup);
    expect({
      actions: actions.length,
      events: state.log.length,
      rng: state.rng,
      phase: state.phase,
      firstEvents: state.log.slice(0, 6),
    }).toMatchInlineSnapshot(`
      {
        "actions": 13,
        "events": 58,
        "firstEvents": [
          {
            "move": "fixture-zippy-zoom",
            "side": "a",
            "slot": 0,
            "turn": 1,
            "type": "move",
          },
          {
            "amount": 15,
            "effectiveness": "super",
            "energy": 16,
            "side": "b",
            "slot": 0,
            "turn": 1,
            "type": "hit",
          },
          {
            "side": "a",
            "slot": 0,
            "stages": 2,
            "stat": "speed",
            "total": 2,
            "turn": 1,
            "type": "stat-change",
          },
          {
            "move": "fixture-lullaby",
            "side": "b",
            "slot": 0,
            "turn": 1,
            "type": "move",
          },
          {
            "side": "a",
            "slot": 0,
            "status": "sleepy",
            "turn": 1,
            "type": "status-start",
          },
          {
            "side": "a",
            "slot": 0,
            "status": "sleepy",
            "turn": 2,
            "type": "status-skip",
          },
        ],
        "phase": {
          "result": {
            "contentHash": "70bc8c45deeb42abeca68325014f1a1c",
            "reason": "tuckered-out",
            "turns": 13,
            "winner": "a",
            "xp": [
              {
                "side": "a",
                "squishyId": "a:emberbun",
                "xp": 120,
              },
              {
                "side": "a",
                "squishyId": "a:puddlepuff",
                "xp": 120,
              },
              {
                "side": "b",
                "squishyId": "b:twirlysprout",
                "xp": 40,
              },
              {
                "side": "b",
                "squishyId": "b:pebblesnooze",
                "xp": 40,
              },
            ],
          },
          "type": "over",
        },
        "rng": [
          114766198,
          1096223947,
          2406548053,
          2118965419,
        ],
      }
    `);
  });

  it('only autoplays battles where both sides are AI', () => {
    expect(() => autoplayBattle(content, randomSetup('x', PLAYER, ai('wild')))).toThrow(/side a/);
    expect(() => autoplayBattle(content, randomSetup('x', ai('wild'), PLAYER))).toThrow(/side b/);
  });
});
