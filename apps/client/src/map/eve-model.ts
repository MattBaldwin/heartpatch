import type { MapView, MapViewChristmasEve, MapViewChristmasEveThanks } from '@heartpatch/shared';
import { foundLines } from '../advent/advent-model.js';

/*
 * The Christmas Eve visit on the map (#37 X5b): the 3-day notice chip, the
 * event card's extra lines and the thanks sheet. Pure, so it's unit-tested
 * without the DOM. The server decides everything (CLAUDE.md rules 1 and 6):
 * this only words what `MapView.christmas.eve` says. Never the head start's
 * size, the goal's formula or who chipped in; only a count and a yes/no.
 */

// Player-facing text (style guide §2, §6: cozy, short, kid-readable).
export const EVE_TEXT = {
  noticeSoon: 'Something BIG visits on Christmas Eve! ❄',
  noticeToday: 'Something BIG visits tonight! ❄',
  noticeHere: 'Something BIG is almost here! ❄',
  chippedIn: (n: number) => `${String(n)} chipped in`,
  warmedUp: 'The lights warmed it up already!',
  // The thanks sheet.
  fellTitle: 'It fell asleep! ❄',
  fellLine: 'The BIG squishy is all tuckered out. Thanks for helping!',
  dozedTitle: 'Thanks for helping! 💤',
  dozedLine: 'It dozed off and wandered home at dawn.',
  bundleHead: 'Look what it left you:',
  waiting: 'Your thanks is coming! 🎁',
  asksHead: 'Ask it to be your friend?',
  asksLeft: (n: number) => `${String(n)} ${n === 1 ? 'ask' : 'asks'} left`,
  ask: 'Ask',
  joined: 'It joined your patch! 💗',
  notYet: 'Not yet! Try again?',
  close: 'Yay!',
  chip: 'Thank-you gift 🎁',
  fallBeat: 'The BIG squishy fell asleep! ❄',
} as const;

/**
 * One win's befriend asks (the server's Christmas Eve `fallAsks`, server-only
 * data). The ask number is asks made + 1, and the server checks it, so a
 * wrong guess is a friendly "mixed up", never a wrong spend.
 */
export const EVE_FALL_ASKS = 2; // TUNE: mirrors the server's fallAsks (owner answer 2)

/** Where the visit stands on the map: before it opens, while the bar is out, or settled. */
export type EveStage = 'notice' | 'open' | 'fell' | 'dozed';

/** Keyed off the bar's `state`, never off the card being there. Null off the Eve. */
export function eveStage(eve: MapViewChristmasEve | undefined): EveStage | null {
  if (!eve) return null;
  return eve.state ?? 'notice';
}

/** The notice chip's line, or null once the bar is out (the card and sheet take over). */
export function noticeLine(eve: MapViewChristmasEve | undefined, now: Date): string | null {
  if (eveStage(eve) !== 'notice' || !eve) return null;
  const opens = Date.parse(eve.opensAt);
  if (!Number.isFinite(opens)) return null;
  if (opens <= now.getTime()) return EVE_TEXT.noticeHere;
  return new Date(opens).toDateString() === now.toDateString()
    ? EVE_TEXT.noticeToday
    : EVE_TEXT.noticeSoon;
}

/**
 * The event card's extra lines. "N chipped in" only with a count to show (the
 * lights' head start is not a chipper), and "The lights warmed it up already!"
 * as a yes/no, never "the lights gave N".
 */
export function cardLines(eve: MapViewChristmasEve | undefined): string[] {
  if (!eve || eve.state === undefined) return [];
  const lines: string[] = [];
  if ((eve.chippers ?? 0) > 0) lines.push(EVE_TEXT.chippedIn(eve.chippers ?? 0));
  if (eve.warmedUp === true && eve.state === 'open') lines.push(EVE_TEXT.warmedUp);
  return lines;
}

/** What the thanks sheet shows. */
export interface ThanksModel {
  readonly kind: 'fell' | 'dozed';
  readonly title: string;
  readonly line: string;
  /** "🎁 6 Heart Charms" lines, the bundle. */
  readonly items: readonly string[];
  readonly asksLeft: number;
  /** The `ask` number the next ask sends (asks made + 1). */
  readonly nextAsk: number;
  readonly battleId: string;
}

export function thanksModel(thanks: MapViewChristmasEveThanks): ThanksModel {
  const dozed = thanks.kind === 'dozed';
  const asksLeft = dozed ? 0 : thanks.asksLeft;
  return {
    kind: thanks.kind,
    title: dozed ? EVE_TEXT.dozedTitle : EVE_TEXT.fellTitle,
    line: dozed ? EVE_TEXT.dozedLine : EVE_TEXT.fellLine,
    items: foundLines(thanks.items),
    asksLeft,
    nextAsk: Math.max(1, EVE_FALL_ASKS - asksLeft + 1),
    battleId: thanks.battleId,
  };
}

/**
 * A settled bar whose thanks hasn't landed yet (it pays on /boss or on the
 * sweep, up to ~5 min later): the gentle waiting state. Only for a Keeper who
 * chipped in (`chipped`), so one who didn't fight sees nothing, not a wait.
 */
export function waitingForThanks(eve: MapViewChristmasEve | undefined, chipped: boolean): boolean {
  const stage = eveStage(eve);
  return chipped && (stage === 'fell' || stage === 'dozed') && eve?.thanks === undefined;
}

export function eveOf(view: Pick<MapView, 'christmas'> | null | undefined) {
  return view?.christmas?.eve;
}
