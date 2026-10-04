import {
  MILESTONE_UNIT,
  type MilestoneReward,
  type MilestonesResponse,
  type MilestoneTier,
  type MilestoneTrack,
  type MilestoneTrackView,
  type PublicUser,
} from '@heartpatch/shared';
import { shownProgress } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { uuidV5 } from '../../lib/uuid-v5.js';
import { creditCoins } from '../coins/service.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import { createMilestonesRepo, type RewardRow } from './repo.js';
import { ALL_MILESTONES } from './tracks.js';

/*
 * Keeper milestones (design doc §24; issue #44). Account-level (DECISIONS F).
 * The `milestones` event consumer counts progress; this module grants tiers
 * and shows them. A tier's reward (its coins, its piece, its title) is
 * granted once: the `milestone_rewards` row is unique per account, track and
 * tier, and its id is the `ref_id` of the coins and the piece, which are
 * unique per `(source, ref_id)` too. Secret tracks (`SECRET_MILESTONES`,
 * server-only, CLAUDE.md rule 6) show as "???" until earned.
 */

/** Kid-readable (style guide §6). */
export const MILESTONE_MESSAGES = {
  notEarned: "You haven't earned that title yet. Keep going!",
  noKeeper: 'Pick your Keeper first, then you can show off a title!',
} as const;

/**
 * Fixed namespace for `milestone_rewards.id` (uuid v5 of account, track and
 * tier under it). It's also the tier's coin and clothing `ref_id`, so the
 * same tier can never pay twice and two players never collide. Never change it.
 */
const REWARD_NAMESPACE = '6a0f8f5e-3c1b-4d0a-9b7e-2f6d4c8a1e57';

/** A tier's reward id for a player. */
export const milestoneRewardId = (userId: string, milestoneId: string, tier: number): string =>
  uuidV5(`${userId}/${milestoneId}/${String(tier)}`, REWARD_NAMESPACE);

/** One tier to grant one player. */
export interface TierGrant {
  userId: string;
  track: MilestoneTrack;
  tier: number;
  /** The patch whose play earned it; null for The First Patch. */
  mapId: string | null;
  at: Date;
}

/** Plain code-unit order (not locale order), the same in every process. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Grants tiers inside the caller's transaction, each exactly once. Lock order
 * (tech spec §7): **every** `milestone_rewards` row first (by player, track,
 * tier), then each new tier's piece (`clothing_owned`, source `milestone`) and
 * coins (`creditCoins`, no daily cap: the account's `coin_balances` row). A
 * reward row inserted after a coin lock would invert that order against
 * another path granting the same tier (`GET /milestones`, the backfill).
 * Returns how many tiers this call granted.
 */
export async function grantMilestoneTiers(
  tx: Executor,
  grants: readonly TierGrant[],
): Promise<number> {
  const repo = createMilestonesRepo(tx);
  const sorted = [...grants].sort(
    (a, b) => compare(a.userId, b.userId) || compare(a.track.id, b.track.id) || a.tier - b.tier,
  );
  const granted: { grant: TierGrant; tier: MilestoneTier; id: string }[] = [];
  for (const grant of sorted) {
    const { userId, track, tier, mapId, at } = grant;
    const data = track.tiers[tier - 1];
    if (!data) continue;
    const id = milestoneRewardId(userId, track.id, tier);
    if (await repo.insertReward({ id, userId, milestoneId: track.id, tier, mapId, at })) {
      granted.push({ grant, tier: data, id });
    }
  }
  for (const { grant, tier, id } of granted) {
    const { userId, mapId, at } = grant;
    if (tier.clothing !== undefined) {
      await createWardrobeRepo(tx).grant({
        userId,
        itemId: tier.clothing,
        source: 'milestone',
        refId: id,
        mapId,
        at,
      });
    }
    await creditCoins(tx, {
      source: 'milestone',
      refId: id,
      userId,
      mapId,
      amount: tier.coins,
      at,
    });
  }
  return granted.length;
}

/**
 * The First Patch's tiers a player is due (DECISIONS "The First Patch
 * (#24)"): granted once the account has finished the tutorial
 * (`users.tutorial_completed_at`, which no event announces). Empty if not.
 */
export async function tutorialGrants(
  tx: Executor,
  userId: string,
  at: Date,
  tracks: readonly MilestoneTrack[] = ALL_MILESTONES,
): Promise<TierGrant[]> {
  const fromTutorial = tracks.filter((t) => t.progress.from === 'tutorial-completed');
  if (fromTutorial.length === 0) return [];
  if ((await createMilestonesRepo(tx).tutorialCompletedAt(userId)) === null) return [];
  return fromTutorial.map((track) => ({ userId, track, tier: 1, mapId: null, at }));
}

/** Grants The First Patch if it's due, in the caller's transaction. True if it granted now. */
export async function awardTutorialMilestones(
  tx: Executor,
  userId: string,
  at: Date,
  tracks: readonly MilestoneTrack[] = ALL_MILESTONES,
): Promise<boolean> {
  return (await grantMilestoneTiers(tx, await tutorialGrants(tx, userId, at, tracks))) > 0;
}

/** Accounts per query while backfilling The First Patch. */
const BACKFILL_BATCH = 100;

const rewardOf = (tier: MilestoneTier): MilestoneReward => ({
  title: tier.title,
  coins: tier.coins,
  clothing: tier.clothing ?? null,
});

export interface MilestonesService {
  get: (user: PublicUser) => Promise<MilestonesResponse>;
  /** The player's client celebrated these. */
  seen: (user: PublicUser, ids: readonly string[]) => Promise<MilestonesResponse>;
  /** Wear an earned title on the profile card, or none. */
  equipTitle: (user: PublicUser, titleId: string | null) => Promise<MilestonesResponse>;
  /**
   * Grants The First Patch to everyone who finished the tutorial before
   * milestones existed (or whose grant was missed). Idempotent; run at boot.
   * One account failing never stops the rest (`onError` hears about it).
   * Returns how many accounts it granted.
   */
  backfillTutorial: (onError?: (userId: string, err: unknown) => void) => Promise<number>;
}

export interface MilestonesServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Tests swap the tracks. */
  tracks?: readonly MilestoneTrack[];
}

export function createMilestonesService(options: MilestonesServiceOptions): MilestonesService {
  const now = options.clock ?? (() => new Date());
  const tracks = options.tracks ?? ALL_MILESTONES;
  const store = createMilestonesRepo(options.db);
  const tracksById = new Map(tracks.map((t) => [t.id, t]));

  /** The tier that gives a title, if any. */
  const tierOfTitle = (titleId: string) => {
    for (const track of tracks) {
      const i = track.tiers.findIndex((t) => t.title.id === titleId);
      if (i >= 0) return { track, tier: i + 1 };
    }
    return null;
  };

  const tutorialDone = async (userId: string, rewards: readonly RewardRow[]) => {
    const pending = tracks.some(
      (t) =>
        t.progress.from === 'tutorial-completed' &&
        !rewards.some((r) => r.milestoneId === t.id && r.tier === 1),
    );
    if (!pending) return false;
    return store.transaction((_repo, tx) => awardTutorialMilestones(tx, userId, now(), tracks));
  };

  const view = async (userId: string): Promise<MilestonesResponse> => {
    let rewards = await store.listRewards(userId);
    // "On the next milestone check": the First Patch for a finished tutorial.
    if (await tutorialDone(userId, rewards)) rewards = await store.listRewards(userId);
    const progress = new Map((await store.listProgress(userId)).map((p) => [p.milestoneId, p]));
    const earned = new Map(rewards.map((r) => [`${r.milestoneId}/${String(r.tier)}`, r]));
    const shown: MilestoneTrackView[] = [];
    const hidden: MilestoneTrackView[] = [];
    for (const track of tracks) {
      const mine = rewards.filter((r) => r.milestoneId === track.id);
      if (track.secret && mine.length === 0) {
        hidden.push({ hidden: true });
        continue;
      }
      const total =
        track.progress.from === 'tutorial-completed'
          ? mine.length * MILESTONE_UNIT
          : (progress.get(track.id)?.progress ?? 0);
      shown.push({
        hidden: false,
        id: track.id,
        name: track.name,
        secret: track.secret,
        season: track.season ?? null,
        progress: shownProgress(track, total),
        tiers: track.tiers.map((tier, i) => ({
          tier: i + 1,
          threshold: tier.threshold,
          goal: tier.goal,
          reward: rewardOf(tier),
          earnedAt: earned.get(`${track.id}/${String(i + 1)}`)?.earnedAt.toISOString() ?? null,
        })),
      });
    }
    // A reward whose track or tier the data no longer has shows nothing.
    const known = rewards.flatMap((row) => {
      const track = tracksById.get(row.milestoneId);
      const tier = track?.tiers[row.tier - 1];
      return track && tier ? [{ row, track, tier }] : [];
    });
    const titles = known.map((k) => k.tier.title);
    const worn = (await store.wornTitle(userId)) ?? null;
    return {
      tracks: [...shown, ...hidden],
      titles,
      // A title the data no longer has, or one never earned, isn't shown.
      equippedTitleId: worn !== null && titles.some((t) => t.id === worn) ? worn : null,
      news: known
        .filter((k) => k.row.seenAt === null)
        .map((k) => ({
          id: k.row.id,
          trackName: k.track.name,
          goal: k.tier.goal,
          reward: rewardOf(k.tier),
          earnedAt: k.row.earnedAt.toISOString(),
        })),
    };
  };

  return {
    get: (user) => view(user.id),

    seen: async (user, ids) => {
      await store.markSeen(user.id, ids, now());
      return view(user.id);
    },

    equipTitle: async (user, titleId) => {
      if (titleId !== null) {
        const source = tierOfTitle(titleId);
        const rewards = source ? await store.listRewards(user.id) : [];
        const has = rewards.some(
          (r) => source && r.milestoneId === source.track.id && r.tier === source.tier,
        );
        if (!has) throw new AppError('FORBIDDEN', MILESTONE_MESSAGES.notEarned);
      }
      if (!(await store.setWornTitle(user.id, titleId, now()))) {
        throw new AppError('CONFLICT', MILESTONE_MESSAGES.noKeeper);
      }
      return view(user.id);
    },

    backfillTutorial: async (onError) => {
      const fromTutorial = tracks.filter((t) => t.progress.from === 'tutorial-completed');
      let granted = 0;
      for (const track of fromTutorial) {
        // Pages by account id, so a failed account is passed over, never retried in a loop.
        let after: string | null = null;
        for (;;) {
          const missing = await store.missingTutorialReward(track.id, after, BACKFILL_BATCH);
          for (const userId of missing) {
            try {
              granted += await store.transaction((_repo, tx) =>
                grantMilestoneTiers(tx, [{ userId, track, tier: 1, mapId: null, at: now() }]),
              );
            } catch (err) {
              onError?.(userId, err);
            }
          }
          after = missing[missing.length - 1] ?? null;
          if (missing.length < BACKFILL_BATCH) break;
        }
      }
      return granted;
    },
  };
}
