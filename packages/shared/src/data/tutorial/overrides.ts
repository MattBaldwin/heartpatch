import type { TutorialOverrides } from '../../schemas/data/tutorial.js';

/**
 * What the real gameplay modules do differently on a tutorial map (tech spec
 * §7, design doc §26). Modules read it with `gameplayOverrides(map.kind)`.
 */
export const TUTORIAL_OVERRIDES: TutorialOverrides = {
  gatherSeconds: 5, // TUNE: "seconds, not minutes"
  buildSeconds: 3, // TUNE:
  captureAlwaysSucceeds: true,
  // TUNE: a level-1 wild squishy picking moves playfully is easy to beat.
  opponent: { ai: 'wild', level: 1 },
  // TUNE: the echo raider plays carefully, so any stance can win.
  raider: { ai: 'defensive', level: 1 },
  hollowManCanTake: false,
};
