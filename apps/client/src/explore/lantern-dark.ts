/**
 * The lantern's dark (board g) without a repaint per frame (#501 G).
 *
 * A full-screen radial-gradient whose centre moved every animation frame
 * meant a full-screen repaint 60 times a second (at DPR 3 on an iPhone) while
 * the 3D view drew 30. Instead the gradient is painted once on a layer
 * larger than the screen and moved by a composited `transform`: translated
 * so its centre sits on the light, and scaled while the light's radius stays
 * within `redrawAt` of the radius painted. Only a bigger change, or a new
 * screen size, repaints it. Pure, so it's tested without a browser.
 *
 * It covers the screen while the light's centre is on it, which the follow
 * camera keeps true (the light is round the Keeper's feet).
 */

export const LANTERN_DARK = {
  /**
   * The layer is this many screen widths and heights, centred on the light:
   * scaled down to 1 / (1 + `redrawAt`) with the light anywhere on screen,
   * it still covers the screen.
   */
  cover: 2.5, // TUNE
  /** Repaint once the light's radius is this share bigger or smaller than the one painted. */
  redrawAt: 0.15, // TUNE
} as const;

/** What the layer's gradient was painted for, CSS pixels. */
export interface DarkPaint {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

export interface DarkPlacement {
  readonly paint: DarkPaint;
  /** True when `paint` differs from the one passed in: set its size and radius (a repaint). */
  readonly repaint: boolean;
  /** The layer's composited transform (origin at its centre). */
  readonly transform: string;
}

/** Where the layer goes for a light at (`x`, `y`) of radius `r` on a `screen`-sized view. */
export function placeDark(
  painted: DarkPaint | null,
  light: { readonly x: number; readonly y: number; readonly r: number },
  screen: { readonly width: number; readonly height: number },
): DarkPlacement {
  const width = Math.round(screen.width * LANTERN_DARK.cover);
  const height = Math.round(screen.height * LANTERN_DARK.cover);
  const r = Math.max(1, light.r);
  const keep =
    painted !== null &&
    painted.width === width &&
    painted.height === height &&
    r <= painted.radius * (1 + LANTERN_DARK.redrawAt) &&
    r * (1 + LANTERN_DARK.redrawAt) >= painted.radius;
  const paint = keep ? painted : { width, height, radius: Math.round(r) };
  const scale = Math.round((r / paint.radius) * 1000) / 1000;
  const dx = Math.round(light.x - width / 2);
  const dy = Math.round(light.y - height / 2);
  return {
    paint,
    repaint: !keep,
    transform: `translate3d(${String(dx)}px, ${String(dy)}px, 0) scale(${String(scale)})`,
  };
}
