import type { ItemCounts } from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';

// What the one Build sheet shows (#371): home base, fires on my land and
// fences all build the same way: pick the spot or edges, pick the building
// from one row of cards, tap Build!. Pure, so every case is unit-tested; the
// server still checks every cost and rule (CLAUDE.md rule 1).

/** One building the sheet can put up, ready for a card. */
export interface BuildCard {
  readonly id: string;
  readonly icon: string;
  readonly name: string;
  /** What it does, in one short line. */
  readonly effect: string;
  /** What it costs: once, or for every edge when `area` is 'edges'. */
  readonly cost: ItemCounts;
  /** Goes on one spot, or on edges (as many as are picked). */
  readonly area: 'spot' | 'edges';
  /** Why it can't be picked right now (no room, out of season), or null. */
  readonly blocked: string | null;
  /** Something to make first (the Jack-o'-Lantern): the sheet offers the recipe book. */
  readonly craft: string | null;
}

/** A cost times `n` (fencing several edges at once). */
export function times(cost: ItemCounts, n: number): ItemCounts {
  return Object.fromEntries(Object.entries(cost).map(([id, k]) => [id, k * n]));
}

/** Does the bag hold all of `cost`? */
export function canAfford(items: ItemCounts, cost: ItemCounts): boolean {
  return Object.entries(cost).every(([id, n]) => (items[id] ?? 0) >= n);
}

/** What building `card` on `areas` spots or edges costs. */
export function buildTotal(card: BuildCard, areas: number): ItemCounts {
  return card.area === 'edges' ? times(card.cost, Math.max(1, areas)) : card.cost;
}

export type BuildStatus =
  | { readonly kind: 'ready' }
  /** The bag is short of something. */
  | { readonly kind: 'short' }
  /** Nothing picked on the tile yet. */
  | { readonly kind: 'no-area' }
  | { readonly kind: 'blocked'; readonly note: string }
  | { readonly kind: 'craft'; readonly note: string };

/**
 * Whether Build! works for `card`: `areas` is how many spots or edges are
 * picked, `bag` is null until the bag has loaded (the server has the last
 * word either way).
 */
export function buildStatus(card: BuildCard, bag: ItemCounts | null, areas: number): BuildStatus {
  if (card.blocked) return { kind: 'blocked', note: card.blocked };
  if (card.craft) return { kind: 'craft', note: card.craft };
  if (areas < 1) return { kind: 'no-area' };
  if (bag && !canAfford(bag, buildTotal(card, areas))) return { kind: 'short' };
  return { kind: 'ready' };
}

/** A cost as icons and counts, for one tight line: "32 🌿 4 🪵". */
export function costShort(cost: ItemCounts): string {
  return Object.entries(cost)
    .map(([id, n]) => `${String(n)} ${itemIcon(id)}`)
    .join(' ');
}

/** The selected card's line: what it does and what it costs. */
export function detailLine(card: BuildCard, areas: number): string {
  const edges = card.area === 'edges' && areas > 1 ? ` (${String(areas)} edges)` : '';
  return `${card.effect} · ${costShort(buildTotal(card, areas))}${edges}`;
}

/** Which card is selected: the one asked for if it's there, else the first you can build. */
export function pickCard(
  cards: readonly BuildCard[],
  wanted: string | null,
  bag: ItemCounts | null,
): BuildCard | null {
  const found = cards.find((c) => c.id === wanted);
  if (found) return found;
  const easy = cards.find(
    (c) => c.blocked === null && c.craft === null && canAfford(bag ?? {}, c.cost),
  );
  return easy ?? cards.find((c) => c.blocked === null) ?? cards[0] ?? null;
}

// Player-facing text (style guide: cozy, short, kid-readable).
export const BUILD_TEXT = {
  build: '🔨 Build',
  go: 'Build!',
  cancel: 'Not now',
  tapEdges: 'Tap the glowing edges!',
  tapSpot: 'Tap a glowing spot!',
  spotChosen: 'Pretty spot! Tap another to change it.',
  centre: 'It goes right in the middle!',
  allEdges: 'All edges',
  noEdges: 'None',
  pickAnEdge: 'Tap an edge to fence it!',
  needMore: "Your bag doesn't have enough for that yet.",
  recipeBook: '📖 Recipe book',
  working: 'Building…',
  edgeOn: (name: string) => `${name} edge: fenced`,
  edgeOff: (name: string) => `${name} edge: no fence`,
} as const;
