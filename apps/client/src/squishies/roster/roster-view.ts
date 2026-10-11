import {
  CARE_RULES,
  GAME_DATA,
  moodLine,
  RaritySchema,
  type CareListResponse,
  type CareSquishy,
  type CareWhisper,
  type HomeResponse,
  type JobSquishy,
  type JobsView,
  type MoodDrift,
  type Rarity,
  type Species,
} from '@heartpatch/shared';
import { blobColor, evolvingBar, speciesById, type EvolvingBar } from '../../care/care-view.js';
import { formatTimeLeft } from '../../inventory/game-clock.js';
import { itemIcon } from '../../inventory/item-icons.js';
import { itemName } from '../../inventory/bag-view.js';

// The Squishies roster's model (#375): one row per squishy, merging the three
// reads the client already makes (`/home`, `/care`, `/jobs`) by squishy id.
// Pure, so every case is unit-tested without a DOM. The server still decides
// everything when the player taps (CLAUDE.md rule 1).

// Player-facing text (style guide §2, §6).
export const ROSTER_TEXT = {
  open: '🐾 Squishies',
  title: 'Squishies',
  close: 'Close',
  empty: 'No squishies yet. Befriend one on the map!',
  noMatch: 'No squishies match. Try another filter!',
  sortBy: 'Sort',
  show: 'Show',
  sort: { mood: 'Mood', level: 'Level', rarity: 'Rarity', status: 'Status' },
  filter: { all: 'All', care: 'Needs care', team: 'On team', working: 'Working' },
  needsCare: 'Needs care',
  care: '💗 Care',
  upClose: '🔍 Up close',
  dressUp: '🎀 Dress up',
  moveIn: '🏡 Move to a habitat',
  moveOut: '🏡 Move out',
  habitatFull: 'Full',
  hollowed: 'In the Hollow',
  inTrade: 'In a trade',
  onTeam: 'On team',
  guarding: 'Guarding',
  gathering: 'Gathering',
  training: 'Training',
  resting: 'Resting',
  level: (n: number) => `Lv ${String(n)}`,
  stage: (n: number, of: number) => `Stage ${String(n)} of ${String(of)}`,
  evolvesAt: (lv: number) => `evolves at Lv ${String(lv)}`,
  readyToEvolve: 'Ready to evolve! ✨',
  fullyEvolved: 'Fully evolved! 🌟',
  // Why happiness is drifting down (#376), short enough for a row tag.
  drift: {
    resting: '💤 Idle, so drifting',
    'wrong-job': '😕 Not its job',
    stopped: "⏸️ Job's on pause",
  } satisfies Record<Exclude<MoodDrift, 'steady'>, string>,
  steady: 'Holding steady',
  hearts: (filled: number) => `${String(filled)} of 5 hearts`,
  count: (n: number) => `${String(n)} ${n === 1 ? 'squishy' : 'squishies'}`,
  countOf: (shown: number, all: number) => `${String(shown)} of ${String(all)}`,
  // Said where the detail would be, when a read is missing.
  partial: 'Some details are still loading. Try again in a sec!',
} as const;

/** The evolving hint shows in the row from here; the detail always shows the bar. */
export const CLOSE_TO_EVOLVING_PERCENT = 70; // TUNE: "close" for the row's little ✨ hint

export type RosterSort = 'mood' | 'level' | 'rarity' | 'status';
export type RosterFilter = 'all' | 'care' | 'team' | 'working';

export const ROSTER_SORTS: readonly RosterSort[] = ['mood', 'level', 'rarity', 'status'];
export const ROSTER_FILTERS: readonly RosterFilter[] = ['all', 'care', 'team', 'working'];

/** A mood's little picture and one word, for its tag (the long line is for the detail). */
export const MOOD_WORDS: Readonly<Record<CareSquishy['mood'], { icon: string; word: string }>> = {
  glowing: { icon: '🌟', word: 'Glowing' },
  happy: { icon: '😊', word: 'Happy' },
  calm: { icon: '😌', word: 'Calm' },
  cuddly: { icon: '🤗', word: 'Cuddly' },
};

/** What a squishy is doing, for its status tag. `away` ones can't be sent anywhere. */
export type StatusKind =
  'team' | 'guard' | 'gathering' | 'training' | 'resting' | 'hollowed' | 'in-trade';

export interface StatusTag {
  readonly kind: StatusKind;
  /** "On team", "Gathering 🪵 Timber"; the countdown (if any) is `readyAt`'s. */
  readonly text: string;
  /** When a gatherer's next cycle lands (ISO), so the sheet can count down; else null. */
  readonly readyAt: string | null;
}

export interface MoodTag {
  readonly mood: CareSquishy['mood'];
  readonly line: string;
  /** 0–100. */
  readonly contentment: number;
  /** A full-value cuddle is still waiting (`fullCareLeft > 0`). */
  readonly needsCare: boolean;
  /** Why it's holding or drifting (#376), or null when the server doesn't say. */
  readonly drift: MoodDrift | null;
}

/** Where a squishy is on its public evolution line: "Stage 2 of 3". */
export interface EvolutionStage {
  readonly stage: number;
  readonly of: number;
  /** The level its next public form comes at, or null (top form, or ready). */
  readonly evolvesAt: number | null;
  /** 0–1 toward the next form; null with no meter (top form). */
  readonly fill: number | null;
  readonly ready: boolean;
}

export interface RosterRow {
  readonly id: string;
  readonly name: string;
  readonly speciesName: string;
  readonly speciesId: string;
  readonly rarity: Rarity | null;
  readonly color: string;
  readonly level: number;
  /** The evolving meter, or null on a top form (or with no care read). */
  readonly evolving: EvolvingBar | null;
  /** Evolving and close enough to say so on the row. */
  readonly evolvingSoon: boolean;
  /** "Stage N of M" with its bar, or null for a form off the public lines (a secret one). */
  readonly stage: EvolutionStage | null;
  /** The care sheet's branch whisper (#32), for the detail only; never a form or a chance. */
  readonly whisper: CareWhisper | null;
  /** Null when the care read is missing, or the squishy is away. */
  readonly mood: MoodTag | null;
  readonly status: StatusTag;
  /** Away (hollowed, in a trade): no care, jobs or habitat. */
  readonly away: boolean;
  readonly habitatId: string | null;
  readonly accessory: string | null;
  /** Its jobs row, for the shared job actions; null with no jobs read or while away. */
  readonly job: JobSquishy | null;
}

export interface RosterSources {
  readonly home: HomeResponse;
  /** Null while its read is missing: rows go without a mood. */
  readonly care: CareListResponse | null;
  /** Null while its read is missing: rows go without a status. */
  readonly jobs: JobsView | null;
}

const RARITY_RANK = new Map(RaritySchema.options.map((r, i) => [r, i]));
const STATUS_RANK: Record<StatusKind, number> = {
  team: 0,
  gathering: 1,
  training: 2,
  guard: 3,
  resting: 4,
  hollowed: 5,
  'in-trade': 6,
};

/** The rarity's place on the ladder (rarest highest). */
export function rarityRank(rarity: Rarity | null): number {
  return rarity === null ? -1 : (RARITY_RANK.get(rarity) ?? -1);
}

/** "Gathering 🪵 Timber" (the countdown rides after it, ticking). */
function gatheringText(job: JobSquishy): string {
  const resource = job.work?.resource;
  return resource
    ? `${ROSTER_TEXT.gathering} ${itemIcon(resource)} ${itemName(resource)}`
    : ROSTER_TEXT.gathering;
}

/** A squishy's status tag, from its jobs row (or, with none, what home knows). */
export function statusTag(
  job: JobSquishy | null,
  fallback: { readonly job: string } | null,
): StatusTag {
  if (job && job.squishy.state === 'hollowed') {
    return { kind: 'hollowed', text: ROSTER_TEXT.hollowed, readyAt: null };
  }
  if (job && job.squishy.state === 'in-trade') {
    return { kind: 'in-trade', text: ROSTER_TEXT.inTrade, readyAt: null };
  }
  const kind = job?.job ?? fallback?.job ?? 'resting';
  switch (kind) {
    case 'team':
      return { kind: 'team', text: ROSTER_TEXT.onTeam, readyAt: null };
    case 'guard':
      return { kind: 'guard', text: ROSTER_TEXT.guarding, readyAt: null };
    case 'gatherer':
      return {
        kind: 'gathering',
        text: job ? gatheringText(job) : ROSTER_TEXT.gathering,
        readyAt: job?.work && !job.work.full ? job.work.nextReadyAt : null,
      };
    case 'training':
      return { kind: 'training', text: ROSTER_TEXT.training, readyAt: null };
    default:
      return { kind: 'resting', text: ROSTER_TEXT.resting, readyAt: null };
  }
}

/** The status text with its countdown at `nowMs` ("Gathering 🪵 Timber · 12:30"). */
export function statusLine(tag: StatusTag, nowMs: number): string {
  if (tag.readyAt === null) return tag.text;
  const left = Date.parse(tag.readyAt) - nowMs;
  return left > 0 ? `${tag.text} · ${formatTimeLeft(left)}` : tag.text;
}

const PUBLIC_SPECIES: ReadonlyMap<string, Species> = new Map(
  GAME_DATA.species.map((s) => [s.id, s]),
);
/** Each public form's public parent (forms on one step share a parent). */
const PARENT: ReadonlyMap<string, string> = new Map(
  GAME_DATA.species.flatMap((s) => s.evolutions.map((e) => [e.into, s.id] as const)),
);

/** How many public steps are still above this form (0 on a top form). */
function stepsAbove(id: string, seen = new Set<string>()): number {
  const sp = PUBLIC_SPECIES.get(id);
  if (!sp || seen.has(id)) return 0;
  seen.add(id);
  let most = 0;
  for (const e of sp.evolutions) most = Math.max(most, 1 + stepsAbove(e.into, seen));
  return most;
}

/**
 * "Stage N of M" from the public species lines only (CLAUDE.md rule 6): a
 * secret form, or a step only a secret form follows, never counts. Null for a
 * form that isn't public. The bar and "evolves at" come from the care read's
 * evolving meter, which the server already blanks before a secret form.
 */
export function evolutionStage(
  speciesId: string,
  level: number,
  meter: CareSquishy['evolving'],
): EvolutionStage | null {
  if (!PUBLIC_SPECIES.has(speciesId)) return null;
  let stage = 1;
  for (let at = PARENT.get(speciesId); at !== undefined && stage < 10; at = PARENT.get(at)) {
    stage += 1;
  }
  const ready = meter !== null && meter.percent >= 100;
  return {
    stage,
    of: stage + stepsAbove(speciesId),
    evolvesAt: meter === null || ready ? null : level + meter.levelsToGo,
    fill: meter === null ? null : Math.min(1, meter.percent / 100),
    ready,
  };
}

/** Hearts out of 5 for a contentment, to the nearest half (2.5 = two and a half). */
export function heartsOf(contentment: number): number {
  return Math.round((contentment / CARE_RULES.maxContentment) * 10) / 2;
}

function moodTag(care: CareSquishy): MoodTag {
  return {
    mood: care.mood,
    line: moodLine(care.mood, CARE_RULES),
    contentment: care.contentment,
    needsCare: care.fullCareLeft > 0,
    drift: care.moodDrift,
  };
}

/**
 * One row per squishy of mine: my active ones from `/home` plus any the job
 * board knows are away (hollowed, in a trade), each joined to its `/care` and
 * `/jobs` rows by id. A missing read just leaves its tags off.
 */
export function mergeRoster(sources: RosterSources): RosterRow[] {
  const { home, care, jobs } = sources;
  const species: ReadonlyMap<string, Species> = new Map([
    ...speciesById({ speciesDefs: [...home.speciesDefs, ...(care?.speciesDefs ?? [])] }),
  ]);
  const careById = new Map(care?.squishies.map((s) => [s.id, s]));
  const jobById = new Map(jobs?.squishies.map((s) => [s.squishy.id, s]));
  const homeById = new Map(home.squishies.map((s) => [s.id, s]));
  // Home's active squishies first, then the away ones only the job board lists.
  const ids = [
    ...home.squishies.map((s) => s.id),
    ...(jobs?.squishies.map((s) => s.squishy.id).filter((id) => !homeById.has(id)) ?? []),
  ];
  return ids.map((id): RosterRow => {
    const h = homeById.get(id);
    const c = careById.get(id);
    const j = jobById.get(id) ?? null;
    const base = h ?? j?.squishy;
    // `ids` came from these two, so one of them has it.
    if (!base) throw new Error('mergeRoster: a squishy with no row');
    const sp = species.get(base.speciesId);
    const status = statusTag(j, h ?? null);
    const away = status.kind === 'hollowed' || status.kind === 'in-trade';
    const nickname = c?.nickname ?? base.nickname;
    const named = jobs?.names[id];
    const speciesName = sp?.name ?? named ?? 'Mystery squishy';
    const evolving = c && !away ? evolvingBar(c.evolving?.percent ?? null) : null;
    return {
      id,
      name: nickname ?? named ?? speciesName,
      speciesName,
      speciesId: base.speciesId,
      rarity: sp?.rarity ?? null,
      color: blobColor(base.speciesId, species),
      level: c?.level ?? j?.squishy.level ?? base.level,
      evolving,
      evolvingSoon: evolving !== null && (c?.evolving?.percent ?? 0) >= CLOSE_TO_EVOLVING_PERCENT,
      stage: c && !away ? evolutionStage(base.speciesId, c.level, c.evolving) : null,
      whisper: c && !away ? c.whisper : null,
      mood: c && !away ? moodTag(c) : null,
      status,
      away,
      // Home's is freshest right after a move; care and jobs fill in for an away one.
      habitatId: h ? h.habitatId : (c?.habitatId ?? j?.habitatId ?? null),
      accessory: c?.accessory ?? h?.accessory ?? null,
      job: away ? null : j,
    };
  });
}

/** Does this row pass the quick filter? */
export function passesFilter(row: RosterRow, filter: RosterFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'care':
      return row.mood?.needsCare === true;
    case 'team':
      return row.status.kind === 'team';
    case 'working':
      return (
        row.status.kind === 'gathering' ||
        row.status.kind === 'training' ||
        row.status.kind === 'guard'
      );
  }
}

const byName = (a: RosterRow, b: RosterRow) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Neediest (lowest contentment) first; away ones, with no mood, last. */
const moodKey = (r: RosterRow) => r.mood?.contentment ?? 1000;

/**
 * The rows to show: filtered, then sorted. Mood puts the neediest first;
 * level and rarity put the highest first; status groups by what they're doing
 * (team, then workers, resting, away). Ties fall back to the name, then id, so
 * the order never jumps between redraws.
 */
export function visibleRows(
  rows: readonly RosterRow[],
  sort: RosterSort,
  filter: RosterFilter,
): RosterRow[] {
  const keep = rows.filter((r) => passesFilter(r, filter));
  const order: Record<RosterSort, (a: RosterRow, b: RosterRow) => number> = {
    mood: (a, b) => moodKey(a) - moodKey(b),
    level: (a, b) => b.level - a.level,
    rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity),
    status: (a, b) => STATUS_RANK[a.status.kind] - STATUS_RANK[b.status.kind],
  };
  return keep.sort((a, b) => order[sort](a, b) || byName(a, b));
}

/** How many rows each filter would show, for its chip. */
export function filterCounts(rows: readonly RosterRow[]): Record<RosterFilter, number> {
  return {
    all: rows.length,
    care: rows.filter((r) => passesFilter(r, 'care')).length,
    team: rows.filter((r) => passesFilter(r, 'team')).length,
    working: rows.filter((r) => passesFilter(r, 'working')).length,
  };
}
