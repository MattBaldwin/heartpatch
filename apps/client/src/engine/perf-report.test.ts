import { PerfReportSchema } from '@heartpatch/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DECISIONS_KEPT,
  DecisionLog,
  FRAME_WINDOW,
  FrameWindow,
  formatReportStatus,
} from './perf-report.js';
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
});
