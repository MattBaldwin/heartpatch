import { test, type Page, type TestInfo, type WebSocket } from '@playwright/test';

// A diagnostic for #784: on CI's WebKit a page sometimes stops answering (no
// animation frames, locator queries never return), after a reload or not
// (recipe-book never reloads). Is its main thread blocked, has only rendering
// stopped, or has Playwright lost the page's execution context? Every page
// newPlayer opens keeps a heartbeat. A watchdog adds a `heartbeat-stall`
// annotation the moment a beat goes quiet or frames stop, and a spec's
// afterEach can add a `heartbeat` one on a failed test (`reportHeartbeats`).
// spec-timing-reporter.ts prints both as check-run warnings.
//
// - In the page (an init script, so from the first line of every load): a
//   250 ms `setInterval` counts ticks (it only runs while the main thread is
//   free) and asks for one animation frame at a time (frames: it only runs while
//   rendering does), with the longest gap each has seen.
// - Every second the page sends both counts two ways: a console line, and a
//   `fetch` of the favicon with the counts in its query (seen from
//   `page.on('request')`, not routed: a route would turn on request
//   interception for every request). Playwright's WebKit side drops a console
//   message when it has no execution context for the main frame, but a
//   request event needs none. So the request beat's age says when the page
//   last ran script even when `page.evaluate` can't reach it, and a request
//   beat with no console beat means Playwright lost the page's context.
// - Test side: the page's load, navigation, crash, page-error and websocket
//   events (Vite's HMR socket), timestamped, for a reload racing something.

/** The console line's prefix and the request's query key, so nothing else is mistaken for a beat. */
const BEAT = 'hp-beat';
/** A file the dev server answers with 200, so the beat logs no failed load. */
const BEAT_URL = '/favicon.svg';
const BEAT_MS = 250;
const EVENTS_KEPT = 30;
/** How long a beat may be quiet, or frames stand still, before the watchdog looks. */
const STALL_MS = 20_000; // iPad CI pages can go 10-12 s between frames and still pass
/** How often the watchdog checks. */
const WATCHDOG_MS = 2_000;
/** At most this many stall reports a page, so one long stall doesn't flood the check run. */
const STALLS_KEPT = 2;
/** How long a probe may take before the page counts as not answering. */
const PROBE_MS = 3_000;

interface PageBeat {
  /** `performance.timeOrigin` of the load, so a reload shows as a new number. */
  load: number;
  ticks: number;
  frames: number;
  /** ms since the load's time origin of the last tick and frame. */
  tickAt: number;
  frameAt: number;
  /** The longest wait between ticks (main thread busy) and between frames. */
  maxTickGap: number;
  maxFrameGap: number;
  /** When the frame now asked for was asked for (0: none pending). */
  framePendingSince: number;
  /** The game's own frames drawn (dev hook `draws`, -1 before it's up) and whether it's idle. */
  draws: number;
  idle: boolean | null;
}

type Channel = 'request' | 'console';

interface Watch {
  started: number;
  /** The last beat on each channel: when it arrived (test clock) and what it said. */
  last: Record<Channel, { at: number; beat: PageBeat } | null>;
  /** Ticks, frames and draws as of the first beat of each 5 s window this load, to show a rate. */
  beats: { at: number; ticks: number; frames: number; draws: number }[];
  events: string[];
  /** The last main-frame navigation: beats from the old load stop then. */
  navigatedAt: number;
  /** When the frame count last moved (test clock), and what it was. */
  framesMovedAt: number;
  frames: number;
  /** Stall kinds reported on the current load, and reports so far. */
  reported: Set<string>;
  stalls: number;
}

const watched = new Map<Page, Watch>();

/** Starts the heartbeat on the page's context (from its next load) and listens to it. */
export async function watchHeartbeat(page: Page): Promise<void> {
  await page.context().addInitScript(
    ({ prefix, every, url }) => {
      // The top frame only: a frame inside would beat with its own load and clock.
      if (window !== window.top) return;
      const now = () => performance.now();
      const beat = {
        load: Math.round(performance.timeOrigin),
        ticks: 0,
        frames: 0,
        tickAt: 0,
        frameAt: 0,
        maxTickGap: 0,
        maxFrameGap: 0,
        framePendingSince: 0,
        draws: -1,
        idle: null as boolean | null,
      };
      (window as unknown as { __hpBeat: typeof beat }).__hpBeat = beat;
      // One frame at a time, asked for on a tick, so the page isn't kept drawing
      // every vsync (CI renders in software) just for the heartbeat.
      const askFrame = () => {
        if (beat.framePendingSince > 0) return;
        beat.framePendingSince = now();
        requestAnimationFrame(() => {
          const t = now();
          if (beat.frames > 0) beat.maxFrameGap = Math.max(beat.maxFrameGap, t - beat.frameAt);
          beat.frames++;
          beat.frameAt = t;
          beat.framePendingSince = 0;
        });
      };
      let logged = 0;
      setInterval(() => {
        const t = now();
        if (beat.ticks > 0) beat.maxTickGap = Math.max(beat.maxTickGap, t - beat.tickAt);
        beat.ticks++;
        beat.tickAt = t;
        const hook = (
          window as unknown as {
            __heartpatch?: { draws?: () => number; idle?: () => boolean };
          }
        ).__heartpatch;
        beat.draws = hook?.draws?.() ?? -1;
        beat.idle = hook?.idle?.() ?? null;
        askFrame();
        if (t - logged >= 1_000) {
          logged = t;
          const line = JSON.stringify(beat);
          console.debug(prefix, line);
          void fetch(`${url}?${prefix}=${encodeURIComponent(line)}`, { cache: 'no-store' }).catch(
            () => undefined,
          );
        }
      }, every);
    },
    { prefix: BEAT, every: BEAT_MS, url: BEAT_URL },
  );

  const started = Date.now();
  const watch: Watch = {
    started,
    last: { request: null, console: null },
    beats: [],
    events: [],
    navigatedAt: started,
    framesMovedAt: started,
    frames: -1,
    reported: new Set(),
    stalls: 0,
  };
  watched.set(page, watch);
  startWatchdog(page, watch, test.info());
  const since = () => `${((Date.now() - watch.started) / 1000).toFixed(1)}s`;
  const note = (event: string) => {
    watch.events.push(`${since()} ${event}`);
    if (watch.events.length > EVENTS_KEPT) watch.events.shift();
  };
  const onBeat = (channel: Channel, json: string) => {
    let beat: PageBeat;
    try {
      beat = JSON.parse(json) as PageBeat;
    } catch {
      return; // Not a beat after all.
    }
    const at = Date.now();
    if (watch.last[channel]?.beat.load !== beat.load) {
      note(`first ${channel} beat of load ${String(beat.load)}`);
    }
    const newLoad = watch.last[channel]?.beat.load !== beat.load;
    watch.last[channel] = { at, beat };
    if (channel !== 'request') return;
    // Counts start again on each load: a rate across a reload means nothing.
    if (newLoad) watch.beats = [];
    if (beat.frames !== watch.frames) {
      watch.frames = beat.frames;
      watch.framesMovedAt = at;
    }
    const last = watch.beats.at(-1);
    if (!last || at - last.at >= 5_000) {
      watch.beats.push({ at, ticks: beat.ticks, frames: beat.frames, draws: beat.draws });
      if (watch.beats.length > 4) watch.beats.shift();
    }
  };
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith(`${BEAT} `)) onBeat('console', text.slice(BEAT.length + 1));
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    const json = url.pathname === BEAT_URL ? url.searchParams.get(BEAT) : null;
    if (json !== null) onBeat('request', json);
  });
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    note('navigated');
    watch.navigatedAt = Date.now();
    watch.framesMovedAt = watch.navigatedAt;
    watch.reported.clear();
  });
  page.on('domcontentloaded', () => {
    note('domcontentloaded');
  });
  page.on('load', () => {
    note('load');
  });
  page.on('crash', () => {
    note('CRASH');
  });
  page.on('close', () => {
    note('close');
    watched.delete(page);
  });
  page.on('pageerror', (error) => {
    note(`pageerror ${error.message.slice(0, 120)}`);
  });
  page.on('websocket', (ws: WebSocket) => {
    const name = new URL(ws.url()).pathname || '/';
    note(`ws open ${name}`);
    ws.on('close', () => {
      note(`ws close ${name}`);
    });
    ws.on('socketerror', (error) => {
      note(`ws error ${name} ${error.slice(0, 80)}`);
    });
  });
}

/** What `work` gave or threw, or `fallback` once `ms` pass without either (the work is left to run). */
async function within<T>(work: Promise<T>, ms: number, fallback: string): Promise<T | string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the test side knows about the page now, plus two 3 s probes into it. */
async function snapshot(page: Page, watch: Watch): Promise<Record<string, unknown>> {
  // The test side first: beats that arrive during the probes would make ages negative.
  const now = Date.now();
  const age = (last: { at: number } | null) => (last ? +((now - last.at) / 1000).toFixed(1) : null);
  const rates = watch.beats.slice(1).map((b, i) => {
    const a = watch.beats[i];
    if (!a) return null;
    const s = (b.at - a.at) / 1000;
    return {
      ticksPerS: +((b.ticks - a.ticks) / s).toFixed(1),
      framesPerS: +((b.frames - a.frames) / s).toFixed(2),
      drawsPerS: +((b.draws - a.draws) / s).toFixed(2),
    };
  });
  const seen = {
    // On the events' clock (seconds since the heartbeat was set up).
    reportedAtS: +((now - watch.started) / 1000).toFixed(1),
    requestBeatAgeS: age(watch.last.request),
    consoleBeatAgeS: age(watch.last.console),
    framesStillS: +((now - watch.framesMovedAt) / 1000).toFixed(1),
    lastBeat: watch.last.request?.beat ?? watch.last.console?.beat ?? null,
    rates,
    events: [...watch.events],
  };
  const evaluate = page.isClosed()
    ? 'closed'
    : await within(
        page.evaluate(() => {
          const w = window as unknown as { __hpBeat?: PageBeat };
          return {
            beat: w.__hpBeat ?? null,
            now: Math.round(performance.now()),
            visibility: document.visibilityState,
            readyState: document.readyState,
          };
        }),
        PROBE_MS,
        'no answer in 3 s',
      );
  const locator = page.isClosed()
    ? 'closed'
    : await within(page.locator('body').count(), PROBE_MS, 'no answer in 3 s');
  return { ...seen, evaluate, locatorCount: locator };
}

/**
 * Every 2 s while the test that opened the page runs: a beat channel quiet for
 * 20 s since the last navigation, or frames standing still for 20 s while
 * request beats come, adds one `heartbeat-stall` annotation (once per kind a
 * load, at most 2 a page). spec-timing-reporter.ts prints them for tries that
 * didn't pass.
 */
function startWatchdog(page: Page, watch: Watch, testInfo: TestInfo): void {
  let probing = false;
  const timer = setInterval(() => {
    let current: TestInfo | null = null;
    try {
      current = test.info();
    } catch {
      // No test running in this worker.
    }
    if (current !== testInfo || page.isClosed() || watch.stalls >= STALLS_KEPT) {
      clearInterval(timer);
      return;
    }
    if (probing) return;
    const now = Date.now();
    const quiet = (channel: Channel) =>
      now - Math.max(watch.last[channel]?.at ?? 0, watch.navigatedAt) >= STALL_MS;
    const kind = quiet('request')
      ? 'request beat quiet'
      : quiet('console')
        ? 'console beat quiet'
        : now - watch.framesMovedAt >= STALL_MS
          ? 'frames stopped'
          : null;
    if (kind === null || watch.reported.has(kind)) return;
    watch.reported.add(kind);
    watch.stalls++;
    probing = true;
    void snapshot(page, watch)
      .then((report) => {
        testInfo.annotations.push({
          type: 'heartbeat-stall',
          description: JSON.stringify({ kind, ...report }),
        });
      })
      .finally(() => {
        probing = false;
      });
  }, WATCHDOG_MS);
}

/**
 * On a failed test, one `heartbeat` annotation per watched page: how old the
 * last request and console beats are, the last beat, ticks and frames per second
 * over the last windows (from request beats), the page's events, and whether a
 * main-world `evaluate` and a locator query (Playwright's utility world) still
 * answer within 3 s.
 *
 * - request beat fresh, frames ~0, probes answer: only rendering stopped.
 * - request beat fresh, console beat stale or probes silent: the page runs, and
 *   Playwright lost its execution context.
 * - request beat stale, probes silent: the main thread is blocked, or the page is
 *   gone (CRASH in the events) or Playwright lost its whole page session (a
 *   process swap on navigation): then navigation and load events stop too.
 */
export async function reportHeartbeats(testInfo: TestInfo): Promise<void> {
  const pages = [...watched];
  watched.clear();
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const [page, watch] of pages) {
    const report = await snapshot(page, watch);
    testInfo.annotations.push({ type: 'heartbeat', description: JSON.stringify(report) });
  }
}
