import {
  GAME_DATA,
  hexDistance,
  PATCH_TREE,
  tradingPostLabels,
  type MapViewChristmas,
  type OrnamentSource,
  type PatchTreeRules,
  type TradeLine,
} from '@heartpatch/shared';
import type { Executor, Transaction } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { christmasOn } from '../advent/service.js';
import { createTreeRepo, type PatchTreeDbRow, type TreePostRow } from './repo.js';

/*
 * The Patch Tree (#37 2c; plan §2, §3; owner answer 5). One shared tree per
 * patch at the trading post nearest the map's centre. Every gift picked up
 * between patch-mates on a December patch day hangs an ornament on it and
 * warms that pair; a present gifted unopened hangs two and warms them twice.
 * At `PATCH_TREE.starAt` ornaments the star lights (`star_lit_at`, once; the
 * Christmas Eve bar's head start reads it).
 *
 * Timestamps, not loops (rule 4): nothing ticks. The tree is planted on the
 * patch's first Christmas map view (`plantTree`, before the snapshot) or by
 * the first December gift's pickup, whichever comes first. Writes happen only
 * inside the gift pickup's transaction (`decorateForGifts`, rule 7), after
 * its bag rows: the pairs' `keeper_warmth` rows in pair order, then the
 * `patch_trees` row (tech spec §7 step 12c), then `maps` last.
 */

const CENTRE = { q: 0, r: 0 } as const;

/**
 * The post the tree stands at: nearest the map's centre, ties to the lowest
 * `PostView.index` (posts in `(q, r)` order), so the same land always picks
 * the same post. Null on a patch with no post.
 */
export function treePostOf<P extends { q: number; r: number }>(posts: readonly P[]): P | null {
  let best: P | null = null;
  for (const post of posts) {
    if (best === null) {
      best = post;
      continue;
    }
    const d = hexDistance(post, CENTRE) - hexDistance(best, CENTRE);
    if (d < 0 || (d === 0 && (post.q - best.q || post.r - best.r) < 0)) best = post;
  }
  return best;
}

/** A gift between patch-mates, as the pickup holds it. */
export interface PickedUpGift {
  offerId: string;
  fromUserId: string;
  toUserId: string;
  lines: readonly TradeLine[];
}

/** What a gift hangs: a present gifted unopened is a `present-gift`. */
export function ornamentSourceOf(
  lines: readonly TradeLine[],
  rules: Pick<PatchTreeRules, 'presentItemId'> = PATCH_TREE,
): OrnamentSource {
  return lines.some((l) => l.kind === 'item' && l.itemId === rules.presentItemId && l.quantity > 0)
    ? 'present-gift'
    : 'gift';
}

/** A warmth pair stored ordered (Postgres lowercase uuids compare as their bytes do). */
export function orderedPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/** The tree's post, checked to be a trading post on this patch (the DB doesn't check it). */
function postOfTree(tree: PatchTreeDbRow, posts: readonly TreePostRow[]) {
  const post = posts.find((p) => p.id === tree.postTileId);
  if (!post) return null;
  const index = tradingPostLabels(posts, GAME_DATA.mapGen.tradingPosts).get(
    `${String(post.q)},${String(post.r)}`,
  )?.index;
  return index === undefined ? null : { post, index };
}

/**
 * Plants the patch's tree if it has none (idempotent: a racing read plants
 * nothing twice). Only a multiplayer patch, only while its Christmas season
 * is on. Its own short write, outside the map view's read-only snapshot.
 */
export async function plantTree(
  db: Executor,
  map: { id: string; kind: 'multiplayer' | 'tutorial'; timeZone: string },
  at: Date,
): Promise<void> {
  if (map.kind !== 'multiplayer' || !christmasOn(at, map.timeZone)) return;
  const repo = createTreeRepo(db);
  if (await repo.findTree(map.id)) return;
  const post = treePostOf(await repo.listPosts(map.id));
  if (post) await repo.plant(map.id, post.id, at);
}

/**
 * `MapView.christmas.tree` and `warmth` for one viewer (plain reads). `tree`
 * is always there once the patch has one whose post is on this patch;
 * absent means "not planted yet". `warmth` lists the patch-mates in
 * `memberIds` I have any warmth with, never anyone else's pairs.
 */
export async function treeViewFor(
  db: Executor,
  mapId: string,
  userId: string,
  memberIds: ReadonlySet<string>,
): Promise<Pick<MapViewChristmas, 'tree' | 'warmth'>> {
  const repo = createTreeRepo(db);
  const [tree, posts, pairs] = await Promise.all([
    repo.findTree(mapId),
    repo.listPosts(mapId),
    repo.warmthOf(mapId, userId),
  ]);
  const at = tree ? postOfTree(tree, posts) : null;
  const warmth = pairs
    .map((p) => ({ userId: p.userAId === userId ? p.userBId : p.userAId, warmth: p.warmth }))
    .filter((w) => w.userId !== userId && memberIds.has(w.userId))
    .sort((a, b) => (a.userId < b.userId ? -1 : 1));
  return {
    ...(tree && at
      ? {
          tree: {
            postIndex: at.index,
            ornaments: tree.ornaments,
            starLit: tree.starLitAt !== null,
          },
        }
      : {}),
    warmth,
  };
}

/**
 * Hangs the ornaments and adds the warmth for gifts picked up in this
 * transaction (`trades` `pickupWithin`), and queues one `tree.decorated` per
 * gift. Nothing outside a December patch day or on a tutorial patch. The
 * caller holds the gifts' offer and mailbox rows (step 9b), so a gift is
 * counted once: its pickup moves it to `accepted` in the same commit.
 */
export async function decorateForGifts(
  tx: Transaction,
  events: NewGameEvent[],
  input: { mapId: string; gifts: readonly PickedUpGift[]; at: Date; actorUserId: string },
  rules: PatchTreeRules = PATCH_TREE,
): Promise<void> {
  const { mapId, at } = input;
  const gifts = input.gifts.filter((g) => g.fromUserId !== g.toUserId);
  if (gifts.length === 0) return;
  const repo = createTreeRepo(tx);
  const map = await repo.findMap(mapId);
  if (map?.kind !== 'multiplayer' || !christmasOn(at, map.timeZone)) return;
  const sourced = gifts.map((gift) => ({ gift, source: ornamentSourceOf(gift.lines, rules) }));

  // Warmth (step 12c): each pair's row once, in pair order.
  const byPair = new Map<string, { a: string; b: string; by: number }>();
  for (const { gift, source } of sourced) {
    const [a, b] = orderedPair(gift.fromUserId, gift.toUserId);
    const key = `${a}:${b}`;
    const pair = byPair.get(key) ?? { a, b, by: 0 };
    pair.by += rules.warmth[source];
    byPair.set(key, pair);
  }
  const pairs = [...byPair.values()].sort((x, y) =>
    x.a === y.a ? (x.b < y.b ? -1 : 1) : x.a < y.a ? -1 : 1,
  );
  for (const p of pairs) await repo.addWarmth(mapId, p.a, p.b, p.by, at);

  // Then the tree (step 12c), planted first if no read has yet.
  const posts = await repo.listPosts(mapId);
  if (!(await repo.findTree(mapId))) {
    const post = treePostOf(posts);
    if (!post) return;
    await repo.plant(mapId, post.id, at);
  }
  const tree = await repo.lockTree(mapId);
  if (!tree) return;
  const stand = postOfTree(tree, posts);
  // A tree whose post isn't on this patch any more hangs nothing.
  if (!stand) return;
  let ornaments = tree.ornaments;
  let starLitAt = tree.starLitAt;
  for (const { gift, source } of sourced) {
    const added = rules.ornaments[source];
    ornaments += added;
    const starLit = starLitAt === null && ornaments >= rules.starAt;
    if (starLit) starLitAt = at;
    events.push({
      mapId,
      type: 'tree.decorated',
      actorUserId: input.actorUserId,
      payload: {
        offerId: gift.offerId,
        postTileId: stand.post.id,
        postIndex: stand.index,
        fromUserId: gift.fromUserId,
        toUserId: gift.toUserId,
        source,
        added,
        ornaments,
        starLit,
      },
    });
  }
  await repo.setOrnaments(mapId, ornaments, starLitAt);
}
