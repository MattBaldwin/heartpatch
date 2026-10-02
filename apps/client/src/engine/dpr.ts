/** Highest device pixel ratio we render at (CLAUDE.md rule 8). */
export const MAX_DPR = 2;

/** The device pixel ratio we actually render at: the real one, capped at 2. */
export function cappedPixelRatio(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, MAX_DPR);
}

/**
 * Babylon's hardware scaling level for a device pixel ratio. A level of 0.5
 * renders at 2x CSS pixels, so the canvas is sharp on Retina screens without
 * paying for 3x on the newest iPhones. `renderScale` (from the dynamic
 * resolution scaler) shrinks that further: 0.75 on a 2x screen gives 1.5x.
 */
export function hardwareScalingFor(devicePixelRatio: number, renderScale = 1): number {
  const scale = Number.isFinite(renderScale) && renderScale > 0 ? Math.min(renderScale, 1) : 1;
  return 1 / (cappedPixelRatio(devicePixelRatio) * scale);
}
