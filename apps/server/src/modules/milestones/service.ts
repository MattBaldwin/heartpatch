import {
  MILESTONE_TRACKS,
  MILESTONE_UNIT,
  type MilestoneReward,
  type MilestonesResponse,
  type MilestoneTier,
  type MilestoneTrack,
  type MilestoneTrackView,
  type PublicUser,
} from '@heartpatch/shared';
import { SECRET_MILESTONES, shownProgress } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { uuidV5 } from '../../lib/uuid-v5.js';
import { creditCoins } from '../coins/service.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import { createMilestonesRepo, type RewardRow } from './repo.js';

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

/** Every track, public then secret. */
export const ALL_MILESTONES: readonly MilestoneTrack[] = [
  ...MILESTONE_TRACKS,
  ...SECRET_MILESTONES,
];

/**
 * Fixed namespace for `milestone_rewards.id` (uuid v5 of account, track and
 * tier under it). It's also the tier's coin and clothing `ref_id`, so the
 * same tier can never pay twice and two players never collide. Never change it.
 */
const REWARD_NAMESPACE = '6a0f8f5e-3c1b-4d0a-9b7e-2f6d4c8a1e57';

/** A tier's reward id for a player. */
export const milestoneRewardId = (userId: string, milestoneId: string, tier: number): string =>
  uuidV5(`${userId}/${milestoneId}/${String(tier)}`, REWARD_NAMESPACE);

/**
 * Grants one tier inside the caller's transaction: the `milestone_rewards`
 * row, then the piece (`clothing_owned`, source `milestone`), then the coins
 * (`creditCoins`, no daily cap). Lock order (tech spec §7): after the track's
 * `milestone_progress` row, before `maps`; `creditCoins` takes the account's
 * `coin_balances` row. True if this call granted it, false if it already was.
 */
export async function grantMilestoneTier(
  tx: Executor,
  grant: { userId: string; track: MilestoneTrack; tier: number; mapId: string | null; at: Date },
): Promise<boolean> {
  const { userId, track, tier, mapId, at } = grant;
  const data = track.tiers[tier - 1];
  if (!data) return false;
  const id = milestoneRewardId(userId, track.id, tier);
  const repo = createMilestonesRepo(tx);
  if (!(await repo.insertReward({ id, userId, milestoneId: track.id, tier, mapId, at }))) {
    return false;
  }
  if (data.clothing !== undefined) {
    await createWardrobeRepo(tx).grant({
      userId,
      itemId: data.clothing,
      source: 'milestone',
      refId: id,
      mapId,
      at,
    });
  }
  // Account-level: coins from milestones aren't a patch's (#45).
  await creditCoins(tx, { source: 'milestone', refId: id, userId, amount: data.coins, at });
  return true;
}

/**
 * The First Patch (DECISIONS "The First Patch (#24)"): granted once the
 * account has finished the tutorial (`users.tutorial_completed_at`, which no
 * event announces). Idempotent, in the caller's transaction. True if it
 * granted something now.
 */
export async function awardTutorialMilestones(
  tx: Executor,
  userId: string,
  at: Date,
  tracks: readonly MilestoneTrack[] = ALL_MILESTONES,
): Promise<boolean> {
  const fromTutorial = tracks.filter((t) => t.progress.from === 'tutorial-completed');
  if (fromTutorial.length === 0) return false;
  if ((await createMilestonesRepo(tx).tutorialCompletedAt(userId)) === null) return false;
  let granted = false;
  for (const track of fromTutorial) {
    if (await grantMilestoneTier(tx, { userId, track, tier: 1, mapId: null, at })) granted = true;
  }
  return granted;
}

/** Accounts per query while backfilling The First Patch. */
const BACKFILL_BATCH = 100;

const TITLE_NAMES = new Map(
  ALL_MILESTONES.flatMap((t) => t.tiers.map((tier) => [tier.title.id, tier.title.name] as const)),
);

/**
 * A worn title's name for other players (`MapMember.title`), or null. Only
 * earned titles can be worn (`equipTitle` checks), so a secret one shown here
 * was earned by its wearer.
 */
export const titleName = (titleId: string | null): string | null =>
  titleId === null ? null : (TITLE_NAMES.get(titleId) ?? null);

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
   * Returns how many accounts it granted.
   */
  backfillTutorial: () => Promise<number>;
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

    backfillTutorial: async () => {
      const fromTutorial = tracks.filter((t) => t.progress.from === 'tutorial-completed');
      let granted = 0;
      for (const track of fromTutorial) {
        for (;;) {
          const missing = await store.missingTutorialReward(track.id, BACKFILL_BATCH);
          let batch = 0;
          for (const userId of missing) {
            const did = await store.transaction((_repo, tx) =>
              grantMilestoneTier(tx, { userId, track, tier: 1, mapId: null, at: now() }),
            );
            if (did) batch += 1;
          }
          granted += batch;
          // Done, or nothing grantable left (never spin on the same rows).
          if (missing.length < BACKFILL_BATCH || batch === 0) break;
        }
      }
      return granted;
    },
  };
}
