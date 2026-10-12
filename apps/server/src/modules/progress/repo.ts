import { and, count, countDistinct, eq, isNotNull, isNull, max, or } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import {
  journeys,
  milestoneRewards,
  speciesSeen,
  squishies,
  tileExplore,
  tiles,
  tradeOffers,
} from '../../db/schema.js';

/** One accepted trade or gift with a player on one side. */
export interface AcceptedOfferRow {
  kind: 'trade' | 'gift';
  fromUserId: string;
  toUserId: string;
}

/**
 * Plain reads for the progress facts (#381 plan §8). No locks: the build
 * transaction (A2) reads them again after its member and house locks, which
 * serialise the only writes that matter to it.
 */
export interface ProgressRepo {
  /** Highest milestone tier per track, for the account (milestones are account-level). */
  milestoneTiers: (userId: string) => Promise<{ milestoneId: string; tier: number }[]>;
  /** Squishies the player has on this patch, in any state. */
  squishyCount: (mapId: string, userId: string) => Promise<number>;
  /** Tiles the player has searched all the way. */
  exploredCount: (mapId: string, userId: string) => Promise<number>;
  speciesSeenCount: (mapId: string, userId: string) => Promise<number>;
  /** Accepted trades and gifts with the player on either side. */
  acceptedOffers: (mapId: string, userId: string) => Promise<AcceptedOfferRow[]>;
  /** Trading posts the player won a journey to, by tile id. */
  wonPostTileIds: (mapId: string, userId: string) => Promise<string[]>;
  /** Homesteads the player has joined on land they still hold, not paused. */
  homesteadCount: (mapId: string, userId: string) => Promise<number>;
}

export function createProgressRepo(db: Executor): ProgressRepo {
  return {
    milestoneTiers: (userId) =>
      db
        .select({ milestoneId: milestoneRewards.milestoneId, tier: max(milestoneRewards.tier) })
        .from(milestoneRewards)
        .where(eq(milestoneRewards.userId, userId))
        .groupBy(milestoneRewards.milestoneId)
        .then((rows) => rows.map((r) => ({ milestoneId: r.milestoneId, tier: r.tier ?? 0 }))),

    squishyCount: async (mapId, userId) => {
      const [row] = await db
        .select({ n: count() })
        .from(squishies)
        .where(and(eq(squishies.mapId, mapId), eq(squishies.ownerUserId, userId)));
      return row?.n ?? 0;
    },

    exploredCount: async (mapId, userId) => {
      const [row] = await db
        .select({ n: count() })
        .from(tileExplore)
        .where(
          and(
            eq(tileExplore.mapId, mapId),
            eq(tileExplore.userId, userId),
            isNotNull(tileExplore.completedAt),
          ),
        );
      return row?.n ?? 0;
    },

    speciesSeenCount: async (mapId, userId) => {
      const [row] = await db
        .select({ n: count() })
        .from(speciesSeen)
        .where(and(eq(speciesSeen.mapId, mapId), eq(speciesSeen.userId, userId)));
      return row?.n ?? 0;
    },

    acceptedOffers: (mapId, userId) =>
      db
        .select({
          kind: tradeOffers.kind,
          fromUserId: tradeOffers.fromUserId,
          toUserId: tradeOffers.toUserId,
        })
        .from(tradeOffers)
        .where(
          and(
            eq(tradeOffers.mapId, mapId),
            eq(tradeOffers.status, 'accepted'),
            or(eq(tradeOffers.fromUserId, userId), eq(tradeOffers.toUserId, userId)),
          ),
        ),

    wonPostTileIds: (mapId, userId) =>
      db
        .selectDistinct({ id: journeys.postTileId })
        .from(journeys)
        .where(
          and(eq(journeys.mapId, mapId), eq(journeys.userId, userId), eq(journeys.outcome, 'won')),
        )
        .then((rows) => rows.map((r) => r.id)),

    homesteadCount: async (mapId, userId) => {
      const [row] = await db
        .select({ n: countDistinct(tileExplore.tileId) })
        .from(tileExplore)
        .innerJoin(tiles, eq(tiles.id, tileExplore.tileId))
        .where(
          and(
            eq(tileExplore.mapId, mapId),
            eq(tileExplore.userId, userId),
            eq(tiles.ownerUserId, userId),
            isNotNull(tileExplore.joinedAt),
            // Paused (cut off from home) until it resumes.
            or(isNull(tileExplore.pausedAt), isNotNull(tileExplore.resumedAt)),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
