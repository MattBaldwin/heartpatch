import {
  CARE_RULES,
  GAME_DATA,
  moodLine,
  type CareListResponse,
  type CareResult,
  type CareWhisper,
  type CareSquishy,
  type MoodDrift,
  type MoodId,
  type Rarity,
  type Species,
  type SpeciesVisual,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { FEED_ACTION, foodCount, foodRow, PLAIN_FOOD, type FoodRow } from './food-pick.js';

/*
 * The care sheet's model (#19, design doc §7–8): one squishy's mood, level
 * and XP bar, and the feed / pet / play buttons. Pure, so it's unit-tested
 * without the DOM, and the close-up view (#20) can reuse it.
 */

/** What each care action's cheer says (by care action id). */
const DONE_LINES: Readonly<Record<string, string>> = {
  feed: 'Nom nom! What a yummy treat.',
  pet: 'So soft! They wiggle happily.',
  play: 'Boop! Giggles all around.',
  'heart-snack': 'Mmm! They feel so loved.',
  'heart-tea': 'Sip, sip! Warm and cozy all over.',
};

/**
 * Public species ids. Only a public form with no public evolution says it's
 * fully evolved: a secret form's own evolutions stay on the server, so it
 * just shows its level (#205).
 */
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));

// Player-facing text (style guide §2, §6, §9).
export const CARE_TEXT = {
  title: 'Care',
  close: 'All done',
  level: (n: number) => `Level ${String(n)}`,
  growsUp: (n: number, at: number) => `Level ${String(n)} · evolves at Level ${String(at)}`,
  // A top form (#205, owner-approved words 2026-10-07).
  fullyEvolved: (n: number) => `Level ${String(n)} · Fully evolved! 🌟`,
  evolving: '✨ Evolving',
  evolvingPercent: (p: number) => `${String(p)}%`,
  readyToEvolve: '✨ Ready to evolve!',
  // Battles and Training Grounds XP both count (owner decision 2026-10-09, #236).
  evolvesNextXp: 'Evolves with its next XP ✨',
  evolvingGain: (p: number) => `+${String(p)}% toward evolving!`,
  topLevel: 'Top level!',
  xp: (into: number, size: number) => `${String(into)} / ${String(size)} XP`,
  noTreats: 'No Treats',
  // A rare treat (`outsideDailyCare`, the Heart Snack, owner decision 2026-10-06).
  treatLine: (name: string) =>
    `A ${name} tastes like a big hug. It always counts, even after today's cuddles!`,
  have: (icon: string, have: number, need: number, item: string) =>
    `${icon} ${String(have)}/${String(need)} ${item}`,
  treats: (n: number) => `${String(n)} ${n === 1 ? 'Treat' : 'Treats'}`,
  wait: 'Just a sec…',
  done: DONE_LINES,
  fallbackDone: 'They loved that!',
  // A feed the server says gave extra (Pies, or Frosty Treats for a Frost one).
  yum: 'Yum yum! Extra yummy! 💖',
  lessNow: "They're nice and full of love for today!",
  coins: (n: number) => `+${String(n)} Patch ${n === 1 ? 'Coin' : 'Coins'}`,
  infoTitle: 'Levels and evolving',
  // Why care matters (design doc §7), up front in "Levels and evolving".
  whyCare: 'Happy squishies learn more from battles and evolve sooner!',
  // CARE_RULES.hoursFullToBaseline (24, `// TUNE:`): reword if it moves far from a day.
  // It fades only while resting or on a job that isn't their thing (#376).
  fades: 'Happiness fades over about a day while they rest. A job they love keeps it steady!',
  // Why happiness is or isn't drifting down right now (#376), under the mood.
  // A no-break space keeps each emoji with its words when the line wraps.
  drift: {
    steady: 'Loves their job, so happiness holds steady\u00a0💪',
    resting: 'Resting, so happiness slowly drifts down\u00a0💤',
    'wrong-job': 'Not loving this job, so happiness drifts\u00a0😕',
    stopped: "Work's on pause, so happiness drifts. Check their\u00a0job!",
  } satisfies Record<MoodDrift, string>,
  // A resident of the Keeper's house (#381; the owner's words): the perk, under the drift line.
  livesInHouse: 'Lives in your house: happiness fades slower\u00a0🏠',
  // The mood title while happiness drifts down (#376): the same level, a little droopy.
  droopy: {
    glowing: 'Glowing, but drooping a little…',
    happy: 'Happy, but a bit droopy…',
    calm: 'Calm, but a bit droopy…',
    cuddly: 'Could use a cuddle!',
  } satisfies Record<MoodId, string>,
  bonus: (percent: number) =>
    percent > 100
      ? `Battles give ×${String(percent / 100)} XP right now.`
      : 'Battles give normal XP. Care and a cozy home add a bonus!',
  fullLeft: (n: number) =>
    n > 0 ? `${String(n)} more extra-special ${n === 1 ? 'cuddle' : 'cuddles'} today.` : '',
  evolvedTitle: 'Whoa!',
  evolved: (from: string, into: string) => `${from} grew into ${into}!`,
  // A branch form (#32), under the celebration line.
  newForm: '🌟 A brand-new form!',
  // "Levels and evolving", on a line that can grow up two ways (#32).
  feelingsMatter:
    'How you care for it can change what it grows into. Treats, pets, games, battles and its home all count!',
  yay: 'Yay!',
  care: 'Care',
  upClose: 'Up close',
  noneYet: 'No squishy friends here yet. Befriend one on the map!',
  notHere: "That friend isn't here right now. Say hi to this one!",
} as const;

const ACTION_ICONS: Readonly<Record<string, string>> = {
  feed: '🍪',
  pet: '🤚',
  play: '✨',
  'heart-snack': '💖',
  'heart-tea': '🍵',
};

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
  /** One or two words with its icon ("🍪 Feed"), so it fits a round button (#153). */
  readonly label: string;
  /** What it costs, under the label ("3 Treats"), or null. */
  readonly sub: string | null;
  /** Why it can't be tapped now (empty: just switched off), or null. */
  readonly note: string | null;
  /** A rare treat (`outsideDailyCare`): drawn as the special button. */
  readonly special: boolean;
}

/** The little face on the care sheet's blob, from the species' parts (#153). */
export interface SquishyFace {
  readonly eyes: 'dot' | 'oval' | 'happy' | 'sleepy';
  readonly mouth: 'smile' | 'open' | 'cat';
  readonly blush: boolean;
  /** A lighter tummy patch, in the palette's second colour. */
  readonly belly: string | null;
}

/**
 * What the sheet's blob should wear for a face, so it reads as the squishy
 * and not a plain circle: the species' eye and mouth parts (the close-up view
 * draws the real one in 3D).
 */
export function squishyFace(visual: Pick<SpeciesVisual, 'parts' | 'palette'>): SquishyFace {
  const has = (part: string) => visual.parts.includes(part);
  return {
    eyes: has('happy-eyes')
      ? 'happy'
      : has('sleepy-eyes')
        ? 'sleepy'
        : has('oval-eyes')
          ? 'oval'
          : 'dot',
    mouth: has('open-mouth') ? 'open' : has('cat-mouth') ? 'cat' : 'smile',
    blush: has('blush-cheeks'),
    belly: has('belly-patch') ? (visual.palette[1] ?? null) : null,
  };
}

/** The face for a species id (a plain one for a species the client doesn't know). */
export function faceFor(speciesId: string, species: ReadonlyMap<string, Species>): SquishyFace {
  const visual = species.get(speciesId)?.visual;
  return squishyFace(visual ?? { parts: [], palette: [] });
}

export interface CareSheetModel {
  readonly name: string;
  /** The species' rarity for its chip (#240), or null when the client has no row for it. */
  readonly rarity: Rarity | null;
  readonly color: string;
  readonly mood: string;
  /** Why happiness is holding or drifting (#376), or null when the reply doesn't say. */
  readonly drift: string | null;
  /** Holding steady or drifting down, for the hearts bar's look (#376); null: unknown. */
  readonly driftMood: 'steady' | 'drifting' | null;
  /** "Lives in your house…" for a resident of the Keeper's house (#381), else null. */
  readonly house: string | null;
  /** Hearts meter, 0–1. */
  readonly hearts: number;
  readonly level: string;
  /** XP bar, 0–1, and its words. */
  readonly xp: number;
  readonly xpLine: string;
  readonly buttons: readonly CareButton[];
  /** Under the buttons while a rare treat shows ("A Heart Snack tastes like…"), else null. */
  readonly treat: string | null;
  /** "Levels and evolving": why care matters, then the numbers (style guide §2). */
  readonly info: readonly string[];
  /** The evolving meter (#205), under the level's XP bar; null with none. */
  readonly evolving: EvolvingBar | null;
  /** Under the evolving meter (#32): what's shaping its next evolution, or null. */
  readonly whisper: CareWhisper | null;
  /** The celebration's "brand-new form!" chip (#32): it grew into a branch form. */
  readonly newForm: boolean;
  /** The food row above Feed (option C, 2026-10-30), or null: Feed pays with Treats. */
  readonly foods: FoodRow | null;
}

/** The evolving meter's words and fill (#205). */
export interface EvolvingBar {
  /** "✨ Evolving", or "✨ Ready to evolve!" at 100%. */
  readonly label: string;
  /** "62%", or empty when ready. */
  readonly value: string;
  /** 0–1. */
  readonly fill: number;
  readonly ready: boolean;
  /** "Evolves with its next XP ✨" when ready, else null. */
  readonly sub: string | null;
}

/** The meter for `percent` (0–100), or null with none (a top form, or a secret one next). */
export function evolvingBar(percent: number | null): EvolvingBar | null {
  if (percent === null) return null;
  const ready = percent >= 100;
  return {
    label: ready ? CARE_TEXT.readyToEvolve : CARE_TEXT.evolving,
    value: ready ? '' : CARE_TEXT.evolvingPercent(percent),
    fill: Math.max(0, Math.min(1, percent / 100)),
    ready,
    sub: ready ? CARE_TEXT.evolvesNextXp : null,
  };
}

/**
 * The sheet for one squishy. `now` is the server's time (ms) as the client
 * reckons it, so a debounced button comes back on; it defaults to the reply's.
 * With `food`, the sheet offers the food row and Feed pays with its pick
 * (the player's tap, or null for the best); without it, Feed is plain Treats.
 */
export function careSheet(
  squishy: CareSquishy,
  reply: Pick<CareListResponse, 'speciesDefs' | 'items' | 'now'>,
  now = Date.parse(reply.now),
  food?: { readonly pick: string | null },
): CareSheetModel {
  const species = speciesById(reply);
  const foods = food
    ? foodRow(
        reply.items,
        { name: squishyName(squishy, species), element: squishy.element },
        food.pick,
      )
    : null;
  // A rare treat shows once the bag has any of what it costs (one Heartdust
  // from a rescue), so it's taught when it's in reach (style guide §3.1).
  const actions = GAME_DATA.careActions.filter(
    (action) =>
      action.outsideDailyCare !== true ||
      Object.keys(action.cost ?? {}).some((id) => (reply.items[id] ?? 0) > 0),
  );
  const buttons = actions.map((action): CareButton => {
    const readyAt = squishy.nextCareAt[action.id];
    // Fed with the row's pick, Feed shows (and is short of) that food instead.
    const fedWith =
      action.id === FEED_ACTION && foods && foods.picked !== PLAIN_FOOD ? foods.picked : null;
    if (fedWith !== null) {
      const n = reply.items[fedWith] ?? 0;
      return {
        action: action.id,
        label: `${itemIcon(fedWith)} ${action.name}`,
        sub: foodCount(fedWith, n),
        note: readyAt !== undefined && Date.parse(readyAt) > now ? CARE_TEXT.wait : null,
        special: false,
      };
    }
    const costs = Object.entries(action.cost ?? {});
    const short = costs.some(([id, n]) => (reply.items[id] ?? 0) < n);
    const special = action.outsideDailyCare === true;
    const treats = action.cost?.['treats'];
    const label = `${ACTION_ICONS[action.id] ?? '💗'} ${action.name}`;
    const sub = special
      ? costs
          .map(([id, n]) => CARE_TEXT.have(itemIcon(id), reply.items[id] ?? 0, n, itemName(id)))
          .join(' ')
      : treats === undefined
        ? null
        : CARE_TEXT.treats(reply.items['treats'] ?? 0);
    const note =
      readyAt !== undefined && Date.parse(readyAt) > now
        ? CARE_TEXT.wait
        : short
          ? special
            ? '' // its have/need already says why
            : CARE_TEXT.noTreats
          : null;
    return { action: action.id, label, sub, note, special };
  });
  const treat = actions.find((a) => a.outsideDailyCare === true);
  const toNext = squishy.xpToNext;
  // A step's forms share its level (#32): the first is the default form.
  const evolutions = species.get(squishy.speciesId)?.evolutions;
  const growsAt = evolutions?.[0]?.level;
  // It can grow up two ways (#32): more than one form at its next level.
  const branches = (evolutions ?? []).filter((e) => e.level === growsAt).length > 1;
  return {
    name: squishyName(squishy, species),
    rarity: species.get(squishy.speciesId)?.rarity ?? null,
    color: blobColor(squishy.speciesId, species),
    mood:
      squishy.moodDrift !== null && squishy.moodDrift !== 'steady'
        ? CARE_TEXT.droopy[squishy.mood]
        : moodLine(squishy.mood, CARE_RULES),
    drift: squishy.moodDrift === null ? null : CARE_TEXT.drift[squishy.moodDrift],
    driftMood:
      squishy.moodDrift === null ? null : squishy.moodDrift === 'steady' ? 'steady' : 'drifting',
    // Set only while the house is switched on for this player (residents exist only then).
    house: squishy.houseRoomId === null ? null : CARE_TEXT.livesInHouse,
    hearts: squishy.contentment / CARE_RULES.maxContentment,
    level:
      growsAt !== undefined && growsAt > squishy.level
        ? CARE_TEXT.growsUp(squishy.level, growsAt)
        : evolutions?.length === 0 && PUBLIC_SPECIES.has(squishy.speciesId)
          ? CARE_TEXT.fullyEvolved(squishy.level)
          : CARE_TEXT.level(squishy.level),
    xp: toNext === null ? 1 : Math.min(1, squishy.xpIntoLevel / toNext),
    xpLine: toNext === null ? CARE_TEXT.topLevel : CARE_TEXT.xp(squishy.xpIntoLevel, toNext),
    buttons,
    treat: treat ? CARE_TEXT.treatLine(treat.name) : null,
    info: [
      CARE_TEXT.whyCare,
      branches ? CARE_TEXT.feelingsMatter : '',
      CARE_TEXT.fades,
      CARE_TEXT.bonus(squishy.xpBonusPercent),
      CARE_TEXT.fullLeft(squishy.fullCareLeft),
    ].filter((line) => line !== ''),
    evolving: evolvingBar(squishy.evolving?.percent ?? null),
    whisper: squishy.whisper,
    newForm: squishy.newEvolution?.branch === true,
    foods,
  };
}

/** The line after a care action (`big`: a feed that gave extra, `bigFeed`). */
export function careDoneLine(result: CareResult, big = false): string {
  const line = !result.full
    ? CARE_TEXT.lessNow
    : big
      ? CARE_TEXT.yum
      : (CARE_TEXT.done[result.action] ?? CARE_TEXT.fallbackDone);
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

/** Milliseconds until the next debounced action on this squishy can count again, or null. */
export function nextReadyIn(squishy: CareSquishy, now: number): number | null {
  let soonest: number | null = null;
  for (const at of Object.values(squishy.nextCareAt)) {
    const wait = Date.parse(at) - now;
    if (wait > 0 && (soonest === null || wait < soonest)) soonest = wait;
  }
  return soonest;
}
