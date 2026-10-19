import { badgeReader } from './badge-lines.js';
import { formatReportStatus, lastReport } from './perf-report.js';
import { formatAmbientStatus } from './render-stats.js';
import type { Stage } from './stage.js';

/**
 * Dev-only stats badge: frame rate, renderer, quality tier, the render pixel
 * ratio the dynamic scaler has picked, and the last frame's draw calls and
 * triangles (#318, for checking a real older iPad). Imported dynamically
 * from main.ts in a dev build, or on the live site with `?fps=1` (#335,
 * `showsStats`), so nobody sees it unless they ask.
 *
 * A second line counts what the scene holds and the WebGL objects made and
 * freed since the badge first saw this engine (a lost context's rebuild
 * starts again from zero) (#501: a frame rate that sinks as a session goes on
 * shows here as a number that keeps climbing), the squishy batch uploads,
 * the governor's render scale, and our JS per drawn frame (a low fps with
 * low JS is the GPU or the browser, not our code).
 *
 * A third line looks page-wide (#501), at work the scene's own counts can't
 * see: live engines, renders per second across all of them, every live
 * render target and its size, canvases, DOM nodes, running CSS animations,
 * and the bisect flags that are on (`bisect-flags.ts`).
 *
 * A fourth line shows the last on-device perf report (#501, `perf-report.ts`):
 * whether it was sent, its frame rate and the GPU's latency. The lines are
 * read by `BadgeReader` (`badge-lines.ts`), which the report shares.
 *
 * While a scene with ambient life is open (`getAmbient`), the second line
 * (it wraps) ends with its mode, and "(slow)" once the judge switched it off
 * (#501 H).
 */
export function mountDevOverlay(
  getStage: () => Stage | null,
  getAmbient: () => { readonly mode: string; readonly slow: boolean } | null = () => null,
): void {
  const badge = document.createElement('div');
  badge.className = 'dev-status dev-stats';
  badge.dataset['testid'] = 'dev-stats';
  badge.textContent = 'renderer: …';
  const counts = document.createElement('div');
  counts.className = 'dev-status dev-stats-counts';
  counts.dataset['testid'] = 'dev-stats-counts';
  const page = document.createElement('div');
  page.className = 'dev-status dev-stats-page';
  page.dataset['testid'] = 'dev-stats-page';
  const stack = document.createElement('div');
  stack.className = 'dev-stats-stack';
  const report = document.createElement('div');
  report.className = 'dev-status dev-stats-report';
  report.dataset['testid'] = 'dev-stats-report';
  stack.append(badge, counts, page, report);
  document.body.append(stack);
  const reader = badgeReader();
  setInterval(() => {
    report.textContent = formatReportStatus(lastReport(), performance.now());
    const stage = getStage();
    if (!stage) return;
    const [first, second, third] = reader.read(stage);
    const ambient = getAmbient();
    badge.textContent = first;
    counts.textContent = ambient ? `${second} · ${formatAmbientStatus(ambient)}` : second;
    page.textContent = third;
  }, 500);
}
