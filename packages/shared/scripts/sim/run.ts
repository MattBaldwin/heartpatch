import { autoplayBattle } from '../../src/battle/engine.js';
import { deriveSeed } from '../../src/rng/index.js';
import type { BattleSideSetup } from '../../src/schemas/battle.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';
import type { SimConfig } from './config.js';
import type { Entrant, Matchup, SimPlan } from './matchups.js';

/** How a matchup went, from entrant `a`'s point of view. */
export interface MatchResult {
  readonly matchup: Matchup;
  readonly aWins: number;
  readonly bWins: number;
  readonly draws: number;
  /** Turns played, summed over the games. */
  readonly turns: number;
}

function sideSetup(entrant: Entrant, policy: BattleAiPolicy, id: string, level: number) {
  return {
    controller: { type: 'ai', policy },
    squishies: [
      {
        id,
        speciesId: entrant.speciesId,
        level,
        ...(entrant.element && { element: entrant.element }),
        ...(entrant.feeling && { feeling: entrant.feeling }),
      },
    ],
  } satisfies BattleSideSetup;
}

/**
 * Plays every game of one matchup with the real engine and AI. Entrant `a`
 * is side `a` in even games and side `b` in odd ones, so the side order
 * (speed-tie coin flips, AI pick order) can't tilt the result.
 */
export function playMatchup(plan: SimPlan, config: SimConfig, matchup: Matchup): MatchResult {
  const { bracket, a, b, policyA, policyB, level, games } = matchup;
  const content = bracket === 'combo' ? plan.comboContent : plan.content;
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let turns = 0;
  for (let i = 0; i < games; i++) {
    const swapped = i % 2 === 1;
    const first = sideSetup(a, policyA, 'first', level);
    const second = sideSetup(b, policyB, 'second', level);
    const { state } = autoplayBattle(content, {
      seed: deriveSeed(config.rootSeed, bracket, a.key, b.key, policyA, policyB, level, i),
      sides: swapped ? { a: second, b: first } : { a: first, b: second },
    });
    if (state.phase.type !== 'over') throw new Error('autoplay always finishes');
    const { winner } = state.phase.result;
    turns += state.turn;
    if (winner === 'draw') draws += 1;
    else if ((winner === 'a') !== swapped) aWins += 1;
    else bWins += 1;
  }
  return { matchup, aWins, bWins, draws, turns };
}

export function runSim(plan: SimPlan, config: SimConfig): MatchResult[] {
  return plan.matchups.map((m) => playMatchup(plan, config, m));
}
