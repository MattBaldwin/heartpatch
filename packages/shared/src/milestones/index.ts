import { MILESTONE_UNIT, type MilestoneTrack } from '../schemas/data/milestones.js';
import { predicateHolds, valueAt } from '../tutorial/index.js';

// Keeper milestones (design doc §24; issue #44): which progress a game event
// makes, and which tiers a total has reached. Pure, so the server's milestone
// consumer and tests share it. Exported from `@heartpatch/shared/server`
// beside the secret tracks it reads.

/** The parts of a `game_events` row the counting reads. */
export interface MilestoneEvent {
  type: string;
  payload: unknown;
}

/** Progress one event gives one player on one track. */
export interface MilestoneCredit {
  trackId: string;
  userId: string;
  /** In hundredths of a step (`MILESTONE_UNIT`). */
  amount: number;
  /**
   * For tracks that count kinds of things: the kind (a species id). It only
   * counts the first time; the server keeps the kinds already counted.
   */
  key: string | null;
}

/** Every event type that can move a track along. */
export function milestoneEventTypes(tracks: readonly MilestoneTrack[]): Set<string> {
  const types = new Set<string>();
  for (const track of tracks) {
    if (track.progress.from !== 'events') continue;
    for (const source of track.progress.sources) types.add(source.eventType);
  }
  return types;
}

/**
 * The progress `event` makes. `seasons` are the seasons on at the event's
 * patch (by its local date): a seasonal track only counts in its season.
 * The caller decides whether the patch counts at all (decision F).
 */
export function milestoneCredits(
  tracks: readonly MilestoneTrack[],
  event: MilestoneEvent,
  seasons: readonly string[],
): MilestoneCredit[] {
  const credits: MilestoneCredit[] = [];
  for (const track of tracks) {
    if (track.progress.from !== 'events') continue;
    if (track.season !== undefined && !seasons.includes(track.season)) continue;
    for (const source of track.progress.sources) {
      if (source.eventType !== event.type) continue;
      if (!source.where.every((p) => predicateHolds(p, event.payload))) continue;
      const userId = valueAt(event.payload, source.player);
      if (typeof userId !== 'string') continue;
      let key: string | null = null;
      if (source.distinct !== undefined) {
        const kind = valueAt(event.payload, source.distinct);
        if (typeof kind !== 'string' && typeof kind !== 'number') continue;
        key = String(kind);
      }
      let amount = MILESTONE_UNIT;
      if (source.scaleBy !== undefined) {
        const percent = valueAt(event.payload, source.scaleBy);
        if (typeof percent !== 'number') continue;
        amount = Math.floor((MILESTONE_UNIT * Math.min(100, Math.max(0, percent))) / 100);
      }
      if (amount > 0) credits.push({ trackId: track.id, userId, amount, key });
    }
  }
  return credits;
}

/** Tier numbers (1 = the first) a total in hundredths has reached. */
export function tiersReached(track: MilestoneTrack, progress: number): number[] {
  return track.tiers.flatMap((tier, i) =>
    progress >= tier.threshold * MILESTONE_UNIT ? [i + 1] : [],
  );
}

/** Whole steps to show on the bar: rounded down, never past the last tier. */
export function shownProgress(track: MilestoneTrack, progress: number): number {
  const last = track.tiers[track.tiers.length - 1]?.threshold ?? 0;
  return Math.min(last, Math.floor(Math.max(0, progress) / MILESTONE_UNIT));
}
