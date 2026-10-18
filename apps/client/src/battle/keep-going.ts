import {
  FENCE_RULES,
  type Hex,
  type MapView,
  type PlayerBattle,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { sendCommand, type SendDeps } from '../inventory/send-command.js';
import { messageOf } from '../ui/dom.js';
import { fenceToBreak } from '../territory/territory-action.js';

// "Keep going!" on the fence-broke result card (#527): the guard showdown
// starts from the card, with the same server command the tile panel sends
// (`attack` on that tile, no new try inside `keepGoingMinutes`). The server
// decides every rule; this only finds the tile, skips a send that would spend
// a try on a rebuilt fence, and turns a refusal into words on the card.

export const KEEP_GOING_TEXT = {
  keepGoing: 'Keep going!',
  notNow: 'Not now',
  // The window ran out, or the land isn't the same Keeper's any more.
  passed: 'That chance is over. Tap the land on the map to start again!',
  // The owner built the gap up again, so it's a fresh fence battle (and a try).
  rebuilt: 'The fence was fixed up! Tap the land on the map to challenge it again.',
} as const;

/** What the card's calls need: the territory panel's `status` and `attack`, and the map view. */
export interface KeepGoingApi {
  status: (mapId: string) => Promise<TerritoryStatus>;
  view: (mapId: string) => Promise<MapView>;
  attack: (mapId: string, at: Hex, key: string) => Promise<PlayerBattle>;
}

export type KeepGoingOutcome =
  /** The guard battle is on: show it. */
  | { readonly kind: 'battle'; readonly battle: PlayerBattle }
  /** Not started: say why on the card. */
  | { readonly kind: 'say'; readonly text: string }
  /** The player moved on while it was sending: nothing to show. */
  | { readonly kind: 'gone' };

const MINUTE_MS = 60 * 1000;

/**
 * The tile whose broken fence this battle was. A battle doesn't say which tile
 * it was on, so it is the open "Keep going" window (`fenceBroken`) that ends
 * closest to when this battle ended plus the window, as the server counts it.
 * Null when no window is open.
 */
export function brokenTileOf(status: TerritoryStatus, endedAt: string | null): Hex | null {
  const now = Date.parse(status.now);
  const open = (status.fenceBroken ?? []).filter((b) => Date.parse(b.until) > now);
  const want =
    endedAt === null ? Infinity : Date.parse(endedAt) + FENCE_RULES.keepGoingMinutes * MINUTE_MS;
  let best: Hex | null = null;
  let bestGap = Infinity;
  for (const b of open) {
    const gap = Math.abs(Date.parse(b.until) - want);
    if (best === null || gap < bestGap) {
      best = { q: b.q, r: b.r };
      bestGap = gap;
    }
  }
  return best;
}

/** Starts the guard showdown after `battle` broke a fence; never throws. */
export async function keepGoing(
  api: KeepGoingApi,
  send: SendDeps,
  battle: PlayerBattle,
  me: string | null,
  stillHere: () => boolean,
): Promise<KeepGoingOutcome> {
  try {
    const [status, view] = await Promise.all([api.status(battle.mapId), api.view(battle.mapId)]);
    if (!stillHere()) return { kind: 'gone' };
    const at = brokenTileOf(status, battle.endedAt);
    const tile = at && view.tiles.find((t) => t.q === at.q && t.r === at.r);
    if (!tile || me === null || tile.ownerUserId === null || tile.ownerUserId === me) {
      return { kind: 'say', text: KEEP_GOING_TEXT.passed };
    }
    // Fenced up again: the server would start a new fence battle and spend a try.
    // The panel offers Challenge for that, not Keep going.
    if (fenceToBreak(tile, view, me)) return { kind: 'say', text: KEEP_GOING_TEXT.rebuilt };
    const next = await sendCommand(send, (key) => api.attack(battle.mapId, at, key), stillHere);
    return next && stillHere() ? { kind: 'battle', battle: next } : { kind: 'gone' };
  } catch (err) {
    return stillHere() ? { kind: 'say', text: messageOf(err) } : { kind: 'gone' };
  }
}
