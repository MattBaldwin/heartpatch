/** Highest device pixel ratio we render at (CLAUDE.md rule 8). */
export const MAX_DPR = 2;

/**
 * Babylon's hardware scaling level for a device pixel ratio. A level of 0.5
 * renders at 2x CSS pixels, so the canvas is sharp on Retina screens without
 * paying for 3x on the newest iPhones.
 */
export function hardwareScalingFor(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return 1 / Math.min(dpr, MAX_DPR);
}
