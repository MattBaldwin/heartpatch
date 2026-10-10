import type { HighlightTarget } from '@heartpatch/shared';
import { SETTLING } from '../ui/trays/tray-state.js';
import type { Rect } from '../ui/geometry.js';

// Finds a step's highlight target on screen (HighlightTargetSchema in
// shared: ids are a client contract and never renamed).
//
// - DOM targets: any element marked `data-tutorial-target="<id>"`. Buttons
//   and panels opt in by carrying the attribute; nothing else is needed.
// - Canvas targets (the Heart Seed, a node, a wild squishy): the scene that
//   draws them registers a locator that projects them to the screen. Until
//   one does, the target can't be found and the step leaves input open.
//
// The overlay lays out again on each step, resize and scene mount, and
// follows on its own when the game's DOM changes (a panel opens, a button
// appears) or the scene draws a frame (a camera pan), so the spotlight moves
// with its target.

/** The on-screen rect of a canvas target, or null if it isn't visible. */
export type TargetLocator = () => Rect | null;

export interface FoundTarget {
  readonly rect: Rect;
  /** The element, when it's a DOM target (null for a canvas one). */
  readonly element: Element | null;
  /** A guide (`TARGET_GUIDES`): the next thing to tap, not what finishes the step. */
  readonly soft: boolean;
}

export interface HighlightTargets {
  /** A scene registers where a canvas target is; returns an unregister. */
  register: (target: HighlightTarget, locate: TargetLocator) => () => void;
  /** The target on screen, or null if it isn't. */
  find: (target: HighlightTarget) => FoundTarget | null;
}

export const TARGET_ATTRIBUTE = 'data-tutorial-target';

/**
 * Buttons the game already marks with a `data-testid` that stand in for a
 * step's target (#24), so other screens needn't know about the tutorial.
 * Only buttons that finish the step from where they are: a spotlight blocks
 * every other tap, so a step that may need something else first (gathering
 * for a Hearthfire or a habitat) leaves its target unmapped and input open.
 * The first one on screen wins; a canvas locator is the fallback.
 *
 * The gather step walks the tile panel: Gather, then its countdown while the
 * gather runs and its "into your bag" line (nothing to tap); the Timber goes
 * straight into the bag with a pop-up (owner decision 2026-10-06), and its
 * `resource.gathered` finishes the step.
 *
 * Buttons that live in a side tray (ui/trays) are hidden while it's shut, so
 * the tray's handle stands in after them: Sprout points at the handle, and
 * once the tray has slid all the way open (it's "settling" until then), at
 * the button inside. The tray settling stops with a class change, which lays
 * the overlay out again.
 */
export const TARGET_STAND_INS: Readonly<Partial<Record<HighlightTarget, readonly string[]>>> = {
  'resource-node': ['tile-gather', 'tile-gathering', 'tile-landing'],
  'neighbor-tile': ['tile-claim'],
  'capture-button': ['battle-capture'],
  'defense-stance': ['territory-pick'],
  'wild-squishy': ['battle-entry', 'tray-handle-adventure'],
};

/**
 * Steps that take more than one tap to finish (#140): the fire on the new
 * land (`land-fire`; fires stand only on captured land, owner decision
 * 2026-10-07) needs the tile, Build a fire, Build, then Emberwood and Add
 * fuel. A spotlight would block the rest, so these only guide: Sprout lights
 * and points at the next thing to tap (the first on screen wins), and every
 * tap stays open. Add fuel once a fire stands, else Build on its card, else
 * Build a fire. Whole selectors, unlike the stand-ins' test ids.
 */
export const TARGET_GUIDES: Readonly<Partial<Record<HighlightTarget, readonly string[]>>> = {
  'build-button': [
    '[data-testid="tile-fire-fuel"]',
    '[data-testid="tile-build-fire-confirm"]',
    '[data-testid="tile-build-fire"]',
  ],
};

/** The visible element at `selector` and its box, or null. */
function visible(root: ParentNode, selector: string): { rect: Rect; element: Element } | null {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement) || element.hidden || !element.isConnected) return null;
  // In a shut tray: laid out off screen, but not showing.
  if (element.closest('[inert]') || getComputedStyle(element).visibility === 'hidden') return null;
  // In a tray still sliding in: not where it will rest yet.
  if (element.closest(`.${SETTLING}`)) return null;
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
      if (marked) return { ...marked, soft: false };
      for (const standIn of TARGET_STAND_INS[target] ?? []) {
        const stood = visible(root, `[data-testid="${standIn}"]`);
        if (stood) return { ...stood, soft: false };
      }
      for (const guide of TARGET_GUIDES[target] ?? []) {
        const next = visible(root, guide);
        if (next) return { ...next, soft: true };
      }
      const rect = locators.get(target)?.() ?? null;
      return rect ? { rect, element: null, soft: false } : null;
    },
  };
}
