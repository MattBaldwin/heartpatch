import { CELLAR_CHESTS } from './hollowed-config.js';

// The cellar chests' moments (#306), as pure maths so they're unit-tested:
// a lid's angle over time and a sparkle's place. `CellarChests` draws them.

type ChestSize = 'small' | 'big';

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** An ease that overshoots a little and settles: the lid pops. */
export function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = clamp01(t) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/**
 * A lid's angle `ms` after its chest was opened (0: shut, `open`: back on its
 * hinge). The big chest wobbles shut first, then swings slower. Before the
 * moment (negative `ms`) it's shut; long after, it rests open.
 */
export function lidAngle(size: ChestSize, ms: number): number {
  if (size === 'small') {
    const { open, openMs } = CELLAR_CHESTS.small;
    return ms <= 0 ? 0 : open * easeOutBack(ms / openMs);
  }
  const { open, openMs, wobbleMs, wobble } = CELLAR_CHESTS.big;
  if (ms <= 0) return 0;
  if (ms < wobbleMs) {
    // A rattle that grows: the lid lifts a crack and drops, faster and faster.
    const k = ms / wobbleMs;
    return Math.abs(Math.sin(k * Math.PI * 6)) * wobble * k;
  }
  return open * easeOutBack((ms - wobbleMs) / openMs);
}

/** How long a chest's whole moment takes, ms (after it, nothing moves). */
export function momentMs(size: ChestSize): number {
  const c = CELLAR_CHESTS[size];
  const lid = size === 'big' ? CELLAR_CHESTS.big.wobbleMs + c.openMs : c.openMs;
  const beam = size === 'big' ? CELLAR_CHESTS.big.wobbleMs + CELLAR_CHESTS.big.beam.ms : 0;
  return Math.max(lid, sparkStart(size) + c.sparkMs, beam);
}

/** When the sparkles burst, ms after the chest was opened (as the lid flies up). */
export function sparkStart(size: ChestSize): number {
  return size === 'big' ? CELLAR_CHESTS.big.wobbleMs + 120 : 60;
}

/**
 * Sparkle `i`'s offset from the chest's mouth and size at `t` (0–1 of its
 * burst): a fountain up and out, falling back a little, twinkling out.
 */
export function chestSparkAt(
  size: ChestSize,
  i: number,
  t: number,
  out: { dx: number; dy: number; dz: number; s: number; a: number },
): void {
  const { sparks, rise, spread, size: big } = CELLAR_CHESTS[size];
  const a = (i / sparks) * Math.PI * 2 + 0.4;
  const r = 0.3 + (0.7 * ((i * 7) % 5)) / 5;
  const lift = 0.55 + (0.45 * ((i * 3) % 4)) / 4;
  out.a = a;
  out.dx = Math.cos(a) * r * t * spread;
  // Mostly up and towards the camera, so the fountain shows over the chest.
  out.dz = Math.sin(a) * r * t * spread * 0.6 - t * 0.4;
  out.dy = rise * lift * (t * (2 - t)) - 0.6 * t * t;
  out.s = big * (0.6 + (0.4 * ((i * 5) % 3)) / 3) * Math.sin(Math.PI * clamp01(t * 1.15 + 0.08));
}

/** The big chest's beam at `ms` after opening: its height share (grows) and how bright (fades). */
export function beamAt(ms: number): { grow: number; alpha: number } {
  const { wobbleMs, beam } = CELLAR_CHESTS.big;
  const t = (ms - wobbleMs) / beam.ms;
  if (t <= 0 || t >= 1) return { grow: 0, alpha: 0 };
  return { grow: easeOutBack(Math.min(1, t * 3)), alpha: Math.sin(Math.PI * t) };
}
