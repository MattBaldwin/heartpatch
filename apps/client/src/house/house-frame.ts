import type { HouseViewport } from './house-camera.js';

/*
 * Where the dollhouse is framed while the sheet is about one room (#381
 * C2b): the move-in picker, the move-out confirm, a resident's opened bed
 * and the beds right after a move all point at a room, so the camera fits
 * the house into the space above the sheet as it stands (its real height,
 * not the folded peek's) and frames that room on a tall phone. When the
 * sheet stops pointing at a room, it fits back. Pure, so it's unit-tested;
 * the fit itself goes through B4's `panner.fit()`, once per change.
 */

/** The bottom bands a fit keeps clear (`HouseViewport.bottom` and `.sheet`). */
export type SheetBands = Required<Pick<HouseViewport, 'bottom' | 'sheet'>>;

/** What the sheet is showing, as far as the framing cares. */
export interface FrameState {
  readonly sheet: string;
  /** The picker's room. */
  readonly pickRoom: string | null;
  /** The room of the resident whose bed is opened (or moving out). */
  readonly chosenRoom: string | null;
  /** The room a squishy just moved into, or out of, while its line shows. */
  readonly movedRoom: string | null;
}

/** The room the sheet is about, or null (the house frames as B4 does). */
export function framedRoomId(s: FrameState): string | null {
  switch (s.sheet) {
    case 'picker':
      return s.pickRoom;
    case 'move-out':
      return s.chosenRoom;
    case 'open':
      return s.chosenRoom ?? s.movedRoom;
    default:
      return null;
  }
}

/** Whether the house fits above the sheet as it stands. */
export const framesAboveSheet = (s: FrameState): boolean => framedRoomId(s) !== null;

/** How much a sheet must grow or shrink (CSS px) before the house refits. */
const REFIT_STEP_PX = 24; // TUNE

/**
 * What the fit depends on, as one string: the house refits only when it
 * changes (a page opens or closes, another room, the sheet grew a step),
 * never every frame.
 */
export function frameKey(s: FrameState, openSheet: number): string {
  const room = framedRoomId(s);
  return room === null ? '' : `${room}|${String(Math.round(openSheet / REFIT_STEP_PX))}`;
}

/**
 * The bands to fit with: the folded ones, or, while the sheet is about a
 * room, its height as it stands (CSS px from the screen's bottom) for both
 * (the Walk in button hides under it).
 */
export function sheetBands(folded: SheetBands, openSheet: number | null): SheetBands {
  if (openSheet === null || !(openSheet > 0)) return folded;
  return {
    bottom: Math.max(folded.bottom, openSheet),
    sheet: Math.max(folded.sheet, openSheet),
  };
}
