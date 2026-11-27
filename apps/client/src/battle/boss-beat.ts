import type { BattleSideId, ElementId } from '@heartpatch/shared';
import type { PlaybackStep } from './battle-playback.js';

// The boss's big beats as a step of the log plays (#190 PR 4): the scene
// works them out where it cues the boss camera (`battle-scene.ts` `perform`),
// and the sound and the Android buzz follow them. Pure, so the sound never
// depends on reduced motion: only the camera's moves do.

export type BossBeatKind =
  /** The boss starts winding up a big move (its `windup` effect step). */
  | 'windup'
  /** That move lands on the team (the hit after its landing move): the thump. */
  | 'landing'
  /** The boss's friend comes in to help (the `move` an `assist` called in). */
  | 'backup'
  /** The fight is over. */
  | 'end';

export interface BossBeat {
  readonly kind: BossBeatKind;
  /** The move's element (the stinger under the boss's voice); null if none. */
  readonly element: ElementId | null;
}

export interface BossBeatContext {
  /** The boss's side. */
  readonly boss: BattleSideId;
  /** The last move played: who used it, and whether it was a windup landing. */
  readonly lastMove: { readonly user: BattleSideId; readonly landing: boolean } | null;
  /** The element of the move the step is about (as the arena's FX pick it). */
  readonly element: ElementId | null;
}

/** The boss beat a step is, or null for an ordinary step. */
export function bossBeat(
  step: Pick<PlaybackStep, 'kind' | 'side'> & Partial<Pick<PlaybackStep, 'windup' | 'backup'>>,
  ctx: BossBeatContext,
): BossBeat | null {
  const { boss, lastMove, element } = ctx;
  if (step.kind === 'effect' && step.windup === true && step.side === boss) {
    return { kind: 'windup', element };
  }
  if (step.kind === 'hit' && step.side !== boss && lastMove?.user === boss && lastMove.landing) {
    return { kind: 'landing', element };
  }
  if (step.kind === 'move' && step.backup === true && step.side === boss) {
    return { kind: 'backup', element };
  }
  if (step.kind === 'end') return { kind: 'end', element: null };
  return null;
}
