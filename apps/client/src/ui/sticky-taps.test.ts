import { describe, expect, it } from 'vitest';
import { TAP_MAX_MOVE_PX, TAP_MAX_MS } from '../map/tap-detector.js';
import { STICKY_TAP_ECHO_MS, StickyTaps, type Pressable } from './sticky-taps.js';

// A tap sticks to the button it landed on, even when the button slid away
// under a still finger (a tray entry, a chip popping up). Pure: buttons and
// hit tests are handed in.

interface FakeButton extends Pressable {
  clicks: number;
  usable: boolean;
  pressedPartKept: boolean;
  inside: Set<unknown>;
}

function button(): FakeButton {
  const b: FakeButton = {
    clicks: 0,
    usable: true,
    pressedPartKept: true,
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

  it('clicks the pressed button, not the one under the lift, when the lift lands on another', () => {
    const taps = new StickyTaps<FakeButton>();
    const pressed = button();
    const other = button();
    taps.pointerDown(pressed, at(100, 300, 0));
    expect(taps.pointerUp(at(100, 300, 100), other)).toBe(true);
    expect(pressed.clicks).toBe(1);
    expect(other.clicks).toBe(0);
    // The browser's own click goes to the common ancestor, never to `other`
    // itself; were it to reach `other`, it is no echo of ours, while one
    // reaching the pressed button (it captured the pointer) is.
    expect(taps.isEcho(other, 105)).toBe(false);
    expect(taps.isEcho(pressed, 105)).toBe(true);
  });

  it('clicks when the part pressed was swapped out by the lift, even with the lift inside', () => {
    // A chip redrawn its label span while the finger rested: the browser has
    // no press node left to pair the lift with, so no click comes from it.
    const taps = new StickyTaps<FakeButton>();
    const chip = button();
    taps.pointerDown(chip, at(200, 130, 0));
    chip.pressedPartKept = false;
    expect(taps.pointerUp(at(200, 130, 110), chip)).toBe(true);
    expect(chip.clicks).toBe(1);
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
    // As the wiring does: the click's target is the element itself (or a
    // part of it), never the wrapper the press was recorded with.
    const entryNode = 'the entry element';
    const entryIcon = 'an icon inside the entry';
    entry.inside.add(entryNode).add(entryIcon);
    taps.pointerDown(entry, at(100, 300, 0));
    expect(taps.pointerUp(at(100, 300, 100), null)).toBe(true);
    expect(taps.isEcho('another element', 110)).toBe(false);
    expect(taps.isEcho(other, 110)).toBe(false);
    expect(taps.isEcho(entryIcon, 110)).toBe(true);
    // Only the one echo: a later click is a new tap.
    expect(taps.isEcho(entryNode, 120)).toBe(false);

    taps.pointerDown(entry, at(100, 300, 1000));
    expect(taps.pointerUp(at(100, 300, 1100), null)).toBe(true);
    expect(taps.isEcho(entry, 1100 + STICKY_TAP_ECHO_MS + 1)).toBe(false);
  });
});
