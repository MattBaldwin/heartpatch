import type { HouseViewport } from './house-camera.js';

/*
 * Where the dollhouse is framed while a residents page is open (#381 C2b):
 * the move-in picker and the move-out confirm are about one room, so the
 * camera fits the house into the space above the open sheet (its real
 * height, not the folded peek's) and fits back when it closes. Pure, so
 * it's unit-tested; the fit itself goes through B4's `panner.fit()`.
 */

/** The bottom bands a fit keeps clear (`HouseViewport.bottom` and `.sheet`). */
export type SheetBands = Required<Pick<HouseViewport, 'bottom' | 'sheet'>>;

/** The sheets that frame the house above themselves: the residents' pages. */
export const framesAboveSheet = (sheet: string): boolean =>
  sheet === 'picker' || sheet === 'move-out';

/**
 * The room a residents page is about, which a tall phone frames instead of
 * the Keeper's: the picker's room, or the room of the resident moving out.
 * Null on every other sheet (the house frames as B4 does).
 */
export function framedRoomId(
  sheet: string,
  pickRoom: string | null,
  movingOutOf: string | null,
): string | null {
  if (sheet === 'picker') return pickRoom;
  if (sheet === 'move-out') return movingOutOf;
  return null;
}

/**
 * The bands to fit with: the folded ones, or, while a residents page is
 * open, the open sheet's height (CSS px from the screen's bottom) for both
 * (the Walk in button hides under the page).
 */
export function sheetBands(folded: SheetBands, openSheet: number | null): SheetBands {
  if (openSheet === null || !(openSheet > 0)) return folded;
  return {
    bottom: Math.max(folded.bottom, openSheet),
    sheet: Math.max(folded.sheet, openSheet),
  };
}
