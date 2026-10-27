import type {
  HomeResponse,
  ItemCounts,
  MyBuilding,
  WeatherKind,
  WorksBuilding,
} from '@heartpatch/shared';
import { formatWait } from '../inventory/game-clock.js';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import type { BuildingPortraitLook } from '../procedural/portraits.js';
import { RESOURCE_TEXT } from '../resource-buildings/resource-model.js';
import { WEATHER_EMOJI } from '../weather/weather-model.js';
import { WORKS_BUILDINGS, WORKS_TEXT } from './works-model.js';

// The standing works tile card (#621 W1-10c, owner-approved mockup v3): my
// Wild Isle homestead building's picture, and for a works what it makes,
// its storage meter, how today's weather over its tile changes it and a
// friendly need line when the bag is short of what it eats. Every state
// comes from the server's `production` (`weather`, `short`, CLAUDE.md
// rule 1); this only picks the words. Pure, so every case is unit-tested.

/** The picture's side in CSS px (drawn at the capped pixel ratio, so ≤ 2×). */
export const WORKS_PORTRAIT_PX = 72; // TUNE: fits beside the lines on an iPhone SE's short panel

const DATA = new Map(WORKS_BUILDINGS.map((b) => [b.id, b]));

/** The sky's word on the chip: "Foggy: fish bite faster!". */
const SKY_WORD: Readonly<Record<WeatherKind, string>> = {
  clear: 'Clear',
  rain: 'Rainy',
  fog: 'Foggy',
  storm: 'Stormy',
  drought: 'Dry',
};

/** What a works' weather speeds up or slows down, by what it makes (mockup v3). */
const PACE_WORD: Readonly<Record<string, string>> = {
  fish: 'fish bite',
  greens: 'growing',
};

/** One of an eaten item, for "Need 1 more Green" (item names are plural, or mass nouns like Fish). */
const ONE_NAME: Readonly<Record<string, string>> = { greens: 'Green' };

/** A works' short name on its need line: "for the mill" (mockup v3). */
const SHORT_NAME: Readonly<Record<string, string>> = { watermill: 'mill' };

/** The waiting chip's emoji: ☔ for rain, like the Rain Barrel's own line (mockup v3). */
const WAIT_EMOJI: Readonly<Record<WeatherKind, string>> = { ...WEATHER_EMOJI, rain: '☔' };

const SKY_NOUN: Readonly<Record<WeatherKind, string>> = {
  clear: 'clear skies',
  rain: 'rain',
  fog: 'fog',
  storm: 'a storm',
  drought: 'a dry spell',
};

/** A no-break space: a line's last word and its emoji wrap together, never the emoji alone. */
const KEEP = '\u00a0';

// Player-facing text (style guide: cozy, short, kid-readable; one idea a chip).
export const WORKS_CARD_TEXT = {
  /** "Makes 🐟 Fish, even while you're away!" */
  makes: (resource: string) =>
    `Makes ${itemIcon(resource)} ${itemName(resource)}, even while you're away!`,
  /** "Turns 🌿 Greens into 🌾 Flour, even while you're away!" */
  turns: (eats: string, resource: string) =>
    `Turns ${itemIcon(eats)} ${itemName(eats)} into ${itemIcon(resource)} ${itemName(resource)}, even while you're away!`,
  /** None in the bag: "Out of Greens! Bring some for the mill 🌿" */
  need: (item: string, building: string) =>
    `Out of ${itemName(item)}! Bring some for the ${building}${KEEP}${itemIcon(item)}`,
  /** Some, but not enough: "Need 7 more Greens for the mill 🌿" */
  needMore: (n: number, item: string, building: string) =>
    `Need ${String(n)} more ${n === 1 ? (ONE_NAME[item] ?? itemName(item)) : itemName(item)} for the ${building}${KEEP}${itemIcon(item)}`,
  /** "Each batch takes 2 🌿" */
  eats: (n: number, item: string) => `Each batch takes ${String(n)} ${itemIcon(item)}`,
  /** "🌫️ Foggy: fish bite faster!" */
  faster: (kind: WeatherKind, resource: string) =>
    `${WEATHER_EMOJI[kind]} ${SKY_WORD[kind]}: ${PACE_WORD[resource] ?? 'working'} faster!`,
  /** "🌞 Dry: growing slower" */
  slower: (kind: WeatherKind, resource: string) =>
    `${WEATHER_EMOJI[kind]} ${SKY_WORD[kind]}: ${PACE_WORD[resource] ?? 'working'} slower`,
  /** An `onlyWhile` building under its weather: "🌧️ Rainy: filling up!" */
  filling: (kind: WeatherKind) => `${WEATHER_EMOJI[kind]} ${SKY_WORD[kind]}: filling up!`,
  waiting: (kind: WeatherKind) => `Dry here: waiting for ${SKY_NOUN[kind]} ${WAIT_EMOJI[kind]}`,
  usual: '⛅ Working as usual today',
} as const;

/** The chip's colour: up (green), down (peach), waiting (blue) or the same (soft). */
export type WorksChipTone = 'up' | 'down' | 'waiting' | 'same';

export interface WorksChip {
  readonly text: string;
  readonly tone: WorksChipTone;
}

/** The five states of a works tile card. */
export type WorksState = 'running' | 'full' | 'short' | 'paused' | 'napping';

export interface WorksCard {
  readonly state: WorksState;
  readonly resource: string;
  readonly stored: number;
  /** Its storage, or null while the Warehouse delivers. */
  readonly max: number | null;
  /** 0–100, for the meter's width. */
  readonly percent: number;
  /** "🐟 58 of 96" */
  readonly meter: string;
  /** What it's doing, or its need line when short. */
  readonly line: string;
  readonly chip: WorksChip | null;
  /** "Next batch in 12m" while running; what a batch eats while short. */
  readonly next: string | null;
  readonly upkeep: string;
  readonly collect: boolean;
}

/** The first weather kind a works lists by how it moves its pace. */
function kindWhere(b: WorksBuilding, test: (percent: number) => boolean): WeatherKind | null {
  const hit = Object.entries(b.weather ?? {}).find(([, p]) => test(p));
  return hit ? (hit[0] as WeatherKind) : null;
}

/** The weather chip for the server's `production.weather`, or null with none to show. */
export function worksChip(
  b: WorksBuilding,
  weather: NonNullable<MyBuilding['production']>['weather'],
): WorksChip | null {
  if (weather === undefined) return null;
  const only = b.onlyWhile ?? null;
  if (weather === 'waiting') {
    return only ? { text: WORKS_CARD_TEXT.waiting(only), tone: 'waiting' } : null;
  }
  if (weather === 'same') {
    return only
      ? { text: WORKS_CARD_TEXT.filling(only), tone: 'up' }
      : { text: WORKS_CARD_TEXT.usual, tone: 'same' };
  }
  const kind = weather === 'faster' ? kindWhere(b, (p) => p > 100) : kindWhere(b, (p) => p < 100);
  if (kind === null) return { text: WORKS_CARD_TEXT.usual, tone: 'same' };
  return weather === 'faster'
    ? { text: WORKS_CARD_TEXT.faster(kind, b.makes.resource), tone: 'up' }
    : { text: WORKS_CARD_TEXT.slower(kind, b.makes.resource), tone: 'down' };
}

/** The first item the bag is short of (the server's `production.short`), or null. */
function firstShort(short: ItemCounts | undefined): string | null {
  return Object.entries(short ?? {}).find(([, n]) => n > 0)?.[0] ?? null;
}

/**
 * A works tile card: napping (its homestead is cut off) wins, then paused
 * for upkeep, then short of what it eats, then full, else running. The
 * need line says "Out of" only when `bag` holds none of it. Null
 * for a building that isn't a works, or an older server's reply without
 * its production.
 */
export function worksCard(
  b: Pick<MyBuilding, 'buildingId' | 'production'>,
  tile: { homestead?: 'joined' | 'paused' | null },
  nowMs: number,
  bag?: Readonly<ItemCounts>,
): WorksCard | null {
  const data = DATA.get(b.buildingId);
  const p = b.production;
  if (data?.kind !== 'works' || !p) return null;
  const need = firstShort(p.short);
  const shortName = SHORT_NAME[data.id] ?? data.name;
  const state: WorksState =
    tile.homestead === 'paused'
      ? 'napping'
      : p.pausedAt !== null
        ? 'paused'
        : need !== null
          ? 'short'
          : p.full
            ? 'full'
            : 'running';
  const icon = itemIcon(p.resource);
  const max = p.maxCycles === null ? null : p.maxCycles * p.perCycle;
  const ready = p.ready[p.resource] ?? 0;
  const stored = max === null ? ready : Math.min(ready, max);
  const percent = max === null || max === 0 ? 0 : Math.min(100, Math.round((stored / max) * 100));
  const eatsFirst = Object.keys(p.eats ?? {})[0] ?? null;
  const making =
    data.onlyWhile !== undefined
      ? WORKS_TEXT.rainBarrel
      : eatsFirst
        ? WORKS_CARD_TEXT.turns(eatsFirst, p.resource)
        : WORKS_CARD_TEXT.makes(p.resource);
  const line =
    state === 'napping'
      ? RESOURCE_TEXT.napping
      : state === 'paused'
        ? RESOURCE_TEXT.paused(p.upkeep)
        : state === 'short' && need !== null
          ? (bag?.[need] ?? 0) > 0
            ? WORKS_CARD_TEXT.needMore(p.short?.[need] ?? 0, need, shortName)
            : WORKS_CARD_TEXT.need(need, shortName)
          : state === 'full'
            ? RESOURCE_TEXT.full
            : making;
  const next =
    state === 'short' && need !== null
      ? WORKS_CARD_TEXT.eats(p.eats?.[need] ?? 0, need)
      : state === 'running' && p.nextReadyAt
        ? RESOURCE_TEXT.next(formatWait(Math.max(0, Date.parse(p.nextReadyAt) - nowMs)))
        : null;
  // Short, napping or paused, the weather can't help: no chip (mockup v3).
  // Nor can it fill a full Rain Barrel: no "filling up!" under "It's full!".
  const chip =
    state === 'running' || (state === 'full' && data.onlyWhile === undefined)
      ? worksChip(data, p.weather)
      : null;
  return {
    state,
    resource: p.resource,
    stored,
    max,
    percent,
    meter:
      max === null
        ? RESOURCE_TEXT.storedNoCap(stored, icon)
        : RESOURCE_TEXT.stored(stored, max, icon),
    line,
    chip,
    next,
    // A napping homestead owes nothing (#601 owner decision Q4).
    upkeep: state === 'napping' ? RESOURCE_TEXT.upkeepFree : RESOURCE_TEXT.upkeep(p.upkeep),
    collect: Object.values(p.ready).some((n) => n > 0),
  };
}

/** The picture a Wild Isle homestead building's card asks for: its level, asleep while it naps. */
export function worksPortraitLook(
  b: Pick<MyBuilding, 'buildingId' | 'level' | 'production'>,
  tile: { homestead?: 'joined' | 'paused' | null },
): BuildingPortraitLook {
  const asleep = tile.homestead === 'paused' || (b.production?.pausedAt ?? null) !== null;
  return { buildingId: b.buildingId, level: b.level, asleep, size: WORKS_PORTRAIT_PX };
}

/** My Wild Isle homestead building on this tile (works, canal, shelter or vane), if one stands there. */
export function worksHere(
  home: Pick<HomeResponse, 'buildings'>,
  tile: { q: number; r: number },
): MyBuilding | undefined {
  return home.buildings.find((b) => DATA.has(b.buildingId) && b.q === tile.q && b.r === tile.r);
}

/** What a canal, shelter or vane's card says: its own description. */
export function worksDescription(buildingId: string): string {
  return DATA.get(buildingId)?.description ?? '';
}
