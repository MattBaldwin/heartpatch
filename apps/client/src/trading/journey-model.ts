import { FAR_HOLLOW_TEXT } from '../hollowed/far-hollow-model.js';
import {
  GROWTH_RULES,
  JOURNEY_RULES,
  journeyFor,
  type JobsView,
  type JourneyRules,
} from '@heartpatch/shared';

// Journeys to trading posts (#270), in words (copy follows docs/STYLE_GUIDE.md
// and the owner-approved mockup, screens b and c). Pure, so every case is
// unit-tested. The level and team size are the shared rules the server uses;
// the chance line is only a hint (the server plays the battle, CLAUDE.md rule 1).

export const JOURNEY_TEXT = {
  heading: (post: string) => `Journey to ${post}`,
  trail: (n: number, level: number) =>
    `Trail squishies: ${String(n)}, about level ${String(level)}`,
  team: (level: number) => `Your team: about level ${String(level)}`,
  noTeam: 'Your team: nobody free yet',
  chance: { good: 'Good chance! 👍', try: 'Worth a try! 🤞', tough: 'Tough one! 💪' },
  stakes: (minutes: number) =>
    `Win and the post is yours to use for ${String(minutes)} minutes. Tuckered out? Nothing's lost. Just try again.`,
  start: 'Start journey',
  /** A visit pass's time left, in whole minutes rounded up (a kid-readable countdown). */
  open: (ms: number) => {
    const minutes = Math.max(1, Math.ceil(ms / 60_000));
    return `⏳ The post is open for you for ${String(minutes)} more ${minutes === 1 ? 'minute' : 'minutes'}!`;
  },
  // The result card (screen c).
  wonTitle: (post: string) => `You made it to ${post}!`,
  wonSub: (minutes: number) => `The post is open for you for ${String(minutes)} minutes.`,
  wonDone: 'Open the post 🏮',
  // A won journey this device didn't start (after a reload): where it went is on the map.
  wonSomewhereTitle: 'You made it! 🧭',
  wonSomewhereSub: 'Back to the map to see where your journey took you.',
  lostTitle: 'Phew, tuckered out!',
  lostSub: "Rest up and try again. You didn't lose a thing.",
  scootedTitle: 'You headed home.',
  scootedSub: "You didn't lose a thing. Set off again any time!",
  startCaption: 'Trail squishies want to play!',
  somePost: 'the trading post',
} as const;

/**
 * Ms left on a visit pass that runs to `until` (the server's `visitUntil`), at
 * `now` on the game clock; null with no pass or once it's over. `until` is
 * server time, so `now` must be too: a phone whose clock is off (or a dev
 * server set to Halloween) would count a device-clock pass wrong (#561).
 */
export function passLeft(until: string | null, now: number): number | null {
  if (until === null) return null;
  const left = Date.parse(until) - now;
  return left > 0 ? left : null;
}

/** Lanterns in the preview's meter: more lit means a tougher trip (the mockup's six). */
export const LANTERNS = 6;

/** What the preview shows for a journey of `distance` tiles. */
export interface JourneyPreview {
  readonly distance: number;
  readonly level: number;
  readonly teamSize: number;
  /** Lanterns lit, 1 to `LANTERNS`: one a tile, the last for any farther trip. */
  readonly lanterns: number;
}

export function journeyPreview(
  distance: number,
  rules: JourneyRules = JOURNEY_RULES,
  maxLevel: number = GROWTH_RULES.maxLevel,
): JourneyPreview {
  const { level, teamSize } = journeyFor(distance, rules, maxLevel);
  return { distance, level, teamSize, lanterns: Math.min(LANTERNS, Math.max(1, distance)) };
}

/**
 * The levels of who would go on the journey, as the server picks a battle's
 * team: the picked team in slot order, else the strongest resting squishies,
 * up to the team size. Empty when nobody is free.
 */
export function journeyTeamLevels(jobs: Pick<JobsView, 'squishies' | 'rules'>): number[] {
  const free = jobs.squishies.filter((s) => s.squishy.state === 'active');
  const picked = free
    .filter((s) => s.job === 'team' && s.teamSlot !== null)
    .sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0));
  const team =
    picked.length > 0
      ? picked
      : free.filter((s) => s.job === 'resting').sort((a, b) => b.squishy.level - a.squishy.level);
  return team.slice(0, jobs.rules.teamSize).map((s) => s.squishy.level);
}

/** About how strong the team is: its average level, rounded. */
export function averageLevel(levels: readonly number[]): number {
  if (levels.length === 0) return 0;
  return Math.round(levels.reduce((sum, l) => sum + l, 0) / levels.length);
}

/**
 * The preview's chance line. A rough guide read from `pnpm sim:progression`'s
 * journey table (#270): how far the team's average level is above or below
 * the trail's, as a share of the trail's level, plus a little for each
 * squishy more than the trail has.
 */
export const CHANCE = {
  /** Per extra squishy on my side. */
  perExtraSquishy: 0.1, // TUNE: the sim's 3-against-1 day-1 trips win far above their levels
  /** At or above this, "Good chance!" (the sim's 65 %+ cells). */
  good: -0.05, // TUNE:
  /** Below this, "Tough one!" (the sim's cells under about 45 %). */
  tough: -0.2, // TUNE:
} as const;

export type JourneyChance = keyof typeof JOURNEY_TEXT.chance;

export function journeyChance(team: readonly number[], journey: JourneyPreview): JourneyChance {
  if (team.length === 0) return 'tough';
  const average = team.reduce((sum, l) => sum + l, 0) / team.length;
  const edge =
    (average - journey.level) / journey.level +
    CHANCE.perExtraSquishy * (team.length - journey.teamSize);
  if (edge >= CHANCE.good) return 'good';
  return edge < CHANCE.tough ? 'tough' : 'try';
}

/** The result card for a finished journey (screen c). */
export function journeyResult(
  outcome: 'won' | 'lost' | 'scooted',
  post: string | null,
  options: {
    rules?: JourneyRules;
    /**
     * Where the journey went (#306 PR 6): a post's (the default), the far
     * road, or not known here (a battle this device didn't start, after a
     * reload), whose win card promises nothing either way.
     */
    to?: 'post' | 'far-hollow' | 'unknown';
  } = {},
): { title: string; subtitle: string; done?: string } {
  const { rules = JOURNEY_RULES, to = 'post' } = options;
  const farHollow = to === 'far-hollow';
  if (outcome === 'won' && to === 'unknown') {
    return { title: JOURNEY_TEXT.wonSomewhereTitle, subtitle: JOURNEY_TEXT.wonSomewhereSub };
  }
  const name = post ?? JOURNEY_TEXT.somePost;
  if (outcome === 'won' && farHollow) {
    return {
      title: FAR_HOLLOW_TEXT.wonTitle,
      subtitle: FAR_HOLLOW_TEXT.wonSub,
      done: FAR_HOLLOW_TEXT.wonDone,
    };
  }
  if (outcome === 'won') {
    return {
      title: JOURNEY_TEXT.wonTitle(name),
      subtitle: JOURNEY_TEXT.wonSub(rules.visitMinutes),
      done: JOURNEY_TEXT.wonDone,
    };
  }
  return outcome === 'scooted'
    ? { title: JOURNEY_TEXT.scootedTitle, subtitle: JOURNEY_TEXT.scootedSub }
    : { title: JOURNEY_TEXT.lostTitle, subtitle: JOURNEY_TEXT.lostSub };
}
