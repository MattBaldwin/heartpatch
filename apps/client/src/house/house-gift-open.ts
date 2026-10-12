import type { HouseView } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { messageOf } from '../ui/dom.js';

/*
 * Opening the daily gift (#381 H2), as the house build sends its command
 * (house-build.ts): one `Idempotency-Key` per tap on Open it!, the same key
 * on the one retry after a dropped connection (so a gift that did open is
 * replayed, never "Already opened!"), and a second tap while one is in
 * flight does nothing. The server decides what's inside and opens it once
 * (CLAUDE.md rule 1). Pure (the API, the key and the clock are passed in).
 */

export interface GiftOpenDeps {
  claim: (mapId: string, day: string, key: string) => Promise<HouseView>;
  newKey?: () => string;
  wait?: (ms: number) => Promise<void>;
  retryAfterMs?: number;
}

/** What one tap on Open it! came to. */
export type GiftOutcome =
  | { readonly kind: 'opened'; readonly view: HouseView }
  /** The server said no (already opened, lost in the mail) or the phone is offline: its kid-readable message. */
  | { readonly kind: 'failed'; readonly message: string }
  /** Another open was in flight, or the player moved on before the reply. */
  | { readonly kind: 'dropped' };

export interface GiftOpener {
  /** Opens `day`'s gift; `stillWanted` is asked before a retry and when the reply lands. */
  open: (mapId: string, day: string, stillWanted: () => boolean) => Promise<GiftOutcome>;
  readonly busy: boolean;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createGiftOpener(deps: GiftOpenDeps): GiftOpener {
  let busy = false;
  const send = {
    newKey: deps.newKey ?? newIdempotencyKey,
    wait: deps.wait ?? delay,
    retryAfterMs: deps.retryAfterMs ?? COMMAND_RETRY_MS,
  };
  return {
    async open(mapId, day, stillWanted) {
      if (busy) return { kind: 'dropped' };
      busy = true;
      try {
        const view = await sendCommand(send, (key) => deps.claim(mapId, day, key), stillWanted);
        if (!view || !stillWanted()) return { kind: 'dropped' };
        return { kind: 'opened', view };
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
