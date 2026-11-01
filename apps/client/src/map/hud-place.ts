// The map's name pill on a phone on its side (Layout B1): the tile panel can't
// stop under the pill there and still fit a busy tile's five buttons (#264),
// so the pill moves up into the top row, in the gap between "My patches" and
// the round buttons (ui/trays), and the panel keeps its height. The gap
// depends on the words and on which round buttons show, so it's measured.

import { LANDSCAPE_PHONE_QUERY } from '../ui/breakpoints.js';

/** Room (px) between the pill and a corner button, each side. // TUNE: */
const GAP = 8;

/** Narrower than this the pill can't show its name and coins, so it stays put. // TUNE: */
const MIN_ROOM = 160;

/** The pill's centre, widest width and half its drawn width (px). */
export interface HudSpot {
  readonly x: number;
  readonly room: number;
  readonly half: number;
}

/**
 * Where the pill sits between `left` and `right` (the corner buttons' inner
 * edges, px): centred on the screen when it fits there, else slid along the
 * gap just far enough to clear the nearer button.
 */
export function hudSpot(
  left: number,
  right: number,
  width: number,
  screenWidth: number,
): HudSpot | null {
  const from = left + GAP;
  const to = right - GAP;
  const room = to - from;
  if (room < MIN_ROOM) return null;
  const half = Math.min(width, room) / 2;
  const x = Math.min(Math.max(screenWidth / 2, from + half), to - half);
  return { x, room, half };
}

/** A shown element's box, or null when it isn't drawn. */
function drawn(selector: string): DOMRect | null {
  const node = document.querySelector(selector);
  if (!node || node.getClientRects().length === 0) return null;
  const box = node.getBoundingClientRect();
  return box.width > 0 ? box : null;
}

/** Keeps the pill in the top row's gap while the phone is on its side. */
export function watchHudPlace(hud: HTMLElement): void {
  const onSide = window.matchMedia(LANDSCAPE_PHONE_QUERY);
  const watched = new Set<Element>();
  const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  // A corner button shown or hidden (the trays under the Build sheet, the 🐾)
  // re-places the pill without waiting on a size notice: on WebKit in CI the
  // pill was once left placed as if the round buttons weren't there, centred
  // under the 🐾 on an iPhone SE.
  const shown = new MutationObserver(schedule);
  let frame = 0;

  const place = (): void => {
    // The corner buttons come and go (the trays, the Build sheet hides them).
    for (const node of document.querySelectorAll('.tray-top-left, .tray-top-right, .auth-chip')) {
      if (!watched.has(node)) {
        watched.add(node);
        sizes?.observe(node);
        shown.observe(node, { subtree: true, attributeFilter: ['hidden'] });
        const trays = node.closest('.trays');
        if (trays) shown.observe(trays, { attributeFilter: ['hidden'] });
      }
    }
    // Over the Build sheet only the Me button shows (main.ts onPanelFocus): the
    // left corner is free, and map.css keeps the pill out of the notch.
    const start = drawn('.tray-top-left');
    const ends = [drawn('.tray-top-right'), drawn('.auth-chip-toggle')].filter((b) => b !== null);
    const spot =
      onSide.matches && !hud.hidden && ends.length > 0
        ? hudSpot(
            start?.right ?? 0,
            Math.min(...ends.map((b) => b.left)),
            hud.offsetWidth,
            window.innerWidth,
          )
        : null;
    if (spot) {
      hud.style.setProperty('--map-hud-x', `${String(spot.x)}px`);
      hud.style.setProperty('--map-hud-room', `${String(spot.room)}px`);
      hud.style.setProperty('--map-hud-half', `${String(spot.half)}px`);
      hud.dataset['place'] = 'top';
    } else {
      delete hud.dataset['place'];
    }
  };
  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  }

  window.addEventListener('resize', schedule);
  onSide.addEventListener('change', schedule);
  // Shown or hidden, a new name or coins: its width changes where it fits.
  new MutationObserver(schedule).observe(hud, { attributeFilter: ['hidden'] });
  sizes?.observe(hud);
  // The screen itself: a size notice comes after layout has the new width.
  // WebKit in CI once left the pill placed for the screen before (852pt wide
  // on a 667pt one): `resize` ran it too soon, and a phone on its side turned
  // to another phone on its side changes no media query, button or pill size.
  sizes?.observe(document.documentElement);
  schedule();
}
