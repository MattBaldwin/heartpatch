import type { HouseView } from '@heartpatch/shared';
import { createHouseCommand, type HouseCommandDeps } from './house-command.js';

/*
 * Building the house's next level (#381 plan §10.5), sent as one house
 * command (house-command.ts): one `Idempotency-Key` per tap on the confirm,
 * the same key on the one retry after a dropped connection (so a build that
 * did land is replayed, never paid twice), and a second tap while one is in
 * flight does nothing. Pure (the API, the key and the clock are passed in),
 * so it's unit-tested.
 */

export interface HouseBuildDeps extends HouseCommandDeps {
  build: (mapId: string, toLevel: number, key: string) => Promise<HouseView>;
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

export function createHouseBuilder(deps: HouseBuildDeps): HouseBuilder {
  const command = createHouseCommand(deps);
  return {
    async build(mapId, toLevel, stillWanted) {
      const outcome = await command.run((key) => deps.build(mapId, toLevel, key), stillWanted);
      return outcome.kind === 'done' ? { kind: 'built', view: outcome.view } : outcome;
    },
    get busy() {
      return command.busy;
    },
  };
}
