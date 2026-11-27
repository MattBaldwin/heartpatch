import type { LocalDate } from '../schemas/time.js';

/*
 * The advent calendar's rules (#37 1c, owner answer 3), shared so the server
 * enforces them and the client draws the same calendar (CLAUDE.md rule 2):
 * 25 presents, December 1 to 25, one a day per Keeper at account level, and
 * one missed day opened late ("catch-up") per day. Pure: dates are the
 * claiming patch's local days; nothing here reads the clock.
 */

/** The first and last advent days of December. */
export const ADVENT_FIRST_DAY = 1;
export const ADVENT_LAST_DAY = 25;

/** Why a day's present can't be opened now, or null when it can. */
export type AdventClaimProblem =
  /** Not December 1–25 at all. */
  | 'not-advent'
  /** Its day hasn't come yet (a day ahead, or another year's). */
  | 'not-yet'
  /** The calendar is over: today is past December 25, or the day is a past year's. */
  | 'over'
  /** Already opened. */
  | 'claimed'
  /** A missed day, but today's one catch-up is used: come back tomorrow. */
  | 'catch-up-used';

function parts(date: LocalDate): { year: number; month: number; day: number } {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return { year, month, day };
}

/** `date`'s advent number (1–25), or null when it isn't an advent day. */
export function adventNumber(date: LocalDate): number | null {
  const { month, day } = parts(date);
  return month === 12 && day >= ADVENT_FIRST_DAY && day <= ADVENT_LAST_DAY ? day : null;
}

/** The 25 advent days of `year`, in order. */
export function adventDaysOf(year: number): LocalDate[] {
  const y = String(year).padStart(4, '0');
  return Array.from(
    { length: ADVENT_LAST_DAY - ADVENT_FIRST_DAY + 1 },
    (_, i) => `${y}-12-${String(ADVENT_FIRST_DAY + i).padStart(2, '0')}`,
  );
}

export interface AdventClaimInput {
  /** The claiming patch's local day. */
  today: LocalDate;
  /** The advent day asked for. */
  day: LocalDate;
  /** That day's present is opened already (account level). */
  claimed: boolean;
  /** A missed day was opened late already today (account level). */
  catchUpTakenToday: boolean;
}

/**
 * Whether `day`'s present can be opened `today`: today's own while today is
 * an advent day, or a missed earlier day of this year's calendar when today's
 * one catch-up is still free. A catch-up is only possible on an advent day
 * too, so the calendar closes after December 25.
 */
export function adventClaimProblem(input: AdventClaimInput): AdventClaimProblem | null {
  const { today, day } = input;
  if (adventNumber(day) === null) return 'not-advent';
  if (day > today) return 'not-yet';
  if (parts(day).year !== parts(today).year || adventNumber(today) === null) return 'over';
  if (input.claimed) return 'claimed';
  if (day < today && input.catchUpTakenToday) return 'catch-up-used';
  return null;
}

/** A claim of `day` on `today` is a catch-up (a missed day opened late). */
export const isCatchUp = (today: LocalDate, day: LocalDate): boolean => day < today;
