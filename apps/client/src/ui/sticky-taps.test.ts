import { describe, expect, it } from 'vitest';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS } from '../map/tap-detector.js';
import { STICKY_TAP_ECHO_MS, StickyTaps, type Pressable } from './sticky-taps.js';

// A tap sticks to the button it landed on, even when the button slid away
// under a still finger (a tray entry, a chip popping up). Pure: buttons and
// hit tests are handed in.

interface FakeButton extends Pressable {
  clicks: number;
  usable: boolean;
  inside: Set<unknown>;
}

function button(): FakeButton {
  const b: FakeButton = {
    clicks: 0,
    usable: true,
    inside: new Set(),
    contains: (under) => b.inside.has(under),
    click: () => {
      b.clicks += 1;
    },
  };
  b.inside.add(b);
  return b;
}

const at = (x: number, y: number, t: number, id = 1) => ({ id, x, y, t });

describe('StickyTaps', () => {
  it('clicks the pressed button when the lift falls outside it (it slid away)', () => {
    const taps = new StickyTaps<FakeButton>();
    const entry = button();
    taps.pointerDown(entry, at(100, 300, 0));
    // 120 ms later the tray has carried the entry 200 px to the right.
    expect(taps.pointerUp(at(101, 300, 120), 'the tray background')).toBe(true);
    expect(entry.clicks).toBe(1);
  });

  it('leaves a lift inside the button to the browser', () => {
    const taps = new StickyTaps<FakeButton>();
    const entry = button();
    taps.pointerDown(entry, at(100, 300, 0));
    expect(taps.pointerUp(at(102, 301, 90), entry)).toBe(false);
    expect(entry.clicks).toBe(0);
  });

  it('does nothing for a drag, a long press, another pointer or a press off any button', () => {
    const taps = new StickyTaps<FakeButton>();
    const entry = button();
    taps.pointerDown(entry, at(100, 300, 0));
    expect(taps.pointerUp(at(100 + TAP_MAX_MOVE_PX + 1, 300, 50), null)).toBe(false);
    taps.pointerDown(entry, at(100, 300, 0));
    expect(taps.pointerUp(at(100, 300, TAP_MAX_MS + 1), null)).toBe(false);
    taps.pointerDown(entry, at(100, 300, 0, 1));
    expect(taps.pointerUp(at(100, 300, 50, 2), null)).toBe(false);
    taps.pointerDown(null, at(100, 300, 0));
    expect(taps.pointerUp(at(100, 300, 50), null)).toBe(false);
    expect(entry.clicks).toBe(0);
  });

  it('is cancelled by pointercancel, and skips a button gone or disabled by the lift', () => {
    const taps = new StickyTaps<FakeButton>();
    const entry = button();
    taps.pointerDown(entry, at(100, 300, 0));
    taps.pointerCancel();
    expect(taps.pointerUp(at(100, 300, 50), null)).toBe(false);
    taps.pointerDown(entry, at(100, 300, 0));
    entry.usable = false;
    expect(taps.pointerUp(at(100, 300, 50), null)).toBe(false);
    expect(entry.clicks).toBe(0);
  });

  it("swallows the browser's own click echo of a tap it clicked, once", () => {
    const taps = new StickyTaps<FakeButton>();
    const entry = button();
    const other = button();
    taps.pointerDown(entry, at(100, 300, 0));
    expect(taps.pointerUp(at(100, 300, 100), null)).toBe(true);
    expect(taps.isEcho(other, 110)).toBe(false);
    expect(taps.isEcho(entry, 110)).toBe(true);
    // Only the one echo: a later click is a new tap.
    expect(taps.isEcho(entry, 120)).toBe(false);

    taps.pointerDown(entry, at(100, 300, 1000));
    expect(taps.pointerUp(at(100, 300, 1100), null)).toBe(true);
    expect(taps.isEcho(entry, 1100 + STICKY_TAP_ECHO_MS + 1)).toBe(false);
  });
});
