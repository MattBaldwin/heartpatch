import type {
  CrookedFixResponse,
  CrookedRelightResponse,
  CrookedRoom,
  CrookedThing,
  RelightMove,
} from '@heartpatch/shared';
import { createPuzzleSheet, type PuzzleDebug } from '../../hollowed/puzzle-sheet.js';
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
  let board: { room: CrookedRoom; thing: CrookedThing } | null = null;
  const sheet = createPuzzleSheet<CrookedFixResponse>({
    parent: options.parent,
    start: async () => (board ? options.start(board.room.id, board.thing.id) : null),
    solve: async (attempt, moves) =>
      board ? options.solve(board.room.id, board.thing.id, attempt, moves) : null,
    onClosed: (fixed) => {
      const was = board;
      board = null;
      if (was) options.onClosed(was.room, was.thing, fixed);
    },
  });
  return {
    open: (room, thing) => {
      sheet.close();
      board = { room, thing };
      sheet.openRelight({
        progress: R.heading(thing.name, room.name),
        fixed: R.relit(thing.name),
      });
    },
    close: () => {
      sheet.close();
    },
    get isOpen() {
      return sheet.isOpen;
    },
    get debug() {
      return sheet.debug;
    },
  };
}
