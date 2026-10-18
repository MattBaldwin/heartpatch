import { describe, expect, it } from 'vitest';
import { LANTERN_DARK, placeDark } from './lantern-dark.js';

const phone = { width: 390, height: 844 };

describe('placeDark (#501 G)', () => {
  it('paints once, then only moves the layer as the light walks', () => {
    const first = placeDark(null, { x: 200, y: 500, r: 120 }, phone);
    expect(first.repaint).toBe(true);
    expect(first.paint).toEqual({
      width: Math.round(phone.width * LANTERN_DARK.cover),
      height: Math.round(phone.height * LANTERN_DARK.cover),
      radius: 120,
    });
    const walked = placeDark(first.paint, { x: 230, y: 470, r: 126 }, phone);
    expect(walked.repaint).toBe(false);
    expect(walked.paint).toBe(first.paint);
    expect(walked.transform).not.toBe(first.transform);
    // The layer's centre sits on the light.
    const w = first.paint.width;
    const h = first.paint.height;
    expect(walked.transform).toBe(
      `translate3d(${String(Math.round(230 - w / 2))}px, ${String(Math.round(470 - h / 2))}px, 0) scale(1.05)`,
    );
  });

  it('repaints when the radius drifts past redrawAt, or the screen changes', () => {
    const first = placeDark(null, { x: 0, y: 0, r: 100 }, phone);
    const r = 100 * (1 + LANTERN_DARK.redrawAt) + 1;
    expect(placeDark(first.paint, { x: 0, y: 0, r }, phone).repaint).toBe(true);
    expect(placeDark(first.paint, { x: 0, y: 0, r: 80 }, phone).repaint).toBe(true);
    const turned = { width: phone.height, height: phone.width };
    expect(placeDark(first.paint, { x: 0, y: 0, r: 100 }, turned).repaint).toBe(true);
  });

  it('covers the screen with the light anywhere on it, at the smallest scale', () => {
    const first = placeDark(null, { x: 0, y: 0, r: 100 }, phone);
    const scale = 1 / (1 + LANTERN_DARK.redrawAt);
    const halfW = (first.paint.width / 2) * scale;
    const halfH = (first.paint.height / 2) * scale;
    // From a corner, the far corner is a whole screen away on each axis.
    expect(halfW).toBeGreaterThanOrEqual(phone.width);
    expect(halfH).toBeGreaterThanOrEqual(phone.height);
  });
});
