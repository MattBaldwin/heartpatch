import type { MorningReport } from '@heartpatch/shared';

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
  ok: 'Okay!',
  rescueNamed: (name: string) => `Rescue ${name}!`,
  open: 'Hollow',
  sheetTitle: 'In the Hollow',
  sheetIntro: 'Win a showdown with the shadows to bring them home!',
  reward: (n: number) => `Your first rescue today earns ${String(n)} Heartdust.`,
  noReward: 'No more Heartdust today, but they still come home!',
  rescue: 'Rescue!',
  empty: 'Everyone is safe at home!',
  back: 'Back',
  devNightfall: 'Night falls (dev)',
  devNight: (night: string, taken: number) =>
    taken === 0 ? `Night fell (${night}). Nobody was taken.` : `Night fell (${night}).`,
  mystery: 'a squishy friend',
  inHollow: (name: string) => `${name}, waiting in the Hollow`,
} as const;

/** Reports worth telling (someone taken, or someone kept safe) newer than `seenNight`, newest first. */
export function unseenReports(
  reports: readonly MorningReport[],
  seenNight: string | null,
): MorningReport[] {
  return reports.filter(
    (r) => (seenNight === null || r.night > seenNight) && (r.taken !== null || r.sheltered > 0),
  );
}

/** The report card's title and lines for these nights (newest first). */
export function reportText(
  reports: readonly MorningReport[],
  nameOf: (taken: NonNullable<MorningReport['taken']>) => string,
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
  if (lines.length === 0) lines.push(HOLLOW_TEXT.safe);
  return { title, lines };
}
