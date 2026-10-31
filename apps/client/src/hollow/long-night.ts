import { LONG_NIGHT_RULES, type HollowStatus, type LongNightWeekday } from '@heartpatch/shared';
import { DUSK_MINUTES } from './hollow-config.js';
import { HOLLOW_TEXT } from './hollow-report.js';

// The Long Night on the client (#727, owner-approved mockups v5): the week's
// big night told over the map. The chips count down to it, a calm sheet says
// when he comes, the reveal says whether the patch held, Juniper's Gap opens
// for one look each, and the morning report and patch stats carry the crown.
// The server decides every bit of it (rule 1); this only words what it sends.
// Every day and time comes from data (`longNight.weekday`, `nextAt`,
// `gap.closesAt` against the map-local day), never a hard-coded Saturday.
// Pure, so each choice and line is unit-tested.

/** The status's Long Night block (left out while it's switched off for me). */
export type LongNightStatus = NonNullable<HollowStatus['longNight']>;

/** A Long Night's result, from `hollow.nightfall.longNight` (the live event). */
export interface LongNightResult {
  readonly night: string;
  readonly held: boolean;
  readonly heldBy: readonly string[];
  readonly keeperOfNight: string | null;
  readonly gapClosesAt: string | null;
}

export const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A weekday's name (0 is Sunday). */
export const dayName = (weekday: LongNightWeekday): string => WEEKDAY_NAMES[weekday] ?? '';

/** The mockup's words (style guide: cozy, short; "this time", never "failed"). */
export const LONG_NIGHT_TEXT = {
  // The owner's chooser (lobby patch details).
  heading: 'Long Night',
  off: 'Off',
  ownerPicks: 'The patch owner picks this.',
  hintDay: (day: string) =>
    `Every ${day} at nightfall the Hollow Man looks extra hard. Hold the patch and Juniper's Gap opens!`,
  hintOff:
    'No Long Night. Ordinary nights, just like always. Pick a day any time to bring it back.',
  skipWeek: 'Moving it to an earlier day can skip a week.',
  picked: (label: string) => `Long Night: ${label}.`,
  // The chips over the map.
  inDays: (days: number) =>
    days === 1 ? '🌑 Long Night tomorrow' : `🌑 Long Night in ${String(days)} days`,
  tonight: '🌑 Long Night tonight!',
  inMinutes: (minutes: number) => `🌇 Long Night in ${String(minutes)} min`,
  night: '🌙 Long Night',
  gapChip: "✨ Juniper's Gap is open",
  // The notice sheet (the chip tapped).
  noticeTitle: (day: string) => `🌑 Long Night on ${day}`,
  noticeLine: (day: string) => `He'll come looking on ${day}. Stock your fires!`,
  noticeSubHold: 'Hold the ',
  noticeSubWhole: 'whole ',
  noticeSub: "patch together and Juniper's Gap opens",
  noticeSubWide: ' for a day.',
  noticeSubShort: '!',
  lightMyLand: 'Light my land',
  okay: 'Okay!',
  /** Appended to the dark-land line in a tile's panel, the week of a Night. */
  darkSoon: (day: string) => `He'll come looking on ${day} 🔥`,
  // The live feed (every Keeper's walk, by place and name).
  feedAt: (name: string, place: string) => `He's sniffing around ${name}'s ${place}…`,
  feedRecoil: (name: string) => `${name}'s fire is too bright! He backs away.`,
  feedHome: (name: string) => `${name}'s Heart Seed glows too bright! He backs away.`,
  feedFound: 'He found a dark spot…',
  // The reveal at 7:30.
  who: 'Long Night',
  heldTitle: 'The patch held! 🎉',
  heldLead: 'You all stood through the Night. ',
  gapOpenTill: (when: string) => `Juniper's Gap is open till ${when}.`,
  missTitle: 'What a long Night 🌙',
  missLine: 'He found a few dark spots, so Juniper’s Gap stays shut this time.',
  mineStood: ' Your land stood strong! 🔥',
  rescueThem: 'Taken to the Hollow? You can rescue them!',
  nextNight: (day: string) => `Next Long Night: ${day}.`,
  goLook: 'Go look 👀',
  later: 'Later',
  // Juniper's Gap.
  gapTitle: "Juniper's Gap is open!",
  gapLine: 'Something is waiting in the Gap, just for you.',
  gapOneLook: 'One look each',
  gapCount: ', so make it count',
  gapTill: (when: string) => `! Open till ${when}.`,
  gapRescue: 'More rescues earn rewards while it’s open! 💗',
  notNow: 'Not now',
  hadLookTitle: "You've had your look 👀",
  hadLookLine: (when: string) => `The Gap closes ${when}. See you next Long Night!`,
  gapName: "Juniper's Gap",
  oneBattleTitle: 'One battle at a time',
  oneBattleLine: 'Finish your other battle first, then come back to the Gap!',
  // The Hollow rescue list while the Gap is open.
  rescueBoost: "✨ Juniper's Gap is open: more rescues earn rewards today! 💗",
  /** Under the boost line, in place of "Your first rescue today earns…": the server's count. */
  rewardsLeft: (n: number) =>
    n === 1 ? '1 rescue reward left today.' : `${String(n)} rescue rewards left today.`,
  // The morning report.
  reportTag: '🌑 Long Night',
  reportHeld: (when: string | null) =>
    when ? `The patch held! Juniper's Gap is open till ${when}.` : 'The patch held!',
  reportMiss:
    'What a long Night. He found a few dark spots in the patch, so the Gap stays shut this time.',
  crownMine: "You're Keeper of the Night!",
  crownOf: (name: string) => `${name} is Keeper of the Night 🔥`,
  tryAgain: (day: string) => `Try again next ${day}!`,
  // When the Gap closes (closingWords).
  closesTonight: 'tonight',
  closesTomorrow: 'tomorrow night',
} as const;

/** One formatter per zone: `localDate` runs on every chip tick and render. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(zone: string | undefined): Intl.DateTimeFormat {
  const key = zone ?? '';
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateFormats.set(key, format);
  }
  return format;
}

/** A map-local date (YYYY-MM-DD) for an instant, in `timeZone` (the device's when unknown). */
/**
 * The rescue list's reward lines. While the Gap is open the boost raises the
 * daily cap, not the pay, so it says how many are left (the server's count),
 * and the boost line only shows while one is (#727).
 */
export function rescueReward(
  rescue: { readonly rewardsLeftToday: number; readonly heartdust: number },
  gapOpen: boolean,
): { readonly boost: boolean; readonly line: string } {
  const left = rescue.rewardsLeftToday;
  if (left <= 0) return { boost: false, line: HOLLOW_TEXT.noReward };
  return gapOpen
    ? { boost: true, line: LONG_NIGHT_TEXT.rewardsLeft(left) }
    : { boost: false, line: HOLLOW_TEXT.reward(rescue.heartdust) };
}

export function localDate(at: number, timeZone: string | null): string {
  try {
    return dateFormat(timeZone ?? undefined).format(new Date(at));
  } catch {
    // An unknown zone name: the device's own day is close enough for words.
    return dateFormat(undefined).format(new Date(at));
  }
}

/** Whole days from one map-local date to another ("2026-10-28" → "2026-10-31": 3). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The patch's weekday name, or null while it's Off. */
export const weekdayName = (ln: LongNightStatus | undefined): string | null =>
  ln?.weekday === undefined || ln.weekday === null ? null : dayName(ln.weekday);

/** The next Night's day, for "Next Long Night" lines: null while Off (or at 0%: `nextAt` null). */
export const nextNightDay = (ln: LongNightStatus | undefined): string | null =>
  ln?.nextAt ? weekdayName(ln) : null;

/** What the notice chip says by day: days, or "tonight", or minutes at dusk. */
export type NoticeChip =
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'tonight' }
  | { readonly kind: 'minutes'; readonly minutes: number };

/**
 * The notice chip by day (mockup "The notice"): from `noticeDays` out until
 * nightfall, from `nextAt` on the client's clock against the map-local day.
 * Null at night (the night chip says "Long Night"), while Off, or at 0%
 * (`nextAt` null), and further out than `noticeDays`.
 */
export function noticeChip(input: {
  readonly ln: LongNightStatus | undefined;
  readonly isNight: boolean;
  readonly now: number;
  readonly timeZone: string | null;
  readonly noticeDays?: number;
}): NoticeChip | null {
  const { ln, isNight, now, timeZone } = input;
  if (!ln?.nextAt || ln.weekday === null || isNight) return null;
  const at = Date.parse(ln.nextAt);
  if (!(at > now)) return null;
  const days = daysBetween(localDate(now, timeZone), localDate(at, timeZone));
  if (days > (input.noticeDays ?? LONG_NIGHT_RULES.noticeDays)) return null;
  if (days >= 1) return { kind: 'days', days };
  const minutes = Math.ceil((at - now) / 60_000);
  return minutes <= DUSK_MINUTES ? { kind: 'minutes', minutes } : { kind: 'tonight' };
}

export function noticeChipText(chip: NoticeChip): string {
  switch (chip.kind) {
    case 'days':
      return LONG_NIGHT_TEXT.inDays(chip.days);
    case 'tonight':
      return LONG_NIGHT_TEXT.tonight;
    case 'minutes':
      return LONG_NIGHT_TEXT.inMinutes(chip.minutes);
  }
}

/**
 * "tomorrow night" or "tonight": when Juniper's Gap closes, against the
 * map-local day (at 7:30 it's open till tomorrow night; the next morning
 * the same Gap closes tonight).
 */
export function closingWords(closesAt: string, now: number, timeZone: string | null): string {
  const days = daysBetween(localDate(now, timeZone), localDate(Date.parse(closesAt), timeZone));
  return days >= 1 ? LONG_NIGHT_TEXT.closesTomorrow : LONG_NIGHT_TEXT.closesTonight;
}

/** The Gap's sheet state: a look to have, or had (window still open). */
export type GapState = 'none' | 'available' | 'had';

export function gapState(ln: LongNightStatus | undefined, now: number): GapState {
  const gap = ln?.gap;
  if (!gap) return 'none';
  if (now < Date.parse(gap.opensAt) || now >= Date.parse(gap.closesAt)) return 'none';
  return gap.available ? 'available' : 'had';
}

/** The reveal's card (mockup "The reveal"). */
export interface RevealCard {
  readonly title: string;
  /** The first line; `lead` is left out when the card is short (sideways). */
  readonly lead: string;
  readonly line: string;
  readonly sub: string | null;
  /** "Go look 👀" with a quiet "Later" (held, and I still have my look). */
  readonly goLook: boolean;
}

/**
 * The 7:30 reveal. Held is a cheer and opens the Gap; not held says "this
 * time" and never names a Keeper (style guide §6): "your land stood" when
 * `heldBy` has me, else the rescue line. A Keeper who wasn't in the Night
 * reads the same card with no Go look.
 */
export function revealCard(input: {
  readonly result: LongNightResult;
  readonly me: string | null;
  readonly ln: LongNightStatus | undefined;
  readonly now: number;
  readonly timeZone: string | null;
}): RevealCard {
  const { result, me, ln, now, timeZone } = input;
  const next = nextNightDay(ln);
  if (result.held) {
    // The status's Gap, or the event's while it hasn't closed (never a past time).
    const fallback =
      result.gapClosesAt !== null && Date.parse(result.gapClosesAt) > now
        ? result.gapClosesAt
        : null;
    const closes = ln?.gap?.closesAt ?? fallback;
    return {
      title: LONG_NIGHT_TEXT.heldTitle,
      lead: LONG_NIGHT_TEXT.heldLead,
      line: closes ? LONG_NIGHT_TEXT.gapOpenTill(closingWords(closes, now, timeZone)) : '',
      sub: null,
      goLook: gapState(ln, now) === 'available',
    };
  }
  const stood = me !== null && result.heldBy.includes(me);
  const nextLine = next ? LONG_NIGHT_TEXT.nextNight(next) : null;
  return {
    title: LONG_NIGHT_TEXT.missTitle,
    lead: '',
    line: `${LONG_NIGHT_TEXT.missLine}${stood ? LONG_NIGHT_TEXT.mineStood : ''}`,
    sub: stood ? nextLine : [LONG_NIGHT_TEXT.rescueThem, nextLine].filter(Boolean).join(' '),
    goLook: false,
  };
}

/** One line of the morning's Long Night block. */
export interface LongNightLine {
  readonly icon: string;
  readonly text: string;
}

/**
 * The morning report's Long Night block (mockup "Report lines"): held or
 * not, then the crown (whenever the server sends one, owner answer 2), then
 * "Try again next Saturday!" after a miss (left out while Off or at 0%).
 */
export function reportLines(input: {
  readonly held: boolean;
  readonly keeperOfNight: string | null;
  readonly me: string | null;
  readonly nameOf: (userId: string) => string | null;
  readonly ln: LongNightStatus | undefined;
  readonly now: number;
  readonly timeZone: string | null;
}): LongNightLine[] {
  const { held, keeperOfNight, me, nameOf, ln, now, timeZone } = input;
  const closes = ln?.gap?.closesAt;
  const lines: LongNightLine[] = [
    held
      ? {
          icon: '🎉',
          text: LONG_NIGHT_TEXT.reportHeld(
            closes && gapState(ln, now) !== 'none' ? closingWords(closes, now, timeZone) : null,
          ),
        }
      : { icon: '🌙', text: LONG_NIGHT_TEXT.reportMiss },
  ];
  if (keeperOfNight !== null) {
    const name = keeperOfNight === me ? null : nameOf(keeperOfNight);
    if (keeperOfNight === me) lines.push({ icon: '🌙', text: LONG_NIGHT_TEXT.crownMine });
    else if (name) lines.push({ icon: '🌙', text: LONG_NIGHT_TEXT.crownOf(name) });
  }
  const next = nextNightDay(ln);
  if (!held && next) lines.push({ icon: '🕯️', text: LONG_NIGHT_TEXT.tryAgain(next) });
  return lines;
}

/** What the Gap's tap leads to: its battle, a kind card, or nothing (switched off). */
export type GapReply =
  | { readonly kind: 'battle' }
  | { readonly kind: 'message'; readonly title: string; readonly line: string }
  | { readonly kind: 'hide' };

/**
 * The Gap's tap, read (#727, 727d's handoff): a wild battle is the Gap's
 * own; any other kind is a battle of mine that came back, to finish first.
 * A refusal shows the server's message as sent (the code alone can't tell
 * closed from claimed); `NOT_FOUND` means it's switched off, so it all hides.
 */
export function gapReply(
  reply:
    | { readonly battle: { readonly kind: string } }
    | { readonly code: string; readonly message: string },
): GapReply {
  if ('battle' in reply) {
    return gapBattleOk(reply.battle)
      ? { kind: 'battle' }
      : {
          kind: 'message',
          title: LONG_NIGHT_TEXT.oneBattleTitle,
          line: LONG_NIGHT_TEXT.oneBattleLine,
        };
  }
  if (reply.code === 'NOT_FOUND') return { kind: 'hide' };
  return { kind: 'message', title: LONG_NIGHT_TEXT.gapName, line: reply.message };
}

/**
 * The Gap's tap, read from the battle start's reply: the Gap's own battle
 * (`wild`), or another battle of mine came back (every start resumes the
 * battle going), which waits to be finished first.
 */
export const gapBattleOk = (battle: { readonly kind: string }): boolean => battle.kind === 'wild';
