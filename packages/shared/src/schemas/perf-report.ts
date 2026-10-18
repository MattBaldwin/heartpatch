import { z } from 'zod';

// The on-device perf report (#501 PR A): one row a client posts when its
// drawn frames stay under 10 fps for 5 s, at most once a minute, or (#501 G)
// after one drawn frame over 100 ms among quick ones, also at most once a
// minute, with what the governor did next. The server
// only logs it (`perf-report`), with the session's user id. Every field is a
// number, a short label or a badge line of counts: no names, no free text.

/** Longest duration a report carries, in ms (the client clamps to it: a page left open for weeks). */
export const PERF_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** A duration in ms: never negative, at most `PERF_MAX_MS`. */
const Ms = z.number().min(0).max(PERF_MAX_MS);
/** Frames per second. */
const Fps = z.number().min(0).max(1000);
const Count = z.int().min(0).max(1_000_000_000);
const Tier = z.enum(['high', 'medium', 'low']);
/** Longest badge line a report carries. */
export const PERF_BADGE_LINE_MAX = 400;
/** A character a badge line may not hold (anything but counts, sizes and labels). */
const NOT_BADGE = /[^\w .,:;/+×·()%-]/gu;
/** A badge line (`dev-overlay.ts`): counts, sizes and labels, one line, no markup. */
const BadgeLine = z
  .string()
  .max(PERF_BADGE_LINE_MAX)
  .regex(/^[\w .,:;/+×·()%-]*$/u);

/** A badge line as a report may carry it: cut to length, any other character as `_`. */
export function cleanBadgeLine(line: string): string {
  return line.slice(0, PERF_BADGE_LINE_MAX).replace(NOT_BADGE, '_');
}
/** A bisect flag as the address spells it (`nopost`, `cap30`), or `slow`. */
const Flag = z.string().regex(/^[a-z0-9]{1,16}$/);

/** Mean and worst over a window. */
const Spread = z.strictObject({ avg: Ms, max: Ms });

/** A change of tier or render scale the governor made. */
export const PerfDecisionSchema = z.strictObject({
  /** When, in ms since the page loaded. */
  atMs: Ms,
  tier: Tier,
  renderScale: z.number().min(0).max(1),
  /** Drawn fps over the recent frames when it decided, or null with none yet. */
  fps: Fps.nullable(),
});
export type PerfDecision = z.infer<typeof PerfDecisionSchema>;

/** The governor's tier and render scale at a moment. */
const GovernorChoice = z.strictObject({ tier: Tier, renderScale: z.number().min(0).max(1) });

/** One drawn frame over 100 ms among quick ones (#501 G) and the governor's choice after it. */
export const PerfHitchSchema = z.strictObject({
  /** The frame's length: the gap since the drawn frame before it. */
  frameMs: Ms,
  /** Our `scene.render` in that frame. */
  renderMs: Ms,
  /** How long after it `after` was read; the frames in between averaged under 100 ms. */
  followMs: Ms,
  before: GovernorChoice,
  after: GovernorChoice,
});
export type PerfHitch = z.infer<typeof PerfHitchSchema>;

/** `POST /api/v1/perf/report` (logged-in members; 204). */
export const PerfReportSchema = z.strictObject({
  /** Drawn fps over the slow run that fired the report. */
  fps: Fps,
  /** How long that run lasted. */
  slowMs: Ms,
  /** The last drawn frames: the gap between frames vs our `scene.render` time. */
  frames: z.strictObject({ count: Count, gapMs: Spread, renderMs: Spread }),
  /** GPU latency from WebGL2 fences, or null without them (WebGPU, WebGL1, none passed yet). */
  gpu: z
    .strictObject({
      lastMs: Ms,
      avgMs: Ms,
      maxMs: Ms,
      /** Fences queued and not yet passed. */
      pending: Count,
      /** Fences passed since the scene opened. */
      passed: Count,
    })
    .nullable(),
  /** The resolution governor's state and its last decisions, oldest first. */
  governor: z.strictObject({
    tier: Tier,
    pinned: z.boolean(),
    renderScale: z.number().min(0).max(1),
    pixelRatio: z.number().min(0).max(8),
    decisions: z.array(PerfDecisionSchema).max(10),
  }),
  /** The `?fps=1` badge's lines; empty if they couldn't be read. */
  badge: z.array(BadgeLine).max(4),
  /** How long the badge counts have run (GL objects made and freed count from then). */
  badgeCountingMs: Ms,
  sincePageLoadMs: Ms,
  sinceSceneOpenMs: Ms,
  visibility: z.enum(['visible', 'hidden']),
  flags: z.array(Flag).max(16),
  renderer: z.enum(['webgpu', 'webgl2', 'webgl1']),
  /** A hitch report (#501 G): `fps` is then the recent frames', and `slowMs` 0. */
  hitch: PerfHitchSchema.optional(),
});
export type PerfReport = z.infer<typeof PerfReportSchema>;

/** Largest report body the server reads, in bytes (a real one is about 1.5 KB). */
export const PERF_REPORT_MAX_BYTES = 8 * 1024;
