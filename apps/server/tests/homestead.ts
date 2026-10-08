// Test helper (#277): a homestead for a player, the way #199 makes one, without
// walking every search spot. A neutral tile just outside the player's home
// ring becomes theirs, fully explored and joined to home.
import { hexDistance } from '@heartpatch/shared';
import type { Executor } from '../src/db/client.js';

export interface HomesteadTile {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly terrain: string;
}

/**
 * Makes the `nth` free tile next to `userId`'s home ring (in id order) theirs
 * and a joined homestead (`tile_explore` completed and joined at `at`).
 */
export async function makeHomestead(
  db: Executor,
  mapId: string,
  userId: string,
  at: Date,
  nth = 0,
): Promise<HomesteadTile> {
  const tiles = [
    ...(await db.execute<{
      id: string;
      q: number;
      r: number;
      terrain: string;
      owner_user_id: string | null;
      home_slot: number | null;
    }>(
      `select id, q, r, terrain, owner_user_id, home_slot from tiles where map_id = '${mapId}' order by id`,
    )),
  ];
  const home = tiles.filter((t) => t.owner_user_id === userId && t.home_slot !== null);
  if (home.length === 0) throw new Error('makeHomestead: the player has no home');
  const seed = {
    q: home.reduce((n, t) => n + t.q, 0) / home.length,
    r: home.reduce((n, t) => n + t.r, 0) / home.length,
  };
  const free = tiles.filter(
    (t) => t.owner_user_id === null && t.home_slot === null && hexDistance(t, seed) === 2,
  );
  const tile = free[nth];
  if (!tile) throw new Error('makeHomestead: no free tile next to home');
  const when = at.toISOString();
  await db.execute(`update tiles set owner_user_id = '${userId}' where id = '${tile.id}'`);
  await db.execute(
    `insert into tile_explore (user_id, tile_id, map_id, layout, terrain, searched, spot_count, completed_at, joined_at)
     values ('${userId}', '${tile.id}', '${mapId}', 1, '${tile.terrain}', 7, 3, '${when}', '${when}')`,
  );
  return { id: tile.id, q: tile.q, r: tile.r, terrain: tile.terrain };
}
