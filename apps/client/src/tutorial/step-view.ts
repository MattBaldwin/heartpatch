import { TUTORIAL_STEPS, type HighlightTarget, type TutorialStep } from '@heartpatch/shared';

// What the tutorial layer shows for a step id. The words are whatever the
// shared step data says (Sprout's lines are drafted there, not here).

export interface StepView {
  readonly id: string;
  /** Short goal shown with the step. */
  readonly goal: string;
  /** Sprout's bubbles, one at a time. */
  readonly lines: readonly string[];
  readonly target: HighlightTarget;
  /**
   * Finished by reading it (Sprout's welcome, graduation): the last bubble
   * gets a button that tells the server. Gameplay steps finish on the real
   * module's event instead, so they get no button.
   */
  readonly talkOnly: boolean;
}

/** Shown if the server is on a step this app doesn't know yet (an update is on its way). */
const UNKNOWN_STEP_LINE = "Ooh, something new! Let's take a look around.";

export function stepView(
  stepId: string,
  steps: readonly TutorialStep[] = TUTORIAL_STEPS,
): StepView {
  const step = steps.find((s) => s.id === stepId);
  if (!step) {
    return { id: stepId, goal: '', lines: [UNKNOWN_STEP_LINE], target: 'none', talkOnly: false };
  }
  return {
    id: step.id,
    goal: step.goal,
    lines: step.sproutLines,
    target: step.highlightTarget,
    talkOnly: step.completeOn.eventType === 'tutorial.acknowledged',
  };
}
