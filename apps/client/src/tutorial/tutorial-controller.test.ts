import type { TutorialState, WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../net/api.js';
import type { WsClientOptions } from '../net/ws-client.js';
import {
  ADVANCE_CHECK_MS,
  ADVANCE_CHECKS_BEFORE_RETRY,
  NAME_FIRST_MESSAGE,
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
  partner: null,
  ...patch,
});

const PARTNER = {
  squishyId: '0190f000-0000-7000-8000-0000000000aa',
  speciesId: 'puddlepuff',
  nickname: null,
};

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
  const keys: string[] = [];
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
      nightfall: () => {
        calls.push('nightfall');
        return ackError ? Promise.reject(ackError) : Promise.resolve();
      },
      name: (mapId, squishyId, nickname, key) => {
        calls.push(`name:${mapId}:${squishyId}:${nickname}`);
        keys.push(key);
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
    keys,
    subscriptions,
    timers,
    views,
    done,
    closedSockets: () => closedSockets,
    setServer: (next: TutorialState) => {
      server = next;
    },
    failAcknowledge: (err: Error | null) => {
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

  it('checks again on request (a step this app does not know yet)', async () => {
    const t = setup(state({ stepId: 'brand-new-step' }));
    await t.controller.open();
    expect(t.controller.view.step?.known).toBe(false);
    t.setServer(state({ stepId: 'graduation' }));
    t.controller.recheckNow();
    await settle();
    expect(t.controller.view.step?.id).toBe('graduation');
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

  it("tucks a gameplay step's bubble away once read, and opens it again on a tap", async () => {
    const t = setup(state({ stepId: 'gather' }));
    await t.controller.open();
    t.controller.tuck(); // not on the last line yet
    expect(t.controller.view.tucked).toBe(false);
    t.controller.nextLine();
    t.controller.tuck();
    expect(t.controller.view.tucked).toBe(true);
    t.controller.untuck();
    expect(t.controller.view.tucked).toBe(false);
    t.controller.tuck();

    // The next step starts untucked, from its first line.
    t.serverAdvances(advanced('gather', 'hearthfire'), state({ stepId: 'hearthfire' }));
    expect(t.controller.view).toMatchObject({ tucked: false, line: 0 });

    // Talk-only steps never tuck: their button is the way on.
    const talk = setup(state({ stepId: 'plant' }));
    await talk.controller.open();
    talk.controller.nextLine();
    talk.controller.tuck();
    expect(talk.controller.view.tucked).toBe(false);
  });

  it('names the Partner on the naming step, with one key per name', async () => {
    const t = setup(state({ stepId: 'name-partner', partner: PARTNER }));
    await t.controller.open();
    t.controller.name('Sunny'); // Sprout hasn't finished talking
    expect(t.calls).toEqual(['state']);
    t.controller.nextLine();
    // Save with nothing typed: a nudge, not silence (#154), and no request.
    t.controller.name('   ');
    expect(t.controller.view).toMatchObject({ phase: 'error', message: NAME_FIRST_MESSAGE });
    expect(t.calls).toEqual(['state']);
    t.controller.retry();
    expect(t.controller.view.phase).toBe('step');

    // Too long: refused here, with the close-up's words, before any request.
    t.controller.name('x'.repeat(17));
    expect(t.controller.view).toMatchObject({
      phase: 'error',
      message: 'Names can be up to 16 letters.',
    });
    t.controller.retry();
    expect(t.controller.view.phase).toBe('step');
    expect(t.calls).toEqual(['state']);

    // A lost reply: "Try again" sends the same name with the same key.
    t.failAcknowledge(new ApiRequestError('OFFLINE', "We can't reach the patch right now."));
    t.controller.name('  Sunny ');
    await settle();
    expect(t.controller.view.phase).toBe('error');
    t.failAcknowledge(null);
    t.controller.retry();
    expect(t.controller.view.phase).toBe('waiting');
    expect(t.calls.filter((c) => c.startsWith('name:'))).toEqual([
      `name:${MAP}:${PARTNER.squishyId}:Sunny`,
      `name:${MAP}:${PARTNER.squishyId}:Sunny`,
    ]);
    // The same name again is the same request (a retry can't rename twice).
    expect(new Set(t.keys).size).toBe(1);

    t.serverAdvances(advanced('name-partner', 'care'), state({ stepId: 'care', partner: PARTNER }));
    expect(t.controller.view.step?.id).toBe('care');
  });

  it('goes back to the name box when the server refuses a name, without sending it again', async () => {
    const t = setup(state({ stepId: 'name-partner', partner: PARTNER }));
    await t.controller.open();
    t.controller.nextLine();
    const names = () => t.calls.filter((c) => c.startsWith('name:'));

    t.failAcknowledge(
      new ApiRequestError(
        'VALIDATION_FAILED',
        "Let's keep names sweet, not stinky! Try another one.",
      ),
    );
    t.controller.name('Stinky');
    await settle();
    expect(t.controller.view).toMatchObject({
      phase: 'error',
      message: "Let's keep names sweet, not stinky! Try another one.",
    });
    t.controller.retry();
    await settle();
    // Back on the naming step (the box shows again), and nothing was re-sent.
    expect(t.controller.view).toMatchObject({ phase: 'step', message: null });
    expect(t.controller.view.step?.action).toBe('name');
    expect(names()).toEqual([`name:${MAP}:${PARTNER.squishyId}:Stinky`]);
    expect(t.timers).toEqual([]);

    // A clean name goes through, with its own key.
    t.failAcknowledge(null);
    t.controller.name('Sunny');
    expect(t.controller.view.phase).toBe('waiting');
    expect(names()).toEqual([
      `name:${MAP}:${PARTNER.squishyId}:Stinky`,
      `name:${MAP}:${PARTNER.squishyId}:Sunny`,
    ]);
    expect(new Set(t.keys).size).toBe(2);
    t.serverAdvances(advanced('name-partner', 'care'), state({ stepId: 'care', partner: PARTNER }));
    expect(t.controller.view.step?.id).toBe('care');
  });

  it('sends a name again after a server hiccup or a slow-down, with the same key', async () => {
    for (const code of ['INTERNAL', 'RATE_LIMITED'] as const) {
      const t = setup(state({ stepId: 'name-partner', partner: PARTNER }));
      await t.controller.open();
      t.controller.nextLine();
      t.failAcknowledge(new ApiRequestError(code, 'Oops!'));
      t.controller.name('Sunny');
      await settle();
      t.controller.retry();
      await settle();
      expect(t.calls.filter((c) => c.startsWith('name:'))).toHaveLength(2);
      expect(new Set(t.keys).size).toBe(1);
    }
  });

  it('names the Partner on plain http, where crypto.randomUUID throws', async () => {
    // A phone on the LAN playtest (DEPLOY.md §9) isn't a secure context.
    const insecure = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new TypeError('crypto.randomUUID is not available in an insecure context');
    });
    try {
      const t = setup(state({ stepId: 'name-partner', partner: PARTNER }));
      await t.controller.open();
      t.controller.nextLine();
      t.controller.name('Sunny');
      await settle();
      expect(t.calls.filter((c) => c.startsWith('name:'))).toEqual([
        `name:${MAP}:${PARTNER.squishyId}:Sunny`,
      ]);
      expect(t.keys[0]).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      insecure.mockRestore();
    }
  });

  it('asks who the Partner is when the live advance reaches the naming step', async () => {
    const t = setup(state({ stepId: 'befriend' }));
    await t.controller.open();
    t.serverAdvances(
      advanced('befriend', 'name-partner'),
      state({ stepId: 'name-partner', partner: PARTNER }),
    );
    await settle();
    expect(t.calls).toEqual(['state', 'state']);
    expect(t.controller.view.state?.partner).toEqual(PARTNER);
  });

  it('only names a Partner the server knows about, and only on its step', async () => {
    const none = setup(state({ stepId: 'name-partner' }));
    await none.controller.open();
    none.controller.nextLine();
    none.controller.name('Sunny');
    expect(none.calls).toEqual(['state']);

    const wrong = setup(state({ stepId: 'gather', partner: PARTNER }));
    await wrong.controller.open();
    wrong.controller.nextLine();
    wrong.controller.name('Sunny');
    wrong.controller.nightfall();
    expect(wrong.calls).toEqual(['state']);
  });

  it('asks for night on the nightfall step, then waits for the server to move on', async () => {
    const t = setup(state({ stepId: 'nightfall' }));
    await t.controller.open();
    t.controller.nextLine();
    t.controller.nightfall();
    expect(t.calls).toContain('nightfall');
    expect(t.controller.view.phase).toBe('waiting');
    t.serverAdvances(advanced('nightfall', 'evolve'), state({ stepId: 'evolve' }));
    expect(t.controller.view).toMatchObject({ phase: 'step', tucked: false });
    expect(t.controller.view.step?.id).toBe('evolve');
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
