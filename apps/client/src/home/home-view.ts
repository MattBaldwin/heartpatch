import {
  buildCost,
  buildingEffects,
  fuelCost,
  HOME_BASE_RULES as RULES,
  freeSpots,
  GAME_DATA,
  hexKey,
  hexSpiral,
  inSeason,
  isBuildable,
  removeRefund,
  shortfall,
  upgradeCost,
  type Building,
  type BuildingEffect,
  type BuildingSlot,
  type HomeResponse,
  type HomeSquishy,
  type MyBuilding,
  type Rarity,
  type Species,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { ELEMENT_GLYPH } from '../ui/glyphs.js';

// What the home-base screen says and offers (copy follows docs/STYLE_GUIDE.md).
// Pure, so every case is unit-tested; the server decides everything again
// when the player taps (CLAUDE.md rule 1).

export const BUILDING_DATA = new Map<string, Building>(GAME_DATA.buildings.map((b) => [b.id, b]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const ELEMENT_NAMES = new Map(GAME_DATA.elements.map((e) => [e.id, e.name]));
const FEELING_NAMES = new Map(GAME_DATA.feelings.map((f) => [f.id, f.name]));

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
    case 'training-grounds':
      return '🎯';
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

/** Is this building on my home base (not out on my captured land, #202)? */
export function isAtHome(
  home: Pick<HomeResponse, 'tiles'>,
  b: Pick<MyBuilding, 'q' | 'r'>,
): boolean {
  return home.tiles.some((t) => t.q === b.q && t.r === b.r);
}

/**
 * The home as the home screen shows it: only the buildings on the home base.
 * Fires out on my land live on their tiles (the map's tile panel, #202).
 */
export function atHome(home: HomeResponse): HomeResponse {
  return { ...home, buildings: home.buildings.filter((b) => isAtHome(home, b)) };
}

/** My fires out on captured land (#202), in the server's order. */
export function landFires(home: HomeResponse): MyBuilding[] {
  return home.buildings.filter((b) => b.kind === 'hearthfire' && !isAtHome(home, b));
}

/** What "Fuel all fires" would do now (#202), or null with no fire out on my land. */
export interface FuelAllOffer {
  /** Fires out on my land. */
  readonly land: number;
  /** My fires with a night or less left (all of them, as the server's Fuel all counts; after the boot pass they're all on land). */
  readonly low: number;
  /** Emberwood (and any other fuel) to fill every fire. */
  readonly cost: Record<string, number>;
  /** Every fire is full already. */
  readonly full: boolean;
}

export function fuelAllOffer(home: HomeResponse): FuelAllOffer | null {
  const outside = landFires(home);
  if (outside.length === 0) return null;
  const fires = home.buildings.filter((b) => b.kind === 'hearthfire');
  const cost: Record<string, number> = {};
  for (const b of fires) {
    const fire = BUILDING_DATA.get(b.buildingId);
    if (fire?.kind !== 'hearthfire' || (b.fuelSpace ?? 0) === 0) continue;
    for (const [id, n] of Object.entries(fuelCost(fire, b.fuelSpace ?? 0))) {
      cost[id] = (cost[id] ?? 0) + n;
    }
  }
  return {
    land: outside.length,
    low: fires.filter((b) => (b.nightsLeft ?? 0) <= 1).length,
    cost,
    full: Object.keys(cost).length === 0,
  };
}

/** What the tile panel offers on one of my tiles out on captured land (#202). */
export type LandTileOffer =
  | { readonly kind: 'fire'; readonly fire: MyBuilding }
  /** Its middle holds a node: a fire next door can reach it. */
  | { readonly kind: 'node'; readonly line: string }
  | {
      readonly kind: 'build';
      readonly building: Building;
      readonly needs: readonly NeedChip[];
      /** The Jack-o'-Lantern Hearthfire too, in season with a carved pumpkin in the bag. */
      readonly lantern: { readonly building: Building; readonly needs: readonly NeedChip[] } | null;
    }
  /** Something else stands in the middle (not one of mine to show here). */
  | { readonly kind: 'none' };

/** What stands in a tile's middle, in a kid's words (never "node", owner note 2026-10-07). */
const MIDDLE_THINGS: Readonly<Record<string, string>> = {
  treats: 'a farm plot',
  pumpkins: 'a pumpkin patch',
  'magic-fallen-leaves': 'a leaf pile',
  glimmer: 'some Glimmer crystals',
};

/** "a Timber pile", "a farm plot": the resource spot in a tile's middle. */
export function middleThing(resource: string): string {
  return MIDDLE_THINGS[resource] ?? `a ${itemName(resource)} pile`;
}

/** The building that can stand on owned land, one a tile, in its middle: the Hearthfire. */
export const LAND_FIRE = GAME_DATA.buildings.find(
  (b) => b.placement === 'land' && b.kind === 'hearthfire',
);

export function landTileOffer(
  tile: {
    q: number;
    r: number;
    nodeResource: string | null;
    buildings: readonly { spot: number }[];
  },
  home: HomeResponse,
): LandTileOffer {
  const fire = home.buildings.find(
    (b) => b.kind === 'hearthfire' && b.q === tile.q && b.r === tile.r,
  );
  if (fire) return { kind: 'fire', fire };
  if (!LAND_FIRE) return { kind: 'none' };
  if (tile.nodeResource !== null) {
    return {
      kind: 'node',
      line: `🔥 Fires go in the middle of a tile. This one has ${middleThing(tile.nodeResource)} there, so a fire next door can reach it!`,
    };
  }
  if (tile.buildings.some((b) => b.spot === 0)) return { kind: 'none' };
  const seasons = new Set(home.seasons);
  const lantern =
    GAME_DATA.buildings.find(
      (b) =>
        b.placement === 'land' &&
        b.id !== LAND_FIRE.id &&
        inSeason(b, seasons) &&
        Object.keys(shortfall(home.items, buildCost(b))).length === 0,
    ) ?? null;
  return {
    kind: 'build',
    building: LAND_FIRE,
    needs: needChips(home.items, buildCost(LAND_FIRE)),
    lantern: lantern
      ? { building: lantern, needs: needChips(home.items, buildCost(lantern)) }
      : null,
  };
}

/** The home's top line (owner decision 2026-10-07): the Heart Seed keeps home safe. */
export const HOME_SAFE_LINE = 'Your Heart Seed keeps home safe 💗';

/** Where fires go, on the build sheet (fires stand only on captured land). */
export const FIRES_ON_LAND =
  'Fires go on your land, in the middle of a tile 🔥. Your Heart Seed keeps home safe!';

/**
 * One ingredient as have/need ("🪵 12/5"), so a kid sees at a glance what's
 * missing (design review 2026-10-05: one cost line, as icon counts).
 */
export interface NeedChip {
  readonly id: string;
  readonly icon: string;
  readonly have: number;
  readonly need: number;
  /** Enough in the bag. */
  readonly ok: boolean;
  /** "🪵 12/5", with the item's name for screen readers. */
  readonly label: string;
  readonly name: string;
}

/** Have/need chips for a cost, in the cost's order. */
export function needChips(
  items: Readonly<Record<string, number>>,
  cost: ItemCountsLike,
): NeedChip[] {
  return Object.entries(cost).map(([id, need]) => {
    const have = items[id] ?? 0;
    return {
      id,
      icon: itemIcon(id),
      have,
      need,
      ok: have >= need,
      label: `${itemIcon(id)} ${String(have)}/${String(need)}`,
      name: itemName(id),
    };
  });
}

type ItemCountsLike = Readonly<Record<string, number>>;

/** How a crafted ingredient is made, for "Carve a Jack-o'-Lantern first!" (default "Make"). */
const CRAFT_VERBS: Readonly<Record<string, string>> = { 'jack-o-lantern-hearthfire': 'Carve' };

/** What tapping "Build" on one building would do, and why not if it can't. */
export type BuildOption =
  | { readonly kind: 'ready' }
  /** Short of a gathered ingredient: Build shows, switched off; the chips say what. */
  | { readonly kind: 'short' }
  /** Short of something you make (the Jack-o'-Lantern): make it in the recipe book first. */
  | { readonly kind: 'craft'; readonly note: string }
  /** Already built (as many as the home base holds): upgrade it at home instead. */
  | { readonly kind: 'built'; readonly note: string }
  /** Built only out on my land, from the map's tile panel (fires, #202). */
  | { readonly kind: 'land'; readonly note: string }
  | { readonly kind: 'blocked'; readonly note: string };

export interface BuildRow {
  readonly building: Building;
  readonly icon: string;
  /** What it's for, in a line (#207). */
  readonly description: string;
  /** What it does, as chips worked out from its data (#207): "🛡️ Safe 1 tile around". */
  readonly effects: readonly string[];
  readonly needs: readonly NeedChip[];
  readonly option: BuildOption;
  /** Which spots it takes (#204): "Fires go in the middle of a tile 🔥". */
  readonly where: string;
}

/** One effect as a build-menu chip (#207; owner-approved words, 2026-10-07). */
export function effectChip(effect: BuildingEffect): string {
  switch (effect.kind) {
    case 'safe':
      return effect.radius === 0
        ? '🛡️ Keeps its own tile safe'
        : `🛡️ Safe ${String(effect.radius)} ${effect.radius === 1 ? 'tile' : 'tiles'} around`;
    case 'fuel':
      return '🪵 Needs fuel each night';
    case 'grows': {
      const who = [
        ...effect.elements.map((e) => `${ELEMENT_GLYPH[e] ?? '✨'} ${ELEMENT_NAMES.get(e) ?? e}`),
        ...effect.feelings.map((f) => FEELING_NAMES.get(f) ?? f),
      ];
      return `✨ Faster growing: ${who.join(' · ')}`;
    }
    case 'room':
      return `🏠 Room for ${String(effect.capacity)}`;
    case 'training':
      return `🏋️ ${String(effect.capacity)} ${effect.capacity === 1 ? 'squishy' : 'squishies'} · ${String(effect.xpPerHour)} XP/hr`;
  }
}

/** A building's chips at a level (1: just built), for the build menu and the fire sheet. */
export function effectChips(building: Building, level = 1): string[] {
  return buildingEffects(building, level).map(effectChip);
}

/** Where a building goes on a tile, in a line (#204). */
export function slotLine(building: Pick<Building, 'kind' | 'slot'>): string {
  if (building.slot === 'centre') {
    return building.kind === 'hearthfire'
      ? 'Fires go in the middle of a tile 🔥'
      : 'Goes in the middle of a tile';
  }
  if (building.slot === 'ring') return 'Goes around the middle 🏡';
  return 'Goes along the edge of a tile';
}

const isCrafted = (id: string) => GAME_DATA.resources.find((r) => r.id === id)?.kind === 'crafted';

/**
 * The build menu: every building a player can put up at home, in data order.
 * Counts only home buildings (fires out on my land don't use up home's one).
 */
export function buildRows(everything: HomeResponse): BuildRow[] {
  const home = atHome(everything);
  const seasons = new Set(home.seasons);
  return GAME_DATA.buildings
    .filter((b) => isBuildable(RULES, b))
    .filter((b) => inSeason(b, seasons) || home.buildings.some((m) => m.buildingId === b.id))
    .map((building) => {
      const cost = buildCost(building);
      const owned = home.buildings.filter((b) => b.buildingId === building.id).length;
      const short = Object.keys(shortfall(home.items, cost));
      const crafted = short.find(isCrafted);
      let option: BuildOption = { kind: 'ready' };
      if (building.placement === 'land' && crafted) {
        // Carve the Jack-o'-Lantern first, then build it out on your land.
        const verb = CRAFT_VERBS[crafted] ?? 'Make';
        option = {
          kind: 'craft',
          note: `${verb} a ${itemName(crafted)} first! It's in your recipe book.`,
        };
      } else if (building.placement === 'land') {
        option = { kind: 'land', note: FIRES_ON_LAND };
      } else if (owned >= (building.maxPerHome ?? 0)) {
        option = {
          kind: 'built',
          note: building.levels.length > 1 ? 'Built! Tap it at home to upgrade.' : 'Built!',
        };
      } else if (!inSeason(building, seasons)) {
        const season = SEASON_NAMES.get(building.season ?? '') ?? 'its season';
        option = { kind: 'blocked', note: `Only around ${season}.` };
      } else if (crafted) {
        const verb = CRAFT_VERBS[crafted] ?? 'Make';
        option = {
          kind: 'craft',
          note: `${verb} a ${itemName(crafted)} first! It's in your recipe book.`,
        };
      } else if (short.length > 0) {
        option = { kind: 'short' };
      } else if (freeHomeSpots(home, null, building.slot).length === 0) {
        option = { kind: 'blocked', note: 'No room left. Take something down first.' };
      }
      return {
        building,
        icon: buildingIcon(building.id),
        description: building.description,
        effects: effectChips(building),
        needs: option.kind === 'built' || option.kind === 'land' ? [] : needChips(home.items, cost),
        option,
        where: building.placement === 'land' ? '' : slotLine(building),
      };
    });
}

/** What upgrading one of my buildings would do (owner decision 2026-10-06). */
export interface UpgradeOffer {
  readonly building: Building;
  readonly from: number;
  readonly to: number;
  readonly needs: readonly NeedChip[];
  readonly affordable: boolean;
  /** What the new level does, in a line ("Its light will reach 2 tiles…"). */
  readonly line: string;
  /** A Hearthfire's radius at the new level (its light on the land), else null. */
  readonly radius: number | null;
  /** What the level after needs, if it needs something new ("…needs 💎 Glimmer."). */
  readonly next: string | null;
}

/** The upgrade on offer for a building, or null at its top level (or for one-level buildings). */
export function upgradeOffer(home: HomeResponse, b: MyBuilding): UpgradeOffer | null {
  const building = BUILDING_DATA.get(b.buildingId);
  if (!building) return null;
  const cost = upgradeCost(building, b.level);
  const step = building.levels[b.level];
  if (!cost || !step) return null;
  const needs = needChips(home.items, cost);
  const to = b.level + 1;
  let line = '';
  let radius: number | null = null;
  if ('safeRadius' in step) {
    radius = step.safeRadius;
    line = `Its light will reach ${String(radius)} tiles. Squishies out there stay safe at night!`;
  } else if ('xpPerHour' in step) {
    line = `Room for ${String(step.capacity)} squishies, and they learn a little faster.`;
  } else if ('capacity' in step) {
    line = `Room for ${String(step.capacity)} squishies (now ${String(b.capacity ?? 0)}).`;
  }
  const after = building.levels[to];
  let next: string | null = null;
  if (after) {
    const fresh = Object.keys(after.cost).filter((id) => !(id in cost));
    const reach = 'safeRadius' in after ? ` reaches ${String(after.safeRadius)} tiles and` : '';
    if (fresh.length > 0) {
      const what = fresh.map((id) => `${itemIcon(id)} ${itemName(id)}`).join(' and ');
      next = `Next time: Level ${String(to + 1)}${reach} needs ${what}.`;
    }
  }
  return {
    building,
    from: b.level,
    to,
    needs,
    affordable: needs.every((n) => n.ok),
    line,
    radius,
    next,
  };
}

/** A tile on the upgrade sheet's little map, in coordinates around the Heart Seed. */
export interface ReachTile {
  readonly q: number;
  readonly r: number;
  /** Safe already (home, or the fire's light now), safe after the upgrade, or still outside. */
  readonly state: 'now' | 'new' | 'outside';
}

/**
 * The little map on a fire's upgrade sheet: the home base and the land
 * around it, which tiles its light covers now and which it will after the
 * upgrade (shared rule: the fire's own tile plus its radius, and the whole
 * home base). Out to one ring past the furthest new tile.
 */
export function upgradeReach(home: HomeResponse, fire: MyBuilding, toRadius: number): ReachTile[] {
  const seed = home.tiles.find((t) => t.heartSeed) ?? { q: 0, r: 0 };
  const now = new Set([
    ...home.tiles.map((t) => hexKey(t)),
    ...hexSpiral({ q: fire.q, r: fire.r }, fire.safeRadius ?? 0).map(hexKey),
  ]);
  const after = new Set(hexSpiral({ q: fire.q, r: fire.r }, toRadius).map(hexKey));
  const ring = (h: { q: number; r: number }) => {
    const q = h.q - seed.q;
    const r = h.r - seed.r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  };
  const furthest = Math.max(
    1,
    ...hexSpiral({ q: fire.q, r: fire.r }, toRadius).map((h) => ring(h)),
  );
  return hexSpiral(seed, furthest + 1).map((h) => {
    const key = hexKey(h);
    const state = now.has(key) ? 'now' : after.has(key) ? 'new' : 'outside';
    return { q: h.q - seed.q, r: h.r - seed.r, state };
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
 * own spot counts as free); `slot` keeps only that kind of spot (#204).
 */
export function freeHomeSpots(
  home: HomeResponse,
  except: string | null = null,
  slot?: BuildingSlot,
): HomeSpot[] {
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
    for (const spot of freeSpots(RULES, tile, taken, slot)) {
      spots.push({ q: tile.q, r: tile.r, spot });
    }
  }
  return spots;
}

/** Species the client can draw: the public table plus what the server sent along. */
export function speciesMap(home: Pick<HomeResponse, 'speciesDefs'>): Map<string, Species> {
  return new Map([...GAME_DATA.species, ...home.speciesDefs].map((s) => [s.id, s]));
}

/** A squishy's name: its nickname, else its species', else a friendly stand-in. */
export function squishyName(squishy: HomeSquishy, species: ReadonlyMap<string, Species>): string {
  return squishy.nickname ?? species.get(squishy.speciesId)?.name ?? 'Mystery squishy';
}

/** A squishy's rarity for its dot (#240), or null when the client has no row for its species. */
export function squishyRarity(
  squishy: HomeSquishy,
  species: ReadonlyMap<string, Species>,
): Rarity | null {
  return species.get(squishy.speciesId)?.rarity ?? null;
}

/** One line about a building on its card. */
export function buildingNote(b: MyBuilding): string {
  if (b.kind === 'hearthfire') {
    const nights = b.nightsLeft ?? 0;
    if (nights === 0) return "It's out. Add Emberwood to light it!";
    return `Lit! ${String(nights)} ${nights === 1 ? 'night' : 'nights'} of fuel left.`;
  }
  if (b.kind === 'training-grounds') {
    const n = b.residents ?? 0;
    const room = b.capacity ?? 0;
    return `${String(n)} of ${String(room)} squishies are practicing. They learn a little every hour, even while you're away.`;
  }
  // A habitat (every kind is handled above or here).
  const living = b.residents ?? 0;
  const room = b.capacity ?? 0;
  if (living === 0) return `Room for ${String(room)} squishies.`;
  return `${String(living)} of ${String(room)} squishies live here.`;
}

/**
 * What sending a squishy to train would stop, said before the tap (the job
 * board's `teamCost` words), or '' when it isn't doing anything else.
 */
export function trainCost(squishy: Pick<HomeSquishy, 'job'>): string {
  switch (squishy.job) {
    case 'guard':
      return 'On watch · Train ends it';
    case 'gatherer':
      return 'Gathering · Train stops it';
    case 'team':
      return 'On the team · Train takes them off';
    default:
      return '';
  }
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
