import type { HouseView } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { messageOf } from '../ui/dom.js';
import type { BuildOutcome } from './house-build.js';

/*
 * Moving a squishy into a room of the house, between rooms, or out
 * (#381 plan §10.3), sent the way the build is: one `Idempotency-Key` per
 * tap, the same key on the one retry after a dropped connection (so a move
 * that did land is replayed), and a second tap while one is in flight does
 * nothing. Pure (the API, the key and the clock are passed in), so it's
 * unit-tested.
 */

export interface HouseMoveDeps {
  move: (
    mapId: string,
    squishyId: string,
    roomId: string | null,
    key: string,
  ) => Promise<HouseView>;
  newKey?: () => string;
  wait?: (ms: number) => Promise<void>;
  retryAfterMs?: number;
}

/** What one tap came to: the new house, the server's kind word, or nothing (dropped). */
export type MoveOutcome =
  { readonly kind: 'moved'; readonly view: HouseView } | Exclude<BuildOutcome, { kind: 'built' }>;

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

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createResidentMover(deps: HouseMoveDeps): ResidentMover {
  let busy = false;
  const send = {
    newKey: deps.newKey ?? newIdempotencyKey,
    wait: deps.wait ?? delay,
    retryAfterMs: deps.retryAfterMs ?? COMMAND_RETRY_MS,
  };
  return {
    async move(mapId, squishyId, roomId, stillWanted) {
      if (busy) return { kind: 'dropped' };
      busy = true;
      try {
        const view = await sendCommand(
          send,
          (key) => deps.move(mapId, squishyId, roomId, key),
          stillWanted,
        );
        if (!view || !stillWanted()) return { kind: 'dropped' };
        return { kind: 'moved', view };
      } catch (err) {
        if (!stillWanted()) return { kind: 'dropped' };
        return { kind: 'failed', message: messageOf(err) };
      } finally {
        busy = false;
      }
    },
    get busy() {
      return busy;
    },
  };
}
