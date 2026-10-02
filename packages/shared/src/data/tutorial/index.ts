import type { TutorialData } from '../../schemas/data/tutorial.js';
import { TUTORIAL_LAYOUT } from './layout.js';
import { TUTORIAL_OVERRIDES } from './overrides.js';
import { TUTORIAL_STEPS } from './steps.js';

export { TUTORIAL_LAYOUT, TUTORIAL_OVERRIDES, TUTORIAL_STEPS };

/** The tutorial's data, checked by `checkTutorialData` in tests. */
export const TUTORIAL_DATA: TutorialData = {
  steps: TUTORIAL_STEPS,
  layout: TUTORIAL_LAYOUT,
  overrides: TUTORIAL_OVERRIDES,
};
