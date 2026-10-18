import { expect, test } from '@playwright/test';
import { draws } from './dev-hook.js';
import { newPlayer, uniqueName } from './players.js';

// The on-device perf report (#501 PR A): drawn frames under 10 fps for 5 s
// post one row to the server, at most once a minute, and the badge says so.
// `?slow=1` (dev builds only) pads every frame to 150 ms and keeps drawing,
// so headless browsers get there on any machine.

/** Drawn frames to watch after the report, for a second one that mustn't come (~10 s at 6 fps). */
const MORE_FRAMES = 60;

test('a slow device sends exactly one perf report, and the badge shows it', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('perf'));
  const posted: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/perf/report')) {
      posted.push(request.postDataJSON());
    }
  });
  const answer = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/api/v1/perf/report'),
    { timeout: 90_000 },
  );
  await page.goto('/?slow=1');
  expect((await answer).status()).toBe(204);

  const report = posted[0] as {
    fps: number;
    slowMs: number;
    frames: { gapMs: { avg: number }; renderMs: { avg: number } };
    gpu: { lastMs: number } | null;
    governor: { tier: string };
    badge: string[];
    flags: string[];
    visibility: string;
  };
  expect(report.fps).toBeLessThan(10);
  expect(report.slowMs).toBeGreaterThanOrEqual(5000);
  // The padding is outside scene.render: a gap the render time doesn't explain.
  expect(report.frames.gapMs.avg).toBeGreaterThan(report.frames.renderMs.avg);
  if (browser.browserType().name() === 'chromium') {
    // The fences work (software GL: no saying how long the GPU takes).
    expect(report.gpu).not.toBeNull();
  }
  expect(report.flags).toContain('slow');
  expect(report.visibility).toBe('visible');
  expect(report.badge).toHaveLength(3);
  await expect(page.getByTestId('dev-stats-report')).toContainText('report · sent');

  // Still slow, but within the minute: no second report.
  const after = await draws(page);
  await expect
    .poll(() => draws(page), { timeout: 90_000, intervals: [500] })
    .toBeGreaterThanOrEqual(after + MORE_FRAMES);
  expect(posted).toHaveLength(1);
  await page.context().close();
});
