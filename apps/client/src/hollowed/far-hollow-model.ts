import type { FarHollowView } from '@heartpatch/shared';

// The far Hollow (#306 PR 6, plan Q7, owner decision 7), in words and
// states. Pure, so every case is unit-tested. The server works out the
// progress and the season (CLAUDE.md rule 1); this only says it.

export const FAR_HOLLOW_TEXT = {
  /** The trading post panel's button. */
  open: 'The far Hollow 🕯️',
  title: (name: string) => `${name} 🕯️`,
  kicker: (season: string) => `${season} season`,
  awayLead:
    'Far past the last post, a crooked old house waits just for you this season. Win the far road to get there!',
  road: (teamSize: number, level: number) =>
    `Trail squishies: ${String(teamSize)}, about level ${String(level)}`,
  roadStakes: "Tuckered out? Nothing's lost. Just try again.",
  start: 'Take the far road 🧭',
  fromPost: 'The far road starts at any trading post you can visit. 🏮',
  night: 'Too spooky after dark! Come back in the morning 🌙',
  arrivedLead: 'The Crooked House! Its rooms are dark and a bit wonky. Bring the light back!',
  goInside: 'Go inside 🕯️',
  stuck: "The front door's stuck! It opens very soon 🔑",
  doneTitle: 'All the joy is back! 🌈',
  doneLead: 'Every room of the Crooked House glows again. You did that!',
  fresh: (season: string, date: string) => `A fresh far Hollow comes with ${season} on ${date} ✨`,
  freshSoon: 'A fresh far Hollow comes next season ✨',
  close: 'Close',
  // The far road's result card (the journey card's shape).
  wonTitle: 'You made it to the far Hollow!',
  wonSub: 'A crooked old house waits for you all season.',
  wonDone: "Let's see 🕯️",
} as const;

/** Where I am with this season's far Hollow. */
export type FarHollowState = 'away' | 'arrived' | 'complete';

export function farHollowState(
  view: Pick<FarHollowView, 'arrived' | 'completedAt'>,
): FarHollowState {
  if (!view.arrived) return 'away';
  return view.completedAt === null ? 'arrived' : 'complete';
}

/**
 * Did I only just arrive (not finished yet)? The far road is once a season,
 * so a won journey of unknown origin (a reload mid-battle) may have been the
 * far road when this holds. #306 6b's `house` progress lets 6c tighten it to
 * "nothing found yet".
 */
export function justArrived(view: Pick<FarHollowView, 'arrived' | 'completedAt'>): boolean {
  return view.arrived && view.completedAt === null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A map-local date (`YYYY-MM-DD`) the short way: "Dec 1". */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${String(day ?? 1)}`;
}

/** The "fresh next season" line, once the joy is all back. */
export function freshLine(next: FarHollowView['nextSeason']): string {
  return next
    ? FAR_HOLLOW_TEXT.fresh(next.name, shortDate(next.startsOn))
    : FAR_HOLLOW_TEXT.freshSoon;
}
