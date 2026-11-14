import { execFileSync } from 'node:child_process';
import { availableParallelism, loadavg } from 'node:os';
import { test, type Page, type TestInfo, type WebSocket } from '@playwright/test';

// A diagnostic for #784: on CI's WebKit a page sometimes crawls (taps wait
// minutes for "stable"), after a reload or not (recipe-book never reloads).
// Found so far: its main thread is starved (timer ticks at a third to a half
// of their rate) while the game itself is idle (a few draws a load), so it
// isn't our render loop. Is the page busy with itself (CSS animations painted
// in software) or waiting for a core on a loaded runner? Every page
// newPlayer opens keeps a heartbeat. A watchdog adds a `heartbeat-stall`
// annotation the moment a beat goes quiet or frames stop, and a spec's
// afterEach can add a `heartbeat` one on a failed test (`reportHeartbeats`).
// spec-timing-reporter.ts prints both as check-run warnings.
//
// - In the page (an init script, so from the first line of every load): a
//   250 ms `setInterval` counts ticks (it only runs while the main thread is
//   free) and asks for one animation frame at a time (frames: it only runs while
//   rendering does), with the longest gap each has seen.
// - Every second the page logs both counts as a console line, with the game's
//   own draws (dev hook), whether its stage is idle, and how many CSS
//   animations are running (WebKit paints those on CI's software renderer).
//   There used to be a second channel, a `fetch` of the favicon each second,
//   in case Playwright lost the page's execution context. In every CI report
//   the console beat stayed current, and a beat fetch that a reload cut off
//   reached specs as a WebKit page error ("…favicon.svg?hp-beat=… due to
//   access control checks."), failing wardrobe.spec. So only the console beats.
// - Test side: the runner's load average with each report, to tell a page
//   starved by the machine from one busy with itself.
// - Test side: the page's load, navigation, crash, page-error and websocket
//   events (Vite's HMR socket), timestamped, for a reload racing something.

/** The console line's prefix, so nothing else is mistaken for a beat. */
const BEAT = 'hp-beat';
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
  /** CSS animations and transitions running on the page now. */
  anims: number;
}

interface Watch {
  /** The test that opened the page: only its own report shows the page. */
  testInfo: TestInfo;
  started: number;
  /** The last beat: when it arrived (test clock) and what it said. */
  last: { at: number; beat: PageBeat } | null;
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
    ({ prefix, every }) => {
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
        anims: 0,
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
          beat.anims = document.getAnimations().filter((a) => a.playState === 'running').length;
          console.debug(prefix, JSON.stringify(beat));
        }
      }, every);
    },
    { prefix: BEAT, every: BEAT_MS },
  );

  const testInfo = test.info();
  // Pages a spec left open in earlier tests (many never close their contexts)
  // belong to those tests: never report them as this one's.
  for (const [old, w] of watched) if (w.testInfo !== testInfo) watched.delete(old);
  const started = Date.now();
  const watch: Watch = {
    testInfo,
    started,
    last: null,
    beats: [],
    events: [],
    navigatedAt: started,
    framesMovedAt: started,
    frames: -1,
    reported: new Set(),
    stalls: 0,
  };
  watched.set(page, watch);
  startWatchdog(page, watch, testInfo);
  const since = () => `${((Date.now() - watch.started) / 1000).toFixed(1)}s`;
  const note = (event: string) => {
    watch.events.push(`${since()} ${event}`);
    if (watch.events.length > EVENTS_KEPT) watch.events.shift();
  };
  const onBeat = (json: string) => {
    let beat: PageBeat;
    try {
      beat = JSON.parse(json) as PageBeat;
    } catch {
      return; // Not a beat after all.
    }
    const at = Date.now();
    const newLoad = watch.last?.beat.load !== beat.load;
    if (newLoad) note(`first beat of load ${String(beat.load)}`);
    watch.last = { at, beat };
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
    if (text.startsWith(`${BEAT} `)) onBeat(text.slice(BEAT.length + 1));
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
  // A page that closed (or crashed) during a failed test is still reported, as closed.
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

/**
 * The machine's threads that are running or waiting for a core right now
 * (what the load average counts), by process name, most first: names what
 * fills a loaded runner. Linux `ps` (procps) only; null elsewhere or without it.
 */
function runnableThreads(): Record<string, number> | null {
  if (process.platform !== 'linux') return null;
  let out: string;
  try {
    out = execFileSync('ps', ['-eLo', 'stat=,comm='], { encoding: 'utf8', timeout: 2_000 });
  } catch {
    return null;
  }
  const count = new Map<string, number>();
  for (const line of out.split('\n')) {
    const [stat = '', ...name] = line.trim().split(/\s+/);
    if (!stat.startsWith('R') && !stat.startsWith('D')) continue;
    const comm = name.join(' ');
    count.set(comm, (count.get(comm) ?? 0) + 1);
  }
  return Object.fromEntries([...count].sort((a, b) => b[1] - a[1]).slice(0, 10));
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
  const [load1 = 0] = loadavg();
  const age = (last: { at: number } | null) => (last ? +((now - last.at) / 1000).toFixed(1) : null);
  const rates = watch.beats.slice(1).map((b, i) => {
    const a = watch.beats[i];
    if (!a) return null;
    const s = (b.at - a.at) / 1000;
    return {
      ticksPerS: +((b.ticks - a.ticks) / s).toFixed(1),
      framesPerS: +((b.frames - a.frames) / s).toFixed(2),
      // The count starts again when the map remounts its stage: no rate across that.
      drawsPerS: b.draws >= a.draws ? +((b.draws - a.draws) / s).toFixed(2) : null,
    };
  });
  const seen = {
    // On the events' clock (seconds since the heartbeat was set up).
    reportedAtS: +((now - watch.started) / 1000).toFixed(1),
    beatAgeS: age(watch.last),
    framesStillS: +((now - watch.framesMovedAt) / 1000).toFixed(1),
    lastBeat: watch.last?.beat ?? null,
    // The runner's 1-minute load average over its cores: above 1, the page waits for a core.
    loadPerCore: +(load1 / availableParallelism()).toFixed(2),
    cores: availableParallelism(),
    runnable: runnableThreads(),
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
 * Every 2 s while the test that opened the page runs: beats quiet for 20 s
 * since the last navigation, or frames standing still for 20 s while beats
 * come, adds one `heartbeat-stall` annotation (once per kind a
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
    const kind =
      now - Math.max(watch.last?.at ?? 0, watch.navigatedAt) >= STALL_MS
        ? 'beat quiet'
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
 * On a failed test, one `heartbeat` annotation per page it opened: how old the
 * last beat is and what it said, ticks, frames and draws per second over the
 * last windows, the runner's load per core, the page's events, and whether a
 * main-world `evaluate` and a locator query (Playwright's utility world) still
 * answer within 3 s.
 *
 * - beat fresh, frames ~0, probes answer: only rendering stopped.
 * - ticks well under 4/s with draws ~0: the page is starved, not by our render
 *   loop. `anims` > 0 points at the page's own CSS animations; `loadPerCore`
 *   above 1 at the runner, and `runnable` names the processes filling it.
 * - beat fresh, probes silent: the page runs, and Playwright lost its context.
 * - beat stale, probes silent: the main thread is blocked, or the page is
 *   gone (CRASH in the events) or Playwright lost its whole page session (a
 *   process swap on navigation): then navigation and load events stop too.
 */
export async function reportHeartbeats(testInfo: TestInfo): Promise<void> {
  const pages = [...watched].filter(([, w]) => w.testInfo === testInfo);
  watched.clear();
  if (testInfo.status === testInfo.expectedStatus) return;
  for (const [page, watch] of pages) {
    const report = await snapshot(page, watch);
    testInfo.annotations.push({ type: 'heartbeat', description: JSON.stringify(report) });
  }
}
