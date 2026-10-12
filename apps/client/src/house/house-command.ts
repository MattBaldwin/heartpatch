import type { HouseView } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { messageOf } from '../ui/dom.js';

/*
 * One house command, as the other screens send theirs (#381): one
 * `Idempotency-Key` per tap, the same key on the one retry after a dropped
 * connection (so a command that did land is replayed, never applied twice),
 * and a second tap while one is in flight does nothing. The build
 * (house-build.ts) and the gift (house-gift-open.ts) both send through it.
 * Pure (the API, the key and the clock are passed in).
 */

export interface HouseCommandDeps {
  newKey?: () => string;
  wait?: (ms: number) => Promise<void>;
  retryAfterMs?: number;
}

/** What one tap came to. */
export type CommandOutcome =
  | { readonly kind: 'done'; readonly view: HouseView }
  /** The server said no (or the phone is offline): its kid-readable message. */
  | { readonly kind: 'failed'; readonly message: string }
  /** Another command was in flight, or the player moved on before the reply. */
  | { readonly kind: 'dropped' };

export interface HouseCommand {
  /** Sends `send(key)`; `stillWanted` is asked before a retry and when the reply lands. */
  run: (
    send: (key: string) => Promise<HouseView>,
    stillWanted: () => boolean,
  ) => Promise<CommandOutcome>;
  readonly busy: boolean;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createHouseCommand(deps: HouseCommandDeps = {}): HouseCommand {
  let busy = false;
  const send = {
    newKey: deps.newKey ?? newIdempotencyKey,
    wait: deps.wait ?? delay,
    retryAfterMs: deps.retryAfterMs ?? COMMAND_RETRY_MS,
  };
  return {
    async run(command, stillWanted) {
      if (busy) return { kind: 'dropped' };
      busy = true;
      try {
        const view = await sendCommand(send, command, stillWanted);
        if (!view || !stillWanted()) return { kind: 'dropped' };
        return { kind: 'done', view };
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
