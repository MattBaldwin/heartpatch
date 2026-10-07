import {
  borderEdges,
  buildCost,
  ELEMENTS,
  FENCE_RULES,
  fenceMaxHp,
  fencePercent,
  fenceRepairCost,
  fenceHpAfterUpgrade,
  GAME_DATA,
  HOME_BASE_RULES,
  isBuildable,
  removeRefund,
  upgradeCost,
  type FenceBuilding,
  type ItemCounts,
  type MapView,
  type PublicFence,
  type PublicTile,
} from '@heartpatch/shared';
import { bagItems } from '../inventory/bag-view.js';
import { costText, effectChips } from '../home/home-view.js';
import { ELEMENT_GLYPH } from '../ui/glyphs.js';

// What the fence sheet shows (#203, the owner-approved mockup): the fences on
// a tile of mine, the open edges a new one could go on, what each costs, and
// which elements crack it. Pure, so every case is unit-tested; the server
// still checks every cost and rule (CLAUDE.md rule 1).

/** Every fence this build offers, in the shared table's order. */
export const FENCES: readonly FenceBuilding[] = GAME_DATA.buildings.filter(
  (b): b is FenceBuilding => b.kind === 'fence' && isBuildable(HOME_BASE_RULES, b),
);
const FENCE_BY_ID = new Map(FENCES.map((f) => [f.id, f]));

export function fenceOf(buildingId: string): FenceBuilding | undefined {
  return FENCE_BY_ID.get(buildingId);
}

const ELEMENT_NAMES = new Map<string, string>(ELEMENTS.map((e) => [e.id, e.name]));

/** A picture for each fence on buttons and cards. */
const FENCE_ICONS: Readonly<Record<string, string>> = {
  hedge: '🌿',
  moat: '💧',
  'stone-wall': '🪨',
  'emberwood-palisade': '🪵',
  'glimmer-rail': '✨',
  'lantern-fence': '🏮',
  'bramble-hedge': '🫐',
  'ice-wall': '🧊',
};

export function fenceIcon(buildingId: string): string {
  return FENCE_ICONS[buildingId] ?? '🪵';
}

export function elementName(id: string): string {
  return ELEMENT_NAMES.get(id) ?? id;
}

/** The elements that hit a fence of `element` hard, in the table's order ("Fire and Frost"). */
export function fenceCrackers(element: FenceBuilding['element']): string[] {
  return ELEMENTS.filter((e) => GAME_DATA.elementMatrix[e.id][element] > 1).map((e) => e.name);
}

/** "a", "a and b", "a, b and c". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/** "Fire and Frost crack it" for a fence's element. */
export function crackedBy(element: FenceBuilding['element']): string {
  const names = fenceCrackers(element);
  if (names.length === 0) return '';
  return `${andList(names)} crack${names.length === 1 ? 's' : ''} it`;
}

/** Edge names as a player says them (edge 0 is east, then anticlockwise). */
const EDGE_NAMES = ['east', 'north-east', 'north-west', 'west', 'south-west', 'south-east'];

export function edgeName(edge: number): string {
  return EDGE_NAMES[edge] ?? 'edge';
}

/** The tiles `owner` holds on the map. */
export function tilesOf(view: Pick<MapView, 'tiles'>, owner: string): PublicTile[] {
  return view.tiles.filter((t) => t.ownerUserId === owner);
}

/** Edges of my `tile` that face land I don't hold and have no fence yet. */
export function openEdges(tile: PublicTile, view: Pick<MapView, 'tiles'>, me: string): number[] {
  const fenced = new Set((tile.fences ?? []).map((f) => f.edge));
  return borderEdges(tile, tilesOf(view, me)).filter((e) => !fenced.has(e));
}

/** Is this edge of my tile inside my land now (no fence needed there)? */
export function isInterior(
  tile: PublicTile,
  edge: number,
  view: Pick<MapView, 'tiles'>,
  me: string,
): boolean {
  return !borderEdges(tile, tilesOf(view, me)).includes(edge as never);
}

/** A cost times `n` (fencing several edges at once). */
export function times(cost: ItemCounts, n: number): ItemCounts {
  return Object.fromEntries(Object.entries(cost).map(([id, k]) => [id, k * n]));
}

/** Does the bag hold all of `cost`? */
export function canAfford(items: ItemCounts, cost: ItemCounts): boolean {
  return Object.entries(cost).every(([id, n]) => (items[id] ?? 0) >= n);
}

/** One segment as its card shows it. */
export interface FenceCard {
  readonly fence: PublicFence;
  readonly name: string;
  readonly element: FenceBuilding['element'];
  readonly percent: number;
  /** Repairing it back to full; null when it's full. */
  readonly repair: ItemCounts | null;
  /** The next level's cost and energy; null at the top. */
  readonly upgrade: {
    readonly cost: ItemCounts;
    readonly hp: number;
    readonly maxHp: number;
  } | null;
  /** What taking it down gives back. */
  readonly refund: ItemCounts;
}

export function fenceCard(fence: PublicFence): FenceCard | null {
  const kind = fenceOf(fence.buildingId);
  if (!kind) return null;
  const repair = fenceRepairCost(kind, fence.level, fence.hp, FENCE_RULES);
  const next = upgradeCost(kind, fence.level);
  return {
    fence,
    name: kind.name,
    element: kind.element,
    percent: fencePercent(fence.hp, fence.maxHp),
    repair: Object.keys(repair).length > 0 ? repair : null,
    upgrade: next
      ? {
          cost: next,
          hp: fenceHpAfterUpgrade(kind, fence.level, fence.hp),
          maxHp: fenceMaxHp(kind, fence.level + 1),
        }
      : null,
    refund: removeRefund(kind, fence.level, HOME_BASE_RULES),
  };
}

/**
 * What a fence does at `level`, as chips worked out from its data (#241,
 * like the build menu's, #207): its element, the shared fence effect (keeps
 * other Keepers out, its energy), and its level.
 */
export function fenceChips(fence: FenceBuilding, level = 1): string[] {
  return [
    `${ELEMENT_GLYPH[fence.element] ?? '✨'} ${elementName(fence.element)}`,
    ...effectChips(fence, level),
    `Level ${String(level)} of ${String(fence.levels.length)}`,
  ];
}

/** One row of the build list. */
export interface FenceChoice {
  readonly fence: FenceBuilding;
  readonly cost: ItemCounts;
  readonly hp: number;
  readonly affordable: boolean;
}

/** Every fence, what fencing `edges` edges with it costs, and whether the bag holds it. */
export function fenceChoices(items: ItemCounts, edges: number): FenceChoice[] {
  const n = Math.max(1, edges);
  return FENCES.map((fence) => {
    const cost = times(buildCost(fence), n);
    return { fence, cost, hp: fenceMaxHp(fence, 1), affordable: canAfford(items, cost) };
  });
}

// Player-facing text (style guide: cozy, short, kid-readable).
export const FENCE_TEXT = {
  fenced: '🪵 Fenced all the way round! Challengers must break it first.',
  open: (n: number) =>
    n === 1
      ? '1 edge faces other land with no fence.'
      : `${String(n)} edges face other land with no fence.`,
  inside: 'All inside your land: no fence needed here.',
  innerDown: (n: number) =>
    n === 1
      ? '🪵 Your new land is past one of your fences, so it came down. Part of it came back to your bag!'
      : `🪵 Your new land is past ${String(n)} of your fences, so they came down. Part of each came back to your bag!`,
  build: 'Build a fence',
  openSheet: (n: number) => (n > 0 ? `🪵 Fences (${String(n)})` : '🪵 Fences'),
  segment: (name: string, edge: string, percent: number) =>
    `${name} · ${edge} · ${String(percent)}%`,
  fences: (n: number) => (n === 1 ? '1 fence here' : `${String(n)} fences here`),
  pickMaterial: 'Pick a material',
  pickEdges: 'Which edges?',
  allEdges: 'All open edges',
  fenceThem: (n: number, cost: string) =>
    `🪵 Fence ${n === 1 ? 'it' : n === 2 ? 'both' : `all ${String(n)}`} (${cost})`,
  pickAnEdge: 'Tap an edge to fence it!',
  needMore: "Your bag doesn't have enough for that yet.",
  built: (n: number) => (n === 1 ? 'Fence up! 🪵' : `${String(n)} fences up! 🪵`),
  level: (n: number) => `Level ${String(n)}`,
  energy: (percent: number) => `Fence ${String(percent)}%`,
  energyFull: (hp: number) => `Energy ${String(hp)}`,
  cracks: (element: FenceBuilding['element']) =>
    `${ELEMENT_GLYPH[element] ?? ''} ${elementName(element)} · ${crackedBy(element)}`,
  repair: (cost: string) => `🔨 Repair (${cost})`,
  repaired: 'Good as new! 🔨',
  upgrade: (cost: string) => `⬆️ Upgrade (${cost})`,
  upgradeFrom: (hp: number, maxHp: number, nextHp: number, nextMax: number) =>
    `Energy ${String(hp)}/${String(maxHp)} → ${String(nextHp)}/${String(nextMax)}`,
  upgraded: (level: number) => `Level ${String(level)}! Sturdier than ever. ⬆️`,
  topLevel: 'Top level!',
  takeDown: 'Take down',
  takeDownTitle: 'Take down this fence?',
  interiorNote: "This edge is inside your land now, so it isn't keeping anyone out.",
  refund: (items: string) => `You get back ${items}. That's half of what it cost.`,
  noRefund: 'Nothing comes back from this one.',
  keep: 'Keep it',
  yesTakeDown: 'Yes, take it down',
  takenDown: (items: string) => (items ? `Taken down. You got back ${items}.` : 'Taken down.'),
  back: 'Back',
  costOf: costText,
  items: (counts: ItemCounts) =>
    andList(bagItems(counts).map((i) => `${String(i.count)} ${i.name}`)),
} as const;
