import {
  EXPLORE_RULES,
  GAME_DATA,
  HOME_BASE_RULES,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  buildCost,
  canalFits,
  economyEffects,
  hasWaterNextDoor,
  isBuildableOn,
  waterRefusalOf,
  type Building,
  type MapView,
  type PublicTile,
  type WaterRefusal,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { buildingIcon, homesteadSpot } from '../home/home-view.js';

// Wild Isle works on the client (#621 W1-10): the Build sheet's cards for
// the works, canal, shelters and vane on one of my homesteads, each held
// back with why when its water isn't next door. The water rule is the
// shared one the server's place check runs (`hasWaterNextDoor`,
// `canalFits`, `waterRefusalOf`); the server stays the judge (CLAUDE.md rule 1). Pure,
// so every case is unit-tested.

/** The Wild Isle kinds that stand on a homestead spot (travel has its own cards, W1-6). */
const HOMESTEAD_KINDS: ReadonlySet<Building['kind']> = new Set([
  'works',
  'canal',
  'shelter',
  'vane',
]);

/** Every Wild Isle homestead building, in data order. */
export const WORKS_BUILDINGS: readonly Building[] = GAME_DATA.buildings.filter(
  (b) => HOMESTEAD_KINDS.has(b.kind) && b.patchTypes !== undefined,
);

/** How far canals carry water: the Canal's `maxRun`, as the server reads it. */
const CANAL_RUN = Math.max(
  0,
  ...GAME_DATA.buildings.flatMap((b) => (b.kind === 'canal' ? [b.maxRun] : [])),
);

const CANAL_IDS = new Set(GAME_DATA.buildings.filter((b) => b.kind === 'canal').map((b) => b.id));

// Player-facing text (style guide: cozy, short, kid-readable).
export const WORKS_TEXT = {
  /** Held back for want of water (plan §8, revision 1 §8): the server's own words. */
  water: {
    water: 'Needs water next door 💧',
    river: 'Needs the river 🌊',
    'river-or-lake': 'Needs a river or lake next door 💧',
    coast: 'Only on the coast 🐚',
    canal: 'Canal needs water or a canal next to it 💧',
  } satisfies Record<WaterRefusal, string>,
  /** The Rain Barrel's card: it only fills under rain. */
  rainBarrel: 'Fills up when it rains ☔',
  /** "🐟 8 Fish an hour, all by itself". */
  makes: (resource: string, perHour: number) =>
    `${itemIcon(resource)} ${String(perHour)} ${itemName(resource)} an hour, all by itself`,
  built: (name: string) => `Built! Your ${name} is getting to work 🔨`,
} as const;

/** A works Build card, and where on the tile it goes. */
export interface WorksBuildCard extends BuildCard {
  readonly spot: number;
}

/**
 * What a card says it does: the Rain Barrel fills when it rains; a works
 * that only makes things says how much an hour (shared `economyEffects`);
 * one that eats (the Watermill) and the canal, shelters and vane read their
 * own description.
 */
export function worksEffect(b: Building): string {
  if (b.kind === 'works' && b.onlyWhile === 'rain') return WORKS_TEXT.rainBarrel;
  if (b.kind === 'works' && !b.eats) {
    const effect = economyEffects(b, 1, {
      jobs: JOB_RULES,
      explore: EXPLORE_RULES,
      resourceBuildings: RESOURCE_BUILDING_RULES,
    }).find((e) => e.kind === 'produces');
    if (effect?.kind === 'produces') return WORKS_TEXT.makes(effect.resource, effect.perHour);
  }
  return b.description;
}

/** Why `b` can't go on `tile` for want of water, or null when its water is next door. */
export function worksWaterProblem(
  b: Building,
  tile: Pick<PublicTile, 'q' | 'r'>,
  tiles: readonly Pick<PublicTile, 'q' | 'r' | 'terrain' | 'buildings'>[],
): string | null {
  const canals = tiles
    .filter((t) => t.buildings.some((x) => CANAL_IDS.has(x.buildingId)))
    .map((t) => ({ q: t.q, r: t.r }));
  if (b.kind === 'canal') {
    return canalFits(tile, tiles, canals, b.maxRun) ? null : WORKS_TEXT.water.canal;
  }
  const needs = b.kind === 'works' || b.kind === 'shelter' ? b.needsWater : undefined;
  if (hasWaterNextDoor(tile, tiles, canals, needs, CANAL_RUN)) return null;
  return WORKS_TEXT.water[waterRefusalOf(b)];
}

/**
 * The Build sheet's Wild Isle cards on one of my homestead tiles: every
 * works, the canal, the shelters and the vane the patch takes, the ones
 * whose water is next door first, the rest held back with why, so a kid
 * learns where each goes. None on a Cozy Patch, or on a tile that isn't an
 * empty, joined homestead of mine.
 */
export function worksBuildCards(
  tile: PublicTile,
  view: Pick<MapView, 'map' | 'tiles'>,
  me: string | null,
): WorksBuildCard[] {
  if (me === null || tile.ownerUserId !== me || tile.homeSlot !== null) return [];
  if (tile.homestead !== 'joined' || tile.clearing || tile.buildings.length > 0) return [];
  const patchType = view.map.patchType ?? 'cozy';
  const cards = WORKS_BUILDINGS.filter((b) => isBuildableOn(HOME_BASE_RULES, b, patchType)).flatMap(
    (b): WorksBuildCard[] => {
      const spot = homesteadSpot(tile, b);
      if (spot === undefined) return [];
      return [
        {
          id: b.id,
          icon: buildingIcon(b.id),
          name: b.name,
          effect: worksEffect(b),
          cost: buildCost(b),
          area: 'spot',
          blocked: worksWaterProblem(b, tile, view.tiles),
          craft: null,
          spot,
        },
      ];
    },
  );
  return [...cards.filter((c) => c.blocked === null), ...cards.filter((c) => c.blocked !== null)];
}
