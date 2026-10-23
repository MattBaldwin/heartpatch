import {
  CLEARING_RULES,
  EXPLORE_RULES,
  GAME_DATA,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  buildCost,
  clearToolFor,
  economyEffects,
  inSeason,
  tileLand,
  type HeartCoins,
  type HomeResponse,
  type ItemCounts,
  type MyBuilding,
  type ResourceBuilding,
  type SettleResponse,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import { CLEAR_TEXT } from '../inventory/clear-model.js';
import { formatWait } from '../inventory/game-clock.js';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { buildingIcon, buildingName, homesteadSpot } from '../home/home-view.js';

// Resource buildings on the client (#601 PR 7): which one a homestead's land
// takes, what its tile card says in each of its five states, the
// welcome-back line, and the Heart Coins sheet's upkeep list and order.
// Pure, so every case is unit-tested; the server decides every cost, rule,
// cycle and charge (CLAUDE.md rule 1) and this only reads its replies.

/** The seven resource buildings, in data order. */
export const RESOURCE_BUILDINGS: readonly ResourceBuilding[] = GAME_DATA.buildings.filter(
  (b): b is ResourceBuilding => b.kind === 'resource',
);

const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));
const RESOURCE_SEASONS = new Map(GAME_DATA.resources.map((r) => [r.id, r.season ?? null]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

/** The resource building that stands on this land, if any. */
export function resourceBuildingFor(land: string): ResourceBuilding | undefined {
  return RESOURCE_BUILDINGS.find((b) => b.terrain === land);
}

/** What a resource building does at a level, from the shared maths (no engine code per building). */
export interface ResourceEffect {
  readonly resource: string;
  readonly perHour: number;
  readonly storageHours: number;
  readonly upkeep: number;
}

export function resourceEffect(building: ResourceBuilding, level = 1): ResourceEffect | null {
  const effect = economyEffects(building, level, {
    jobs: JOB_RULES,
    explore: EXPLORE_RULES,
    resourceBuildings: RESOURCE_BUILDING_RULES,
  }).find((e) => e.kind === 'produces');
  return effect?.kind === 'produces' ? effect : null;
}

// Player-facing text (style guide: cozy, short, kid-readable). Patch › Town › Hollow.
export const RESOURCE_TEXT = {
  /** The Build card's line: "🪵 18 Timber an hour, all by itself". */
  effect: (e: ResourceEffect) =>
    `${itemIcon(e.resource)} ${String(e.perHour)} ${itemName(e.resource)} an hour, all by itself`,
  /** "Needs Forest land 🌲" on land that takes no resource building. */
  needsLand: (terrain: string) => `Needs ${TERRAIN_NAMES.get(terrain) ?? 'the right'} land!`,
  outOfSeason: (season: string) =>
    `${SEASON_NAMES.get(season) ?? 'Its season'} only! Come back then 🎃`,
  built: (name: string) => `Built! Your ${name} is getting to work 🔨`,
  making: (e: ResourceEffect) =>
    `Makes ${String(e.perHour)} ${itemIcon(e.resource)} ${itemName(e.resource)} an hour, even while you're away!`,
  stored: (n: number, max: number, icon: string) => `${icon} ${String(n)} of ${String(max)}`,
  storedNoCap: (n: number, icon: string) => `${icon} ${String(n)} waiting`,
  next: (wait: string) => `Next batch in ${wait}`,
  full: "It's full! Tap Collect to bring it all home 🧺",
  paused: (coins: number) =>
    `⏸️ Paused: this morning's 💛 ${String(coins)} wasn't there. It starts again as soon as you have 💛 ${String(coins)}!`,
  napping: 'zZ This homestead is napping, cut off from home. It wakes up when it joins home again.',
  dormant: (season: string) =>
    `zZ Asleep till ${SEASON_NAMES.get(season) ?? 'its season'} comes back. It costs nothing while it sleeps 🎃`,
  upkeep: (coins: number) => `💛 ${String(coins)} each morning`,
  upkeepFree: 'Free while it sleeps',
  /** A seasonal building's last day in season: it owes nothing from the next morning (#601). */
  freeFromTomorrow: 'Free from tomorrow 🎃',
  collect: '🧺 Collect',
  coins: '💛 Upkeep',
  /** The welcome-back line: "Your Stone Quarry made 96 🪨". */
  made: (name: string, items: string) => `Your ${name} made ${items}`,
  // The Heart Coins sheet's upkeep list (#601, owner decision Q5).
  upkeepTitle: 'Morning upkeep',
  upkeepTotal: (coins: number, wait: string) => `💛 ${String(coins)} next morning, in ${wait}`,
  upkeepNone: 'Nothing due: every building is asleep.',
  upkeepOrderHint: 'Short on coins? The top ones keep running. Tap the arrows to choose!',
  /** Three different sleeps, three words, so a kid knows what to do (#601). */
  rowPaused: 'Needs 💛',
  rowNapping: 'Napping',
  rowAsleep: (season: string) => `Asleep till ${SEASON_NAMES.get(season) ?? 'its season'} 🎃`,
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
  saving: 'Saving…',
} as const;

/** An item count as icons: "96 🪨", "40 🎃 and 20 ✨". */
export function itemsShort(items: ItemCounts): string {
  return Object.entries(items)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${String(n)} ${itemIcon(id)}`)
    .join(' and ');
}

/**
 * A row that owes nothing: out of season (it says till when), else its
 * homestead is napping. Every resource building level has upkeep, so a 0 can
 * only mean one of those two (a free level would need a third word here).
 */
function sleepRow(buildingId: string, seasons: readonly string[] | null): string {
  const building = RESOURCE_BUILDINGS.find((b) => b.id === buildingId);
  const season = building ? resourceSeason(building) : null;
  // Seasons unknown (no patch time zone yet): Napping, the less surprising word.
  return season !== null && seasons !== null && !seasons.includes(season)
    ? RESOURCE_TEXT.rowAsleep(season)
    : RESOURCE_TEXT.rowNapping;
}

/** Asleep for its season (a Pumpkin Barn after Halloween), so it makes nothing and owes nothing. */
export function outOfSeason(buildingId: string, seasons: readonly string[]): boolean {
  const building = RESOURCE_BUILDINGS.find((b) => b.id === buildingId);
  const season = building ? resourceSeason(building) : null;
  return season !== null && !seasons.includes(season);
}

/** The season a building's resource grows in (the Pumpkin Barn's Halloween), or null. */
export function resourceSeason(building: Pick<ResourceBuilding, 'terrain'>): string | null {
  const source = JOB_RULES.terrainYields.find((y) => y.terrain === building.terrain);
  return source ? (RESOURCE_SEASONS.get(source.resource) ?? null) : null;
}

/** The tile fields the Build cards read. */
export interface ResourceTile {
  readonly q: number;
  readonly r: number;
  readonly terrain: string;
  readonly clearedFrom?: string | null;
  readonly nodeResource: string | null;
  readonly ownerUserId: string | null;
  readonly homeSlot: number | null;
  readonly homestead?: 'joined' | 'paused' | null;
  readonly clearing?: unknown;
  readonly buildings: readonly { spot: number }[];
}

/** A resource building's Build card, and where on the tile it goes. */
export interface ResourceBuildCard extends BuildCard {
  readonly spot: number;
}

function buildCard(b: ResourceBuilding, spot: number, blocked: string | null): ResourceBuildCard {
  const effect = resourceEffect(b);
  return {
    id: b.id,
    icon: buildingIcon(b.id),
    name: b.name,
    effect: effect ? RESOURCE_TEXT.effect(effect) : b.description,
    cost: buildCost(b),
    area: 'spot',
    blocked,
    craft: null,
    spot,
  };
}

/**
 * The Build sheet's resource card on one of my homestead tiles out on the
 * land: only the building that matches the land (or what it was cleared
 * from), out of its season blocked. On land no building matches (a clear
 * from before it was remembered), every one shows with the land it needs,
 * so the kid learns where each goes. With a spot still to clear, the
 * matching one shows held back with "Clear this land first", whether or not
 * Clear land can start just now (owner bug: a squishy on the spot hid it).
 * None on a tile that isn't an empty, joined homestead of mine.
 */
export function resourceBuildCards(
  tile: ResourceTile,
  home: Pick<HomeResponse, 'seasons'>,
  me: string | null,
): ResourceBuildCard[] {
  if (me === null || tile.ownerUserId !== me || tile.homeSlot !== null) return [];
  if (tile.homestead !== 'joined' || tile.clearing) return [];
  if (tile.buildings.length > 0) return [];
  const seasons = new Set(home.seasons);
  const match = resourceBuildingFor(tileLand(tile));
  const spotOf = (b: ResourceBuilding) => homesteadSpot(tile, b);
  const outOfSeason = (b: ResourceBuilding) =>
    inSeason(b, seasons) || !b.season ? null : RESOURCE_TEXT.outOfSeason(b.season);
  if (tile.nodeResource !== null) {
    // Land no tool clears keeps its spot: nothing goes up there.
    if (!match || !clearToolFor(tile.terrain, CLEARING_RULES)) return [];
    // Where it goes once the spot is gone (it's only shown till then).
    const spot = homesteadSpot({ ...tile, nodeResource: null }, match);
    if (spot === undefined) return [];
    return [buildCard(match, spot, outOfSeason(match) ?? CLEAR_TEXT.firstLine)];
  }
  if (match) {
    const spot = spotOf(match);
    if (spot === undefined) return [];
    return [buildCard(match, spot, outOfSeason(match))];
  }
  return RESOURCE_BUILDINGS.filter((b) => inSeason(b, seasons)).flatMap((b) => {
    const spot = spotOf(b);
    return spot === undefined ? [] : [buildCard(b, spot, RESOURCE_TEXT.needsLand(b.terrain))];
  });
}

/** The five states of a resource building's tile card. */
export type ResourceState = 'running' | 'full' | 'paused' | 'napping' | 'dormant';

export interface ResourceCard {
  readonly state: ResourceState;
  readonly resource: string;
  /** The storage meter: what's waiting and how much fits (null: no cap, the Warehouse delivers). */
  readonly stored: number;
  readonly max: number | null;
  /** 0–100, for the meter's width. */
  readonly percent: number;
  /** The meter's words: "🪵 42 of 432". */
  readonly meter: string;
  /** What it's doing, in a line. */
  readonly line: string;
  /** "Next batch in 6m", while running. */
  readonly next: string | null;
  /** Its morning upkeep line, or "Free while it sleeps". */
  readonly upkeep: string;
  /** Collect runs a settle (owner decision Q3): offered while something is waiting. */
  readonly collect: boolean;
}

/**
 * A resource building's tile card at `nowMs` (game clock): napping (its
 * homestead is cut off) wins, then paused for upkeep, then a sleeping
 * out-of-season Pumpkin Barn, then full, else running. Null for a building
 * that isn't a resource building, or an older server's reply without its
 * production.
 */
export function resourceCard(
  b: Pick<MyBuilding, 'buildingId' | 'level' | 'production'>,
  tile: { homestead?: 'joined' | 'paused' | null },
  seasons: readonly string[],
  nowMs: number,
): ResourceCard | null {
  const data = GAME_DATA.buildings.find((d) => d.id === b.buildingId);
  const p = b.production;
  if (data?.kind !== 'resource' || !p) return null;
  const effect = resourceEffect(data, b.level);
  const season = resourceSeason(data);
  const state: ResourceState =
    tile.homestead === 'paused'
      ? 'napping'
      : p.pausedAt !== null
        ? 'paused'
        : season !== null && !seasons.includes(season)
          ? 'dormant'
          : p.full
            ? 'full'
            : 'running';
  const icon = itemIcon(p.resource);
  const max = p.maxCycles === null ? null : p.maxCycles * p.perCycle;
  // Right after the Warehouse stops, what it delivered but nobody banked yet
  // can sit past the storage (#601 PR 8): the meter stops at full, and the
  // next settle banks it all.
  const ready = p.ready[p.resource] ?? 0;
  const stored = max === null ? ready : Math.min(ready, max);
  const percent = max === null || max === 0 ? 0 : Math.min(100, Math.round((stored / max) * 100));
  const line =
    state === 'napping'
      ? RESOURCE_TEXT.napping
      : state === 'paused'
        ? RESOURCE_TEXT.paused(p.upkeep)
        : state === 'dormant'
          ? RESOURCE_TEXT.dormant(season ?? '')
          : state === 'full'
            ? RESOURCE_TEXT.full
            : effect
              ? RESOURCE_TEXT.making(effect)
              : data.description;
  const next =
    state === 'running' && p.nextReadyAt
      ? RESOURCE_TEXT.next(formatWait(Math.max(0, Date.parse(p.nextReadyAt) - nowMs)))
      : null;
  // A napping or sleeping building owes nothing (owner decisions Q4, Q6).
  const free = state === 'napping' || state === 'dormant';
  // Its season's last day: the next morning finds it out of season, so free.
  const lastDay =
    !free &&
    state !== 'paused' &&
    p.seasonEndsAt != null &&
    p.nextMorningAt !== undefined &&
    Date.parse(p.seasonEndsAt) <= Date.parse(p.nextMorningAt);
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
    next,
    upkeep: free
      ? RESOURCE_TEXT.upkeepFree
      : lastDay
        ? RESOURCE_TEXT.freeFromTomorrow
        : RESOURCE_TEXT.upkeep(p.upkeep),
    collect: Object.values(p.ready).some((n) => n > 0),
  };
}

/** One of my resource buildings on this tile, if one stands there. */
export function resourceHere(
  home: Pick<HomeResponse, 'buildings'>,
  tile: { q: number; r: number },
): MyBuilding | undefined {
  return home.buildings.find((b) => b.kind === 'resource' && b.q === tile.q && b.r === tile.r);
}

/**
 * The welcome-back lines for what my buildings made since the last settle
 * (#601 plan §5): "Your Stone Quarry made 96 🪨", one a building.
 */
export function producedLines(produced: SettleResponse['produced']): string[] {
  return (produced ?? []).flatMap((p) => {
    const items = itemsShort(p.items);
    return items === '' ? [] : [RESOURCE_TEXT.made(buildingName(p.buildingId), items)];
  });
}

type Upkeep = NonNullable<HeartCoins['upkeep']>;

/** A row of the Heart Coins sheet's upkeep list, in charge order. */
export interface UpkeepRow {
  readonly buildingRowId: string;
  readonly icon: string;
  readonly name: string;
  readonly level: number;
  /** "💛 6"; "Needs 💛" short of coins, "Napping" cut off from home, "Asleep till Halloween 🎃" out of season (owner decisions Q4, Q6). */
  readonly coins: string;
  readonly paused: boolean;
  readonly first: boolean;
  readonly last: boolean;
}

export interface UpkeepSection {
  /** "💛 34 next morning, in 3h 05m", or "Nothing due". */
  readonly total: string;
  readonly rows: readonly UpkeepRow[];
  /** The order control only matters with two or more. */
  readonly canOrder: boolean;
}

/** The Heart Coins sheet's upkeep section, or null when I have no upkeep buildings. */
export function upkeepSection(
  upkeep: Upkeep | undefined,
  msUntilMorning: number,
  /**
   * The seasons on at an instant, to tell a sleeping Pumpkin Barn from a
   * napping homestead. Read at the next morning, the one the server charges
   * for (`canWorkAt`): on a season's last day the barn already owes nothing.
   * Null: not known (the row then says Napping).
   */
  seasonsAt: (at: Date) => readonly string[] | null = () => null,
): UpkeepSection | null {
  if (!upkeep || upkeep.due.length === 0) return null;
  const seasons = seasonsAt(new Date(upkeep.nextMorningAt));
  const rows = upkeep.due.map((d, i) => ({
    buildingRowId: d.buildingRowId,
    icon: buildingIcon(d.buildingId),
    name: buildingName(d.buildingId),
    level: d.level,
    coins: d.paused
      ? RESOURCE_TEXT.rowPaused
      : d.coins > 0
        ? `💛 ${String(d.coins)}`
        : sleepRow(d.buildingId, seasons),
    paused: d.paused,
    first: i === 0,
    last: i === upkeep.due.length - 1,
  }));
  return {
    total:
      upkeep.total > 0
        ? RESOURCE_TEXT.upkeepTotal(upkeep.total, formatWait(msUntilMorning))
        : RESOURCE_TEXT.upkeepNone,
    rows,
    canOrder: rows.length > 1,
  };
}

/** The order after moving `id` one place up (-1) or down (+1); unchanged at either end. */
export function moveInOrder(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const next = [...ids];
  const at = next.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to] ?? id, id];
  return next;
}
