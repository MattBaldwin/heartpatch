import type { Catalog, Rarity, Species } from '@heartpatch/shared';

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
  /** The species' rarity once seen (#240); unseen cards keep it hidden. */
  readonly rarity: Rarity | null;
  readonly seen: boolean;
  readonly caught: boolean;
  /** A secret squishy the player found. */
  readonly secret: boolean;
  /** A mini-boss line squishy the player has met (#190): it only ever shows once met. */
  readonly boss: boolean;
}

/** The tiers with a goal, in the order a kid works through them. Secret has none (it never shows before it's met). */
export const GOAL_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;

/** One rarity tier's goal: kinds befriended out of the kinds a kid can meet now. Counts only. */
export interface CatalogTier {
  readonly rarity: Rarity;
  readonly caught: number;
  readonly seen: number;
  readonly total: number;
  /** Every kind in the tier is a friend. */
  readonly done: boolean;
  /** The first unfinished tier: the kid's current finish line. */
  readonly current: boolean;
}

export interface CatalogPage {
  readonly cards: readonly CatalogCard[];
  readonly seen: number;
  readonly caught: number;
  /** Cards on the page: the public roster plus any secret ones found. */
  readonly total: number;
  /** The goal block at the top: one row per tier that has kinds to find. */
  readonly tiers: readonly CatalogTier[];
}

/** A tier row's words: "9 of 30 friends", or "All found!" once done. Seen shows on the current row only. */
export function tierText(tier: CatalogTier): string {
  if (tier.done) return 'All found!';
  const friends = `${String(tier.caught)} of ${String(tier.total)} ${tier.total === 1 ? 'friend' : 'friends'}`;
  return tier.current ? `${friends} · ${String(tier.seen)} seen` : friends;
}

/**
 * `seasons` is the ids of the seasons on today for this patch. A seasonal kind
 * counts toward its tier while its season is on, or once the kid has met it
 * (so a total never takes away a friend they already made).
 */
export function catalogPage(
  publicSpecies: readonly Species[],
  catalog: Catalog,
  seasons: readonly string[] = [],
): CatalogPage {
  const entries = new Map(catalog.entries.map((e) => [e.speciesId, e]));
  const card = (species: Species, secret: boolean): CatalogCard => {
    const entry = entries.get(species.id);
    return {
      speciesId: species.id,
      name: entry ? species.name : null,
      color: entry ? (species.visual.palette[0] ?? null) : null,
      rarity: entry ? species.rarity : null,
      seen: entry !== undefined,
      caught: entry?.firstCaughtAt != null,
      secret,
      boss: species.line === 'boss',
    };
  };
  const publicIds = new Set(publicSpecies.map((s) => s.id));
  const cards = [
    ...publicSpecies.map((s) => card(s, false)),
    // Only secrets and boss lines the player has met come with the catalog
    // (#190: never a "???" card or a count before; `hiddenUntilSeen`).
    ...catalog.speciesDefs
      .filter((s) => !publicIds.has(s.id) && entries.has(s.id))
      .map((s) => card(s, true)),
  ];
  const seen = cards.filter((c) => c.seen).length;
  const caught = cards.filter((c) => c.caught).length;
  const reachable = publicSpecies.filter(
    (sp) => sp.season === undefined || seasons.includes(sp.season) || entries.has(sp.id),
  );
  const counts = GOAL_TIERS.map((rarity) => {
    const kinds = reachable.filter((sp) => sp.rarity === rarity);
    const caughtKinds = kinds.filter((sp) => entries.get(sp.id)?.firstCaughtAt != null).length;
    return {
      rarity,
      caught: caughtKinds,
      seen: kinds.filter((sp) => entries.has(sp.id)).length,
      total: kinds.length,
      done: kinds.length > 0 && caughtKinds === kinds.length,
    };
  }).filter((t) => t.total > 0);
  const currentRarity = counts.find((t) => !t.done)?.rarity;
  const tiers = counts.map((t) => ({ ...t, current: t.rarity === currentRarity }));
  return { cards, seen, caught, total: cards.length, tiers };
}
