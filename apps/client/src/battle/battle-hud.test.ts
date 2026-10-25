import { describe, expect, it } from 'vitest';
import { createSheetHold, sheetHold, watchLayout, type LayoutWatchEnv } from './battle-hud.js';

/** A window and `ResizeObserver` stand-in that records what was hooked up. */
function fakeEnv() {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const observers: { callback: ResizeObserverCallback; nodes: Element[]; on: boolean }[] = [];
  const env: LayoutWatchEnv = {
    win: {
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener);
      },
    },
    Observer: class {
      readonly #entry: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.#entry = { callback, nodes: [], on: true };
        observers.push(this.#entry);
      }
      observe(node: Element) {
        this.#entry.nodes.push(node);
      }
      disconnect() {
        this.#entry.on = false;
        this.#entry.nodes = [];
      }
    },
  };
  return { env, listeners, observers };
}

describe('watchLayout (battle HUD safe region)', () => {
  it('watches the window and every box, and its cleanup stops both', () => {
    const { env, listeners, observers } = fakeEnv();
    const boxes = [{}, {}, {}] as Element[];
    let changes = 0;
    const stop = watchLayout(boxes, () => (changes += 1), env);

    expect(listeners.size).toBe(1);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.nodes).toEqual(boxes);
    observers[0]!.callback([], {} as ResizeObserver);
    expect(changes).toBe(1);

    stop();
    // A disposed HUD leaves nothing behind: no resize listener, no observed boxes.
    expect(listeners.size).toBe(0);
    expect(observers[0]).toMatchObject({ on: false, nodes: [] });
  });
});

describe('sheetHold (a steady sheet while a turn plays, #656)', () => {
  it("takes the pick's height when the turn starts and keeps it through the log", () => {
    const held = sheetHold('choose', 'waiting', 197.4, null);
    expect(held).toBe(197.4);
    // The log's own steps change the controls but not the height held.
    expect(sheetHold('waiting', 'hidden', 150, held)).toBe(197.4);
    expect(sheetHold('hidden', 'hidden', 150, held)).toBe(197.4);
    expect(sheetHold('hidden', 'waiting', 150, held)).toBe(197.4);
  });

  it('lets go at the next pick, "Who comes out?" and when the result is up', () => {
    expect(sheetHold('hidden', 'choose', 150, 197.4)).toBeNull();
    expect(sheetHold('hidden', 'replace', 150, 197.4)).toBeNull();
    expect(sheetHold('waiting', 'choose', 150, 197.4)).toBeNull();
  });

  it('holds nothing where there is no layout', () => {
    expect(sheetHold('choose', 'waiting', 0, null)).toBeNull();
    expect(sheetHold(undefined, 'hidden', 0, null)).toBeNull();
  });

  it('measures a turn that starts from "Who comes out?" too', () => {
    expect(sheetHold('replace', 'hidden', 230, null)).toBe(230);
  });
});

describe('createSheetHold (the hold across a battle, #656)', () => {
  it('holds the height the turn started with, then lets go at the next pick', () => {
    const hold = createSheetHold();
    expect(hold.next('choose', 197)).toBeNull();
    expect(hold.next('waiting', 197)).toBe(197);
    expect(hold.next('hidden', 150)).toBe(197);
    expect(hold.next('choose', 197)).toBeNull();
  });

  it('forgets a hold when released, so the next battle measures its own sheet', () => {
    const hold = createSheetHold();
    hold.next('choose', 300);
    expect(hold.next('hidden', 300)).toBe(300);
    // The result card shows, or the HUD is hidden and shown again.
    hold.release();
    // A replay opens straight on "hidden": measured fresh, not the old 300.
    expect(hold.next('hidden', 120)).toBe(120);
    hold.release();
    expect(hold.next('waiting', 0)).toBeNull();
  });
});
