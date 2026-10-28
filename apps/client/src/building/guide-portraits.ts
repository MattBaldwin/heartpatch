import type { BuildingPortraitLook, BuildingPortraits } from '../procedural/portraits.js';
import { el } from '../ui/dom.js';
import { askPortrait } from '../works/works-card.js';

// The Buildings guide's card pictures (#715): asked for only once a card
// comes near the screen, a few at a time, so the guide's ~35 cards don't
// fill the one serial portrait queue at once (each draw waits on the last).
// An empty draw (a busy engine) is asked again, up to `GUIDE_PORTRAIT_TRIES`.

/** Asks in all for one picture before it stays the soft square. */
export const GUIDE_PORTRAIT_TRIES = 5; // TUNE
/** How far below the list's bottom edge a card starts drawing. */
export const GUIDE_PORTRAIT_MARGIN = '240px'; // TUNE: about one card

/** The bits of IntersectionObserver used, so a test can stand in for it. */
export interface NearScreen<T> {
  observe(target: T): void;
  unobserve(target: T): void;
}
export type NearScreenFactory<T> = (near: (target: T) => void, root: Element) => NearScreen<T>;

const browserNearScreen: NearScreenFactory<Element> = (near, root) =>
  new IntersectionObserver(
    (seen) => {
      for (const s of seen) if (s.isIntersecting) near(s.target);
    },
    { root, rootMargin: `0px 0px ${GUIDE_PORTRAIT_MARGIN} 0px` },
  );

/** Runs `start` once for each added target, when it first comes near the screen. */
export function lazyAsks<T, L>(
  nearScreen: NearScreenFactory<T>,
  root: Element,
  start: (target: T, look: L) => void,
): { add(target: T, look: L): void; reset(): void } {
  const waiting = new Map<T, L>();
  const watch = nearScreen((target) => {
    const look = waiting.get(target);
    if (look === undefined) return;
    waiting.delete(target);
    watch.unobserve(target);
    start(target, look);
  }, root);
  return {
    add(target, look) {
      waiting.set(target, look);
      watch.observe(target);
    },
    reset() {
      for (const target of waiting.keys()) watch.unobserve(target);
      waiting.clear();
    },
  };
}

export interface GuidePortraits {
  /**
   * A card's picture box: empty until it nears the screen and is drawn. Its
   * `data-portrait` says waiting, drawing, drawn or none (e2e waits on drawn).
   */
  box(look: BuildingPortraitLook): HTMLElement;
  /** Forgets every box not yet asked for (the list was redrawn or the guide shut). */
  reset(): void;
}

export function createGuidePortraits(
  portraits: BuildingPortraits | undefined,
  root: Element,
): GuidePortraits {
  const asks = lazyAsks<Element, BuildingPortraitLook>(browserNearScreen, root, (box, look) => {
    if (!(box instanceof HTMLElement)) return;
    box.dataset['portrait'] = 'drawing';
    void askPortrait(
      portraits,
      look,
      (url) => {
        box.replaceChildren(el('img', { class: 'works-portrait-img', alt: '', src: url }));
      },
      undefined,
      GUIDE_PORTRAIT_TRIES,
    ).then((drawn) => {
      box.dataset['portrait'] = drawn ? 'drawn' : 'none';
    });
  });
  return {
    box(look) {
      const box = el('span', {
        class: 'works-portrait guide-portrait',
        'aria-hidden': 'true',
        'data-portrait': portraits ? 'waiting' : 'none',
      });
      box.style.width = `${String(look.size)}px`;
      box.style.height = `${String(look.size)}px`;
      if (portraits) asks.add(box, look);
      return box;
    },
    reset: () => {
      asks.reset();
    },
  };
}
