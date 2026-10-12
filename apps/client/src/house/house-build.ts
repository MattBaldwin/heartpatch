import type { HouseView } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { messageOf } from '../ui/dom.js';

/*
 * Building the house's next level (#381 plan §10.5), as the other screens
 * send a command: one `Idempotency-Key` per tap on the confirm, the same key
 * on the one retry after a dropped connection (so a build that did land is
 * replayed, never paid twice), and a second tap while one is in flight does
 * nothing. Pure (the API, the key and the clock are passed in), so it's
 * unit-tested.
 */

export interface HouseBuildDeps {
  build: (mapId: string, toLevel: number, key: string) => Promise<HouseView>;
  newKey?: () => string;
  wait?: (ms: number) => Promise<void>;
  retryAfterMs?: number;
}

/** What one tap on the confirm came to. */
export type BuildOutcome =
  | { readonly kind: 'built'; readonly view: HouseView }
  /** The server said no (or the phone is offline): its kid-readable message. */
  | { readonly kind: 'failed'; readonly message: string }
  /** Another build was in flight, or the player moved on before the reply. */
  | { readonly kind: 'dropped' };

export interface HouseBuilder {
  /** Builds `toLevel`; `stillWanted` is asked before a retry and when the reply lands. */
  build: (mapId: string, toLevel: number, stillWanted: () => boolean) => Promise<BuildOutcome>;
  readonly busy: boolean;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createHouseBuilder(deps: HouseBuildDeps): HouseBuilder {
  let busy = false;
  const send = {
    newKey: deps.newKey ?? newIdempotencyKey,
    wait: deps.wait ?? delay,
    retryAfterMs: deps.retryAfterMs ?? COMMAND_RETRY_MS,
  };
  return {
    async build(mapId, toLevel, stillWanted) {
      if (busy) return { kind: 'dropped' };
      busy = true;
      try {
        const view = await sendCommand(
          send,
          (key) => deps.build(mapId, toLevel, key),
          stillWanted,
        );
        if (!view || !stillWanted()) return { kind: 'dropped' };
        return { kind: 'built', view };
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
