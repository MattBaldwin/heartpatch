import type { BattleKind } from '@heartpatch/shared';

/** The result card's line under a plain win or a loss (style guide §6). */
export const RESULT_LINES = {
  wonSub: 'Everyone had a great time.',
  wildWonSub: "It's tuckered out and toddles away!",
  wildGoneSub: 'It wandered off. Try another one nearby!',
  scootedSub: 'Maybe next time!',
  lostSub: 'A nap and a snack, and they’ll be ready again.',
} as const;

/**
 * The line under a win (not a befriend or a rescue) or a loss. Off the
 * Tutorial Glade, a wild squishy wanders off whether you beat it (owner
 * decision 2026-10-03), lost to it or ran from it (owner decision 2026-10-06,
 * #208), so the next find is a different one. On the Glade it stays (#24).
 */
export function resultLine(
  kind: BattleKind,
  outcome: 'won' | 'lost' | 'scooted',
  glade: boolean,
): string {
  const wandersOff = kind === 'wild' && !glade;
  if (outcome === 'won') return wandersOff ? RESULT_LINES.wildWonSub : RESULT_LINES.wonSub;
  if (wandersOff) return RESULT_LINES.wildGoneSub;
  return outcome === 'scooted' ? RESULT_LINES.scootedSub : RESULT_LINES.lostSub;
}

/** The result card for a fence battle (#203, the owner-approved mockup). */
export const FENCE_RESULTS = {
  broke: {
    title: 'Crack! The fence fell down!',
    subtitle: 'Now beat the guard to make it yours. Tap Keep going on the land!',
  },
  held: {
    title: 'The fence held!',
    subtitle: 'It keeps the energy it lost. This land needs a little rest now.',
  },
  stopped: { title: 'You stopped for now.', subtitle: 'The fence keeps the energy it lost.' },
  // The owner's replay of a challenge on their fence.
  replayHeld: { title: 'Your fence held!', subtitle: 'Fix it up from the land’s Fences.' },
  replayBroke: {
    title: 'They broke your fence!',
    subtitle: 'Build it again from the land’s Fences.',
  },
} as const;

/**
 * A fence battle's card: the challenger broke it, it held to the turn limit
 * (or tuckered them out), or they stopped. In a replay, the owner's side.
 */
export function fenceResult(
  winner: 'mine' | 'theirs',
  reason: string,
  replay: boolean,
): { title: string; subtitle: string } {
  if (replay) return winner === 'mine' ? FENCE_RESULTS.replayHeld : FENCE_RESULTS.replayBroke;
  if (winner === 'mine') return FENCE_RESULTS.broke;
  return reason === 'forfeit' ? FENCE_RESULTS.stopped : FENCE_RESULTS.held;
}
