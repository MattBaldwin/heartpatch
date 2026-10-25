import { hexDistance, type Hex, type StrandedTile } from '@heartpatch/shared';

// Stranded land (Wild Isle, #621): land of mine cut off from home by a lost
// road or bridge. The words, and the pure rules the card and the map layer
// share. Cozy and short (style guide): never "damage" or "destroy".

export const STRANDED_TEXT = {
  title: 'Some land is cut off! 🛤️',
  /** Cut off, but the fading hasn't started yet (a lost bridge's grace). */
  soon: 'Join it up to home soon!',
  fading: 'Fading! Join it to home!',
  show: 'Show me',
  tileSoon: 'Cut off, fading soon 🛤️',
  tileFading: 'Cut off and fading 🍂',
} as const;

/** Grace: the fading is still ahead. Past: it has started. */
export type StrandedPhase = 'grace' | 'fading';

export function strandedPhase(tile: Pick<StrandedTile, 'since'>, nowMs: number): StrandedPhase {
  return Date.parse(tile.since) > nowMs ? 'grace' : 'fading';
}

/** Splits stranded land into the two looks (pure, for the layer and tests). */
export function splitStranded(
  stranded: readonly StrandedTile[],
  nowMs: number,
): { grace: StrandedTile[]; fading: StrandedTile[] } {
  const grace: StrandedTile[] = [];
  const fading: StrandedTile[] = [];
  for (const t of stranded) (strandedPhase(t, nowMs) === 'grace' ? grace : fading).push(t);
  return { grace, fading };
}

/** The card's line: fading wins over soon when any tile has started. */
export function strandedLine(stranded: readonly StrandedTile[], nowMs: number): string {
  return splitStranded(stranded, nowMs).fading.length > 0
    ? STRANDED_TEXT.fading
    : STRANDED_TEXT.soon;
}

/**
 * The gap to show: the tile nearest `from` (when given), else the one going
 * wild soonest; ties by wildAt, then q, r. Null when nothing is cut off.
 */
export function nearestGap(
  stranded: readonly StrandedTile[],
  from?: Hex | null,
): StrandedTile | null {
  let best: StrandedTile | null = null;
  const rank = (t: StrandedTile) => (from ? hexDistance(from, t) : 0);
  for (const t of stranded) {
    if (!best) {
      best = t;
      continue;
    }
    const d = rank(t) - rank(best);
    const w = Date.parse(t.wildAt) - Date.parse(best.wildAt);
    if (
      d < 0 ||
      (d === 0 && (w < 0 || (w === 0 && (t.q < best.q || (t.q === best.q && t.r < best.r)))))
    )
      best = t;
  }
  return best;
}
