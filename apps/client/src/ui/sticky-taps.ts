import { TAP_MAX_MOVE_PX, TAP_MAX_MS } from '../map/tap-detector.js';

/*
 * A tap sticks to the button it landed on (the owner's "I had to tap
 * everything twice", 2026-10-05). Browsers send `click` to the common
 * ancestor of where the finger pressed and where it lifted (iOS drops the
 * tap outright when the two nodes differ), so a finger that lands on a tray
 * entry still sliding in, or a chip still popping up, and lifts a moment
 * later after the control moved out from under it, gets no click at all.
 * Here, a press on a button that is still a tap at the lift (the finger
 * stayed put and lifted soon) clicks that button when the lift fell outside
 * it, once; a lift inside it is the browser's own click and is left alone.
 * Drags and long presses are untouched. Pure (the DOM is handed in), so the
 * rules are unit-tested; `installStickyTaps` wires it to a document, once,
 * for the whole app: this is the one place mid-motion taps are rescued (a
 * second way of handling taps in a feature would be drift).
 */

export interface PressSample {
  readonly id: number;
  /** CSS pixels from the viewport's top left. */
  readonly x: number;
  readonly y: number;
  /** Event time, ms. */
  readonly t: number;
}

/** What a sticky tap needs of the pressed button. */
export interface Pressable {
  /** Still in the document and not disabled at the lift. */
  readonly usable: boolean;
  /**
   * The part of the button the finger landed on (a label span, an icon) is
   * still in it at the lift. A part swapped out by a redraw while the finger
   * rested gets no click from the browser either, whatever is under the lift.
   */
  readonly pressedPartKept: boolean;
  /** Whether the element under the lift point is this button (or inside it). */
  contains: (under: unknown) => boolean;
  click: () => void;
}

/** A native click on a button we clicked ourselves counts as the same tap within this long. */
export const STICKY_TAP_ECHO_MS = 100; // TUNE: a browser's own click follows the lift within a frame or two

export class StickyTaps<B extends Pressable> {
  private pressed: { button: B; sample: PressSample } | null = null;
  /** The button we clicked ourselves, until the browser's own click (if any) has been swallowed. */
  private sent: { button: B; at: number } | null = null;

  /** A primary pointer went down on `button` (null when it landed elsewhere). */
  pointerDown(button: B | null, sample: PressSample): void {
    this.pressed = button ? { button, sample } : null;
  }

  /**
   * The pointer lifted; `under` is what the lift point hits now. Returns
   * true when the pressed button was clicked here (the browser's own click
   * would have missed it).
   */
  pointerUp(sample: PressSample, under: unknown): boolean {
    const p = this.pressed;
    this.pressed = null;
    if (!p || p.sample.id !== sample.id) return false;
    const still =
      Math.abs(sample.x - p.sample.x) <= TAP_MAX_MOVE_PX &&
      Math.abs(sample.y - p.sample.y) <= TAP_MAX_MOVE_PX;
    if (!still || sample.t - p.sample.t > TAP_MAX_MS) return false;
    if (!p.button.usable) return false;
    if (p.button.pressedPartKept && under !== null && p.button.contains(under)) return false;
    this.sent = { button: p.button, at: sample.t };
    p.button.click();
    return true;
  }

  pointerCancel(): void {
    this.pressed = null;
  }

  /**
   * A click reached `target` (the element itself) at `t`: true when it is
   * the browser's own echo of a tap already clicked here (a button that
   * captured its pointer gets the browser's click as well), which the
   * caller should swallow.
   */
  isEcho(target: unknown, t: number): boolean {
    const s = this.sent;
    if (!s) return false;
    if (t - s.at > STICKY_TAP_ECHO_MS) {
      this.sent = null;
      return false;
    }
    if (!s.button.contains(target)) return false;
    this.sent = null;
    return true;
  }
}

/** The button a pointer event landed on, if any. */
function buttonOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('button, [role="button"]');
  return button instanceof HTMLElement ? button : null;
}

const pressable = (
  node: HTMLElement,
  part: Node | null = node,
): Pressable & { node: HTMLElement } => ({
  node,
  get usable() {
    return node.isConnected && !node.matches(':disabled');
  },
  get pressedPartKept() {
    return part !== null && part.isConnected && node.contains(part);
  },
  contains: (under) => under instanceof Node && node.contains(under),
  click: () => {
    node.click();
  },
});

/** Wires sticky taps to a document's buttons until `signal` aborts. */
export function installStickyTaps(root: Document, signal?: AbortSignal): void {
  const taps = new StickyTaps<Pressable & { node: HTMLElement }>();
  const sample = (e: PointerEvent): PressSample => ({
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    t: e.timeStamp,
  });
  const options: AddEventListenerOptions = {
    capture: true,
    passive: true,
    ...(signal ? { signal } : {}),
  };
  root.addEventListener(
    'pointerdown',
    (e) => {
      // A second finger (or another mouse button) drops the press held: the
      // browser then handles the first finger as usual, nothing is rescued.
      const primary = e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0);
      const button = primary ? buttonOf(e.target) : null;
      const part = e.target instanceof Node ? e.target : null;
      taps.pointerDown(button ? pressable(button, part) : null, sample(e));
    },
    options,
  );
  root.addEventListener(
    'pointerup',
    (e) => {
      taps.pointerUp(sample(e), root.elementFromPoint(e.clientX, e.clientY));
    },
    options,
  );
  root.addEventListener(
    'pointercancel',
    () => {
      taps.pointerCancel();
    },
    options,
  );
  // The browser's own click for a press we already clicked: once is enough.
  root.addEventListener(
    'click',
    (e) => {
      const button = buttonOf(e.target);
      if (button && e.isTrusted && taps.isEcho(button, e.timeStamp)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    { capture: true, ...(signal ? { signal } : {}) },
  );
}
