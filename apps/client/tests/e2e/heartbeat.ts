import type { Page, TestInfo, WebSocket } from '@playwright/test';

// A diagnostic for #784: on CI's WebKit a page sometimes stops answering just
// after `page.reload()` (no animation frames, locator queries never return).
// Is its main thread blocked, has only rendering stopped, or has Playwright
// lost the page's execution context? The page keeps a heartbeat, and on a
// failed test `reportHeartbeats` puts what it saw in a `heartbeat` annotation,
// which spec-timing-reporter.ts prints as a check-run warning.
//
// - In the page (an init script, so from the first line of every load): a
//   250 ms `setInterval` counts ticks (it only runs while the main thread is
//   free) and asks for one animation frame at a time (frames: it only runs while
//   rendering does), with the longest gap each has seen.
// - Every second the page logs one console line with both counts. Console
//   messages reach the test over the inspector protocol without Playwright's
//   injected script or execution contexts, so the last line's age says when the
//   page last ran script even when `page.evaluate` can't reach it.
// - Test side: the page's load, navigation, crash, page-error and websocket
//   events (Vite's HMR socket), timestamped, for a reload racing something.

/** The console line's prefix, so nothing else is mistaken for a beat. */
const BEAT = 'hp-beat';
const BEAT_MS = 250;
const EVENTS_KEPT = 30;
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
}

interface Watch {
  started: number;
  /** The last console beat: when it arrived (test clock) and what it said. */
  lastBeat: { at: number; beat: PageBeat } | null;
  /** Ticks and frames as of the first beat of each 5 s window, to show a rate. */
  beats: { at: number; ticks: number; frames: number }[];
  events: string[];
}

const watched = new Map<Page, Watch>();

/** Starts the heartbeat on the page's context (from its next load) and listens to it. */
export async function watchHeartbeat(page: Page): Promise<void> {
  await page.context().addInitScript(
    ({ prefix, every }) => {
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
        askFrame();
        if (t - logged >= 1_000) {
          logged = t;
          console.debug(prefix, JSON.stringify(beat));
        }
      }, every);
    },
    { prefix: BEAT, every: BEAT_MS },
  );

  const watch: Watch = { started: Date.now(), lastBeat: null, beats: [], events: [] };
  watched.set(page, watch);
  const since = () => `${((Date.now() - watch.started) / 1000).toFixed(1)}s`;
  const note = (event: string) => {
    watch.events.push(`${since()} ${event}`);
    if (watch.events.length > EVENTS_KEPT) watch.events.shift();
  };
  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.startsWith(BEAT)) return;
    try {
      const beat = JSON.parse(text.slice(BEAT.length + 1)) as PageBeat;
      const at = Date.now();
      if (watch.lastBeat?.beat.load !== beat.load) note(`first beat of load ${String(beat.load)}`);
      watch.lastBeat = { at, beat };
      const last = watch.beats.at(-1);
      if (!last || at - last.at >= 5_000) {
        watch.beats.push({ at, ticks: beat.ticks, frames: beat.frames });
        if (watch.beats.length > 4) watch.beats.shift();
      }
    } catch {
      // Not a beat after all.
    }
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) note('navigated');
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
function within<T>(work: Promise<T>, ms: number, fallback: string): Promise<T | string> {
  return Promise.race([
    work.catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
    new Promise<string>((resolve) =>
      setTimeout(() => {
        resolve(fallback);
      }, ms),
    ),
  ]);
}

/**
 * On a failed test, one `heartbeat` annotation per watched page: the last beat
 * and how old it is, ticks and frames per second over the last windows, the page's
 * events, and whether a main-world `evaluate` and a locator query (Playwright's
 * utility world) still answer within 3 s.
 */
export async function reportHeartbeats(testInfo: TestInfo): Promise<void> {
  const pages = [...watched];
  watched.clear();
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const [page, watch] of pages) {
    const now = Date.now();
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
      : await within(page.locator('#game').count(), PROBE_MS, 'no answer in 3 s');
    const rates = watch.beats.slice(1).map((b, i) => {
      const a = watch.beats[i];
      if (!a) return null;
      const s = (b.at - a.at) / 1000;
      return {
        ticksPerS: +((b.ticks - a.ticks) / s).toFixed(1),
        framesPerS: +((b.frames - a.frames) / s).toFixed(2),
      };
    });
    const report = {
      // On the events' clock (seconds since the heartbeat was set up).
      reportedAtS: +((now - watch.started) / 1000).toFixed(1),
      lastBeatAgeS: watch.lastBeat ? +((now - watch.lastBeat.at) / 1000).toFixed(1) : null,
      lastBeat: watch.lastBeat?.beat ?? null,
      rates,
      evaluate,
      locatorCount: locator,
      events: watch.events,
    };
    testInfo.annotations.push({ type: 'heartbeat', description: JSON.stringify(report) });
  }
}
