import {
  GAME_DATA,
  heartSeedOf,
  isTradingPost,
  placeTradingPosts,
  type Hex,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { createMapsRepo, type PostPlacementTileRow } from './repo.js';

/*
 * Trading posts for patches made before them (#269; #30 decision 4 and the
 * coordinator's 2026-10-08 ruling). Every boot runs this pass, like
 * `relayoutHomes`; it's idempotent: a map that has its posts is never
 * touched again. New maps are made with theirs by `generateMap`.
 *
 * It runs the same rule (`placeTradingPosts`) over the stored tiles, using
 * only tiles that are neutral, outside every home and free (no building,
 * fence, guard, gatherer, unfinished gather or battle on them), so nobody
 * loses land and nothing is cut off mid-way. A map with no fair spot free is
 * left alone and reported; the next boot tries again, so it gets its posts
 * once enough land is free (land that goes wild, a player who leaves).
 *
 * One transaction per map: the chosen tiles locked in id order (tech spec §7
 * step 6), checked again under the lock, changed, then `post.placed` with
 * `maps` last. No migration: a post is a terrain on the existing rows.
 */

/** What one pass did, for the boot log. */
export interface PostsPlaced {
  /** Maps that got their posts. */
  readonly placed: number;
  /** Maps with no fair spot free yet, for the log and the admin console. */
  readonly skipped: readonly string[];
}

/** The rule's input from stored tiles: busy tiles count as taken. */
function plan(rows: readonly PostPlacementTileRow[], seed: string): Hex[] | null {
  const slots = new Set(rows.flatMap((t) => (t.homeSlot === null ? [] : [t.homeSlot])));
  const homes = [...slots]
    .sort((a, b) => a - b)
    .flatMap((slot) => heartSeedOf(rows.filter((t) => t.homeSlot === slot)) ?? []);
  return placeTradingPosts({
    tiles: rows.map((t) => ({ ...t, ownerUserId: t.busy ? 'busy' : t.ownerUserId })),
    homes,
    gapTerrain: GAME_DATA.mapGen.gapTerrain,
    rules: GAME_DATA.mapGen.tradingPosts,
    seed,
  });
}

/**
 * Places trading posts on every patch that has none, map by map. A map whose
 * pass fails is reported to `onError` and the rest go on. `publish` sends a
 * placed map's `post.placed` to members already watching, after its commit
 * (the hub's after-commit broadcast), so an open map redraws by itself.
 */
export async function placeMissingTradingPosts(
  db: Executor,
  onError: (mapId: string, err: unknown) => void,
  publish?: (mapId: string) => Promise<void>,
): Promise<PostsPlaced> {
  const repo = createMapsRepo(db);
  let placed = 0;
  const skipped: string[] = [];
  for (const map of await repo.listMapsWithoutPosts()) {
    try {
      const done = await placeOne(db, map.id, map.seed);
      if (done === 'placed') {
        placed += 1;
        await publish?.(map.id);
      } else if (done === 'no-room') {
        skipped.push(map.id);
      }
      // 'moved': another boot placed them, or the land changed under the
      // lock; nothing to count, and the next boot looks again if need be.
    } catch (err) {
      onError(map.id, err);
    }
  }
  return { placed, skipped };
}

/**
 * One map, in one transaction: `placed`, `no-room` (no fair spot free) or
 * `moved` (something changed between the read and the lock).
 */
async function placeOne(
  db: Executor,
  mapId: string,
  seed: string,
): Promise<'placed' | 'no-room' | 'moved'> {
  const first = plan(await createMapsRepo(db).listPostPlacementTiles(mapId), seed);
  if (first === null) return 'no-room';
  return createMapsRepo(db).transaction(async (repo) => {
    const before = await repo.listPostPlacementTiles(mapId);
    const idAt = new Map(before.map((t) => [`${String(t.q)},${String(t.r)}`, t.id]));
    const ids = first.flatMap((h) => idAt.get(`${String(h.q)},${String(h.r)}`) ?? []);
    // Under the lock: a claim, a gather or another boot may have got there first.
    const locked = await repo.listPostPlacementTiles(mapId, ids);
    if (locked.some(isTradingPost)) return 'moved';
    const again = plan(locked, seed);
    const keys = (hexes: readonly Hex[]) =>
      hexes.map((h) => `${String(h.q)},${String(h.r)}`).join(' ');
    const same = again !== null && keys(again) === keys(first);
    // Something moved between the read and the lock: leave it for the next boot.
    if (!same) return 'moved';
    const changed = await repo.makeTradingPosts(ids);
    if (changed !== ids.length)
      throw new Error(`placed ${String(changed)} of ${String(ids.length)} posts`);
    await repo.appendEvent({
      mapId,
      type: 'post.placed',
      actorUserId: null,
      payload: { tiles: first.map((h) => ({ q: h.q, r: h.r })) },
    });
    return 'placed';
  });
}
