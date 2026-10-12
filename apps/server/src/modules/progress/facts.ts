import {
  canFade,
  connectedLand,
  EMPTY_PROGRESS_FACTS,
  hexDistance,
  heartSeedOf,
  isTradingPost,
  landMood,
  hexKey,
  hexNeighbors,
  MILESTONE_TRACKS,
  TERRITORY_RULES,
  type ProgressFacts,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { fireStateAt } from '../buildings/hearthfire.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { createHouseRepo } from '../house/repo.js';
import { contentmentsOf } from '../jobs/contentment.js';
import { createTendingRepo, createTerritoryRepo } from '../territory/repo.js';
import { createProgressRepo } from './repo.js';

/*
 * The progress facts gatherer (#381 plan §8): every fact the shared
 * requirement evaluator reads, for one Keeper on one patch, in one read of
 * about ten queries on existing indexes. Used by `GET /house` now, inside
 * the house build transaction next (A2), and by the Heart Seed (#221) later,
 * which reads the same facts and ignores what it doesn't use.
 *
 * Residents count only while they're active (one in a trade or in the
 * Hollow is away), with contentment worked out now (CLAUDE.md rule 4).
 * Not yet gathered, and why: `heartSeedLevel` reads 1 until Heart Seed
 * levels land (#221); `decorations` is 0 until furniture (Phase 2).
 */

/** Milestones a kid can see (secret tracks are server-only, CLAUDE.md rule 6). */
const PUBLIC_TRACKS = new Set(MILESTONE_TRACKS.map((t) => t.id));

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
    residentRows,
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
    createHouseRepo(tx).residents(mapId, userId),
  ]);
  const residents = residentRows.filter((r) => r.state === 'active');
  const contentment = await contentmentsOf(
    tx,
    mapId,
    residents.map((r) => r.squishyId),
    at,
  );

  const owned = mapTiles.filter((t) => t.ownerUserId === userId);
  const seed = heartSeedOf(owned.filter((t) => t.homeSlot !== null));

  // Land that misses you isn't tended; the home ring, land near home and
  // joined homesteads never fade, so they always count (tending.ts `statusOf`).
  const fading = outerTiles.filter(
    (t) =>
      canFade({ ...t, homeSlot: null }, seed, rules) &&
      landMood(t.tendedAt ?? at, at, rules) !== 'happy',
  ).length;

  // A post is used once my land reaches it (`postReach`'s "connected"), or
  // once I won a journey to it. Connected land is worked out once, not per post.
  const posts = new Set(wonPosts);
  const connected = connectedLand(mapTiles, userId);
  for (const tile of mapTiles) {
    if (isTradingPost(tile) && hexNeighbors(tile).some((n) => connected.has(hexKey(n)))) {
      posts.add(tile.id);
    }
  }

  return {
    ...EMPTY_PROGRESS_FACTS,
    ownedTileDistances: seed === null ? [] : owned.map((t) => hexDistance(t, seed)),
    // Public tracks only: a visible row never moves on a secret milestone.
    milestoneTiers: Object.fromEntries(
      milestoneTiers
        .filter((m) => PUBLIC_TRACKS.has(m.milestoneId))
        .map((m) => [m.milestoneId, m.tier]),
    ),
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
    residents: residents.map((r) => ({
      contentment: contentment.get(r.squishyId)?.contentment ?? 0,
      level: r.level,
      evolved: r.evolved,
    })),
    postsUsed: posts.size,
    tilesTended: owned.length - fading,
    homesteads,
  };
}
