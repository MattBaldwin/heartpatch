import { pushLineFor } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { PageMessage, WorkerDescription } from './messages.js';
import { FALLBACK_NUDGE } from './push-payload.js';
import { API_HEADERS, PUSH_SUBSCRIPTION_URL } from './push-subscription.js';
import {
  answerMessage,
  openNudge,
  putSubscription,
  showNudge,
  type NudgeTargets,
  type WorkerClients,
  type WorkerSelf,
} from './sw-handlers.js';

const MAP_ID = '019a7c3e-5b2d-7f10-8a4c-2d9e6f1b3c5a';

describe('answerMessage', () => {
  function worker() {
    const log: string[] = [];
    const self: WorkerSelf = {
      version: 'v1',
      cache: 'heartpatch-shell-v1',
      hasPath: (path) => path === '/index.html',
      skipWaiting: () => {
        log.push('skip-waiting');
        return Promise.resolve();
      },
    };
    return { self, log };
  }

  function port() {
    const sent: WorkerDescription[] = [];
    return { sent, postMessage: (message: WorkerDescription) => sent.push(message) };
  }

  it('answers describe on the first port', () => {
    const w = worker();
    const [first, second] = [port(), port()];
    answerMessage({ type: 'describe', path: '/index.html' }, [first, second], w.self);
    answerMessage({ type: 'describe', path: '/nope.js' }, [first], w.self);
    expect(first.sent).toEqual([
      { version: 'v1', cache: 'heartpatch-shell-v1', hasPath: true },
      { version: 'v1', cache: 'heartpatch-shell-v1', hasPath: false },
    ]);
    expect(second.sent).toEqual([]);
    expect(w.log).toEqual([]);
  });

  it('skips waiting when asked, and answers nothing', () => {
    const w = worker();
    const p = port();
    answerMessage({ type: 'skip-waiting' }, [p], w.self);
    expect(w.log).toEqual(['skip-waiting']);
    expect(p.sent).toEqual([]);
  });

  it('is fine with no port to answer on', () => {
    const w = worker();
    expect(() => {
      answerMessage({ type: 'describe', path: '/' }, [], w.self);
    }).not.toThrow();
  });

  it.each([null, 'skip-waiting', { type: 'describe' }, { type: 'open-map', mapId: null }])(
    'ignores %j',
    (data) => {
      const w = worker();
      const p = port();
      answerMessage(data, [p], w.self);
      expect(p.sent).toEqual([]);
      expect(w.log).toEqual([]);
    },
  );
});

describe('showNudge', () => {
  function targets(badge: 'ok' | 'fails' | 'none' = 'ok') {
    const shown: { title: string; options: NotificationOptions }[] = [];
    const badges: number[] = [];
    const t: NudgeTargets = {
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
      setAppBadge:
        badge === 'none'
          ? undefined
          : (count) => {
              badges.push(count);
              return badge === 'fails' ? Promise.reject(new Error('no badge')) : Promise.resolve();
            },
    };
    return { t, shown, badges };
  }

  it('shows the server’s words, tagged and quiet on replace, and badges the icon', async () => {
    const line = pushLineFor('dusk');
    const tag = `dusk:${MAP_ID}`;
    const f = targets();
    await showNudge(JSON.stringify({ v: 1, kind: 'dusk', ...line, mapId: MAP_ID, tag }), f.t);
    expect(f.shown).toEqual([
      {
        title: line.title,
        options: { body: line.body, tag, data: { mapId: MAP_ID, kind: 'dusk' }, renotify: false },
      },
    ]);
    expect(f.badges).toEqual([1]);
  });

  it.each([null, '', 'not json'])('never stays silent: %j shows the fallback', async (text) => {
    const f = targets();
    await showNudge(text, f.t);
    expect(f.shown.map((s) => s.title)).toEqual([FALLBACK_NUDGE.title]);
    expect(f.shown[0]?.options.body).toBe(FALLBACK_NUDGE.body);
  });

  it('still shows the nudge when the badge fails or there is none', async () => {
    for (const badge of ['fails', 'none'] as const) {
      const f = targets(badge);
      await expect(showNudge(null, f.t)).resolves.toBeDefined();
      expect(f.shown).toHaveLength(1);
      // The badge was tried where there is one, and its failure swallowed.
      expect(f.badges).toEqual(badge === 'fails' ? [1] : []);
    }
  });
});

describe('openNudge', () => {
  function clients(windows: number) {
    const log: string[] = [];
    const messages: PageMessage[] = [];
    const c: WorkerClients = {
      matchAll: (options) => {
        log.push(`matchAll ${options.type} ${String(options.includeUncontrolled)}`);
        return Promise.resolve(
          Array.from({ length: windows }, (_, i) => ({
            postMessage: (message: PageMessage) => {
              messages.push(message);
              log.push(`post ${String(i)}`);
            },
            focus: () => {
              log.push(`focus ${String(i)}`);
              return Promise.resolve();
            },
          })),
        );
      },
      openWindow: (url) => {
        log.push(`open ${url}`);
        return Promise.resolve(null);
      },
    };
    return { c, log, messages };
  }

  it('tells an open app which patch, then brings it to the front', async () => {
    const f = clients(2);
    await openNudge({ mapId: MAP_ID, kind: 'dusk' }, f.c);
    expect(f.messages).toEqual([{ type: 'open-map', mapId: MAP_ID }]);
    expect(f.log).toEqual(['matchAll window true', 'post 0', 'focus 0']);
  });

  it('names no patch for the fallback nudge', async () => {
    const f = clients(1);
    await openNudge(FALLBACK_NUDGE.data, f.c);
    expect(f.messages).toEqual([{ type: 'open-map', mapId: null }]);
  });

  it('opens / when the app is closed (no deep link)', async () => {
    const f = clients(0);
    await openNudge({ mapId: MAP_ID, kind: 'dusk' }, f.c);
    expect(f.log).toEqual(['matchAll window true', 'open /']);
  });
});

describe('putSubscription', () => {
  function fetcher(status: number) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response('{"ok":true}', { status }));
    };
    return { f, calls };
  }

  it('PUTs the body as JSON with the API headers and the session cookie', async () => {
    const body = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
    const f = fetcher(200);
    await putSubscription(f.f, body);
    expect(f.calls).toEqual([
      {
        url: PUSH_SUBSCRIPTION_URL,
        init: {
          method: 'PUT',
          credentials: 'same-origin',
          headers: API_HEADERS,
          body: JSON.stringify(body),
        },
      },
    ]);
  });

  it('throws when the server says no', async () => {
    await expect(putSubscription(fetcher(401).f, {})).rejects.toThrow('push subscription 401');
  });
});
