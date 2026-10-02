import type { PlayerBattle, PlayerBattleAction } from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';

/*
 * Sending one battle action, with the two things a phone needs: a retry
 * when the radio dropped, and a check that the player is still in the
 * battle before anything comes back to the screen. Pure (the API and the
 * clock are passed in), so it's unit-tested without the DOM.
 */

export interface SubmitDeps {
  act: (
    battleId: string,
    action: PlayerBattleAction,
    turn: number,
    key: string,
  ) => Promise<PlayerBattle>;
  /** A fresh `Idempotency-Key`. */
  newKey: () => string;
  /** Waits before the one retry. */
  wait: (ms: number) => Promise<void>;
  retryAfterMs: number;
}

/**
 * Sends `action` for `current`. A submit that never reached the server
 * (the client's `OFFLINE` error) is sent once more with the same
 * `Idempotency-Key`, so one that did land is replayed rather than applied
 * twice (tech spec §5). `stillOpen` is asked after every wait: once the
 * player has left this battle (Back, logout, the map closing), the reply is
 * dropped (null) and no retry is sent, so a late reply can never reopen a
 * screen the player closed.
 */
export async function sendAction(
  deps: SubmitDeps,
  current: Pick<PlayerBattle, 'id'> & { view: Pick<PlayerBattle['view'], 'turn'> },
  action: PlayerBattleAction,
  stillOpen: () => boolean,
): Promise<PlayerBattle | null> {
  const key = deps.newKey();
  const attempt = async (): Promise<PlayerBattle | null> => {
    const reply = await deps.act(current.id, action, current.view.turn, key);
    return stillOpen() ? reply : null;
  };
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof ApiRequestError) || err.code !== 'OFFLINE' || !stillOpen()) throw err;
    await deps.wait(deps.retryAfterMs);
    if (!stillOpen()) return null;
    return attempt();
  }
}
