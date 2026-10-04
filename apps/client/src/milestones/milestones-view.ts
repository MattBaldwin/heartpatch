import {
  CLOTHING_BY_ID,
  GAME_DATA,
  type MilestoneNews,
  type MilestoneReward,
  type MilestoneTrackView,
  type WsEventMessage,
} from '@heartpatch/shared';

// What the Milestones screen and its celebration show (design doc §24). Pure,
// so it's tested without a DOM. Player-facing words follow the style guide
// (§2, §6): short, warm, numbers only where a kid wants them.

export const MILESTONES_TEXT = {
  open: 'Milestones',
  title: 'Milestones',
  back: 'Back',
  subtitle: 'Big goals, each with a prize!',
  loading: 'Counting your milestones…',
  loadFailed: 'We couldn’t load your milestones. Check your connection and try again!',
  retry: 'Try again',
  noTitle: 'No title yet',
  wearTitle: 'Wear a title',
  changeTitle: 'Change title',
  pickTitle: 'Pick a title to show your friends:',
  noneOption: 'No title',
  titleWorn: (name: string) => `Now showing “${name}”!`,
  titleOff: 'Title tucked away.',
  secretName: '???',
  secretGoal: 'A secret milestone. Keep exploring!',
  allDone: 'All done!',
  of: (have: number, need: number) => `${String(have)} of ${String(need)}`,
  season: (name: string) => `${name} only`,
  prize: 'Prize:',
  coins: (n: number) => `${String(n)} Patch Coins`,
  titleReward: (name: string) => `the title “${name}”`,
  // The celebration card.
  kicker: 'Milestone!',
  yay: 'Yay!',
  next: 'Next!',
} as const;

const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
export type ShownTrack = Extract<MilestoneTrackView, { hidden: false }>;
type Tier = ShownTrack['tiers'][number];

/** The first tier not earned yet, or null when the track is finished. */
export function nextTier(track: ShownTrack): Tier | null {
  return track.tiers.find((t) => t.earnedAt === null) ?? null;
}

/** How many tiers are earned. */
export function earnedCount(track: ShownTrack): number {
  return track.tiers.filter((t) => t.earnedAt !== null).length;
}

/** How full the bar is, 0–100: progress towards the next tier ("3 of 10"). */
export function barPercent(track: ShownTrack): number {
  const next = nextTier(track);
  if (!next) return 100;
  return Math.max(0, Math.min(100, Math.floor((track.progress * 100) / next.threshold)));
}

/** The line under the bar: "3 of 10", or "All done!". */
export function progressLabel(track: ShownTrack): string {
  const next = nextTier(track);
  return next
    ? MILESTONES_TEXT.of(Math.min(track.progress, next.threshold), next.threshold)
    : MILESTONES_TEXT.allDone;
}

/** "Halloween only" for a seasonal track, or null. */
export function seasonLabel(track: ShownTrack): string | null {
  return track.season
    ? MILESTONES_TEXT.season(SEASON_NAMES.get(track.season) ?? track.season)
    : null;
}

/** A tier's prize in words: "Explorer's Hat, 25 Patch Coins and the title “Trailblazer”". */
export function rewardLine(reward: MilestoneReward): string {
  const parts: string[] = [];
  const piece = reward.clothing ? CLOTHING_BY_ID.get(reward.clothing)?.name : undefined;
  if (piece) parts.push(piece);
  if (reward.coins > 0) parts.push(MILESTONES_TEXT.coins(reward.coins));
  parts.push(MILESTONES_TEXT.titleReward(reward.title.name));
  if (parts.length === 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/** News this device hasn't queued yet, oldest first. */
export function freshNews(
  news: readonly MilestoneNews[],
  queued: ReadonlySet<string>,
): MilestoneNews[] {
  return news.filter((n) => !queued.has(n.id));
}

/** Events whose play can earn a milestone (the server decides whether it did). */
const COUNTED = new Set([
  'tile.captured',
  'squishy.captured',
  'squishy.evolved',
  'squishy.leveled',
  'squishy.cared',
  'raid.resolved',
  'squishy.rescued',
  'clothing.found',
  'resource.gathered',
  'outfit.changed',
  'tutorial.advanced',
]);

/** Whose play an event is, from its public payload. */
function playerOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  for (const key of ['userId', 'defenderUserId']) {
    const value: unknown = Reflect.get(data, key);
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * True if a live event is the player's own play that could earn a milestone,
 * so it's worth looking soon. The Glade's events are all the player's.
 */
export function mayEarnMilestone(
  event: Pick<WsEventMessage, 'type' | 'data'>,
  me: string,
): boolean {
  if (!COUNTED.has(event.type)) return false;
  return event.type === 'tutorial.advanced' || playerOf(event.data) === me;
}
