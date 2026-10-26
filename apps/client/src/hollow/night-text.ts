import {
  EXPLORE_RULES,
  GAME_DATA,
  HOLLOW_RULES,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  economyEffects,
  type HollowRules,
  type HollowStage,
  type MorningReport,
  type PvpMode,
  type WeatherKind,
} from '@heartpatch/shared';
import { WEATHER_EMOJI } from '../weather/weather-model.js';
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

/** The stages from mildest to boldest, as the sheet lists them. */
export const STAGE_ORDER: readonly HollowStage[] = ['watching', 'curious', 'bold', 'boldest'];

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
  const nightsOf = (stage: HollowStage): string => {
    const mine = rows.filter((r) => r.stage === stage);
    const first = mine[0]?.from;
    const after = rows.find(
      (r) => r.from > (mine[mine.length - 1]?.from ?? 0) && r.stage !== stage,
    );
    if (first === undefined) return '';
    if (!after) return `night ${String(first)} on`;
    if (after.from - 1 === first) return `night ${String(first)}`;
    return `nights ${String(first)}–${String(after.from - 1)}`;
  };
  return {
    watching: nightsOf('watching'),
    curious: nightsOf('curious'),
    bold: nightsOf('bold'),
    boldest: nightsOf('boldest'),
  };
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
      // Resource buildings and the Warehouse (#601): what they'd stored lands too.
      makers: sum.makers + (r.lostBuildings.resourceBuildings ?? 0),
      warehouses: sum.warehouses + (r.lostBuildings.warehouses ?? 0),
    }),
    { fires: 0, fences: 0, grounds: 0, makers: 0, warehouses: 0 },
  );
  const things = [
    ...(lost.fences > 0 ? [lost.fences === 1 ? 'fence' : 'fences'] : []),
    ...(lost.fires > 0 ? [lost.fires === 1 ? 'fire' : 'fires'] : []),
    ...(lost.grounds > 0 ? ['Training Grounds'] : []),
    ...(lost.makers > 0 ? [lost.makers === 1 ? 'building' : 'buildings'] : []),
    ...(lost.warehouses > 0 ? ['Warehouse'] : []),
  ];
  const land =
    tiles === 1
      ? 'A bit of your dark land went wild again.'
      : `${String(tiles)} bits of your dark land went wild again.`;
  const back = things.length > 0 ? ` Your ${joinNames(things)} there came back to your bag.` : '';
  const made =
    lost.makers > 0
      ? ` What your ${lost.makers === 1 ? 'building' : 'buildings'} made came home too!`
      : '';
  return { icon: '🌿', text: `${land}${back}${made}` };
}

const BUILDING_NAMES = new Map(GAME_DATA.buildings.map((b) => [b.id, b.name]));

/** A building's morning upkeep at a level, from the shared maths (0 if it has none). */
function upkeepAt(buildingId: string, level: number): number {
  const building = GAME_DATA.buildings.find((b) => b.id === buildingId);
  if (!building) return 0;
  const effect = economyEffects(building, level, {
    jobs: JOB_RULES,
    explore: EXPLORE_RULES,
    resourceBuildings: RESOURCE_BUILDING_RULES,
  })[0];
  return effect?.upkeep ?? 0;
}

/**
 * The morning card's line for buildings that fell asleep for unpaid upkeep
 * this morning (#601, `HeartCoins.upkeep.pausedThisMorning`), in the tile
 * card's own words ("needs 💛", and the 💛 that wakes it): "Your Warehouse
 * needs 💛: this morning's coins ran short. It wakes up as soon as you have
 * 💛 30!" Up to three by name; more, or two of one kind, by count, with the
 * 💛 that wakes them all.
 */
export function upkeepPausedLine(
  buildings: readonly { buildingId: string; level: number }[],
): ReportLine | null {
  if (buildings.length === 0) return null;
  const names = buildings.map((b) => BUILDING_NAMES.get(b.buildingId) ?? 'building');
  const named = new Set(names).size === names.length && names.length <= 3;
  const one = buildings.length === 1;
  const who = named
    ? `Your ${joinNames(names)} ${one ? 'needs' : 'need'}`
    : `${String(names.length)} of your buildings need`;
  const coins = buildings.reduce((sum, b) => sum + upkeepAt(b.buildingId, b.level), 0);
  const enough = coins > 0 ? `💛 ${String(coins)}` : 'enough';
  return {
    icon: '💛',
    text: `${who} 💛: this morning's coins ran short. ${one ? 'It wakes' : 'They wake'} up as soon as you have ${enough}!`,
  };
}

/** Who knocked the buildings about, by the weather that did it. */
const KNOCKED_BY: Readonly<Record<Exclude<WeatherKind, 'clear'>, string>> = {
  storm: 'The storm',
  rain: 'The rain',
  fog: 'The fog',
  drought: 'The dry spell',
};

/**
 * The morning card's line after a Wild Isle storm (#621 W1-9): the buildings
 * it knocked about that still wait to be fixed (`HollowStatus.weatherNotes`).
 * "The storm knocked your Pier about. Fix it when you can!", with the
 * weather's emoji as the line's icon, never mid-sentence. Up to three by
 * name, more by count. Never "damage" or "destroy": it is knocked, not broken.
 * Only storms knock buildings today, and the notes don't say which weather
 * did it, so `kind` is the storm unless told otherwise.
 */
export function weatherNotesLine(
  notes: readonly { buildingId: string }[],
  kind: Exclude<WeatherKind, 'clear'> = 'storm',
): ReportLine | null {
  if (notes.length === 0) return null;
  const names = notes.map((n) => BUILDING_NAMES.get(n.buildingId) ?? 'building');
  const named = new Set(names).size === names.length && names.length <= 3;
  const what = named ? `your ${joinNames(names)}` : `${String(names.length)} of your buildings`;
  return {
    icon: WEATHER_EMOJI[kind],
    text: `${KNOCKED_BY[kind]} knocked ${what} about. Fix ${notes.length === 1 ? 'it' : 'them'} when you can!`,
  };
}
