import { BATTLE_RULES, type BattleSideId } from '@heartpatch/shared';
import type { SquishMove } from '../procedural/config.js';
import type { PlaybackStep } from './battle-playback.js';

/**
 * How the player's Keeper reacts to a playback step (design doc §23: "a happy
 * jump on a super-effective hit"). Only on events, never per frame, so an
 * idle arena stays idle. Null means the Keeper just watches.
 */
export interface KeeperReaction {
  readonly move: SquishMove;
  readonly strength: number;
}

/** Callout lines for hits worth a happy jump ("Super cozy!", "Ooh, nice one!"). */
const BIG_HITS: ReadonlySet<string> = new Set(
  BATTLE_RULES.effectiveness
    .filter((tier) => tier.id === 'super' || tier.id === 'good')
    .flatMap((tier) => (tier.line ? [tier.line] : [])),
);

export function keeperReaction(step: PlaybackStep, mySide: BattleSideId): KeeperReaction | null {
  const mine = step.side === mySide;
  switch (step.kind) {
    case 'hit':
      // `side` is who got hit: cheer for my squishy's big hits, wince a little at theirs.
      if (!mine && step.callout !== null && BIG_HITS.has(step.callout)) {
        return { move: 'bounce', strength: 1 };
      }
      return mine ? { move: 'wobble', strength: 0.5 } : null;
    case 'tuckered':
      return mine ? { move: 'wobble', strength: 1 } : { move: 'bounce', strength: 1 };
    case 'swap':
      // "Come on out!": a little wiggle of encouragement.
      return mine ? { move: 'jiggle', strength: 0.8 } : null;
    case 'capture':
      // The Heart Charm lands on the wild squishy: the Keeper watches, and
      // cheers on the 'end' step if it says yes.
      return null;
    case 'end':
      // `squish` is set when the player won (see battle-playback.ts).
      return step.squish === 'bounce'
        ? { move: 'bounce', strength: 1.2 }
        : { move: 'wobble', strength: 0.7 };
    default:
      return null;
  }
}
