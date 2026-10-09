import { CLOTHING } from '../data/clothing.js';
import { GAME_DATA } from '../data/index.js';
import { TRADE_VALUES } from '../data/trading.js';
import type { ClothingItem } from '../schemas/data/clothing.js';
import type { SynergyTable } from '../schemas/data/matrices.js';
import type { Species } from '../schemas/data/species.js';
import type { TradeValues } from '../schemas/data/trading.js';

// What a trade is worth, for the fairness meter (#305; #272's values, pulled
// forward; design doc §10). Pure and deterministic. The meter is only a
// display: the server can run these same functions for the #272 bonuses, and
// players only ever see hearts. A species the viewer hasn't met comes as
// `speciesId: null` and is valued at a plain middle value, so a value never
// gives a secret away (CLAUDE.md rule 6).

/** One thing on one side, as much as its value needs (a `TradeLineView` fits). */
export type ValuedLine =
  | { readonly kind: 'squishy'; readonly speciesId: string | null; readonly level: number }
  | { readonly kind: 'item'; readonly itemId: string; readonly quantity: number }
  | { readonly kind: 'clothing'; readonly itemId: string };

/** What the values are read from (the game's own data unless a test passes its own). */
export interface TradeValueData {
  readonly values: TradeValues;
  readonly species: readonly Species[];
  readonly synergy: SynergyTable;
  readonly clothing: readonly ClothingItem[];
}

export interface TradeValuer {
  /** One line's worth (an item stack counts each one). */
  readonly lineValue: (line: ValuedLine) => number;
  /** A whole side's worth. */
  readonly sideValue: (lines: readonly ValuedLine[]) => number;
}

/** Each species' evolution stage: 1 for a first form, 2 for what it evolves into, … */
export function evolutionStages(species: readonly Species[]): ReadonlyMap<string, number> {
  const parent = new Map<string, string>();
  for (const s of species) for (const e of s.evolutions) parent.set(e.into, s.id);
  const stages = new Map<string, number>();
  for (const s of species) {
    let stage = 1;
    // Bounded by the species count, so a bad loop in the data can't hang.
    for (let at = parent.get(s.id); at !== undefined && stage <= species.length;) {
      stage += 1;
      at = parent.get(at);
    }
    stages.set(s.id, stage);
  }
  return stages;
}

export function createTradeValuer(data: TradeValueData): TradeValuer {
  const { values } = data;
  const species = new Map(data.species.map((s) => [s.id, s]));
  const stages = evolutionStages(data.species);
  const clothing = new Map(data.clothing.map((c) => [c.id, c]));
  const levelFactor = (level: number) => 1 + values.levelStep * Math.max(0, level - 1);
  const stageFactor = (stage: number) =>
    values.stage[Math.min(stage, values.stage.length) - 1] ?? 1;

  const lineValue = (line: ValuedLine): number => {
    if (line.kind === 'item') return (values.items[line.itemId] ?? 0) * line.quantity;
    if (line.kind === 'clothing') {
      const item = clothing.get(line.itemId);
      return item ? values.clothingRarity[item.rarity] : 0;
    }
    const known = line.speciesId === null ? undefined : species.get(line.speciesId);
    if (!known) return values.squishyRarity[values.mysteryRarity] * levelFactor(line.level);
    const synergy = data.synergy[known.element][known.feeling];
    return (
      values.squishyRarity[known.rarity] *
      stageFactor(stages.get(known.id) ?? 1) *
      synergy *
      levelFactor(line.level)
    );
  };
  return {
    lineValue,
    sideValue: (lines) => lines.reduce((sum, line) => sum + lineValue(line), 0),
  };
}

/** Values from the game's own data. */
export const tradeValuer: TradeValuer = createTradeValuer({
  values: TRADE_VALUES,
  species: GAME_DATA.species,
  synergy: GAME_DATA.synergy,
  clothing: CLOTHING,
});

/** A side's worth as 0–5 hearts: 0 only for nothing at all. */
export function heartsOf(value: number, values: TradeValues = TRADE_VALUES): number {
  if (value <= 0) return 0;
  return 1 + values.hearts.filter((least) => value >= least).length;
}

/**
 * Which way a trade tips, from one player's side: `even` within `evenBand`
 * of the bigger side, else toward `me` (I get more) or `them`; `none` until
 * both sides have something.
 */
export type TradeTip = 'none' | 'even' | 'me' | 'them';

export interface TradeBalance {
  readonly tip: TradeTip;
  /** One side is worth at least `lopsided` times the other. */
  readonly lopsided: boolean;
}

/** How even a trade is: what I give against what I get. */
export function tradeBalance(
  give: number,
  get: number,
  values: TradeValues = TRADE_VALUES,
): TradeBalance {
  if (give <= 0 || get <= 0) return { tip: 'none', lopsided: false };
  const big = Math.max(give, get);
  const small = Math.min(give, get);
  if (big - small <= values.evenBand * big) return { tip: 'even', lopsided: false };
  return { tip: get > give ? 'me' : 'them', lopsided: big >= values.lopsided * small };
}
