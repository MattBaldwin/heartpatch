import { Rng, type Seed } from '../rng/index.js';
import type { FeelingId } from '../schemas/data/elements.js';
import type {
  BranchTrigger,
  EvolutionCondition,
  EvolutionRules,
} from '../schemas/data/evolution-odds.js';

/** One form a step can become. No `trigger`: the step's default form. */
export interface EvolutionForm {
  readonly from: string;
  readonly into: string;
  readonly level: number;
  readonly trigger?: BranchTrigger;
}

/**
 * The forms a species can evolve into at `level`: every form at the lowest
 * evolution level it has reached, in table order (public before secret, so
 * the default form comes first). Empty when it doesn't evolve yet.
 */
export function stepForms(
  speciesId: string,
  level: number,
  forms: readonly EvolutionForm[],
): EvolutionForm[] {
  let lowest = Infinity;
  for (const f of forms) {
    if (f.from === speciesId && f.level <= level && f.level < lowest) lowest = f.level;
  }
  return forms.filter((f) => f.from === speciesId && f.level === lowest);
}

/** What the world looks like as a squishy evolves, for rare conditions. Plain data, so it can be logged. */
export interface EvolutionFacts {
  readonly time: 'day' | 'dusk' | 'night';
  /** Seasons on now. */
  readonly seasons: readonly string[];
  /** Buildings with a fire burning on the owner's land. */
  readonly firesLit: readonly string[];
  /** A fire on the owner's land is full of fuel. */
  readonly fireFull: boolean;
}

export function conditionHolds(condition: EvolutionCondition, facts: EvolutionFacts): boolean {
  switch (condition.kind) {
    case 'time':
      return condition.times.includes(facts.time);
    case 'fire-lit':
      return facts.firesLit.includes(condition.building);
    case 'fire-full':
      return facts.fireFull;
    case 'season':
      return facts.seasons.includes(condition.season);
  }
}

/** Everything a roll depends on besides its seed and the tables, as logged with it. */
export interface EvolutionRollInputs {
  readonly dominant: FeelingId;
  /** Care history, 0–1 (`careScore`). */
  readonly careScore: number;
  readonly facts: EvolutionFacts;
  /** Aimed misses so far, per branch form (this player's, since they last got it). */
  readonly pity: Readonly<Record<string, number>>;
}

export interface FormWeight {
  readonly into: string;
  readonly weight: number;
  /** A branch the squishy was aimed at: its feeling won, or its rare conditions held. */
  readonly aimed: boolean;
  readonly branch: boolean;
}

const tidy = (n: number) => Math.round(n * 1000) / 1000;

/** Whether a branch is aimed at, and whether it can be rolled at all. */
function aim(
  trigger: BranchTrigger,
  inputs: EvolutionRollInputs,
): { aimed: boolean; possible: boolean } {
  if (trigger.kind === 'feeling') {
    return { aimed: trigger.feeling === inputs.dominant, possible: true };
  }
  const holds =
    trigger.conditions.every((c) => conditionHolds(c, inputs.facts)) &&
    (trigger.feeling === undefined || trigger.feeling === inputs.dominant);
  return { aimed: holds, possible: holds };
}

/**
 * Each form's weight (#32, design doc §8): the default form keeps
 * `weights.default`; a branch gets `aimed` or `unaimed` (a rare branch whose
 * conditions don't hold gets 0), then the care boost, then pity for an aimed
 * branch: ×`boost` after `boostAfter` misses, certain after `guaranteeAfter`.
 */
export function evolutionWeights(
  forms: readonly EvolutionForm[],
  inputs: EvolutionRollInputs,
  rules: Pick<EvolutionRules, 'weights' | 'pity'>,
): FormWeight[] {
  const { weights, pity } = rules;
  const care = 1 + (weights.careBoost - 1) * Math.max(0, Math.min(1, inputs.careScore));
  const out = forms.map((form) => {
    if (!form.trigger) {
      return {
        into: form.into,
        weight: weights.default,
        aimed: false,
        branch: false,
        certain: false,
      };
    }
    const { aimed, possible } = aim(form.trigger, inputs);
    let weight = possible ? (aimed ? weights.aimed : weights.unaimed) * care : 0;
    const misses = aimed ? (inputs.pity[form.into] ?? 0) : 0;
    if (aimed && misses >= pity.boostAfter) weight *= pity.boost;
    return {
      into: form.into,
      weight: tidy(weight),
      aimed,
      branch: true,
      certain: aimed && misses >= pity.guaranteeAfter,
    };
  });
  const anyCertain = out.some((f) => f.certain);
  return out.map(({ certain, ...f }) => (anyCertain && !certain ? { ...f, weight: 0 } : f));
}

/** A rolled evolution, everything needed to explain and replay it. */
export interface EvolutionRoll {
  readonly seed: Seed;
  /** The uniform draw in [0, 1). */
  readonly u: number;
  readonly inputs: EvolutionRollInputs;
  readonly weights: readonly FormWeight[];
  readonly pick: string;
  /** The pick is a branch, not the default form. */
  readonly branch: boolean;
  /** Aimed branches that weren't picked (they count toward this player's pity). */
  readonly aimedMisses: readonly string[];
}

/**
 * Rolls a step's forms (#32). The same seed, forms, inputs and rules always
 * give the same pick, so a logged roll replays exactly. Forms are walked in
 * table order (`Rng.weighted`); the default form's weight is positive
 * (`EvolutionRulesSchema`), so there's always something to pick.
 */
export function rollEvolution(
  seed: Seed,
  forms: readonly EvolutionForm[],
  inputs: EvolutionRollInputs,
  rules: Pick<EvolutionRules, 'weights' | 'pity'>,
): EvolutionRoll {
  if (forms.length === 0) throw new RangeError('rollEvolution needs at least one form');
  const weights = evolutionWeights(forms, inputs, rules);
  // `weighted` draws the generator's first `next()`, so `u` is that same draw, logged.
  const u = Rng.fromSeed(seed).next();
  const picked = Rng.fromSeed(seed).weighted(weights);
  return {
    seed,
    u,
    inputs,
    weights,
    pick: picked.into,
    branch: picked.branch,
    aimedMisses: weights.filter((w) => w.aimed && w.into !== picked.into).map((w) => w.into),
  };
}
