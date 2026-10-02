import {
  buildCost,
  fuelCost,
  HOME_BASE_RULES as RULES,
  freeSpots,
  GAME_DATA,
  inSeason,
  isBuildable,
  removeRefund,
  shortfall,
  type Building,
  type HomeResponse,
  type HomeSquishy,
  type HomeTile,
  type MyBuilding,
  type Species,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';

// What the home-base screen says and offers (copy follows docs/STYLE_GUIDE.md).
// Pure, so every case is unit-tested; the server decides everything again
// when the player taps (CLAUDE.md rule 1).

export const BUILDING_DATA = new Map<string, Building>(GAME_DATA.buildings.map((b) => [b.id, b]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

/** Picture for a building on buttons and cards. */
export function buildingIcon(buildingId: string): string {
  switch (buildingId) {
    case 'hearthfire':
      return '🔥';
    case 'jack-o-lantern-hearthfire':
      return '🎃';
    case 'ember-den':
      return '🛖';
    case 'cozy-meadow':
      return '🌼';
    default:
      return '🏠';
  }
}

export function buildingName(buildingId: string): string {
  return BUILDING_DATA.get(buildingId)?.name ?? 'Mystery building';
}

/** "5 🪵 Timber, 5 🪨 Stone" for a cost. */
export function costText(cost: Record<string, number>): string {
  return Object.entries(cost)
    .map(([id, n]) => `${String(n)} ${itemIcon(id)} ${itemName(id)}`)
    .join(', ');
}

/** One line about how the home's fires are doing, for the top of the screen. */
export function fireStatus(buildings: readonly MyBuilding[]): string {
  const fires = buildings.filter((b) => b.kind === 'hearthfire');
  if (fires.length === 0) return 'Build a Hearthfire to keep everyone safe at night!';
  const best = Math.max(...fires.map((f) => f.nightsLeft ?? 0));
  if (best === 0) return 'Your fire is out! Add some Emberwood.';
  if (best === 1) return 'Your fire is lit: 1 night left.';
  return `Your fire is lit: ${String(best)} nights left.`;
}

/** What tapping "Build" on one building would do, and why not if it can't. */
export type BuildOption =
  { readonly kind: 'ready' } | { readonly kind: 'blocked'; readonly note: string };

export interface BuildRow {
  readonly building: Building;
  readonly icon: string;
  readonly cost: string;
  readonly option: BuildOption;
}

/** The build menu: every building a player can put up, in data order. */
export function buildRows(home: HomeResponse): BuildRow[] {
  const seasons = new Set(home.seasons);
  return GAME_DATA.buildings
    .filter((b) => isBuildable(RULES, b))
    .filter((b) => inSeason(b, seasons) || home.buildings.some((m) => m.buildingId === b.id))
    .map((building) => {
      const cost = buildCost(building);
      const owned = home.buildings.filter((b) => b.buildingId === building.id).length;
      const short = shortfall(home.items, cost);
      let option: BuildOption = { kind: 'ready' };
      if (owned >= building.maxPerHome) {
        option = { kind: 'blocked', note: 'Your home has all it can hold.' };
      } else if (!inSeason(building, seasons)) {
        const season = SEASON_NAMES.get(building.season ?? '') ?? 'its season';
        option = { kind: 'blocked', note: `Only around ${season}.` };
      } else if (Object.keys(short).length > 0) {
        option = { kind: 'blocked', note: `Need ${costText(short)} more.` };
      } else if (freeHomeSpots(home).length === 0) {
        option = { kind: 'blocked', note: 'No room left. Take something down first.' };
      }
      return { building, icon: buildingIcon(building.id), cost: costText(cost), option };
    });
}

/** A spot on one of my home tiles. */
export interface HomeSpot {
  readonly q: number;
  readonly r: number;
  readonly spot: number;
}

/**
 * Every free spot on my home base: the Heart Seed tile first, then the ring
 * in `q, r` order, spots in order. `except` is a building being moved (its
 * own spot counts as free).
 */
export function freeHomeSpots(home: HomeResponse, except: string | null = null): HomeSpot[] {
  const tiles = [...home.tiles].sort(
    (a, b) => Number(b.heartSeed) - Number(a.heartSeed) || a.q - b.q || a.r - b.r,
  );
  const spots: HomeSpot[] = [];
  for (const tile of tiles) {
    const taken = new Set(
      home.buildings
        .filter((b) => b.id !== except && b.q === tile.q && b.r === tile.r)
        .map((b) => b.spot),
    );
    for (const spot of freeSpots(RULES, tile, taken)) {
      spots.push({ q: tile.q, r: tile.r, spot });
    }
  }
  return spots;
}

/** The tile a building stands on. */
export function tileOf(home: HomeResponse, b: { q: number; r: number }): HomeTile | undefined {
  return home.tiles.find((t) => t.q === b.q && t.r === b.r);
}

/** Species the client can draw: the public table plus what the server sent along. */
export function speciesMap(home: Pick<HomeResponse, 'speciesDefs'>): Map<string, Species> {
  return new Map([...GAME_DATA.species, ...home.speciesDefs].map((s) => [s.id, s]));
}

/** A squishy's name: its nickname, else its species', else a friendly stand-in. */
export function squishyName(squishy: HomeSquishy, species: ReadonlyMap<string, Species>): string {
  return squishy.nickname ?? species.get(squishy.speciesId)?.name ?? 'Mystery squishy';
}

/** One line about a building on its card. */
export function buildingNote(b: MyBuilding): string {
  if (b.kind === 'hearthfire') {
    const nights = b.nightsLeft ?? 0;
    if (nights === 0) return "It's out. Add Emberwood to light it!";
    return `Lit! ${String(nights)} ${nights === 1 ? 'night' : 'nights'} of fuel left.`;
  }
  if (b.kind === 'habitat') {
    const living = b.residents ?? 0;
    const room = b.capacity ?? 0;
    if (living === 0) return `Room for ${String(room)} squishies.`;
    return `${String(living)} of ${String(room)} squishies live here.`;
  }
  return BUILDING_DATA.get(b.buildingId)?.description ?? '';
}

/** Does a squishy like this habitat (matching element or feeling tag)? */
export function likesHabitat(squishy: HomeSquishy, buildingId: string): boolean {
  const building = BUILDING_DATA.get(buildingId);
  if (building?.kind !== 'habitat') return false;
  return (
    (building.tags.elements as readonly string[]).includes(squishy.element) ||
    (building.tags.feelings as readonly string[]).includes(squishy.feeling)
  );
}

/**
 * What taking a building down gives back, to show before the player says yes:
 * its refund (shared `removeRefund`) plus any fuel it hasn't burned. The
 * server works it out again when it happens.
 */
export function refundPreview(b: MyBuilding): Record<string, number> {
  const building = BUILDING_DATA.get(b.buildingId);
  if (!building) return {};
  const back = removeRefund(building, b.level, RULES);
  if (building.kind === 'hearthfire' && (b.nightsLeft ?? 0) > 0) {
    for (const [id, n] of Object.entries(fuelCost(building, b.nightsLeft ?? 0))) {
      back[id] = (back[id] ?? 0) + n;
    }
  }
  return back;
}
