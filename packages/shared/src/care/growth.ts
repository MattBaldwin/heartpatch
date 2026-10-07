import type { GrowthRules } from '../schemas/data/care.js';
import type { ElementId, FeelingId } from '../schemas/data/elements.js';

// XP, levels and evolution (design doc §7–8). XP gained = battle XP × care
// multiplier × habitat multiplier, floor 1.0×, cap 3×. Multipliers are whole
// percents and every step floors, so the maths is integers only and the same
// on every engine (DECISIONS "Battle engine (#11)").

/** A habitat's tags (`HabitatBuilding.tags`). */
export interface HabitatTags {
  readonly elements: readonly ElementId[];
  readonly feelings: readonly FeelingId[];
}

/** Care multiplier, as a percent: 100 at no contentment, rising to `care.maxPercent` when full. */
export function carePercent(
  contentment: number,
  rules: Pick<GrowthRules, 'care'>,
  maxContentment = 100,
): number {
  const { minPercent, maxPercent } = rules.care;
  const c = Math.max(0, Math.min(maxContentment, contentment));
  return minPercent + Math.floor(((maxPercent - minPercent) * c) / maxContentment);
}

/**
 * Habitat multiplier, as a percent: the squishy's habitat matches its element
 * or its feeling (`onePercent`), both (`bothPercent`), or neither / no
 * habitat (100).
 */
export function habitatPercent(
  habitat: HabitatTags | null,
  squishy: { readonly element: ElementId; readonly feeling: FeelingId },
  rules: Pick<GrowthRules, 'habitat'>,
): number {
  if (!habitat) return 100;
  const matches =
    (habitat.elements.includes(squishy.element) ? 1 : 0) +
    (habitat.feelings.includes(squishy.feeling) ? 1 : 0);
  if (matches === 2) return rules.habitat.bothPercent;
  if (matches === 1) return rules.habitat.onePercent;
  return 100;
}

/**
 * The whole XP multiplier, as a percent (150 = 1.5×): care × habitat, never
 * below 100 (neglect costs nothing, design doc §7) nor above `capPercent`.
 */
export function xpMultiplier(
  contentment: number,
  habitat: HabitatTags | null,
  squishy: { readonly element: ElementId; readonly feeling: FeelingId },
  rules: Pick<GrowthRules, 'care' | 'habitat' | 'capPercent'>,
): number {
  const combined = Math.floor(
    (carePercent(contentment, rules) * habitatPercent(habitat, squishy, rules)) / 100,
  );
  return Math.max(100, Math.min(rules.capPercent, combined));
}

/** XP a squishy actually gets from `baseXp` battle XP at `multiplier` percent. */
export function grantedXp(baseXp: number, multiplier: number): number {
  return Math.floor((Math.max(0, baseXp) * multiplier) / 100);
}

/**
 * Total XP a squishy needs to be `level` (level 1 is 0). Past each of the
 * curve's knees, every level also costs `steep × (L − knee)²` more in total.
 */
export function xpForLevel(
  level: number,
  rules: Pick<GrowthRules, 'xpCurve' | 'maxLevel'>,
): number {
  const { perLevel, curve, knees = [] } = rules.xpCurve;
  const capped = Math.min(level, rules.maxLevel);
  const steps = Math.max(0, capped - 1);
  let xp = perLevel * steps + curve * steps * steps;
  for (const knee of knees) {
    const past = Math.max(0, capped - knee.level);
    xp += knee.steep * past * past;
  }
  return xp;
}

/** The level `xp` total XP reaches, up to `maxLevel`. */
export function levelForXp(xp: number, rules: Pick<GrowthRules, 'xpCurve' | 'maxLevel'>): number {
  let level = 1;
  while (level < rules.maxLevel && xp >= xpForLevel(level + 1, rules)) level += 1;
  return level;
}

/** A squishy's level and total XP (`squishies.level`, `squishies.xp`). */
export interface LevelState {
  readonly level: number;
  readonly xp: number;
}

/**
 * Adds `gained` XP. A squishy that joined above level 1 (a befriended one
 * keeps its battle level) starts counting from that level's XP, so nobody
 * ever goes down a level and the next one is the usual distance away.
 */
export function addXp(
  state: LevelState,
  gained: number,
  rules: Pick<GrowthRules, 'xpCurve' | 'maxLevel'>,
): LevelState {
  const xp = Math.max(state.xp, xpForLevel(state.level, rules)) + Math.max(0, gained);
  return { xp, level: Math.max(state.level, levelForXp(xp, rules)) };
}

/** How far into its level a squishy is, for the XP bar. `toNext` is null at the top level. */
export function xpProgress(
  state: LevelState,
  rules: Pick<GrowthRules, 'xpCurve' | 'maxLevel'>,
): { intoLevel: number; toNext: number | null } {
  const start = xpForLevel(state.level, rules);
  const into = Math.max(0, state.xp - start);
  if (state.level >= rules.maxLevel) return { intoLevel: into, toNext: null };
  return { intoLevel: into, toNext: xpForLevel(state.level + 1, rules) - start };
}

/** One evolution: public (`Species.evolutions`) or secret (`SecretEvolution`). */
export interface EvolutionStep {
  readonly from: string;
  readonly into: string;
  readonly level: number;
}

/**
 * Phase 1 evolution (design doc §8): the single next form a species reaches
 * at `level`, or null. Of the steps from it whose level it has reached, the
 * lowest level wins, then the first listed (callers list public steps before
 * secret ones). Branch weights and rare conditions arrive in Phase 2.
 */
export function evolutionAt(
  speciesId: string,
  level: number,
  steps: readonly EvolutionStep[],
): EvolutionStep | null {
  let best: EvolutionStep | null = null;
  for (const step of steps) {
    if (step.from !== speciesId || step.level > level) continue;
    if (!best || step.level < best.level) best = step;
  }
  return best;
}

/**
 * The level a befriended squishy joins at: its battle level, but at most
 * `befriendBelowEvolution` below its species' first evolution (the lowest
 * level in `steps` from it). A species that never evolves keeps its level.
 */
export function befriendedLevel(
  speciesId: string,
  battleLevel: number,
  steps: readonly EvolutionStep[],
  rules: Pick<GrowthRules, 'befriendBelowEvolution'>,
): number {
  const below = rules.befriendBelowEvolution;
  if (below === undefined) return battleLevel;
  let first: number | null = null;
  for (const step of steps) {
    if (step.from === speciesId && (first === null || step.level < first)) first = step.level;
  }
  if (first === null) return battleLevel;
  return Math.max(1, Math.min(battleLevel, first - below));
}

/**
 * The share (%) of a battle's XP a squishy gets, given how many battles it
 * has already won today (this one not counted): full until it has won
 * `fullWinsPerDay`, then `afterPercent`.
 */
export function battleXpPercent(
  winsToday: number,
  rules: Pick<GrowthRules, 'battleXpFalloff'>,
): number {
  const falloff = rules.battleXpFalloff;
  if (!falloff || winsToday < falloff.fullWinsPerDay) return 100;
  return falloff.afterPercent;
}

/** How far a squishy is toward its next evolution (#205), for the evolving meter. */
export interface EvolvingMeter {
  /** 0–100, floored. 100: past the level, it evolves on its next XP. */
  readonly percent: number;
  /** Levels until the evolution level (0 once it's reached). */
  readonly levelsToGo: number;
}

/**
 * Progress toward the evolution `evolutionAt` would pick next: XP since the
 * form's own start over the XP to the evolution level. The start is the
 * level it joined at (a befriended squishy keeps its battle level), or the
 * level its species is evolved into at, whichever is later; a base form a
 * player raised from the start joins at level 1.
 *
 * Null when there's no next evolution (a top form) or when the next one is
 * into a form `isPublic` says is secret: a meter would give away that a
 * secret form exists and when (CLAUDE.md rule 6). Callers pass every step,
 * secret ones included, so a secret step that comes first hides the meter.
 */
export function evolvingMeter(
  squishy: {
    readonly speciesId: string;
    readonly level: number;
    readonly xp: number;
    /** The level it joined at; null for squishies from before it was kept (#205): its level now. */
    readonly joinedLevel: number | null;
  },
  steps: readonly EvolutionStep[],
  isPublic: (speciesId: string) => boolean,
  rules: Pick<GrowthRules, 'xpCurve' | 'maxLevel'>,
): EvolvingMeter | null {
  let next: EvolutionStep | null = null;
  let evolvedAt = 1;
  for (const step of steps) {
    if (step.from === squishy.speciesId && (!next || step.level < next.level)) next = step;
    if (step.into === squishy.speciesId) evolvedAt = Math.max(evolvedAt, step.level);
  }
  if (!next || !isPublic(next.into)) return null;
  const start = Math.max(1, squishy.joinedLevel ?? squishy.level, evolvedAt);
  const levelsToGo = Math.max(0, next.level - squishy.level);
  const from = xpForLevel(start, rules);
  const span = xpForLevel(next.level, rules) - from;
  const xp = Math.max(squishy.xp, xpForLevel(squishy.level, rules));
  if (span <= 0 || levelsToGo === 0) return { percent: 100, levelsToGo };
  const percent = Math.floor(((xp - from) * 100) / span);
  return { percent: Math.max(0, Math.min(100, percent)), levelsToGo };
}
