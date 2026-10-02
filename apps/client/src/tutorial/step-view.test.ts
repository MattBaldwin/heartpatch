import { TUTORIAL_STEPS, type TutorialStep } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { stepView } from './step-view.js';

const gather: TutorialStep = {
  id: 'gather',
  goal: 'Gather Timber',
  sproutLines: ['Tap the trees!'],
  highlightTarget: 'resource-node',
  completeOn: { eventType: 'map.updated', actor: 'player', where: [] },
};

describe('stepView', () => {
  it("shows the step data's own words and target", () => {
    const welcome = TUTORIAL_STEPS[0]!;
    const view = stepView(welcome.id);
    expect(view.lines).toEqual(welcome.sproutLines);
    expect(view.goal).toBe(welcome.goal);
    expect(view.target).toBe(welcome.highlightTarget);
  });

  it('marks steps finished by reading them as talk-only', () => {
    expect(stepView('welcome').talkOnly).toBe(true);
    expect(stepView('gather', [gather]).talkOnly).toBe(false);
    expect(stepView('gather', [gather]).target).toBe('resource-node');
  });

  it("copes with a step this app doesn't know yet", () => {
    const view = stepView('brand-new-step');
    expect(view.lines).toHaveLength(1);
    expect(view.target).toBe('none');
    expect(view.talkOnly).toBe(false);
  });
});
