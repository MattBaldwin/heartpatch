import {
  canFade,
  EMPTY_PROGRESS_FACTS,
  hexDistance,
  heartSeedOf,
  isTradingPost,
  landMood,
  postReach,
  TERRITORY_RULES,
  type ProgressFacts,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { fireStateAt } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { createTendingRepo, createTerritoryRepo } from '../territory/repo.js';
import { createProgressRepo } from './repo.js';

/*
 * The progress facts gatherer (#381 plan §8): every fact the shared
 * requirement evaluator reads, for one Keeper on one patch, in one read of
 * about ten queries on existing indexes. Used by `GET /house` now, inside
 * the house build transaction next (A2), and by the Heart Seed (#221) later,
 * which reads the same facts and ignores what it doesn't use.
 *
 * Not yet gathered, and why: `heartSeedLevel` reads 1 until Heart Seed
 * levels land (#221); `residents` is empty until the house tables land (A2)
 * and residents move in (C); `decorations` is 0 until furniture (Phase 2).
 */

export interface FactsInput {
  mapId: string;
  userId: string;
  /** The patch's time zone, for tonight's fires. */
  timeZone: string;
  at: Date;
}

export async function gatherProgressFacts(tx: Executor, input: FactsInput): Promise<ProgressFacts> {
  const { mapId, userId, timeZone, at } = input;
  const repo = createProgressRepo(tx);
  const rules = TERRITORY_RULES.tending;
  const [
    mapTiles,
    outerTiles,
    buildings,
    milestoneTiers,
    befriended,
    explored,
    speciesSeen,
    offers,
    wonPosts,
    homesteads,
  ] = await Promise.all([
    createTerritoryRepo(tx).listTiles(mapId),
    createTendingRepo(tx).outerTiles(mapId, userId),
    createBuildingsRepo(tx).listOwned(mapId, userId),
    repo.milestoneTiers(userId),
    repo.squishyCount(mapId, userId),
    repo.exploredCount(mapId, userId),
    repo.speciesSeenCount(mapId, userId),
    repo.acceptedOffers(mapId, userId),
    repo.wonPostTileIds(mapId, userId),
    repo.homesteadCount(mapId, userId),
  ]);

  const owned = mapTiles.filter((t) => t.ownerUserId === userId);
  const seed = heartSeedOf(owned.filter((t) => t.homeSlot !== null));

  // Land that misses you isn't tended; the home ring, land near home and
  // joined homesteads never fade, so they always count (tending.ts `statusOf`).
  const fading = outerTiles.filter(
    (t) =>
      canFade({ ...t, homeSlot: null }, seed, rules) &&
      landMood(t.tendedAt ?? at, at, rules) !== 'happy',
  ).length;

  // A post is used once my land reaches it, or once I won a journey to it.
  const posts = new Set(wonPosts);
  for (const tile of mapTiles) {
    if (isTradingPost(tile) && postReach(tile, mapTiles, userId)?.kind === 'connected') {
      posts.add(tile.id);
    }
  }

  return {
    ...EMPTY_PROGRESS_FACTS,
    ownedTileDistances: seed === null ? [] : owned.map((t) => hexDistance(t, seed)),
    milestoneTiers: Object.fromEntries(milestoneTiers.map((m) => [m.milestoneId, m.tier])),
    befriended,
    buildings: buildings.map((b) => ({ buildingId: b.buildingId, kind: b.kind })),
    explored,
    speciesSeen,
    litFires: buildings.filter(
      (b) => b.kind === 'hearthfire' && fireStateAt(b.fuelledThrough, at, timeZone).lit,
    ).length,
    trades: offers.map((o) => ({
      kind: o.kind,
      partnerUserId: o.fromUserId === userId ? o.toUserId : o.fromUserId,
    })),
    postsUsed: posts.size,
    tilesTended: owned.length - fading,
    homesteads,
  };
}
