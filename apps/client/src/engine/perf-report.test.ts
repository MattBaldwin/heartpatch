import { PerfReportSchema } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECISIONS_KEPT,
  DecisionLog,
  FRAME_WINDOW,
  FrameWindow,
  formatReportStatus,
  HITCH_FOLLOW_MS,
  HitchWatch,
} from './perf-report.js';
import { REPORT_EVERY_MS } from './slow-trigger.js';
import type { QualitySnapshot } from './quality/render-quality.js';

describe('FrameWindow', () => {
  it('splits the frame gap from our render time, over the last frames only', () => {
    const window = new FrameWindow();
    expect(window.fps).toBeNull();
    window.push(null, 3); // the first after idle has no gap
    for (let i = 0; i < FRAME_WINDOW; i++) window.push(1000, 1);
    expect(window.split).toEqual({
      count: FRAME_WINDOW,
      gapMs: { avg: 1000, max: 1000 },
      renderMs: { avg: 1, max: 1 },
    });
    expect(window.fps).toBe(1);
  });
});

describe('DecisionLog', () => {
  const at = (tier: QualitySnapshot['tier'], renderScale: number) => ({ tier, renderScale });

  it('logs only changes, not the starting state or repeats', () => {
    const log = new DecisionLog();
    log.note(0, at('high', 1), null);
    log.note(10, at('high', 1), 40);
    log.note(20, at('high', 0.85), 41.234);
    log.note(30, at('medium', 0.85), 20);
    expect(log.entries).toEqual([
      { atMs: 20, tier: 'high', renderScale: 0.85, fps: 41.23 },
      { atMs: 30, tier: 'medium', renderScale: 0.85, fps: 20 },
    ]);
  });

  it(`keeps the last ${String(DECISIONS_KEPT)}`, () => {
    const log = new DecisionLog();
    log.note(0, at('high', 1), null);
    for (let i = 1; i <= 15; i++) log.note(i, at('high', 1 - i / 100), null);
    expect(log.entries).toHaveLength(DECISIONS_KEPT);
    expect(log.entries[0]!.atMs).toBe(6);
  });

  it("doesn't log a new stage's starting state as a decision", () => {
    const log = new DecisionLog();
    log.note(0, at('high', 1), null);
    log.remount();
    log.note(5, at('low', 0.5), null);
    expect(log.entries).toEqual([]);
  });
});

describe('HitchWatch (#501 G)', () => {
  const high = () => ({ tier: 'high' as const, renderScale: 1 });
  /** Drawn frames at 30 fps from `from` for `ms`; returns the last hitch reported, if any. */
  function calm(
    watch: HitchWatch,
    from: number,
    ms: number,
    lastPostAt: number | null = null,
    governor = high,
  ) {
    let found = null;
    for (let t = from + 33; t <= from + ms; t += 33) {
      found = watch.frame(t, 33, 2, governor, lastPostAt) ?? found;
    }
    return found;
  }

  it('reports one frame over 100 ms among quick ones, with the governor choice after it', () => {
    const watch = new HitchWatch();
    expect(calm(watch, 0, 1000)).toBeNull();
    expect(watch.frame(1200, 200, 140, high, null)).toBeNull();
    const cut = () => ({ tier: 'high' as const, renderScale: 0.9 });
    const hitch = calm(watch, 1200, HITCH_FOLLOW_MS + 100, null, cut);
    expect(hitch).toMatchObject({
      frameMs: 200,
      renderMs: 140,
      before: { tier: 'high', renderScale: 1 },
      after: { tier: 'high', renderScale: 0.9 },
    });
    expect(hitch!.followMs).toBeGreaterThanOrEqual(HITCH_FOLLOW_MS);
  });

  it('leaves a slow run to the slow report', () => {
    const slow = new HitchWatch();
    let found = null;
    for (let t = 150; t < 5000; t += 150) found = slow.frame(t, 150, 1, high, null) ?? found;
    expect(found).toBeNull();
  });

  it('waits a minute after any report, and yields to one posted during its follow-up', () => {
    const watch = new HitchWatch();
    // A report 10 s ago (a slow run's, or the last hitch): no hitch yet.
    watch.frame(10_000, 200, 1, high, 0);
    expect(calm(watch, 10_000, 2000, 0)).toBeNull();
    // A minute on, it reports.
    watch.frame(REPORT_EVERY_MS + 1000, 200, 1, high, 0);
    expect(calm(watch, REPORT_EVERY_MS + 1000, 2000, 0)).not.toBeNull();
    // A slow report lands while a hitch waits on its follow-up: the slow one goes alone.
    const at = 3 * REPORT_EVERY_MS;
    watch.frame(at, 200, 1, high, null);
    expect(calm(watch, at, 2000, at + 500)).toBeNull();
  });
});

describe('formatReportStatus', () => {
  it('reads none, then the last report', () => {
    expect(formatReportStatus(null, 0)).toBe('report · none');
    expect(formatReportStatus({ at: 1000, fps: 3.14, gpuMs: 812.4, result: 'sent' }, 43_000)).toBe(
      'report · sent 42 s ago · 3.1 fps · gpu 812 ms',
    );
    expect(formatReportStatus({ at: 0, fps: 1, gpuMs: null, result: 'logged out' }, 0)).toBe(
      'report · logged out 0 s ago · 1.0 fps · gpu n/a',
    );
  });
});

describe('PerfProbe', () => {
  const quality = {
    snapshot: {
      tier: 'medium',
      pinned: false,
      renderScale: 0.75,
      pixelRatio: 1.5,
    } as QualitySnapshot,
  };
  let fetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('document', { visibilityState: 'visible' });
    fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts one valid report after 5 s under 10 fps, and none again within the minute', async () => {
    const { PerfProbe, lastReport } = await import('./perf-report.js');
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000); // the scene opens
    const probe = new PerfProbe({}, 'webgl2', quality, () => null);
    let now = 1000;
    probe.frame(now, null, 2);
    for (let i = 0; i < 100; i++) {
      now += 250; // 4 fps
      probe.frame(now, 250, 1.5);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/perf/report');
    expect(init.method).toBe('POST');
    const report = PerfReportSchema.parse(JSON.parse(init.body as string));
    expect(report).toMatchObject({
      fps: 4,
      slowMs: 5000,
      frames: { gapMs: { avg: 250, max: 250 }, renderMs: { max: 2 } },
      gpu: null, // no WebGL2 context here
      governor: { tier: 'medium', renderScale: 0.75, pixelRatio: 1.5, decisions: [] },
      badge: [],
      sincePageLoadMs: 6000,
      sinceSceneOpenMs: 5000,
      visibility: 'visible',
      flags: [],
      renderer: 'webgl2',
    });
    await vi.waitFor(() => {
      expect(lastReport()?.result).toBe('sent');
    });
  });

  it('carries the governor decisions it saw', async () => {
    const { PerfProbe } = await import('./perf-report.js');
    const live = { snapshot: { ...quality.snapshot } };
    const probe = new PerfProbe({}, 'webgl2', live, () => null);
    let now = 0;
    for (let i = 0; i < 30; i++) {
      now += 200;
      probe.frame(now, 200, 1);
      if (i === 10) {
        live.snapshot = { ...live.snapshot, renderScale: 0.6 };
        probe.decided(now);
      }
    }
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const report = PerfReportSchema.parse(JSON.parse(init.body as string));
    expect(report.governor.decisions).toEqual([
      { atMs: 2200, tier: 'medium', renderScale: 0.6, fps: 5 },
    ]);
  });

  it('posts a hitch row (and leaves the badge on the last slow run)', async () => {
    const { PerfProbe, lastReport } = await import('./perf-report.js');
    const probe = new PerfProbe({}, 'webgl2', quality, () => null);
    let now = 0;
    probe.frame(now, null, 2);
    const step = (ms: number, render = 2) => {
      now += ms;
      probe.frame(now, ms, render);
    };
    for (let i = 0; i < 30; i++) step(33);
    step(220, 180);
    for (let i = 0; i < 60; i++) step(33);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const report = PerfReportSchema.parse(JSON.parse(init.body as string));
    expect(report.slowMs).toBe(0);
    expect(report.fps).toBeGreaterThan(20);
    expect(report.hitch).toMatchObject({
      frameMs: 220,
      renderMs: 180,
      before: { tier: 'medium', renderScale: 0.75 },
      after: { tier: 'medium', renderScale: 0.75 },
    });
    expect(lastReport()).toBeNull();
  });

  it('posts no hitch within a minute of a slow report (the server allows two a minute)', async () => {
    const { PerfProbe } = await import('./perf-report.js');
    const probe = new PerfProbe({}, 'webgl2', quality, () => null);
    let now = 0;
    probe.frame(now, null, 2);
    const step = (ms: number) => {
      now += ms;
      probe.frame(now, ms, 1);
    };
    for (let i = 0; i < 30; i++) step(250); // a slow run: one report
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    for (let i = 0; i < 60; i++) step(33);
    step(220);
    for (let i = 0; i < 60; i++) step(33);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
