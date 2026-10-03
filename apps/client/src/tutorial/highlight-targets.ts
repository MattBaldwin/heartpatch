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

/**
 * Buttons the game already marks with a `data-testid` that stand in for a
 * step's target (#24), so other screens needn't know about the tutorial.
 * Only buttons that finish the step from where they are: a spotlight blocks
 * every other tap, so a step that may need something else first (gathering
 * for a Hearthfire or a habitat) leaves its target unmapped and input open.
 */
export const TARGET_STAND_INS: Readonly<Partial<Record<HighlightTarget, string>>> = {
  'resource-node': 'tile-gather',
  'neighbor-tile': 'tile-claim',
  'capture-button': 'battle-capture',
  'care-buttons': 'care-close-up',
  'defense-stance': 'territory-pick',
};

/** The visible element at `selector` and its box, or null. */
function visible(root: ParentNode, selector: string): { rect: Rect; element: Element } | null {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement) || element.hidden || !element.isConnected) return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { rect: { x: box.x, y: box.y, width: box.width, height: box.height }, element };
}

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
      const marked = visible(root, `[${TARGET_ATTRIBUTE}="${target}"]`);
      if (marked) return marked;
      const standIn = TARGET_STAND_INS[target];
      const stood = standIn ? visible(root, `[data-testid="${standIn}"]`) : null;
      if (stood) return stood;
      const rect = locators.get(target)?.() ?? null;
      return rect ? { rect, element: null } : null;
    },
  };
}
