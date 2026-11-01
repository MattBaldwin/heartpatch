import type { TutorialState } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { PUSH_OFFERED_KEY } from './config.js';
import { fakeClient, settle, VAPID_KEY, type FakeClientOptions } from './push-fixtures.js';
import {
  createPushOffer,
  graduated,
  offeredStore,
  PUSH_OFFER_TEXT,
  subscribeOnTap,
  type PushOfferDeps,
  type ReadyOffer,
} from './push-offer.js';

const DONE: Pick<TutorialState, 'status' | 'completedAt' | 'required'> = {
  status: 'completed',
  completedAt: '2026-10-31T18:00:00.000Z',
  required: true,
};

function setup(
  opts: FakeClientOptions & {
    tutorial?: Pick<TutorialState, 'status' | 'completedAt' | 'required'> | null;
    patch?: string | null;
    busy?: boolean[];
    storage?: Map<string, string> | 'blocked';
  } = {},
) {
  const fake = fakeClient(opts);
  const store = opts.storage ?? new Map<string, string>();
  const shown: ReadyOffer[] = [];
  const toasts: string[] = [];
  const timers: (() => void)[] = [];
  let hidden = 0;
  const busy = [...(opts.busy ?? [])];
  let patch = opts.patch === undefined ? 'map-1' : opts.patch;
  const deps: PushOfferDeps = {
    client: fake.client,
    offered: offeredStore(() => {
      if (store === 'blocked') throw new Error('SecurityError');
      return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    }),
    tutorial: () => Promise.resolve(opts.tutorial === undefined ? DONE : opts.tutorial),
    patch: () => patch,
    busy: () => busy.shift() ?? false,
    show: (offer) => shown.push(offer),
    hide: () => {
      hidden++;
    },
    toast: (text) => toasts.push(text),
    setTimer: (task) => timers.push(task),
    retryMs: 3000,
  };
  const offer = createPushOffer(deps);
  return {
    ...fake,
    offer,
    store,
    offered: () => store !== 'blocked' && store.has(PUSH_OFFERED_KEY),
    shown,
    toasts,
    timers,
    hidden: () => hidden,
    setPatch: (next: string | null) => {
      patch = next;
    },
  };
}

describe('graduated', () => {
  it('is done with the tutorial, or never needed it, and not in a run', () => {
    expect(graduated(DONE)).toBe(true);
    expect(graduated({ status: 'not-started', completedAt: null, required: false })).toBe(true);
    expect(graduated({ status: 'not-started', completedAt: null, required: true })).toBe(false);
    // A replay of the tutorial is a run going.
    expect(graduated({ ...DONE, status: 'in-progress' })).toBe(false);
  });
});

describe('the offer card shows', () => {
  it('once every condition holds, with the status and device read first', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    expect(t.shown).toHaveLength(1);
    expect(t.log).toEqual(['status', 'device']);
    expect(t.offer.debug.state).toBe('showing');
  });

  const hides: [string, Parameters<typeof setup>[0]][] = [
    [
      'before graduation',
      { tutorial: { status: 'in-progress', completedAt: null, required: true } },
    ],
    ['when the tutorial cannot be read', { tutorial: null }],
    ['with no patch on screen', { patch: null }],
    ['outside a Home Screen app with push', { supported: false }],
    ['when permission was granted already', { permission: 'granted' }],
    ['when permission was denied', { permission: 'denied' }],
    ['when push is off for me (NOT_FOUND)', { status: { state: 'off' } }],
    ['when the server is unreachable', { status: { state: 'unreachable' } }],
    ['when the service worker is not ready', { device: false }],
    ['once offered on this device', { storage: new Map([[PUSH_OFFERED_KEY, '1']]) }],
  ];
  for (const [name, opts] of hides) {
    it(`not ${name}`, async () => {
      const t = setup(opts);
      t.offer.maybeOffer();
      await settle();
      expect(t.shown).toHaveLength(0);
    });
  }

  it('waits while another card owns the screen, then shows', async () => {
    const t = setup({ busy: [true, true] });
    t.offer.maybeOffer();
    await settle();
    expect(t.shown).toHaveLength(0);
    expect(t.offer.debug.state).toBe('waiting');
    t.timers.shift()?.();
    expect(t.shown).toHaveLength(0);
    t.timers.shift()?.();
    expect(t.shown).toHaveLength(1);
  });

  it('gives up the wait when the patch goes away, and asks on the next one', async () => {
    const t = setup({ busy: [true] });
    t.offer.maybeOffer();
    await settle();
    t.setPatch(null);
    t.timers.shift()?.();
    expect(t.shown).toHaveLength(0);
    expect(t.offer.debug.state).toBe('idle');
    t.setPatch('map-2');
    t.offer.maybeOffer();
    await settle();
    expect(t.shown).toHaveLength(1);
  });

  it('checks only once at a time', async () => {
    const t = setup();
    t.offer.maybeOffer();
    t.offer.maybeOffer();
    await settle();
    expect(t.shown).toHaveLength(1);
    expect(t.log.filter((l) => l === 'status')).toHaveLength(1);
  });

  it('tries again on a later patch when the server was unreachable', async () => {
    const t = setup({ status: { state: 'unreachable' } });
    t.offer.maybeOffer();
    await settle();
    expect(t.offer.debug.state).toBe('idle');
  });

  it('never asks again once push is off for me', async () => {
    const t = setup({ status: { state: 'off' } });
    t.offer.maybeOffer();
    await settle();
    expect(t.offer.debug.state).toBe('done');
  });
});

describe('answering the card', () => {
  it('"Not now" closes it and never asks again', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    t.shown[0]?.no();
    expect(t.hidden()).toBe(1);
    expect(t.store).toEqual(new Map([[PUSH_OFFERED_KEY, '1']]));
    // A fresh launch on this device reads the flag.
    const again = setup({ storage: t.store as Map<string, string> });
    again.offer.maybeOffer();
    await settle();
    expect(again.shown).toHaveLength(0);
  });

  it('"Yes please" subscribes before its first await (the tap rule)', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    t.log.length = 0;
    // A microtask queued now runs after every synchronous step of `yes()`.
    const marker = Promise.resolve().then(() => t.log.push('first await'));
    const outcome = t.shown[0]?.yes();
    expect(t.log).toEqual(['subscribe key']);
    await marker;
    expect(await outcome).toBe('on');
    expect(t.log[0]).toBe('subscribe key');
  });

  it('"Yes please" → on: the toast, the card closes, the flag is set', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    await t.shown[0]?.yes();
    expect(t.toasts).toEqual([PUSH_OFFER_TEXT.on]);
    expect(t.hidden()).toBe(1);
    expect(t.offered()).toBe(true);
    expect(t.offer.debug.state).toBe('done');
  });

  for (const outcome of ['denied', 'off', 'failed'] as const) {
    it(`"Yes please" → ${outcome}: closes, says nothing, never asks again`, async () => {
      const t = setup({ outcomes: [outcome], answer: outcome === 'denied' ? 'denied' : 'default' });
      t.offer.maybeOffer();
      await settle();
      expect(await t.shown[0]?.yes()).toBe(outcome);
      expect(t.toasts).toEqual([]);
      expect(t.hidden()).toBe(1);
      expect(t.offered()).toBe(true);
      t.offer.maybeOffer();
      await settle();
      expect(t.shown).toHaveLength(1);
    });
  }

  it('asks at most once per launch when storage is blocked', async () => {
    const t = setup({ storage: 'blocked' });
    t.offer.maybeOffer();
    await settle();
    t.shown[0]?.no();
    t.offer.maybeOffer();
    await settle();
    expect(t.shown).toHaveLength(1);
  });

  it('Settings answering first settles the offer (and closes an open card)', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    t.offer.settle();
    expect(t.hidden()).toBe(1);
    expect(t.offered()).toBe(true);
    expect(t.offer.debug.state).toBe('done');
  });
  it('signing out mid-check: the old check never shows a card', async () => {
    const t = setup();
    t.offer.maybeOffer();
    expect(t.offer.debug.state).toBe('checking');
    t.offer.cancel();
    expect(t.offer.debug.state).toBe('idle');
    await settle();
    expect(t.shown).toHaveLength(0);
    expect(t.offer.debug.state).toBe('idle');
  });

  it('signing out closes an open card unanswered, and stops a wait', async () => {
    const t = setup();
    t.offer.maybeOffer();
    await settle();
    expect(t.offer.debug.state).toBe('showing');
    t.offer.cancel();
    expect(t.hidden()).toBe(1);
    expect(t.offered()).toBe(false);
    expect(t.offer.debug.state).toBe('idle');
    // Once per launch: the next patch doesn't ask again.
    t.offer.maybeOffer();
    expect(t.offer.debug.state).toBe('done');

    const w = setup({ busy: [true] });
    w.offer.maybeOffer();
    await settle();
    expect(w.offer.debug.state).toBe('waiting');
    w.offer.cancel();
    expect(w.hidden()).toBe(0);
    w.timers.shift()?.();
    expect(w.shown).toHaveLength(0);
    expect(w.offer.debug.state).toBe('idle');
  });
});

describe('subscribeOnTap (subscribe while the prompt is open)', () => {
  it('tries once more when it failed but permission is now granted', async () => {
    const t = fakeClient({ outcomes: ['failed', 'on'] });
    expect(await subscribeOnTap(t.device, VAPID_KEY, t.permission)).toBe('on');
    expect(t.log).toEqual(['subscribe key', 'subscribe key']);
  });

  it('only once: a second failure stays failed', async () => {
    const t = fakeClient({ outcomes: ['failed', 'failed', 'on'] });
    expect(await subscribeOnTap(t.device, VAPID_KEY, t.permission)).toBe('failed');
    expect(t.log).toHaveLength(2);
  });

  it('does not try again when the prompt was refused', async () => {
    const t = fakeClient({ outcomes: ['failed'], answer: 'denied' });
    expect(await subscribeOnTap(t.device, VAPID_KEY, t.permission)).toBe('failed');
    expect(t.log).toEqual(['subscribe key']);
  });

  it('calls subscribe synchronously', () => {
    const t = fakeClient();
    void subscribeOnTap(t.device, VAPID_KEY, t.permission);
    expect(t.log).toEqual(['subscribe key']);
  });
});
