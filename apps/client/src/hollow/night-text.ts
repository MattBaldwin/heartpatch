import {
  HOLLOW_RULES,
  type HollowRules,
  type HollowStage,
  type MorningReport,
  type PvpMode,
} from '@heartpatch/shared';
import { joinNames } from './show-timeline.js';

// The night's words around the show (#277, mockup screens 1, 2, 5 and 7):
// the chips over the map, the dark-land nudge before nightfall, the "he gets
// bolder" sheet and the morning report's calm lines. Kids see his stage
// (with a moon) and never a number (owner decision 2026-10-08 Q8). Pure, so
// the wording is unit-tested and scanned for avoided words (style guide §9).

/** Each stage's moon and name (owner decision 2026-10-08 Q8). */
export const STAGES: Record<HollowStage, { moon: string; name: string }> = {
  watching: { moon: '🌑', name: 'Watching' },
  curious: { moon: '🌒', name: 'Curious' },
  bold: { moon: '🌓', name: 'Bold' },
  boldest: { moon: '🌕', name: 'Boldest' },
};

const ORDER: readonly HollowStage[] = ['watching', 'curious', 'bold', 'boldest'];

export const NIGHT_TEXT = {
  nightIn: (minutes: number) => `🌇 Night in ${String(minutes)} min`,
  night: '🌙 Night',
  darkSpots: (n: number) => `🌑 ${String(n)} dark ${n === 1 ? 'spot' : 'spots'}`,
  stageChip: (stage: HollowStage) =>
    `${STAGES[stage].moon} He's ${STAGES[stage].name.toLowerCase()} tonight`,
  /** The nudge before nightfall: who sleeps out in the dark, by name. */
  outInDark: (names: readonly string[]) => {
    if (names.length === 0) return 'Some of your land is dark tonight!';
    if (names.length <= 2) {
      return `${joinNames(names)} ${names.length > 1 ? 'are' : 'is'} out in the dark tonight!`;
    }
    return `${names[0] ?? ''} and ${String(names.length - 1)} friends are out in the dark tonight!`;
  },
  noLight: (n: number) =>
    `${n === 1 ? '1 bit of your land has' : `${String(n)} bits of your land have`} no fire light. Light a fire nearby to keep your land and squishies safe.`,
  lightFire: '🔥 Light fire',
  showMe: 'Show me',
  sheetTitle: 'The Hollow Man gets bolder',
  sheetIntro:
    "Each night you're on this patch, he gets a little braver. But he can never go into fire light, and your home is always safe.",
  tonight: (stage: HollowStage) => `Tonight he's ${STAGES[stage].name}.`,
  lightAll: "Light every bit of your land and he can't get anything!",
  okay: 'Okay!',
  /** The morning report (mockup screen 5). */
  watchReplay: '▶ Watch replay',
  lightMyLand: 'Light my land',
} as const;

/** The nights each stage covers, from the curve: "nights 3–6", "night 14 on". */
export function stageNights(
  rules: Pick<HollowRules, 'strength'> = HOLLOW_RULES,
): Record<HollowStage, string> {
  const rows = rules.strength.nights;
  const out = {} as Record<HollowStage, string>;
  for (const stage of ORDER) {
    const mine = rows.filter((r) => r.stage === stage);
    const first = mine[0]?.from;
    const after = rows.find(
      (r) => r.from > (mine[mine.length - 1]?.from ?? 0) && r.stage !== stage,
    );
    if (first === undefined) out[stage] = '';
    else if (!after) out[stage] = `night ${String(first)} on`;
    else if (after.from - 1 === first) out[stage] = `night ${String(first)}`;
    else out[stage] = `nights ${String(first)}–${String(after.from - 1)}`;
  }
  return out;
}

/**
 * How many dark spots he reaches for at a stage, in words, from the curve
 * (and a gentle patch's cap): "He's only watching tonight.", "He might reach
 * for 1 dark spot.", "He'll reach for 1 or 2 dark spots."
 */
export function reachText(
  stage: HollowStage,
  pvpMode: PvpMode | null,
  rules: Pick<HollowRules, 'strength'> = HOLLOW_RULES,
): string {
  const rows = rules.strength.nights.filter((r) => r.stage === stage);
  const cap = pvpMode === 'gentle' ? rules.strength.gentleCap : rules.strength.cap;
  const most = Math.min(cap, Math.max(0, ...rows.map((r) => r.chances.length)));
  if (most === 0) return "He's only watching tonight.";
  const sure = rows.length > 0 && rows.every((r) => (r.chances[0] ?? 0) >= 100);
  if (most === 1) return sure ? "He'll reach for 1 dark spot." : 'He might reach for 1 dark spot.';
  const range = most === 2 ? '1 or 2' : `up to ${String(most)}`;
  return sure ? `He'll reach for ${range} dark spots.` : `He might reach for ${range} dark spots.`;
}

/** One line of the morning report, with its little picture (mockup screen 5). */
export interface ReportLine {
  readonly icon: string;
  readonly text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

/** "He backed away 4 times!" and "Your fires kept 5 squishies safe.", for these nights. */
export function firesLine(reports: readonly MorningReport[]): ReportLine | null {
  const backed = reports.reduce((n, r) => n + r.walk.filter((p) => p.kind === 'recoil').length, 0);
  const kept = reports.reduce((n, r) => n + r.sheltered, 0);
  if (backed === 0 && kept === 0) return null;
  const parts = [
    ...(kept > 0 ? [`Your fires kept ${plural(kept, 'squishy', 'squishies')} safe.`] : []),
    ...(backed > 0 ? [`He backed away ${backed === 1 ? 'once' : `${String(backed)} times`}!`] : []),
  ];
  return { icon: '🔥', text: parts.join(' ') };
}

/** "2 bits of land went wild again. Your fence and fire there came back to your bag." */
export function wildLine(reports: readonly MorningReport[]): ReportLine | null {
  const tiles = reports.reduce((n, r) => n + r.reclaimed.length, 0);
  if (tiles === 0) return null;
  const lost = reports.reduce(
    (sum, r) => ({
      fires: sum.fires + r.lostBuildings.fires,
      fences: sum.fences + r.lostBuildings.fences,
      grounds: sum.grounds + r.lostBuildings.trainingGrounds,
    }),
    { fires: 0, fences: 0, grounds: 0 },
  );
  const things = [
    ...(lost.fences > 0 ? [lost.fences === 1 ? 'fence' : 'fences'] : []),
    ...(lost.fires > 0 ? [lost.fires === 1 ? 'fire' : 'fires'] : []),
    ...(lost.grounds > 0 ? ['Training Grounds'] : []),
  ];
  const land =
    tiles === 1
      ? 'A bit of your dark land went wild again.'
      : `${String(tiles)} bits of your dark land went wild again.`;
  const back = things.length > 0 ? ` Your ${joinNames(things)} there came back to your bag.` : '';
  return { icon: '🌿', text: `${land}${back}` };
}
