import { describe, expect, it } from 'vitest';
import {
  ai,
  battleSetup,
  FIXTURE_BATTLE_CONTENT as content,
  patchActive,
  squishy,
  FIXTURE_BATTLE_RULES,
} from '../../tests/fixtures/battle.js';
import {
  FIXTURE_BACKUP,
  FIXTURE_BONK,
  FIXTURE_COUNTDOWN,
  FIXTURE_EFFECT_CONTENT,
  FIXTURE_SHOUT,
  sturdy,
} from '../../tests/fixtures/team-battle.js';
import { Rng } from '../rng/index.js';
import type { BattleChoice, BattleSquishySetup } from '../schemas/battle.js';
import type { BattleAiPolicy } from '../schemas/data/battle.js';
import type { Move } from '../schemas/data/moves.js';
import { chooseAiChoice, chooseAiReplacement, scoreMove } from './ai.js';
import { getMove } from './content.js';
import { autoplayBattle, startBattle } from './engine.js';
import { activeSquishy, type BattleState } from './state.js';

const start = (a: BattleSquishySetup[], b: BattleSquishySetup[]) =>
  startBattle(content, battleSetup('ai', { squishies: a }, { squishies: b }));

/** How often each choice comes up over `n` seeded picks for side a. */
function tally(state: BattleState, policy: BattleAiPolicy, n = 300): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const choice: BattleChoice = chooseAiChoice(
      content,
      state,
      'a',
      policy,
      Rng.fromSeed(`pick-${i}`),
    );
    const key =
      choice.type === 'move'
        ? choice.move
        : choice.type === 'swap'
          ? `swap-${String(choice.slot)}`
          : choice.type;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

describe('AI policies (design doc §6)', () => {
  it('Bold (aggressive) mostly goes for the strongest move', () => {
    const state = start([squishy('fixture-emberbun')], [squishy('fixture-twirlysprout')]);
    const counts = tally(state, 'aggressive');
    expect(counts.get('fixture-tickle-tackle')).toBeGreaterThan(210);
  });

  it('wild squishies play for fun: every useful move comes up', () => {
    const state = start([squishy('fixture-emberbun')], [squishy('fixture-twirlysprout')]);
    const counts = tally(state, 'wild');
    expect([...counts.keys()].sort()).toEqual([
      'fixture-silly-face',
      'fixture-tickle-tackle',
      'fixture-zippy-zoom',
    ]);
    expect(counts.get('fixture-tickle-tackle')).toBeLessThan(210);
  });

  it('Careful (defensive) mostly heals when low on energy, and not when full', () => {
    const full = start(
      [squishy('fixture-emberbun')],
      [squishy('fixture-twirlysprout', { level: 20 })],
    );
    expect(tally(full, 'defensive').get('fixture-cuddle-nap') ?? 0).toBeLessThan(10);
    const low = patchActive(full, 'a', { energy: 5 });
    expect(tally(low, 'defensive').get('fixture-cuddle-nap')).toBeGreaterThan(150);
  });

  it('Careful sometimes swaps to a better matchup when low, and never when healthy', () => {
    const state = start(
      [squishy('fixture-twirlysprout'), squishy('fixture-puddlepuff')],
      [squishy('fixture-emberbun')],
    );
    expect(tally(state, 'defensive').has('swap-1')).toBe(false);
    const low = patchActive(state, 'a', { energy: 5 });
    expect(tally(low, 'defensive').get('swap-1')).toBeGreaterThan(20);
    // Wild and Bold never swap.
    expect(tally(low, 'wild').has('swap-1')).toBe(false);
    expect(tally(low, 'aggressive').has('swap-1')).toBe(false);
  });

  it('wild teams never swap on their own in a whole battle', () => {
    for (let i = 0; i < 30; i++) {
      const team = ['fixture-twirlysprout', 'fixture-puddlepuff', 'fixture-emberbun'].map((id) =>
        squishy(id),
      );
      const { state } = autoplayBattle(
        content,
        battleSetup(
          `wild-${i}`,
          { controller: ai('wild'), squishies: team },
          { controller: ai('wild'), squishies: team },
        ),
      );
      expect(state.log.filter((e) => e.type === 'swap')).toEqual([]);
    }
  });

  it('sends out the best matchup after a squishy is tuckered out', () => {
    const state = patchActive(
      start(
        [
          squishy('fixture-twirlysprout'),
          squishy('fixture-snoozlet'),
          squishy('fixture-puddlepuff'),
        ],
        [squishy('fixture-emberbun')],
      ),
      'a',
      { energy: 0 },
    );
    let water = 0;
    for (let i = 0; i < 50; i++) {
      const slot = chooseAiReplacement(content, state, 'a', 'guardian', Rng.fromSeed(`r-${i}`));
      expect([1, 2]).toContain(slot);
      if (slot === 2) water++;
    }
    expect(water).toBeGreaterThan(45);
  });
});

describe('scoreMove', () => {
  const policy = FIXTURE_BATTLE_RULES.ai.balanced;
  const state = start([squishy('fixture-emberbun')], [squishy('fixture-twirlysprout')]);
  const user = activeSquishy(state, 'a');
  const target = activeSquishy(state, 'b');
  const nap = getMove(content, 'fixture-cuddle-nap');
  const zoom = getMove(content, 'fixture-zippy-zoom');
  const dance = getMove(content, 'fixture-dizzy-dance');

  it('only values healing below the policy threshold', () => {
    expect(scoreMove(content, policy, nap, user, target)).toBe(0);
    const tired = { ...user, energy: 6 };
    expect(scoreMove(content, policy, nap, tired, target)).toBeCloseTo(policy.heal * 0.5);
  });

  it('stops valuing a stat boost at the cap', () => {
    const capped = {
      ...user,
      stages: { ...user.stages, speed: FIXTURE_BATTLE_RULES.statStages.maxStages },
    };
    const withBoost = scoreMove(content, policy, zoom, user, target);
    const atCap = scoreMove(content, policy, zoom, capped, target);
    expect(withBoost - atCap).toBeCloseTo(policy.boost * 2);
  });

  it('ignores effects that would help the other squishy', () => {
    const backfire: Move = {
      ...zoom,
      power: 0,
      effects: [{ type: 'stat', target: 'self', stat: 'speed', stages: -1, chance: 100 }],
    };
    expect(scoreMove(content, policy, backfire, user, target)).toBe(0);
  });

  it("doesn't value a status the other squishy already has", () => {
    expect(scoreMove(content, policy, dance, user, target)).toBeCloseTo(policy.status);
    const dizzy = { ...target, status: { id: 'dizzy' as const, turnsLeft: 2 } };
    expect(scoreMove(content, policy, dance, user, dizzy)).toBe(0);
  });

  it('scales by accuracy', () => {
    const shaky = { ...dance, accuracy: 50 };
    expect(scoreMove(content, policy, shaky, user, target)).toBeCloseTo(policy.status / 2);
  });
});

describe('the AI and the #234 move effects', () => {
  const effects = FIXTURE_EFFECT_CONTENT;
  const policy = effects.rules.ai.balanced;
  const duel = startBattle(
    effects,
    battleSetup(
      'effects',
      { squishies: [squishy('fixture-counterbun', { stats: sturdy(50) })] },
      { squishies: [squishy('fixture-shoutbun', { stats: sturdy(50) })] },
    ),
  );
  const me = duel.sides.a.squishies[0]!;
  const foe = duel.sides.b.squishies[0]!;
  const fast = { ...me, stats: { ...me.stats, speed: 90 } };
  const slow = { ...me, stats: { ...me.stats, speed: 10 } };
  const plain = (move: Move): Move => ({ ...move, effects: [] });

  it('values a flinch only when it moves first', () => {
    const base = scoreMove(effects, policy, plain(FIXTURE_SHOUT), me, foe);
    const bonus = policy.status; // chance 100 × the status weight
    expect(scoreMove(effects, policy, FIXTURE_SHOUT, fast, foe)).toBeCloseTo(base + bonus, 10);
    expect(scoreMove(effects, policy, FIXTURE_SHOUT, me, foe)).toBeCloseTo(base + bonus / 2, 10);
    expect(scoreMove(effects, policy, FIXTURE_SHOUT, slow, foe)).toBe(base);
  });

  it('discounts a windup by the foe’s threat and stops counting when nearly out', () => {
    const now = scoreMove(effects, policy, plain(FIXTURE_COUNTDOWN), me, foe);
    const later = scoreMove(effects, policy, FIXTURE_COUNTDOWN, me, foe);
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThan(now);
    const nearlyOut = { ...me, energy: 1 };
    expect(scoreMove(effects, policy, FIXTURE_COUNTDOWN, nearlyOut, foe)).toBe(0);
  });

  it('scores an assist’s move as its own', () => {
    const callOnly: Move = { ...FIXTURE_BACKUP, effects: [FIXTURE_BACKUP.effects![0]!] };
    expect(scoreMove(effects, policy, callOnly, me, foe)).toBe(
      scoreMove(effects, policy, FIXTURE_BONK, me, foe),
    );
  });

  it('picks the pending windup move without a draw', () => {
    const winding = patchActive(duel, 'a', { windup: { move: FIXTURE_COUNTDOWN.id } });
    const rng = Rng.fromSeed('no-draw');
    const before = rng.state();
    expect(chooseAiChoice(effects, winding, 'a', 'balanced', rng)).toEqual({
      type: 'move',
      move: FIXTURE_COUNTDOWN.id,
    });
    expect(rng.state()).toEqual(before);
  });
});
