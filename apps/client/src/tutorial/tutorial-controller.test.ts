import type { TutorialState, WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import type { WsClientOptions } from '../net/ws-client.js';
import {
  ADVANCE_CHECK_MS,
  ADVANCE_CHECKS_BEFORE_RETRY,
  STUCK_MESSAGE,
  TutorialController,
  type GraduationChoice,
  type TutorialView,
} from './tutorial-controller.js';
import { opensByItself } from './tutorial-screen.js';

const MAP = '0190f000-0000-7000-8000-000000000001';
const OTHER_MAP = '0190f000-0000-7000-8000-000000000002';

const state = (patch: Partial<TutorialState> = {}): TutorialState => ({
  status: 'in-progress',
  stepId: 'welcome',
  mapId: MAP,
  completedAt: null,
  required: false,
  ...patch,
});

const advanced = (completedStepId: string, stepId: string | null, mapId = MAP): WsEventMessage => ({
  v: 1,
  type: 'tutorial.advanced',
  mapId,
  seq: 5,
  at: '2026-10-02T12:00:00.000Z',
  data: { completedStepId, stepId },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(initial: TutorialState = state()) {
  let server = initial;
  const calls: string[] = [];
  let ackError: Error | null = null;
  const subscriptions: [string, number][] = [];
  let wsOptions: WsClientOptions | null = null;
  let closedSockets = 0;
  const timers: { task: () => void; ms: number }[] = [];
  const views: TutorialView[] = [];
  const done: (GraduationChoice | null)[] = [];

  const controller = new TutorialController({
    api: {
      state: () => {
        calls.push('state');
        return Promise.resolve(server);
      },
      start: () => {
        calls.push('start');
        server = state();
        return Promise.resolve(server);
      },
      replay: () => {
        calls.push('replay');
        server = state({ mapId: OTHER_MAP, completedAt: server.completedAt });
        return Promise.resolve(server);
      },
      skip: () => {
        calls.push('skip');
        server = state({ status: 'completed', stepId: null, mapId: null, completedAt: 'x' });
        return Promise.resolve(server);
      },
      acknowledge: (stepId) => {
        calls.push(`ack:${stepId}`);
        return ackError ? Promise.reject(ackError) : Promise.resolve();
      },
    },
    createWs: (options) => {
      wsOptions = options;
      return {
        subscribe: (mapId, afterSeq) => subscriptions.push([mapId, afterSeq]),
        close: () => {
          closedSockets++;
        },
        status: 'live',
      };
    },
    onChange: (view) => views.push(view),
    onDone: (choice) => done.push(choice),
    setTimer: (task, ms) => {
      const timer = { task, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const i = timers.indexOf(handle as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });

  return {
    controller,
    calls,
    subscriptions,
    timers,
    views,
    done,
    closedSockets: () => closedSockets,
    setServer: (next: TutorialState) => {
      server = next;
    },
    failAcknowledge: (err: Error) => {
      ackError = err;
    },
    /** The server's step engine moves on and writes `tutorial.advanced`. */
    serverAdvances: (event: WsEventMessage, next: TutorialState) => {
      server = next;
      wsOptions?.onEvent(event);
    },
    resync: () => wsOptions?.onResync(MAP),
    fireTimer: async () => {
      const timer = timers.shift();
      timer?.task();
      await settle();
      await settle();
    },
  };
}

describe('opensByItself', () => {
  it('resumes a run going, and starts when the server requires it', () => {
    expect(opensByItself(state())).toBe(true);
    expect(opensByItself(state({ status: 'not-started', stepId: null, mapId: null }))).toBe(false);
    expect(
      opensByItself(state({ status: 'not-started', stepId: null, mapId: null, required: true })),
    ).toBe(true);
    expect(
      opensByItself(
        state({ status: 'completed', stepId: null, mapId: null, completedAt: 'x', required: true }),
      ),
    ).toBe(false);
  });
});

describe('TutorialController', () => {
  it('resumes the run going on the same step, and follows its map live', async () => {
    const t = setup(state({ stepId: 'graduation' }));
    await t.controller.open();
    expect(t.calls).toEqual(['state']);
    expect(t.controller.view.phase).toBe('step');
    expect(t.controller.view.step?.id).toBe('graduation');
    expect(t.subscriptions).toEqual([[MAP, 0]]);
  });

  it('starts the first run', async () => {
    const t = setup(state({ status: 'not-started', stepId: null, mapId: null }));
    await t.controller.open();
    expect(t.calls).toEqual(['state', 'start']);
    expect(t.controller.view.step?.id).toBe('welcome');
  });

  it('taps through the lines, then tells the server and waits for it to move on', async () => {
    const t = setup();
    await t.controller.open();
    t.controller.acknowledge(); // not on the last line yet
    expect(t.calls).not.toContain('ack:welcome');

    t.controller.nextLine();
    expect(t.controller.view.line).toBe(1);
    t.controller.nextLine(); // already on the last line
    expect(t.controller.view.line).toBe(1);

    t.controller.acknowledge();
    expect(t.controller.view.phase).toBe('waiting');
    expect(t.calls).toContain('ack:welcome');

    t.serverAdvances(advanced('welcome', 'graduation'), state({ stepId: 'graduation' }));
    expect(t.controller.view.phase).toBe('step');
    expect(t.controller.view.step?.id).toBe('graduation');
    expect(t.controller.view.line).toBe(0);
    expect(t.timers).toHaveLength(0); // the fallback check was cancelled
  });

  it("ignores replayed advances from earlier steps and other maps' events", async () => {
    const t = setup(state({ stepId: 'graduation' }));
    await t.controller.open();
    t.serverAdvances(advanced('welcome', 'graduation'), state({ stepId: 'graduation' }));
    t.serverAdvances(advanced('graduation', null, OTHER_MAP), state({ stepId: 'graduation' }));
    expect(t.controller.view.step?.id).toBe('graduation');
    expect(t.done).toEqual([]);
  });

  it('finishes with the graduation choice once the server says the tutorial is done', async () => {
    const t = setup(state({ stepId: 'graduation' }));
    await t.controller.open();
    t.controller.nextLine();
    t.controller.acknowledge('join');
    expect(t.calls).toContain('ack:graduation');
    t.serverAdvances(
      advanced('graduation', null),
      state({ status: 'completed', stepId: null, mapId: null, completedAt: 'x' }),
    );
    await settle();
    expect(t.done).toEqual(['join']);
    expect(t.controller.view.phase).toBe('closed');
    expect(t.closedSockets()).toBe(1);
  });

  it('asks the server where we are when the live advance never comes', async () => {
    const t = setup();
    await t.controller.open();
    t.controller.nextLine();
    t.controller.acknowledge();
    expect(t.timers[0]?.ms).toBe(ADVANCE_CHECK_MS);

    t.setServer(state({ stepId: 'graduation' })); // moved on, but the event was lost
    await t.fireTimer();
    expect(t.controller.view.step?.id).toBe('graduation');
    expect(t.controller.view.phase).toBe('step');
  });

  it('offers to try again if the server never moves on', async () => {
    const t = setup();
    await t.controller.open();
    t.controller.nextLine();
    t.controller.acknowledge();
    for (let i = 0; i < ADVANCE_CHECKS_BEFORE_RETRY; i++) await t.fireTimer();
    expect(t.controller.view.phase).toBe('error');
    expect(t.controller.view.message).toBe(STUCK_MESSAGE);

    t.controller.retry();
    expect(t.controller.view.phase).toBe('waiting');
    expect(t.calls.filter((c) => c === 'ack:welcome')).toHaveLength(2);
  });

  it('a double tap the server already took just catches up', async () => {
    const t = setup();
    await t.controller.open();
    t.controller.nextLine();
    t.failAcknowledge(new ApiRequestError('CONFLICT', 'Sprout has already moved on.'));
    t.setServer(state({ stepId: 'graduation' }));
    t.controller.acknowledge();
    await settle();
    await settle();
    expect(t.controller.view.step?.id).toBe('graduation');
    expect(t.controller.view.phase).toBe('step');
  });

  it("shows a friendly error when the tap can't reach the server", async () => {
    const t = setup();
    await t.controller.open();
    t.controller.nextLine();
    t.failAcknowledge(new ApiRequestError('OFFLINE', "We can't reach the patch right now."));
    t.controller.acknowledge();
    await settle();
    expect(t.controller.view.phase).toBe('error');
    expect(t.controller.view.message).toBe("We can't reach the patch right now.");
  });

  it('rechecks on a live resync', async () => {
    const t = setup();
    await t.controller.open();
    t.setServer(state({ stepId: 'graduation' }));
    t.resync();
    await settle();
    expect(t.controller.view.step?.id).toBe('graduation');
  });

  it('only offers skip on a replay, after a first completion', async () => {
    const t = setup(state({ status: 'completed', stepId: null, mapId: null, completedAt: 'x' }));
    await t.controller.check();
    expect(t.controller.view.canSkip).toBe(false);
    await t.controller.replay();
    expect(t.calls).toContain('replay');
    expect(t.subscriptions).toEqual([[OTHER_MAP, 0]]);
    expect(t.controller.view.canSkip).toBe(true);

    t.controller.skip();
    await settle();
    expect(t.calls).toContain('skip');
    expect(t.done).toEqual([null]);
    expect(t.controller.view.phase).toBe('closed');
  });

  it("can't skip a first run, and can't leave one the server requires", async () => {
    const t = setup(state({ required: true }));
    await t.controller.open();
    expect(t.controller.view.canSkip).toBe(false);
    expect(t.controller.view.canLeave).toBe(false);
    t.controller.skip();
    expect(t.calls).not.toContain('skip');
  });

  it('can always put an optional tutorial away, keeping the place on the server', async () => {
    const t = setup();
    await t.controller.open();
    expect(t.controller.view.canLeave).toBe(true);
    t.controller.close();
    expect(t.controller.view.phase).toBe('closed');
    expect(t.closedSockets()).toBe(1);
    await t.controller.open();
    expect(t.controller.view.step?.id).toBe('welcome');
  });

  it('drops a slow answer that arrives after it was put away', async () => {
    const t = setup();
    const opening = t.controller.open();
    t.controller.close();
    await opening;
    expect(t.controller.view.phase).toBe('closed');
    expect(t.subscriptions).toEqual([]);
  });
});
