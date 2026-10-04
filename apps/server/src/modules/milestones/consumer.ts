import {
  activeSeasons,
  MILESTONE_RULES,
  parseGameEventPayload,
  SEASONS,
  type MilestoneRules,
  type MilestoneTrack,
} from '@heartpatch/shared';
import { milestoneCredits, milestoneEventTypes, tiersReached } from '@heartpatch/shared/server';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createMilestonesRepo } from './repo.js';
import {
  awardTutorialMilestones,
  grantMilestoneTiers,
  tutorialGrants,
  type TierGrant,
} from './service.js';
import { ALL_MILESTONES } from './tracks.js';

/** Plain code-unit order (not locale order), the same in every process. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * When an event happened on the game clock. `game_events.created_at` is the
 * database's clock, while `map_members.joined_at` and season dates use the
 * game clock (`HP_DEV_NOW` moves it), so shift the row's time by the game
 * clock's offset. Judging by the event's own time also means a consumer that
 * lags, or replays history, counts Halloween play by when it was played.
 */
const gameTimeOf = (createdAt: Date, now: Date): Date =>
  new Date(createdAt.getTime() + (now.getTime() - Date.now()));

export interface MilestonesConsumerOptions {
  clock?: Clock;
  /** Tests swap the tracks and rules. */
  tracks?: readonly MilestoneTrack[];
  rules?: MilestoneRules;
}

/**
 * Keeper milestones' event consumer (design doc §24, tech spec §7 "Event
 * consumers"). For each event, in seq order:
 *
 * - on a patch with `minMembers` active members who had joined by the event
 *   (decision F; never the Tutorial Glade), add the progress the shared
 *   counting gives (`milestoneCredits`, seasonal tracks by the patch's local
 *   date on the game clock) and grant every tier that total has reached;
 * - on the Glade, the tutorial's last `tutorial.advanced` grants The First
 *   Patch (`users.tutorial_completed_at`, set in that same transaction), as
 *   does the next counted event of a player who finished it before.
 *
 * Membership and seasons are judged at the event's own game time.
 *
 * Exactly once: the runner applies each event once (`jobs/consumers.ts`),
 * and a tier's reward row is unique, so a retried event or a second path
 * (`GET /milestones`, the boot backfill) never grants twice. It writes no
 * game event, so it never takes `maps`. Lock order (tech spec §7):
 * `event_consumers`, the tracks' `milestone_progress` rows (by player, then
 * track), every `milestone_rewards` row (by player, track, tier), then the
 * pieces and `coin_balances` (`grantMilestoneTiers`).
 */
export function createMilestonesConsumer(options: MilestonesConsumerOptions = {}): EventConsumer {
  const now = options.clock ?? (() => new Date());
  const tracks = options.tracks ?? ALL_MILESTONES;
  const rules = options.rules ?? MILESTONE_RULES;
  const tracksById = new Map(tracks.map((t) => [t.id, t]));
  const eventTypes = milestoneEventTypes(tracks);

  return {
    name: 'milestones',
    mapKinds: ['multiplayer', 'tutorial'],
    handle: async (tx: Transaction, event: GameEvent) => {
      const finishing = event.type === 'tutorial.advanced';
      if (!finishing && !eventTypes.has(event.type)) return;
      const repo = createMilestonesRepo(tx);
      const at = now();
      const happened = gameTimeOf(event.createdAt, at);
      const map = await repo.mapContext(event.mapId, happened);
      if (!map) return;

      if (map.kind === 'tutorial') {
        // Glade play never counts (decision F); finishing it is The First Patch.
        if (!finishing || map.tutorialPlayer === null) return;
        const advanced = parseGameEventPayload('tutorial.advanced', event.payload);
        if (advanced.stepId === null) {
          await awardTutorialMilestones(tx, map.tutorialPlayer, at, tracks);
        }
        return;
      }
      if (finishing || map.members < rules.minMembers) return;

      const seasons = activeSeasons(SEASONS, localDate(happened, map.timeZone)).map((s) => s.id);
      // By player, then track: every milestone transaction locks rows in this order.
      const credits = milestoneCredits(tracks, event, seasons).sort(
        (a, b) => compare(a.userId, b.userId) || compare(a.trackId, b.trackId),
      );
      // Progress rows first (the lock order), then the tiers they reached.
      const reached: TierGrant[] = [];
      for (const credit of credits) {
        const track = tracksById.get(credit.trackId);
        if (!track) continue;
        const total = await repo.addProgress({
          userId: credit.userId,
          milestoneId: credit.trackId,
          amount: credit.amount,
          key: credit.key,
          at,
        });
        if (total === null) continue;
        for (const tier of tiersReached(track, total)) {
          reached.push({ userId: credit.userId, track, tier, mapId: event.mapId, at });
        }
      }
      // "On the next milestone check": a First Patch finished before milestones.
      for (const userId of new Set(credits.map((c) => c.userId))) {
        reached.push(...(await tutorialGrants(tx, userId, at, tracks)));
      }
      // Every reward row, then the pieces and coins (one ordered call).
      await grantMilestoneTiers(tx, reached);
    },
  };
}
