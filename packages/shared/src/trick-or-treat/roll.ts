import { deriveSeed, Rng, type Seed } from '../rng/index.js';
import type { ClothingItem } from '../schemas/data/clothing.js';
import {
  trickOrTreatCostumes,
  type TrickOrTreatPrizes,
} from '../schemas/data/trick-or-treat-prizes.js';
import type { TrickOrTreatPrizeKind } from '../schemas/trick-or-treat.js';

/*
 * Rolling a trick-or-treat visit (#515). Server-only: it reads the secret
 * prize table (`@heartpatch/shared/server`) and is seeded from the secret map
 * seed (tech spec §8), so neither the odds nor a home's treat can be worked
 * out on the client. Pure and deterministic: the same visit always rolls the
 * same treat, so a retried request can't fish for a better one.
 */

/** What a visit is seeded by: the map seed (never sent), both Keepers and the patch's local day. */
export interface TrickOrTreatSeedInput {
  /** `maps.seed`, or `deriveSeed('hand-authored-map', mapId)` for a map without one. */
  mapSeed: Seed;
  visitorUserId: string;
  hostUserId: string;
  /** The patch's local day (`YYYY-MM-DD`). */
  day: string;
}

/** What `rollTrickOrTreat` rolls from. */
export interface TrickOrTreatInput extends TrickOrTreatSeedInput {
  /** The host has a lit Jack-o'-Lantern Hearthfire tonight. */
  lantern: boolean;
  /** Clothing the visitor owns already (item ids): costumes they have never come up. */
  owned: ReadonlySet<string>;
}

/** A visit's treat. */
export interface TrickOrTreatPrize {
  kind: TrickOrTreatPrizeKind;
  /** `heartdust`, or the costume's clothing id. */
  itemId: string;
  count: number;
}

export interface TrickOrTreatRoll {
  /** A silly trick plays first. It changes nothing: the treat comes anyway. */
  trick: boolean;
  prize: TrickOrTreatPrize;
}

/** The seed for one visitor's visit to one home on one patch day. Never sent to the client. */
export const trickOrTreatSeed = (input: TrickOrTreatSeedInput): Seed =>
  deriveSeed(input.mapSeed, 'trick-or-treat', input.visitorUserId, input.hostUserId, input.day);

/**
 * The visit's treat. A costume roll picks among the costumes of that kind the
 * visitor doesn't own yet, weighted by rarity; when there are none left (or
 * none of that kind exist yet), it gives the table's Heartdust instead.
 */
export function rollTrickOrTreat(
  input: TrickOrTreatInput,
  prizes: TrickOrTreatPrizes,
  catalog: readonly ClothingItem[],
): TrickOrTreatRoll {
  const rng = Rng.fromSeed(trickOrTreatSeed(input));
  const trick = rng.int(1, prizes.trickOneIn) === 1;
  const table = input.lantern ? prizes.lantern : prizes.plain;
  const { kind } = rng.weighted<{ kind: TrickOrTreatPrizeKind; weight: number }>([
    { kind: 'heartdust', weight: table.heartdust.weight },
    { kind: 'keeper-costume', weight: table.keeperCostume.weight },
    { kind: 'squishy-costume', weight: table.squishyCostume.weight },
  ]);
  if (kind !== 'heartdust') {
    const choices = trickOrTreatCostumes(catalog, kind)
      .filter((item) => !input.owned.has(item.id))
      .map((item) => ({ id: item.id, weight: prizes.rarityWeights[item.rarity] }))
      .filter((c) => c.weight > 0);
    if (choices.length > 0) {
      return { trick, prize: { kind, itemId: rng.weighted(choices).id, count: 1 } };
    }
  }
  const count = rng.int(table.heartdust.min, table.heartdust.max);
  return { trick, prize: { kind: 'heartdust', itemId: 'heartdust', count } };
}
