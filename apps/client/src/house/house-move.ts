import type { HouseView } from '@heartpatch/shared';
import { createHouseCommand, type CommandOutcome, type HouseCommandDeps } from './house-command.js';

/*
 * Moving a squishy into a room of the house, between rooms, or out
 * (#381 plan §10.3), sent as one house command (house-command.ts), as the
 * build and the gift are: one `Idempotency-Key` per tap, the same key on
 * the one retry after a dropped connection (so a move that did land is
 * replayed), and a second tap while one is in flight does nothing. Pure (the
 * API, the key and the clock are passed in), so it's unit-tested.
 */

export interface HouseMoveDeps extends HouseCommandDeps {
  move: (
    mapId: string,
    squishyId: string,
    roomId: string | null,
    key: string,
  ) => Promise<HouseView>;
}

/** What one tap came to: the new house, the server's kind word, or nothing (dropped). */
export type MoveOutcome =
  { readonly kind: 'moved'; readonly view: HouseView } | Exclude<CommandOutcome, { kind: 'done' }>;

export interface ResidentMover {
  /** Moves `squishyId` into `roomId` (null: out); `stillWanted` is asked before a retry and on the reply. */
  move: (
    mapId: string,
    squishyId: string,
    roomId: string | null,
    stillWanted: () => boolean,
  ) => Promise<MoveOutcome>;
  readonly busy: boolean;
}

export function createResidentMover(deps: HouseMoveDeps): ResidentMover {
  const command = createHouseCommand(deps);
  return {
    async move(mapId, squishyId, roomId, stillWanted) {
      const outcome = await command.run(
        (key) => deps.move(mapId, squishyId, roomId, key),
        stillWanted,
      );
      return outcome.kind === 'done' ? { kind: 'moved', view: outcome.view } : outcome;
    },
    get busy() {
      return command.busy;
    },
  };
}
