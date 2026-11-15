import { BOSS_WARMTH_STEPS } from '../schemas/battle.js';
import type { BossBefriendRules } from '../schemas/data/boss-events.js';
import type { EvolutionStep } from '../care/growth.js';
import { deriveSeed, Rng, type Seed } from '../rng/index.js';

/**
 * The chance (%) a boss says yes to one ask (#190 plan §3): the base, plus a
 * share per squishy of yours still standing at the win, plus warmth per
 * earlier "not yet" from this boss kind; the ask after `sureAfterMisses`
 * misses always works. Server-only (CLAUDE.md rule 6).
 */
export function bossBefriendChance(
  rules: BossBefriendRules,
  standing: number,
  misses: number,
): number {
  if (misses >= rules.sureAfterMisses) return 100;
  const chance =
    rules.basePercent + rules.perStandingPercent * standing + rules.perMissPercent * misses;
  return Math.max(0, Math.min(100, chance));
}

/**
 * How warm a boss kind is to this Keeper, as a coarse step from 0 to
 * `BOSS_WARMTH_STEPS` (#190 ruling on PR #827): the hearts the "not yet" card
 * lights, carried across visits. Never the misses or the odds themselves: the
 * misses are scaled onto the steps, the first miss lights a heart, and
 * the top step means the next ask always works whatever `sureAfterMisses` is.
 */
export function bossWarmthStep(rules: BossBefriendRules, misses: number): number {
  if (misses <= 0) return 0;
  if (misses >= rules.sureAfterMisses) return BOSS_WARMTH_STEPS;
  // Any miss lights a heart; the last heart waits for the sure ask.
  const step = Math.ceil((misses / rules.sureAfterMisses) * BOSS_WARMTH_STEPS);
  return Math.min(BOSS_WARMTH_STEPS - 1, step);
}

/**
 * One ask's roll, 1–100 (a yes when it's at most the chance): seeded by the
 * battle, the ask number and the patch's seed. The battle's seed alone is
 * sent to the client once the fight ends (tech spec §8), so it would let a
 * kid see each ask's roll coming; the patch seed never leaves the server.
 */
export function bossBefriendRoll(battleSeed: Seed, patchSeed: Seed, ask: number): number {
  return Rng.fromSeed(deriveSeed(battleSeed, 'boss-befriend', ask, patchSeed)).int(1, 100);
}

/** The base form of a species' line: back through every evolution into it (#234). */
export function baseFormOf(speciesId: string, steps: readonly EvolutionStep[]): string {
  let at = speciesId;
  const seen = new Set([at]);
  for (;;) {
    const from = steps.find((step) => step.into === at)?.from;
    if (from === undefined || seen.has(from)) return at;
    seen.add(from);
    at = from;
  }
}

/** The level a befriended boss joins at, before `befriendedLevel` holds it below its first evolution. */
export function bossJoinLevel(rules: BossBefriendRules, partnerLevel: number): number {
  return Math.max(rules.minJoinLevel, Math.floor((partnerLevel * rules.joinLevelPercent) / 100));
}
