import {
  createBattleContent,
  type BattleContent,
  type BattleData,
} from '../../src/battle/content.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GAME_DATA } from '../../src/data/index.js';
import { SERVER_GAME_DATA, serverBattleData } from '../../src/data/server/index.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';
import {
  ElementIdSchema,
  FeelingIdSchema,
  type ElementId,
  type FeelingId,
} from '../../src/schemas/data/elements.js';
import { SpeciesSchema, type Species } from '../../src/schemas/data/species.js';
import type { SimConfig } from './config.js';

/*
 * What the sim plays (issue #12). Every bracket is 1v1 at matched levels, so
 * a result points at one table:
 *   - species: every base form against every base form, and every evolved
 *     form against every evolved form, public and secret (the sim runs
 *     server-side, so it may read data/server).
 *   - combo: one stand-in squishy per element × feeling combo, all with the
 *     same stats and their element's moves, so only the matrices, the synergy
 *     table and the element's moves differ.
 *   - stance: every base form against itself with two different stances.
 */

export type Bracket = 'base' | 'evolved' | 'combo' | 'stance';

/** One side of a matchup. `key` is what the report names it by. */
export interface Entrant {
  readonly key: string;
  readonly speciesId: string;
  readonly element?: ElementId;
  readonly feeling?: FeelingId;
  readonly secret?: boolean;
  readonly rarity?: string;
}

export interface Matchup {
  readonly bracket: Bracket;
  readonly a: Entrant;
  readonly b: Entrant;
  readonly policyA: BattleAiPolicy;
  readonly policyB: BattleAiPolicy;
  readonly level: number;
  readonly games: number;
}

export interface SimPlan {
  readonly matchups: readonly Matchup[];
  /** Content for the species and stance brackets (public + secret data). */
  readonly content: BattleContent;
  /** Content for the combo bracket: the same data plus the stand-ins. */
  readonly comboContent: BattleContent;
}

const STAND_IN_PREFIX = 'sim-stand-in-';
/** A species knows 2–4 moves (design doc §6, `SpeciesSchema`). */
const MAX_MOVES = 4;

/** The battle data the server plays with: public plus secret rows. */
export function serverData(): BattleData {
  return serverBattleData(GAME_DATA, SERVER_GAME_DATA);
}

/** Splits species into base forms and evolved forms (public and secret evolutions). */
export function speciesForms(data: BattleData): { base: Species[]; evolved: Species[] } {
  const evolvedIds = new Set([
    ...data.species.flatMap((s) => s.evolutions.map((e) => e.into)),
    ...SERVER_GAME_DATA.secretEvolutions.map((e) => e.into),
  ]);
  return {
    base: data.species.filter((s) => !evolvedIds.has(s.id)),
    evolved: data.species.filter((s) => evolvedIds.has(s.id)),
  };
}

/**
 * One stand-in species per element: the average base form's stats and up to
 * `MAX_MOVES` of that element's public moves, the ones most public base
 * forms know first (ties in move-table order). Its feeling is set per battle.
 * Validated like real data, so the engine never sees a squishy the game
 * couldn't have.
 */
export function standIns(data: BattleData): Species[] {
  const { base } = speciesForms(data);
  const publicBase = base.filter((s) => s.rarity !== 'secret');
  const average = (stat: keyof Species['baseStats']) =>
    Math.round(publicBase.reduce((sum, s) => sum + s.baseStats[stat], 0) / publicBase.length);
  const baseStats = {
    hp: average('hp'),
    attack: average('attack'),
    defense: average('defense'),
    speed: average('speed'),
  };
  const template = publicBase[0];
  if (!template) throw new Error('the roster has no public base forms');
  const knownBy = new Map<string, number>();
  for (const s of publicBase) for (const id of s.moves) knownBy.set(id, (knownBy.get(id) ?? 0) + 1);
  return ElementIdSchema.options.map((element) => {
    const moves = GAME_DATA.moves
      .map((m, index) => ({ m, index, uses: knownBy.get(m.id) ?? 0 }))
      .filter(({ m }) => m.element === element)
      .sort((x, y) => y.uses - x.uses || x.index - y.index)
      .slice(0, MAX_MOVES)
      .map(({ m }) => m.id);
    return SpeciesSchema.parse({
      ...template,
      id: `${STAND_IN_PREFIX}${element}`,
      name: `Stand-in ${element}`,
      element,
      baseStats,
      moves,
      evolutions: [],
    });
  });
}

const entrantOf = (s: Species): Entrant => ({
  key: s.id,
  speciesId: s.id,
  secret: s.rarity === 'secret',
  rarity: s.rarity,
});

/** Every unordered pair (i < j). */
function pairs<T>(items: readonly T[]): [T, T][] {
  return items.flatMap((a, i) => items.slice(i + 1).map((b): [T, T] => [a, b]));
}

export function planSim(config: SimConfig): SimPlan {
  for (const [name, games] of Object.entries(config.games)) {
    // Entrants alternate sides, so an odd count would give side `a` an extra start.
    if (games <= 0 || games % 2 !== 0) throw new Error(`games.${name} must be even, got ${games}`);
  }
  const data = serverData();
  const content = createBattleContent(data, BATTLE_RULES);
  const stands = standIns(data);
  const comboContent = createBattleContent(
    { ...data, species: [...data.species, ...stands] },
    BATTLE_RULES,
  );
  const { base, evolved } = speciesForms(data);

  const matchups: Matchup[] = [];
  const roundRobin = (bracket: Bracket, entrants: Entrant[], level: number, games: number) => {
    for (const [a, b] of pairs(entrants)) {
      for (const policy of config.policies) {
        matchups.push({ bracket, a, b, policyA: policy, policyB: policy, level, games });
      }
    }
  };

  roundRobin('base', base.map(entrantOf), config.levels.base, config.games.species);
  roundRobin('evolved', evolved.map(entrantOf), config.levels.evolved, config.games.species);

  const combos = stands.flatMap((s) =>
    FeelingIdSchema.options.map((feeling): Entrant => ({
      key: `${s.element}+${feeling}`,
      speciesId: s.id,
      element: s.element,
      feeling,
    })),
  );
  roundRobin('combo', combos, config.levels.combo, config.games.combo);

  for (const s of base) {
    for (const [policyA, policyB] of pairs(config.policies)) {
      const entrant = entrantOf(s);
      matchups.push({
        bracket: 'stance',
        a: entrant,
        b: entrant,
        policyA,
        policyB,
        level: config.levels.base,
        games: config.games.stance,
      });
    }
  }
  return { matchups, content, comboContent };
}
