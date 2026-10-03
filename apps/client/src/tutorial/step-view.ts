import { TUTORIAL_STEPS, type HighlightTarget, type TutorialStep } from '@heartpatch/shared';

// What the tutorial layer shows for a step id. The words are whatever the
// shared step data says (Sprout's lines are drafted there, not here).

/**
 * What Sprout's bubble offers once its last line is read:
 * - `acknowledge`: a talk-only step's button tells the server ("Got it!").
 * - `name`: a name box for the Partner (the rename the close-up uses).
 * - `nightfall`: "Night falls" asks the server for the Glade's night.
 * - `wardrobe`: opens the Wardrobe to put the Seedling Scarf on.
 * - `go`: a gameplay step; "Let's go!" tucks the bubble out of the way.
 */
export type StepAction = 'acknowledge' | 'name' | 'nightfall' | 'wardrobe' | 'go';

/** Steps whose bubble offers more than "Let's go!" (#24). Keyed by step id. */
const STEP_ACTIONS: Readonly<Record<string, StepAction>> = {
  'name-partner': 'name',
  nightfall: 'nightfall',
  wardrobe: 'wardrobe',
};

/** Button words (style guide §6: 1–2 words, verb first). */
export const STEP_ACTION_LABELS: Readonly<Record<StepAction, string>> = {
  acknowledge: 'Got it!',
  name: 'Save',
  nightfall: 'Night falls',
  wardrobe: 'Wardrobe',
  go: "Let's go!",
};

/** A talk-only step's own button words, where "Got it!" doesn't fit. */
const ACKNOWLEDGE_LABELS: Readonly<Record<string, string>> = { plant: 'Plant it!' };

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
  /**
   * False for a step this app doesn't know yet (the server has newer steps
   * than this bundle). Input stays open and Sprout offers to check again.
   */
  readonly known: boolean;
  /** What the bubble offers after the last line. */
  readonly action: StepAction;
  /** The bubble's button words for `action`. */
  readonly actionLabel: string;
}

/** Shown if the server is on a step this app doesn't know yet (an update is on its way). */
const UNKNOWN_STEP_LINE = "Ooh, something new! Let's take a look around.";

export function stepView(
  stepId: string,
  steps: readonly TutorialStep[] = TUTORIAL_STEPS,
): StepView {
  const step = steps.find((s) => s.id === stepId);
  if (!step) {
    return {
      id: stepId,
      goal: '',
      lines: [UNKNOWN_STEP_LINE],
      target: 'none',
      talkOnly: false,
      known: false,
      action: 'go',
      actionLabel: STEP_ACTION_LABELS.go,
    };
  }
  const talkOnly = step.completeOn.eventType === 'tutorial.acknowledged';
  const action: StepAction = talkOnly ? 'acknowledge' : (STEP_ACTIONS[step.id] ?? 'go');
  return {
    id: step.id,
    goal: step.goal,
    lines: step.sproutLines,
    target: step.highlightTarget,
    talkOnly,
    known: true,
    action,
    actionLabel: (talkOnly ? ACKNOWLEDGE_LABELS[step.id] : undefined) ?? STEP_ACTION_LABELS[action],
  };
}
