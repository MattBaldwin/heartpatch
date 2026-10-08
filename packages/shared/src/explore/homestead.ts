import { hexBfs, hexKey, type Hex, type HexKey } from '../hex/index.js';

// Homestead tiles (#199, owner design 2026-10-07; contract approved on the
// issue). A tile a player has fully explored joins their home as a
// homestead when it borders their home ring or another of their
// homesteads, so home grows outward as one connected shape. Nothing on the
// tile row says so: it's worked out from the player's explore rows and
// who owns what.
//
// - joined: owned, fully explored, and connected to the player's home
//   tiles through their own fully explored land.
// - paused: joined once (the row's `joined_at` is set) and still owned,
//   but cut off from home since. Its gathering naps until it reconnects.
// - null: anything else, including a fully explored tile that has never
//   touched home: that's ordinary land, never paused or penalised.
//
// Explore progress stays with the player (owner decision 2026-10-06), so a
// homestead a rival captures and the player wins back is joined again at
// once: its row still says it was explored and joined.

export type HomesteadState = 'joined' | 'paused';

/** A map tile as the homestead check sees it. */
export interface HomesteadTile extends Hex {
  readonly ownerUserId: string | null;
  /** Set on the seven tiles of each home (the Heart Seed and its ring). */
  readonly homeSlot: number | null;
}

/** One of the player's explore rows (`tile_explore`), by where its tile is. */
export interface HomesteadRow extends Hex {
  /** Every spot searched (`completed_at` set). */
  readonly completed: boolean;
  /** It has been a homestead before (`joined_at` set). */
  readonly joined: boolean;
  /** It was cut off last time anyone looked (`paused_at` set). */
  readonly paused: boolean;
}

/**
 * Every one of the player's homestead tiles and its state, keyed by hex.
 * Tiles not in the map are neither. Pure: the server passes in the map's
 * tiles and this player's explore rows.
 */
export function homesteadStates(
  tiles: readonly HomesteadTile[],
  rows: readonly HomesteadRow[],
  userId: string,
): Map<HexKey, HomesteadState> {
  const mine = new Map<HexKey, HomesteadTile>();
  for (const tile of tiles) if (tile.ownerUserId === userId) mine.set(hexKey(tile), tile);
  const home = [...mine.values()].filter((t) => t.homeSlot !== null);

  const explored = new Map<HexKey, HomesteadRow>();
  for (const row of rows) {
    const tile = mine.get(hexKey(row));
    if (row.completed && tile && tile.homeSlot === null) explored.set(hexKey(row), row);
  }

  const reached = hexBfs(home, (h) => explored.has(hexKey(h)));
  const states = new Map<HexKey, HomesteadState>();
  for (const [key, row] of explored) {
    if (reached.has(key)) states.set(key, 'joined');
    else if (row.joined) states.set(key, 'paused');
  }
  return states;
}

/** What changed since the rows were written: the server's events and column updates. */
export interface HomesteadChanges {
  /** Became a homestead for the first time (set `joined_at`; `homestead.joined`). */
  readonly joined: Hex[];
  /** Cut off from home (set `paused_at`; `homestead.paused`). */
  readonly paused: Hex[];
  /** Connected again after a pause (clear `paused_at`; `homestead.resumed`). */
  readonly resumed: Hex[];
}

/**
 * Compares the stored rows with the states worked out now. A tile that
 * leaves the player's hands isn't "paused" (it's someone else's); its row
 * keeps `joined_at`, and its `paused_at` is only set if it comes back cut
 * off. Each list is in row order.
 */
export function homesteadChanges(
  rows: readonly HomesteadRow[],
  states: ReadonlyMap<HexKey, HomesteadState>,
): HomesteadChanges {
  const joined: Hex[] = [];
  const paused: Hex[] = [];
  const resumed: Hex[] = [];
  for (const row of rows) {
    const state = states.get(hexKey(row));
    const at = { q: row.q, r: row.r };
    if (state === 'joined' && !row.joined) joined.push(at);
    else if (state === 'joined' && row.paused) resumed.push(at);
    else if (state === 'paused' && !row.paused) paused.push(at);
  }
  return { joined, paused, resumed };
}
