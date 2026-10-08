import { describe, expect, it } from 'vitest';
import { watchLayout, type LayoutWatchEnv } from './battle-hud.js';

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
