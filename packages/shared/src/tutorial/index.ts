import { TUTORIAL_OVERRIDES } from '../data/tutorial/overrides.js';
import type {
  CompleteOn,
  TutorialOverrides,
  TutorialPredicate,
  TutorialScalar,
  TutorialStep,
} from '../schemas/data/tutorial.js';

// The tutorial step engine (tech spec §7): pure, so the server's event
// consumer and tests share it. The consumer feeds it each game event on the
// player's tutorial map, in seq order, and stores what it returns.

/** The parts of a `game_events` row the engine reads. */
export interface TutorialEvent {
  type: string;
  actorUserId: string | null;
  payload: unknown;
}

/** What one event did to the player's tutorial. */
export type TutorialAdvance =
  /** Finished `completed`; `next` is the new current step. */
  | { completed: TutorialStep; next: TutorialStep }
  /** Finished the last step: the tutorial is done. */
  | { completed: TutorialStep; next: null };

/** The value at a dot path, or undefined if the path isn't there. */
function valueAt(payload: unknown, field: string): unknown {
  let node: unknown = payload;
  for (const key of field.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, key)) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

function isScalar(value: unknown): value is TutorialScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/** One predicate against an event payload. */
export function predicateHolds(predicate: TutorialPredicate, payload: unknown): boolean {
  const value = valueAt(payload, predicate.field);
  switch (predicate.op) {
    case 'equals':
      return isScalar(value) && value === predicate.value;
    case 'oneOf':
      return isScalar(value) && predicate.values.includes(value);
    case 'atLeast':
      return typeof value === 'number' && value >= predicate.value;
    case 'exists':
      return value !== undefined && value !== null;
  }
}

/** True if `event` (by `playerId`'s tutorial map) satisfies `completeOn`. */
export function completesStep(
  completeOn: CompleteOn,
  event: TutorialEvent,
  playerId: string,
): boolean {
  if (event.type !== completeOn.eventType) return false;
  if (completeOn.actor === 'player' && event.actorUserId !== playerId) return false;
  return completeOn.where.every((predicate) => predicateHolds(predicate, event.payload));
}

/**
 * What `event` does to a player on step `currentStepId`: null if nothing (a
 * different event, an unknown step id), else the finished step and the next
 * one. At most one step per event, so an event can't skip ahead.
 */
export function advanceTutorial(
  steps: readonly TutorialStep[],
  currentStepId: string,
  event: TutorialEvent,
  playerId: string,
): TutorialAdvance | null {
  const index = steps.findIndex((s) => s.id === currentStepId);
  const step = steps[index];
  if (step === undefined || !completesStep(step.completeOn, event, playerId)) return null;
  return { completed: step, next: steps[index + 1] ?? null };
}

/** The step a new or replayed tutorial starts on. */
export function firstTutorialStep(steps: readonly TutorialStep[]): TutorialStep {
  const [first] = steps;
  if (first === undefined) throw new Error('firstTutorialStep: no tutorial steps');
  return first;
}

/**
 * `tutorialOverrides` for a map (tech spec §7): what gameplay modules change
 * on a tutorial map, or null on a multiplayer map. Modules call this rather
 * than branching on the map kind themselves, so there is one tutorial switch.
 */
export function gameplayOverrides(
  mapKind: 'multiplayer' | 'tutorial',
  overrides: TutorialOverrides = TUTORIAL_OVERRIDES,
): TutorialOverrides | null {
  return mapKind === 'tutorial' ? overrides : null;
}
