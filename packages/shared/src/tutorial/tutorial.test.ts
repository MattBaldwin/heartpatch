import { describe, expect, it } from 'vitest';
import { TUTORIAL_OVERRIDES, TUTORIAL_STEPS } from '../data/tutorial/index.js';
import type { TutorialStep } from '../schemas/data/tutorial.js';
import { TutorialOverridesSchema } from '../schemas/data/tutorial.js';
import {
  advanceTutorial,
  completesStep,
  firstTutorialStep,
  gameplayOverrides,
  predicateHolds,
  type TutorialEvent,
} from './index.js';

const player = '0190a000-0000-7000-8000-000000000001';
const someoneElse = '0190a000-0000-7000-8000-000000000002';

/** Steps on today's event types, standing in for gameplay steps to come. */
const STEPS: TutorialStep[] = [
  {
    id: 'hello',
    goal: 'Say hello',
    sproutLines: ['Hi!'],
    highlightTarget: 'none',
    completeOn: {
      eventType: 'tutorial.acknowledged',
      actor: 'player',
      where: [{ op: 'equals', field: 'stepId', value: 'hello' }],
    },
  },
  {
    id: 'calm-down',
    goal: 'Make it gentle',
    sproutLines: ['Gentle is nice.'],
    highlightTarget: 'none',
    completeOn: {
      eventType: 'map.updated',
      actor: 'anyone',
      where: [{ op: 'oneOf', field: 'pvpMode', values: ['gentle', 'off'] }],
    },
  },
  {
    id: 'far-seed',
    goal: 'Plant far away',
    sproutLines: ['Far!'],
    highlightTarget: 'heart-seed',
    completeOn: {
      eventType: 'map.created',
      actor: 'player',
      where: [
        { op: 'atLeast', field: 'heartSeed.q', value: 2 },
        { op: 'exists', field: 'name' },
      ],
    },
  },
];

const ack = (stepId: string, actorUserId: string | null = player): TutorialEvent => ({
  type: 'tutorial.acknowledged',
  actorUserId,
  payload: { stepId },
});

describe('tutorial step engine', () => {
  it('advances one step when the current step completes', () => {
    expect(advanceTutorial(STEPS, 'hello', ack('hello'), player)).toEqual({
      completed: STEPS[0],
      next: STEPS[1],
    });
  });

  it('ignores other events, other steps and other players', () => {
    expect(advanceTutorial(STEPS, 'hello', ack('calm-down'), player)).toBeNull();
    expect(advanceTutorial(STEPS, 'hello', ack('hello', someoneElse), player)).toBeNull();
    expect(advanceTutorial(STEPS, 'hello', ack('hello', null), player)).toBeNull();
    // A matching event for a later step doesn't skip ahead.
    const gentle = { type: 'map.updated', actorUserId: null, payload: { pvpMode: 'off' } };
    expect(advanceTutorial(STEPS, 'hello', gentle, player)).toBeNull();
    expect(advanceTutorial(STEPS, 'no-such-step', ack('hello'), player)).toBeNull();
  });

  it('lets system events complete `anyone` steps', () => {
    const gentle = { type: 'map.updated', actorUserId: null, payload: { pvpMode: 'gentle' } };
    expect(advanceTutorial(STEPS, 'calm-down', gentle, player)?.next?.id).toBe('far-seed');
    const on = { ...gentle, payload: { pvpMode: 'on' } };
    expect(advanceTutorial(STEPS, 'calm-down', on, player)).toBeNull();
  });

  it('finishes the tutorial on the last step', () => {
    const created: TutorialEvent = {
      type: 'map.created',
      actorUserId: player,
      payload: { name: 'Glade', heartSeed: { q: 2, r: 0 } },
    };
    expect(advanceTutorial(STEPS, 'far-seed', created, player)).toEqual({
      completed: STEPS[2],
      next: null,
    });
    const near = { ...created, payload: { name: 'Glade', heartSeed: { q: 1, r: 0 } } };
    expect(advanceTutorial(STEPS, 'far-seed', near, player)).toBeNull();
  });

  it('evaluates predicates on nested fields without crashing on odd payloads', () => {
    expect(predicateHolds({ op: 'exists', field: 'a.b' }, { a: { b: 0 } })).toBe(true);
    expect(predicateHolds({ op: 'exists', field: 'a.b' }, { a: { b: null } })).toBe(false);
    expect(predicateHolds({ op: 'exists', field: 'a.b' }, { a: 'b' })).toBe(false);
    expect(predicateHolds({ op: 'equals', field: 'a', value: null }, {})).toBe(false);
    expect(predicateHolds({ op: 'equals', field: 'a', value: 1 }, { a: { valueOf: 1 } })).toBe(
      false,
    );
    expect(predicateHolds({ op: 'atLeast', field: 'a', value: 1 }, { a: '2' })).toBe(false);
    expect(predicateHolds({ op: 'oneOf', field: 'a', values: [1] }, null)).toBe(false);
    expect(predicateHolds({ op: 'exists', field: 'toString' }, {})).toBe(false);
  });

  it('matches the shipped steps with acknowledgements of the same step', () => {
    const talkOnly = TUTORIAL_STEPS.filter(
      (s) => s.completeOn.eventType === 'tutorial.acknowledged',
    );
    expect(talkOnly.map((s) => s.id)).toEqual(['welcome', 'plant', 'graduation']);
    for (const step of talkOnly) {
      expect(completesStep(step.completeOn, ack(step.id), player)).toBe(true);
      expect(completesStep(step.completeOn, ack('nope'), player)).toBe(false);
    }
    expect(firstTutorialStep(TUTORIAL_STEPS).id).toBe('welcome');
    expect(() => firstTutorialStep([])).toThrow();
  });
});

describe('tutorialOverrides', () => {
  it('applies on tutorial maps only', () => {
    expect(gameplayOverrides('tutorial')).toBe(TUTORIAL_OVERRIDES);
    expect(gameplayOverrides('multiplayer')).toBeNull();
  });

  it('ships the design-doc defaults: fast timers, sure capture, nothing lost', () => {
    expect(TutorialOverridesSchema.parse(TUTORIAL_OVERRIDES)).toEqual(TUTORIAL_OVERRIDES);
    expect(TUTORIAL_OVERRIDES).toEqual({
      gatherSeconds: 5,
      buildSeconds: 3,
      captureAlwaysSucceeds: true,
      opponent: { ai: 'wild', level: 1 },
      raider: { ai: 'defensive', level: 1 },
      hollowManCanTake: false,
    });
  });
});
