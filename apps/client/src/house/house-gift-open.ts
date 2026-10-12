import type { HouseView } from '@heartpatch/shared';
import { createHouseCommand, type HouseCommandDeps } from './house-command.js';

/*
 * Opening the daily gift (#381 H2), sent as one house command
 * (house-command.ts, as the build is): one `Idempotency-Key` per tap on
 * Open it!, the same key on the one retry after a dropped connection (so a
 * gift that did open is replayed, never "Already opened!"), and a second tap
 * while one is in flight does nothing. The server decides what's inside and
 * opens it once (CLAUDE.md rule 1). Pure (the API, the key and the clock are
 * passed in).
 */

export interface GiftOpenDeps extends HouseCommandDeps {
  claim: (mapId: string, day: string, key: string) => Promise<HouseView>;
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

export function createGiftOpener(deps: GiftOpenDeps): GiftOpener {
  const command = createHouseCommand(deps);
  return {
    async open(mapId, day, stillWanted) {
      const outcome = await command.run((key) => deps.claim(mapId, day, key), stillWanted);
      return outcome.kind === 'done' ? { kind: 'opened', view: outcome.view } : outcome;
    },
    get busy() {
      return command.busy;
    },
  };
}
