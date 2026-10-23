import type {
  CrookedFixResponse,
  CrookedRelightResponse,
  CrookedRoom,
  CrookedThing,
  RelightMove,
} from '@heartpatch/shared';
import {
  createPuzzleSheet,
  type PuzzleDebug,
  type PuzzleSheet,
} from '../../hollowed/puzzle-sheet.js';
import { CROOKED_RELIGHT_TEXT as R } from './crooked-text.js';
import '../../explore/explore.css';
import './crooked-relight.css';

// The Crooked House's Relight boards (#306 6f, owner decision 5): the
// Library's reading lamps (5×5) and the Music Room's music box (6×6). The
// board is the Hollow's own approved card (`puzzle-sheet.ts`, PR #605):
// each try is a fresh, seeded puzzle from the server, no hints and no
// peeking, and a faded try reshuffles. The moves go to the house's `fix`,
// which replays them on its own copy (rule 1); a win closes the card and the
// screen shows what the fix did (the thing lights up, maybe the bloom).

export interface CrookedRelightOptions {
  /** Where the card goes (the house's overlay). */
  readonly parent: HTMLElement;
  /** A fresh try at the thing's board; null if the visit moved on. Throws a kid-readable error. */
  readonly start: (room: string, thing: string) => Promise<CrookedRelightResponse | null>;
  /** Sends a try's moves as the thing's fix; null if the visit moved on. Throws a kid-readable error. */
  readonly solve: (
    room: string,
    thing: string,
    attempt: number,
    moves: readonly RelightMove[],
  ) => Promise<CrookedFixResponse | null>;
  /** The card closed: relit (the fix's reply) or not now (null). */
  readonly onClosed: (
    room: CrookedRoom,
    thing: CrookedThing,
    fixed: CrookedFixResponse | null,
  ) => void;
}

export interface CrookedRelight {
  /** Opens the board of a Relight thing in the room I'm in. */
  open: (room: CrookedRoom, thing: CrookedThing) => void;
  /** Closes it at once (Back, a catch, the patch going). */
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: PuzzleDebug | null;
}

export function createCrookedRelight(options: CrookedRelightOptions): CrookedRelight {
  /**
   * The open board's card: made on open and taken out of the page on close,
   * so the Hollow's own card is the only one in the page the rest of the time.
   */
  let board: { room: CrookedRoom; thing: CrookedThing; sheet: PuzzleSheet } | null = null;
  const done = (fixed: CrookedFixResponse | null) => {
    const was = board;
    board = null;
    if (!was) return;
    // After this turn: the card is still finishing its own close.
    queueMicrotask(() => {
      was.sheet.dispose();
    });
    options.onClosed(was.room, was.thing, fixed);
  };
  return {
    open: (room, thing) => {
      board?.sheet.close();
      const sheet = createPuzzleSheet<CrookedFixResponse>({
        parent: options.parent,
        start: async () => options.start(room.id, thing.id),
        solve: async (attempt, moves) => options.solve(room.id, thing.id, attempt, moves),
        onClosed: done,
      });
      board = { room, thing, sheet };
      sheet.openRelight({
        progress: R.heading(thing.name, room.name),
        fixed: R.relit(thing.name),
      });
    },
    close: () => {
      board?.sheet.close();
    },
    get isOpen() {
      return board?.sheet.isOpen ?? false;
    },
    get debug() {
      return board?.sheet.debug ?? null;
    },
  };
}
