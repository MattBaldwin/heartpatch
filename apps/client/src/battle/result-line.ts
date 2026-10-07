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
