import {
  CARE_RULES,
  GAME_DATA,
  moodLine,
  type CareListResponse,
  type CareResult,
  type CareSquishy,
  type Species,
} from '@heartpatch/shared';

/*
 * The care sheet's model (#19, design doc §7–8): one squishy's mood, level
 * and XP bar, and the feed / pet / play buttons. Pure, so it's unit-tested
 * without the DOM, and the close-up view (#20) can reuse it.
 */

// Player-facing text (style guide §2, §6, §9).
export const CARE_TEXT = {
  title: 'Care',
  close: 'All done',
  level: (n: number) => `Level ${String(n)}`,
  topLevel: 'Top level!',
  xp: (into: number, size: number) => `${String(into)} / ${String(size)} XP`,
  noTreats: 'No Treats',
  treats: (n: number) => `${String(n)} ${n === 1 ? 'Treat' : 'Treats'}`,
  wait: 'Just a sec…',
  done: {
    feed: 'Nom nom! What a yummy treat.',
    pet: 'So soft! They wiggle happily.',
    play: 'Boop! Giggles all around.',
  } as Readonly<Record<string, string>>,
  fallbackDone: 'They loved that!',
  lessNow: "They're nice and full of love for today!",
  coins: (n: number) => `+${String(n)} Patch ${n === 1 ? 'Coin' : 'Coins'}`,
  infoTitle: 'Growing up',
  bonus: (percent: number) =>
    percent > 100
      ? `Battles give ×${String(percent / 100)} XP right now.`
      : 'Battles give normal XP. Care and a cozy home add a bonus!',
  fullLeft: (n: number) =>
    n > 0 ? `${String(n)} more extra-special ${n === 1 ? 'cuddle' : 'cuddles'} today.` : '',
  evolvedTitle: 'Whoa!',
  evolved: (from: string, into: string) => `${from} grew into ${into}!`,
  yay: 'Yay!',
  care: 'Care',
  noneYet: 'No squishy friends here yet. Befriend one on the map!',
} as const;

const ACTION_ICONS: Readonly<Record<string, string>> = { feed: '🍪', pet: '🤚', play: '✨' };

/** Every species the sheet may need to name or colour: public plus the reply's secret rows. */
export function speciesById(reply: Pick<CareListResponse, 'speciesDefs'>): Map<string, Species> {
  return new Map([...GAME_DATA.species, ...reply.speciesDefs].map((s) => [s.id, s]));
}

export function squishyName(
  squishy: Pick<CareSquishy, 'nickname' | 'speciesId'>,
  species: ReadonlyMap<string, Species>,
): string {
  return squishy.nickname ?? species.get(squishy.speciesId)?.name ?? 'Mystery squishy';
}

/** A species' main colour, for the soft blob on the sheet. */
export function blobColor(speciesId: string, species: ReadonlyMap<string, Species>): string {
  return species.get(speciesId)?.visual.palette[0] ?? '#c9b8ff';
}

export interface CareButton {
  readonly action: string;
  readonly label: string;
  /** Why it can't be tapped now, or null. */
  readonly note: string | null;
}

export interface CareSheetModel {
  readonly name: string;
  readonly color: string;
  readonly mood: string;
  /** Hearts meter, 0–1. */
  readonly hearts: number;
  readonly level: string;
  /** XP bar, 0–1, and its words. */
  readonly xp: number;
  readonly xpLine: string;
  readonly buttons: readonly CareButton[];
  /** The optional info card (numbers live here, style guide §2). */
  readonly info: readonly string[];
}

export function careSheet(
  squishy: CareSquishy,
  reply: Pick<CareListResponse, 'speciesDefs' | 'items' | 'now'>,
): CareSheetModel {
  const species = speciesById(reply);
  const now = Date.parse(reply.now);
  const buttons = GAME_DATA.careActions.map((action): CareButton => {
    const readyAt = squishy.nextCareAt[action.id];
    const costs = Object.entries(action.cost ?? {});
    const short = costs.some(([id, n]) => (reply.items[id] ?? 0) < n);
    const treats = action.cost?.['treats'];
    const label =
      treats === undefined
        ? `${ACTION_ICONS[action.id] ?? '💗'} ${action.name}`
        : `${ACTION_ICONS[action.id] ?? '💗'} ${action.name} (${CARE_TEXT.treats(reply.items['treats'] ?? 0)})`;
    const note =
      readyAt !== undefined && Date.parse(readyAt) > now
        ? CARE_TEXT.wait
        : short
          ? CARE_TEXT.noTreats
          : null;
    return { action: action.id, label, note };
  });
  const toNext = squishy.xpToNext;
  return {
    name: squishyName(squishy, species),
    color: blobColor(squishy.speciesId, species),
    mood: moodLine(squishy.mood, CARE_RULES),
    hearts: squishy.contentment / CARE_RULES.maxContentment,
    level: CARE_TEXT.level(squishy.level),
    xp: toNext === null ? 1 : Math.min(1, squishy.xpIntoLevel / toNext),
    xpLine: toNext === null ? CARE_TEXT.topLevel : CARE_TEXT.xp(squishy.xpIntoLevel, toNext),
    buttons,
    info: [
      CARE_TEXT.bonus(squishy.xpBonusPercent),
      CARE_TEXT.fullLeft(squishy.fullCareLeft),
    ].filter((line) => line !== ''),
  };
}

/** The line after a care action. */
export function careDoneLine(result: CareResult): string {
  const line = result.full
    ? (CARE_TEXT.done[result.action] ?? CARE_TEXT.fallbackDone)
    : CARE_TEXT.lessNow;
  return result.coins > 0 ? `${line} ${CARE_TEXT.coins(result.coins)}` : line;
}

/** The celebration line for an evolution, naming both forms (the owner has met both). */
export function evolutionLine(
  squishy: CareSquishy,
  species: ReadonlyMap<string, Species>,
): string | null {
  const evolution = squishy.newEvolution;
  if (!evolution) return null;
  const from = species.get(evolution.fromSpeciesId)?.name ?? 'Your squishy';
  const into = species.get(evolution.intoSpeciesId)?.name ?? 'something new';
  return CARE_TEXT.evolved(squishy.nickname ?? from, into);
}
