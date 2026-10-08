import { Rng, type Seed } from '../rng/index.js';
import type { BattleSquishySetup } from '../schemas/battle.js';
import type { JourneyRules } from '../schemas/data/journeys.js';

// Journeys to trading posts (#270, owner decisions 2 and 3 on #30). Pure: the
// server builds the trail team with these, and the client's journey preview
// shows the same level and team size.

/**
 * The trail squishies' level for a journey of `distance` tiles: absolute, not
 * the Partner's (so a far post gets easier as the team grows) and uncapped
 * (decision 3) up to the game's `maxLevel`.
 */
export function journeyLevel(distance: number, rules: JourneyRules, maxLevel: number): number {
  return Math.min(maxLevel, rules.baseLevel + rules.levelsPerTile * Math.max(1, distance));
}

/** How many trail squishies a journey of `distance` tiles meets. */
export function journeyTeamSize(distance: number, rules: JourneyRules): number {
  let size = 1;
  for (const row of rules.teamSize) if (row.fromDistance <= distance) size = row.size;
  return size;
}

/** A journey's size and level, as the preview and `MapView.posts[]` show them. */
export interface JourneyOdds {
  readonly level: number;
  readonly teamSize: number;
}

export function journeyFor(distance: number, rules: JourneyRules, maxLevel: number): JourneyOdds {
  return {
    level: journeyLevel(distance, rules, maxLevel),
    teamSize: journeyTeamSize(distance, rules),
  };
}

/**
 * A journey's trail team (ids `trail-1`, …), picked from `rules.trail` with a
 * seed the server fixes per post, player and window (tech spec §8 "No
 * rerolls": `deriveSeed(mapSeed, 'journey', q, r, userId, windowId)`), so a
 * retry meets the same team. Each squishy has its species' own element and feeling.
 */
export function journeyTeam(
  input: { readonly seed: Seed; readonly distance: number },
  rules: JourneyRules,
  maxLevel: number,
): BattleSquishySetup[] {
  const rng = Rng.fromSeed(input.seed);
  const { level, teamSize } = journeyFor(input.distance, rules, maxLevel);
  return Array.from({ length: teamSize }, (_, i) => ({
    id: `trail-${String(i + 1)}`,
    speciesId: rng.pick(rules.trail),
    level,
  }));
}

/** Is a visit pass still good at `now`? Worked out on read (CLAUDE.md rule 4). */
export function visitOpen(visitUntil: Date | string | null | undefined, now: Date): boolean {
  if (visitUntil === null || visitUntil === undefined) return false;
  return new Date(visitUntil).getTime() > now.getTime();
}
