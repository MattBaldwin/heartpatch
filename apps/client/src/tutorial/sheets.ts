import type { Rect } from './overlay-layout.js';

// What else is on screen while the tutorial runs (#127, #128, #139). Sprout
// waits its turn behind any open sheet: a tile chip, the care sheet, the
// Hollow's morning report, a lore or milestone card, the home sheet, a
// battle's result card. They all carry `role="dialog"`, so nothing has to
// know about the tutorial to be waited for; a non-modal note
// (`aria-modal="false"`, like the install guide) isn't a sheet.

/** An open sheet anywhere on the page: a dialog that isn't a mere note. */
export const SHEET_SELECTOR = '[role="dialog"]:not([aria-modal="false"])';

/** Controls a player might tap, which Sprout's orb keeps clear of. */
const CONTROL_SELECTOR = 'button, input, select, textarea, [role="button"]';

/** A sheet wider than this share of the screen is a backdrop; its card is what's in the way. */
const BACKDROP_SHARE = 0.8; // TUNE

export interface OpenSheet {
  readonly element: Element;
  readonly rect: Rect;
}

function boxOf(element: Element): Rect | null {
  if (!(element instanceof HTMLElement) || element.hidden || !element.isConnected) return null;
  if (element.closest('[hidden]') || element.closest('[inert]')) return null;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * Every sheet open and on top right now, leaving out anything inside
 * `except` (the tutorial layer). A sheet under another one (the home sheet
 * while the care sheet is up) can't be tapped, so it isn't in anyone's way.
 */
export function openSheets(root: ParentNode, except: Element): OpenSheet[] {
  const open: OpenSheet[] = [];
  for (const element of root.querySelectorAll(SHEET_SELECTOR)) {
    if (except.contains(element)) continue;
    const rect = boxOf(element);
    if (rect) open.push({ element, rect });
  }
  return open.filter((sheet) => {
    const top = topSheetAt(open, except, sheet.rect);
    return top === null || top === sheet.element;
  });
}

/**
 * The sheet drawn uppermost at the middle of `rect` (null: no sheet takes a
 * tap there). One sample, at the centre: a sheet whose middle is covered
 * counts as covered even if a corner of it peeks out (the e2e's no-trap
 * check reads it the same way).
 */
function topSheetAt(open: readonly OpenSheet[], except: Element, rect: Rect): Element | null {
  const doc = except.ownerDocument;
  const stack = doc.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  for (const hit of stack) {
    if (except.contains(hit)) continue;
    const owner = open.find((s) => s.element.contains(hit));
    if (owner) return owner.element;
  }
  return null;
}

/**
 * The sheets Sprout must wait behind: every open one that doesn't hold the
 * step's own target (a spotlight on the care sheet's buttons gates the care
 * sheet on purpose; a morning report over it does not).
 */
export function foreignSheets(sheets: readonly OpenSheet[], target: Element | null): OpenSheet[] {
  return sheets.filter((s) => target === null || !s.element.contains(target));
}

/**
 * What Sprout's orb keeps clear of while it waits (#139): every control on
 * screen and the open sheets' cards. A sheet that covers the screen is a
 * backdrop, so its children stand in for it.
 */
export function obstacles(
  root: ParentNode,
  except: Element,
  sheets: readonly OpenSheet[],
  viewport: { width: number; height: number },
): Rect[] {
  const out: Rect[] = [];
  const backdrop = viewport.width * viewport.height * BACKDROP_SHARE;
  const card = (element: Element, rect: Rect, depth: number) => {
    if (rect.width * rect.height < backdrop) {
      out.push(rect);
      return;
    }
    if (depth === 0) return;
    for (const child of element.children) {
      const box = boxOf(child);
      if (box) card(child, box, depth - 1);
    }
  };
  for (const sheet of sheets) card(sheet.element, sheet.rect, 2);
  for (const element of root.querySelectorAll(CONTROL_SELECTOR)) {
    if (except.contains(element)) continue;
    const rect = boxOf(element);
    if (rect) out.push(rect);
  }
  return out;
}
