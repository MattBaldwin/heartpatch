import type { Catalog, Species } from '@heartpatch/shared';

/*
 * The catalog page's model (design doc §21: seen vs caught). Pure, so it's
 * unit-tested without the DOM. The public roster fills the page, unseen ones
 * as a "???" silhouette; secret species only exist here once the player has
 * met them (the server sends their rows then, never before).
 */

export interface CatalogCard {
  readonly speciesId: string;
  /** Null while unseen: the card shows "???". */
  readonly name: string | null;
  /** The species' main colour once seen; unseen cards are a silhouette. */
  readonly color: string | null;
  readonly seen: boolean;
  readonly caught: boolean;
  /** A secret squishy the player found. */
  readonly secret: boolean;
}

export interface CatalogPage {
  readonly cards: readonly CatalogCard[];
  readonly seen: number;
  readonly caught: number;
  /** Cards on the page: the public roster plus any secret ones found. */
  readonly total: number;
  /** One short line for the top of the page. */
  readonly progress: string;
}

export function catalogPage(publicSpecies: readonly Species[], catalog: Catalog): CatalogPage {
  const entries = new Map(catalog.entries.map((e) => [e.speciesId, e]));
  const card = (species: Species, secret: boolean): CatalogCard => {
    const entry = entries.get(species.id);
    return {
      speciesId: species.id,
      name: entry ? species.name : null,
      color: entry ? (species.visual.palette[0] ?? null) : null,
      seen: entry !== undefined,
      caught: entry?.firstCaughtAt != null,
      secret,
    };
  };
  const publicIds = new Set(publicSpecies.map((s) => s.id));
  const cards = [
    ...publicSpecies.map((s) => card(s, false)),
    // Only secrets the player has met come with the catalog.
    ...catalog.speciesDefs
      .filter((s) => !publicIds.has(s.id) && entries.has(s.id))
      .map((s) => card(s, true)),
  ];
  const seen = cards.filter((c) => c.seen).length;
  const caught = cards.filter((c) => c.caught).length;
  const progress =
    seen === 0
      ? 'No squishies yet. Go find some!'
      : `Seen ${String(seen)} of ${String(cards.length)} · Friends ${String(caught)}`;
  return { cards, seen, caught, total: cards.length, progress };
}
