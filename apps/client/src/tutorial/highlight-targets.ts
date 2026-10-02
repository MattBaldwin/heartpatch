import type { HighlightTarget } from '@heartpatch/shared';
import type { Rect } from './overlay-layout.js';

// Finds a step's highlight target on screen (HighlightTargetSchema in
// shared: ids are a client contract and never renamed).
//
// - DOM targets: any element marked `data-tutorial-target="<id>"`. Buttons
//   and panels opt in by carrying the attribute; nothing else is needed.
// - Canvas targets (the Heart Seed, a node, a wild squishy): the scene that
//   draws them registers a locator that projects them to the screen. Until
//   one does, the target can't be found and the step leaves input open.
//
// The overlay lays out again on each step, resize and scene mount. Anything
// that moves a target on screen (a camera pan, a panel sliding in) calls
// `TutorialScreen.relayout` so the spotlight follows it.

/** The on-screen rect of a canvas target, or null if it isn't visible. */
export type TargetLocator = () => Rect | null;

export interface HighlightTargets {
  /** A scene registers where a canvas target is; returns an unregister. */
  register: (target: HighlightTarget, locate: TargetLocator) => () => void;
  /** The target's rect, the element if it's a DOM one, or null if it isn't on screen. */
  find: (target: HighlightTarget) => { rect: Rect; element: Element | null } | null;
}

export const TARGET_ATTRIBUTE = 'data-tutorial-target';

export function createHighlightTargets(root: ParentNode = document): HighlightTargets {
  const locators = new Map<HighlightTarget, TargetLocator>();
  return {
    register: (target, locate) => {
      locators.set(target, locate);
      return () => {
        if (locators.get(target) === locate) locators.delete(target);
      };
    },
    find: (target) => {
      if (target === 'none') return null;
      const element = root.querySelector(`[${TARGET_ATTRIBUTE}="${target}"]`);
      if (element instanceof HTMLElement && !element.hidden && element.isConnected) {
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          return { rect: { x: box.x, y: box.y, width: box.width, height: box.height }, element };
        }
      }
      const rect = locators.get(target)?.() ?? null;
      return rect ? { rect, element: null } : null;
    },
  };
}
