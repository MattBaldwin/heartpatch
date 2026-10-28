import {
  GAME_DATA,
  type BuildingGuideEntry,
  type GuideGroup,
  type GuidePlace,
  type GuideValue,
  type ItemCounts,
  type PatchType,
  type PublicTile,
  type WeatherKind,
} from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { shortNumber } from '../ui/short-number.js';
import { canAfford, type BuildCard } from './build-model.js';

// The Buildings guide's words (#715): the shared `buildingGuide` facts, each
// worded for a kid, and whether the picked tile fits. "Fits" never has a rule
// of its own: it reads the Build sheet's own cards (`BuildSource.cards`), so
// the guide and the sheet can't disagree. Pure, so every line is unit-tested.

const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const ELEMENT_NAMES = new Map(GAME_DATA.elements.map((e) => [e.id, e.name]));
const FEELING_NAMES = new Map(GAME_DATA.feelings.map((f) => [f.id, f.name]));

const plural = (n: number, one: string, many: string) =>
  `${shortNumber(n)} ${n === 1 ? one : many}`;
const list = (words: readonly string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
const orList = (words: readonly string[]) =>
  words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1] ?? ''}`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WATER_WORDS: Record<string, string> = {
  river: 'river',
  lake: 'lake',
  deep: 'sea',
  canal: 'Canal',
};
const WEATHER_WORDS: Record<WeatherKind, string> = {
  clear: 'sunshine',
  rain: 'rain',
  storm: 'storms',
  fog: 'fog',
  drought: 'a drought',
};
const PATCH_NAMES: Record<PatchType, string> = { cozy: 'Cozy Patch', 'wild-isle': 'Wild Isle' };

// Player-facing text (style guide: cozy, short, kid-readable).
export const GUIDE_TEXT = {
  seeAll: 'See all buildings ›',
  title: 'All buildings',
  back: '‹ Build',
  close: 'Close the buildings guide',
  yourTile: 'Your tile:',
  why: 'Why build it',
  where: 'Where it goes',
  fitsFilter: (n: number) => `Fits this tile · ${String(n)}`,
  allFilter: (n: number) => `All · ${String(n)}`,
  fits: '✓ Fits this tile',
  fitCount: (n: number) => (n === 1 ? 'Fits 1 of your tiles' : `Fits ${String(n)} of your tiles`),
  buildHere: 'Build here',
  needMore: 'Need more',
  recipeBook: '📖 Recipe book',
  perEdge: 'an edge',
  groupFits: (n: number) => (n === 0 ? 'none fit here' : `${String(n)} fit here`),
  later: 'Coming later',
  laterNote: "Can't build these yet",
  laterChip: 'Later',
  notYet: 'Coming soon!',
  backNext: (season: string) => `Back next ${season}`,
  nothingFits: 'Nothing fits this tile yet. Peek at All!',
  groups: {
    fires: 'Fires',
    home: 'Home',
    helpers: 'Helpers',
    resources: 'Resources',
    water: 'Water works',
    shelters: 'Shelters',
    travel: 'Travel',
    fences: 'Fences',
  } satisfies Record<GuideGroup, string>,
} as const;

/** Why build one, as short lines (fences say "energy", style guide §9). */
export function valueLines(value: readonly GuideValue[]): string[] {
  return value.flatMap((v): string[] => {
    switch (v.kind) {
      case 'safe':
        return [`Keeps squishies safe ${plural(v.radius, 'tile', 'tiles')} around it`];
      case 'fuel':
        return [`Needs ${shortNumber(v.perNight)} fuel each night`];
      case 'grows': {
        const who = [
          ...v.elements.map((e) => ELEMENT_NAMES.get(e) ?? e),
          ...v.feelings.map((f) => FEELING_NAMES.get(f) ?? f),
        ];
        return [`${list(who)} squishies grow faster here`];
      }
      case 'room':
        return [`Room for ${plural(v.capacity, 'squishy', 'squishies')}`];
      case 'training':
        return [
          `${plural(v.capacity, 'squishy trains', 'squishies train')} at once`,
          `Each earns ${shortNumber(v.xpPerHour)} XP an hour, even while you nap`,
        ];
      case 'fence':
        return ['Keeps other Keepers off this edge', `Starts with ${shortNumber(v.hp)} energy`];
      case 'batches':
        return [`Cooks ${plural(v.queues, 'recipe', 'recipes')} at once, even while you're away`];
      case 'produces':
        return [
          `Makes ${shortNumber(v.perHour)} ${itemName(v.resource)} an hour, all by itself`,
          `Holds ${shortNumber(v.perHour * v.storageHours)} ${itemName(v.resource)}`,
          ...upkeepLine(v.upkeep),
        ];
      case 'delivers':
        return [
          `Level ${String(v.fromLevel)}+ buildings send stuff straight to your bag`,
          ...upkeepLine(v.upkeep),
        ];
      case 'eats':
        return [`Eats ${costWords(v.items)} each time`];
      case 'weather':
        return Object.entries(v.percent).flatMap(([kind, pct]) => {
          const w = WEATHER_WORDS[kind as WeatherKind];
          if (pct > 100) return [`Extra fast in ${w}!`];
          if (pct < 100) return [`Sleepy in ${w}`];
          return [];
        });
      case 'only-while':
        return [`Only works in ${WEATHER_WORDS[v.weather]}`];
      case 'carries-water':
        return [`Carries water up to ${plural(v.maxRun, 'tile', 'tiles')} inland`];
      case 'shelters':
        return [
          `Keeps ${list(v.from.map((f) => (f === 'storm' ? 'storms' : 'floods')))} off ${plural(v.radius, 'tile', 'tiles')} around`,
        ];
      case 'forecast':
        return ["Shows tomorrow's weather"];
      case 'weatherproof':
        return ['Storms never knock it over'];
      case 'travel':
        if (v.role === 'bridge') return ['Every Keeper on the patch can cross here'];
        if (v.role === 'ferry-dock') return ['Hop to the far shore of the lake'];
        return [`Keeps land up to ${plural(v.reach ?? 1, 'tile', 'tiles')} away joined to home`];
      case 'refund-all':
        return ['Pack it up and get the whole thing back'];
    }
  });
}

function upkeepLine(coins: number): string[] {
  return coins > 0 ? [`Upkeep: ${shortNumber(coins)} Heart Coins a morning`] : [];
}

function costWords(items: ItemCounts): string {
  return list(Object.entries(items).map(([id, n]) => `${shortNumber(n)} ${itemName(id)}`));
}

const waterWords = (water: readonly string[]) => orList(water.map((w) => WATER_WORDS[w] ?? w));

/** Where it goes, as chips. */
export function placeChips(place: readonly GuidePlace[]): string[] {
  const edges = place.some((p) => p.kind === 'edges');
  return place.flatMap((p): string[] => {
    switch (p.kind) {
      case 'placement':
        if (edges) return ['Edges of your tiles'];
        return [
          {
            home: 'At your home',
            land: 'Your land',
            owned: 'Any tile you own',
            homestead: 'Your homestead',
          }[p.placement],
        ];
      case 'on-water':
        return [`On a ${WATER_WORDS[p.water] ?? p.water} tile`, 'Next to your land'];
      case 'terrain':
        return [`${TERRAIN_NAMES.get(p.terrain) ?? p.terrain} land`];
      case 'needs-water':
        return [`${capital(waterWords(p.water))} next door`];
      case 'edges':
        return ['Priced per edge'];
      case 'per-tile':
        return [p.max === 1 ? '1 per tile' : `Up to ${String(p.max)} a tile`];
      case 'per-home':
        return [p.atHome ? `Up to ${String(p.max)}` : `${String(p.max)} per patch`];
      case 'patch':
        return [`${list(p.patchTypes.map((t) => PATCH_NAMES[t]))} only`];
      case 'season':
        return [`${SEASON_NAMES.get(p.season) ?? p.season} only`];
    }
  });
}

/** The "Coming later" shelf's label, or null for a building you can build now. */
export function gateLabel(entry: Pick<BuildingGuideEntry, 'gate'>): string | null {
  if (!entry.gate) return null;
  if (entry.gate.kind === 'not-yet') return GUIDE_TEXT.notYet;
  return GUIDE_TEXT.backNext(SEASON_NAMES.get(entry.gate.season) ?? entry.gate.season);
}

/** Whether the picked tile takes it: the Build sheet's own card says. */
export type GuideFit =
  | { readonly kind: 'later'; readonly label: string }
  | { readonly kind: 'fits'; readonly card: BuildCard }
  | { readonly kind: 'no'; readonly reason: string };

/**
 * `here` is every card the Build sheet offers on the picked tile. A card
 * there and not blocked fits; a blocked one says its own why; no card at
 * all says what the building needs, from its data.
 */
export function fitHere(entry: BuildingGuideEntry, here: readonly BuildCard[]): GuideFit {
  const label = gateLabel(entry);
  if (label !== null) return { kind: 'later', label };
  const card = here.find((c) => c.id === entry.id);
  if (card && card.blocked === null) return { kind: 'fits', card };
  return { kind: 'no', reason: card?.blocked ?? needsLine(entry.place) };
}

/** What a building needs that this tile doesn't have, from its data. */
export function needsLine(place: readonly GuidePlace[]): string {
  for (const p of place) {
    if (p.kind === 'on-water') return `Goes on a ${WATER_WORDS[p.water] ?? p.water} tile`;
    if (p.kind === 'terrain') return `Needs ${TERRAIN_NAMES.get(p.terrain) ?? p.terrain} land`;
    if (p.kind === 'needs-water') return `Needs ${waterWords(p.water)} next door`;
  }
  const at = place.find((p) => p.kind === 'placement');
  if (at?.kind === 'placement') {
    if (at.placement === 'home') return 'Goes at your home';
    if (at.placement === 'homestead') return 'Goes on a homestead';
    if (at.placement === 'land') return 'Goes on your land past home';
  }
  return "Doesn't fit this tile";
}

/** What the card's button does. */
export type GuideAction = 'build' | 'short' | 'craft' | 'off' | 'none';

export function guideAction(fit: GuideFit, bag: ItemCounts | null): GuideAction {
  if (fit.kind === 'later') return 'none';
  if (fit.kind === 'no') return 'off';
  if (fit.card.craft !== null) return 'craft';
  if (bag && !canAfford(bag, fit.card.cost)) return 'short';
  return 'build';
}

/**
 * How many tiles each building fits on: one pass over the map, asking the
 * Build sheets' sources (`cardsAt`) for each tile's cards.
 */
export function fitCounts(
  tiles: readonly PublicTile[],
  cardsAt: (tile: PublicTile) => readonly BuildCard[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    for (const id of new Set(cardsAt(tile).flatMap((c) => (c.blocked === null ? [c.id] : [])))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** The "Your tile" strip: what every ✓ and ✗ is measured against. */
export function tileLine(
  tile: Pick<PublicTile, 'terrain' | 'homeSlot'> & { homestead?: unknown },
): string {
  const where =
    tile.homeSlot !== null ? 'Your home' : tile.homestead === 'joined' ? 'Homestead' : null;
  const land = TERRAIN_NAMES.get(tile.terrain) ?? tile.terrain;
  return where ? `${where} · ${land}` : land;
}

/** A cost line's parts, through `shortNumber`, each marked when the bag is short of it. */
export function costParts(
  cost: ItemCounts,
  bag: ItemCounts | null,
): { readonly id: string; readonly count: string; readonly short: boolean }[] {
  return Object.entries(cost).map(([id, n]) => ({
    id,
    count: shortNumber(n),
    short: bag !== null && (bag[id] ?? 0) < n,
  }));
}
