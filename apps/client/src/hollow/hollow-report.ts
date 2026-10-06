import { GAME_DATA, type MorningReport, type WsEventMessage } from '@heartpatch/shared';

/** The Heart Snack, Heartdust's use (owner decision 2026-10-06): what it's called and costs. */
const SNACK = GAME_DATA.careActions.find(
  (a) => a.outsideDailyCare === true && a.cost?.['heartdust'] !== undefined,
);

// The morning report's words (design doc §14, style guide §1, §9): kid-gentle,
// short, and every squishy taken to the Hollow is followed by "you can rescue
// them!". Pure, so the wording is unit-tested and scanned for avoided words.

export const HOLLOW_TEXT = {
  visitedOne: 'The Hollow Man visited last night…',
  visitedMany: 'The Hollow Man came by while you were away…',
  passedBy: 'The Hollow Man passed by last night…',
  taken: (name: string) => `He took ${name} to the Hollow. You can rescue them!`,
  home: (name: string) => `He took ${name} to the Hollow, but they're home again!`,
  safe: 'Everyone stayed safe and cozy. Nice planning!',
  /** Squishies were out in the dark, but he took nobody (first-night grace, or a last friend). */
  spared: 'He came by, but took nobody this time.',
  ok: 'Okay!',
  rescueNamed: (name: string) => `Rescue ${name}!`,
  open: 'Hollow',
  sheetTitle: 'In the Hollow',
  sheetIntro: 'Win a showdown with the shadows to bring them home!',
  reward: (n: number) => `Your first rescue today earns ${String(n)} Heartdust.`,
  /** What Heartdust is for (the Heart Snack), under the reward line. */
  saveUp: SNACK ? `Save ${String(SNACK.cost?.['heartdust'] ?? 0)} for a ${SNACK.name}!` : '',
  noReward: 'No more Heartdust today, but they still come home!',
  rescue: 'Rescue!',
  empty: 'Everyone is safe at home!',
  back: 'Back',
  devNightfall: 'Night falls (dev)',
  devNight: (night: string, taken: number) =>
    taken === 0 ? `Night fell (${night}). Nobody was taken.` : `Night fell (${night}).`,
  fireHint: 'Light a fire before night falls!',
  /** Peeks out beside the Adventure handle while a friend is in the Hollow. */
  news: 'A friend is in the Hollow!',
  mystery: 'a squishy friend',
  waiting: ', waiting in the Hollow',
} as const;

/**
 * Reports worth telling (someone taken, kept safe, or left out and spared)
 * newer than `seenNight`, newest first. A night with nobody of mine there
 * says nothing.
 */
export function unseenReports(
  reports: readonly MorningReport[],
  seenNight: string | null,
): MorningReport[] {
  return reports.filter(
    (r) =>
      (seenNight === null || r.night > seenNight) &&
      (r.taken !== null || r.sheltered > 0 || r.exposed > 0),
  );
}

/**
 * The report card's title and lines for these nights (newest first).
 * `fireHint` is the status's own ("no fire of mine is lit for tonight"), so
 * a night he let them be asks for a fire only while there isn't one.
 */
export function reportText(
  reports: readonly MorningReport[],
  nameOf: (taken: NonNullable<MorningReport['taken']>) => string,
  fireHint = true,
): { title: string; lines: string[] } {
  const taken = reports.flatMap((r) => (r.taken ? [r.taken] : []));
  const title =
    taken.length === 0
      ? HOLLOW_TEXT.passedBy
      : reports.length > 1
        ? HOLLOW_TEXT.visitedMany
        : HOLLOW_TEXT.visitedOne;
  const lines = taken.map((t) =>
    t.inHollow ? HOLLOW_TEXT.taken(nameOf(t)) : HOLLOW_TEXT.home(nameOf(t)),
  );
  if (lines.length === 0) {
    // Nobody taken: either everyone was sheltered, or some were out in the
    // dark and he let them be (first-night grace), which is the moment to
    // say "light a fire" (owner decision 2026-10-03).
    if (reports.some((r) => r.taken === null && r.exposed > 0)) {
      lines.push(HOLLOW_TEXT.spared, ...(fireHint ? [HOLLOW_TEXT.fireHint] : []));
    } else {
      lines.push(HOLLOW_TEXT.safe);
    }
  }
  return { title, lines };
}

/** Building events that can light (or put out) tonight's fire. */
const FIRE_EVENTS = new Set(['building.placed', 'building.fueled', 'building.removed']);

/** One of my buildings changed: tonight's fire may be lit now (the fire hint asks again). */
export function changesMyFire(
  event: Pick<WsEventMessage, 'type' | 'data'>,
  userId: string,
): boolean {
  return FIRE_EVENTS.has(event.type) && event.data['userId'] === userId;
}
