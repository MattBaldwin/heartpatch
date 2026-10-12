// The home sheet's peek bar (#412): on opening Home, the sheet is a short bar
// (Squishies, Jobs & team, Build, Back to map) so the squishies by the Heart
// Seed stay in view. The handle on top opens it into the full lists and
// folds it back: a tap toggles, a swipe goes the way the finger went.

/**
 * Whether the sheet is open after a press on its handle that moved `dy` CSS
 * pixels (up is negative). A short move is a tap and toggles; a longer one
 * opens on the way up and folds on the way down.
 */
export function afterHandle(open: boolean, dy: number, swipePx: number): boolean {
  if (dy <= -swipePx) return true;
  if (dy >= swipePx) return false;
  return !open;
}
