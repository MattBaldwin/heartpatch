import {
  adventNumber,
  CLOTHING_BY_ID,
  type AdventDayState,
  type AdventDayView,
  type AdventResult,
  type AdventView,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';
import { itemName } from '../inventory/bag-view.js';

/*
 * The advent sheet's rules of thumb, pure (#37 1d). The server says what each
 * day is (`AdventView`); this only decides how it's drawn and worded. It never
 * decides whether a day can be opened (CLAUDE.md rule 1): a tap sends the day
 * and the server answers.
 */

// Player-facing text (style guide §2, §6): cozy, short, kid-readable.
export const ADVENT_TEXT = {
  entry: 'Presents',
  news: "Today's present!",
  title: 'Presents under the tree',
  lead: "Open today's, or one you missed!",
  close: 'Close the presents',
  legend: {
    opened: 'Opened',
    today: 'Today',
    'catch-up': 'Catch up',
    missed: 'Missed',
    locked: 'Wrapped · not yet',
  },
  mightHold: "Today's present might hold:",
  mightHoldDay: (day: number) => `Day ${String(day)} might hold:`,
  openToday: "Open today's present",
  openMissed: (day: number) => `Open the one I missed (Day ${String(day)})`,
  opening: 'Opening…',
  todayDone: "Today's is open! Come back tomorrow 🎁",
  catchUpUsed: 'You opened a missed one today. Come back tomorrow for another!',
  over: 'All unwrapped! See you next December ❄️',
  revealToday: "Today's present had…",
  revealDay: (day: number) => `Day ${String(day)} had…`,
  revealAgain: (day: number) => `Day ${String(day)} held…`,
  yay: 'Yay!',
  // One line each: the note's slot keeps the sheet the same height (14 px, about 40 characters).
  tapLocked: 'Not yet! Still wrapped up tight 🎁',
  tapMissedUsed: 'One missed day a day. More tomorrow! ❄️',
  tapMissedOver: "That one's gone. See you next December ❄️",
  bag: 'Safe in your bag!',
  // A present from the bag (#37 1d2). One line each, like the rest.
  presentMightHold: 'A present might hold:',
  openPresent: (n: number) =>
    n > 1 ? `Open a wrapped present (${String(n)})` : 'Open a wrapped present',
  revealPresent: 'Your present had…',
  presentsLeft: (n: number) =>
    n === 1
      ? 'Safe in your bag! 1 more to open 🎁'
      : `Safe in your bag! ${String(n)} more to open 🎁`,
} as const;

/** The fixed days that name their present on the grid (data lives on the server). */
const DAY_ICONS: Readonly<Record<number, string>> = { 24: '🎆', 25: '⭐' };

/** What a day's cell shows: words and a picture, never colour alone. */
export interface DayLook {
  readonly state: AdventDayState;
  readonly number: number;
  /** The small second line, 14 px or more. */
  readonly tag: string;
  /** A picture beside it (decoration; the tag and label carry the meaning). */
  readonly icon: string;
  readonly label: string;
}

/** The day's number on the calendar (1 to 25), from its date. */
export function dayNumber(day: AdventDayView): number {
  return adventNumber(day.day) ?? 0;
}

export function dayLook(day: AdventDayView, view: AdventView): DayLook {
  const number = dayNumber(day);
  const fixed = DAY_ICONS[number];
  const of = (tag: string, icon: string, label: string): DayLook => ({
    state: day.state,
    number,
    tag,
    icon,
    label: `Day ${String(number)}, ${label}`,
  });
  switch (day.state) {
    case 'opened':
      return of('Opened', '✓', 'opened, see what it held');
    case 'today':
      return of('Today', fixed ?? '🎁', 'today, open it');
    case 'catch-up':
      return of('Catch up', fixed ?? '⏰', 'you missed it, open it now');
    case 'missed':
      return of('Missed', '💤', view.catchUpLeft ? 'missed' : 'missed, catch up is used today');
    case 'locked':
      return of('Wrapped', fixed ?? '🎀', 'still wrapped up');
  }
}

/** Where the calendar is: before it opens, on one of its days, or over. */
export type AdventPhase = 'before' | 'live' | 'over';

export function phaseOf(view: AdventView): AdventPhase {
  if (adventNumber(view.today) !== null) return 'live';
  return view.today.slice(5) < '12-01' ? 'before' : 'over';
}

/** Today's day, if the calendar is on one. */
export function todayOf(view: AdventView): AdventDayView | null {
  return view.days.find((day) => day.day === view.today) ?? null;
}

/** Today's present is waiting: the badge on the entry. */
export function presentWaiting(view: AdventView | null): boolean {
  return view !== null && todayOf(view)?.state === 'today';
}

/** The missed days that can be opened now, oldest first. */
export function catchUpDays(view: AdventView): AdventDayView[] {
  return view.days.filter((day) => day.state === 'catch-up');
}

/**
 * The missed day the "Open the one I missed" button means: the one tapped,
 * if it's still open to catch up, else the oldest. Null when there's none
 * (or today's catch-up is used).
 */
export function pickedCatchUp(view: AdventView, picked: string | null): AdventDayView | null {
  const days = catchUpDays(view);
  return days.find((day) => day.day === picked) ?? days[0] ?? null;
}

/** An item's picture and name; a Christmas outfit (it joins the pool with the wardrobe lane) is clothing, not a bag item. */
function thing(id: string): string {
  const outfit = CLOTHING_BY_ID.get(id);
  return outfit ? `🧣 ${outfit.name}` : `${itemIcon(id)} ${itemName(id)}`;
}

/** "🍬 Treats, 🥧 Pies, ✨ Heartdust": what a day can hold (names, never odds). */
export function contentsLine(ids: readonly string[]): string {
  return ids.map(thing).join(', ');
}

/** One found thing, for the reveal: "🍬 3 Treats" (the count first when it's more than one). */
export function foundLine(id: string, count: number): string {
  return count > 1 ? `${String(count)} × ${thing(id)}` : thing(id);
}

export function foundLines(items: AdventResult): string[] {
  return Object.entries(items).map(([id, count]) => foundLine(id, count));
}

/** What tapping a day that can't be opened says (it never asks the server). */
export function stuckNote(day: AdventDayView, view: AdventView): string | null {
  if (day.state === 'locked') return ADVENT_TEXT.tapLocked;
  if (day.state === 'missed') {
    return phaseOf(view) === 'live' ? ADVENT_TEXT.tapMissedUsed : ADVENT_TEXT.tapMissedOver;
  }
  return null;
}

/** The reveal's last line after a present from the bag: how many are still wrapped. */
export function bagLine(presentsLeft: number | null): string {
  return presentsLeft !== null && presentsLeft > 0
    ? ADVENT_TEXT.presentsLeft(presentsLeft)
    : ADVENT_TEXT.bag;
}

/** "🍬 🥧 ✨": what a wrapped present can hold, pictures only (one line; names go in the label). */
export function contentsIcons(ids: readonly string[]): string {
  return ids.map(itemIcon).join(' ');
}
