import { describe, expect, it } from 'vitest';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS, TapDetector } from './tap-detector.js';

function setup() {
  const taps: [number, number][] = [];
  const detector = new TapDetector((x, y) => taps.push([x, y]));
  return { taps, detector };
}

describe('TapDetector', () => {
  it('reports a quick, still press where it started', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 100, y: 200, t: 0 });
    detector.pointerMove({ id: 1, x: 103, y: 198, t: 50 });
    detector.pointerUp({ id: 1, x: 104, y: 199, t: 120 });
    expect(taps).toEqual([[100, 200]]);
  });

  it('ignores a drag (that pans the camera)', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 100, y: 200, t: 0 });
    detector.pointerMove({ id: 1, x: 100 + TAP_MAX_MOVE_PX + 1, y: 200, t: 30 });
    detector.pointerMove({ id: 1, x: 100, y: 200, t: 60 });
    detector.pointerUp({ id: 1, x: 100, y: 200, t: 90 });
    expect(taps).toEqual([]);
  });

  it('ignores a long press', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 10, y: 10, t: 0 });
    detector.pointerUp({ id: 1, x: 10, y: 10, t: TAP_MAX_MS + 1 });
    expect(taps).toEqual([]);
  });

  it('ignores both fingers of a pinch', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 10, y: 10, t: 0 });
    detector.pointerDown({ id: 2, x: 80, y: 80, t: 10 });
    detector.pointerUp({ id: 2, x: 80, y: 80, t: 60 });
    detector.pointerUp({ id: 1, x: 10, y: 10, t: 70 });
    expect(taps).toEqual([]);
  });

  it('ignores a still finger whose pinch partner started on a map button', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 10, y: 10, t: 0 });
    // Finger 2 pressed a tray handle; the camera handed it to the canvas.
    detector.pointerMove({ id: 2, x: 120, y: 80, t: 30 });
    detector.pointerUp({ id: 2, x: 140, y: 80, t: 60 });
    detector.pointerUp({ id: 1, x: 10, y: 10, t: 90 });
    expect(taps).toEqual([]);
  });

  it('forgets a cancelled press', () => {
    const { taps, detector } = setup();
    detector.pointerDown({ id: 1, x: 10, y: 10, t: 0 });
    detector.pointerCancel({ id: 1, x: 10, y: 10, t: 20 });
    detector.pointerUp({ id: 1, x: 10, y: 10, t: 30 });
    detector.pointerDown({ id: 3, x: 5, y: 5, t: 100 });
    detector.pointerUp({ id: 3, x: 5, y: 5, t: 150 });
    expect(taps).toEqual([[5, 5]]);
  });
});
