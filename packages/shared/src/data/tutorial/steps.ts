import type { TutorialStep } from '../../schemas/data/tutorial.js';

/**
 * Tutorial steps, in order (design doc §26). The step engine moves the player
 * to the next step when a game event on their tutorial map matches the
 * current step's `completeOn`; finishing the last step finishes the tutorial.
 *
 * Placeholder set: only steps that can complete with today's event types.
 * Design doc §26 steps 1–12 (plant, gather, Hearthfire, battle, capture,
 * care, habitat, territory, defend, nightfall, evolve, milestone) slot in
 * between these two in #24, as their gameplay modules register their events.
 * Sprout's final lines are drafted by the coordinator (DECISIONS "Kickoff").
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    goal: 'Say hello to Sprout',
    sproutLines: [
      "Ooh, hello! I'm Sprout, the little glow inside your Heart Seed.",
      "This is the Tutorial Glade. Let's bring the color back together!",
    ],
    highlightTarget: 'none',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'welcome' }],
    },
  },
  {
    id: 'graduation',
    goal: 'Find your patch',
    sproutLines: [
      "Ta-da! You're a real Keeper now. I'm so proud of you!",
      'Other Keepers have Heart Seeds too… Start a patch, or join a friend!',
    ],
    highlightTarget: 'graduation-choices',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'graduation' }],
    },
  },
];
