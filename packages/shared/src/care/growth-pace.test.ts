import { describe, expect, it } from 'vitest';
import { BATTLE_RULES } from '../data/battle.js';
import { GROWTH_RULES } from '../data/care.js';
import { SPAWN_RULES } from '../data/server/spawn-rules.js';
import { SPECIES } from '../data/species.js';
import { STARTERS } from '../data/starters.js';
import { addXp, grantedXp } from './growth.js';

// How fast a squishy grows up (coordinator tuning, 2026-10-04): a player's
// starter, picked at level 1, first evolves after about 12–15 wild wins at 1×
// care, with rarer forms proportionally slower. XP is linear in the care ×
// habitat multiplier, so full care (1.75×) gives 7–9 and the 3× cap 4–5.
// Pins `BATTLE_RULES.xp` against `GROWTH_RULES.xpCurve` and the evolution
// levels, so a change to any of them shows up here.

/** A wild opponent of the average spawn level. */
const WILD_LEVEL = (SPAWN_RULES.levels.min + SPAWN_RULES.levels.max) / 2;

/** Base XP for beating one wild squishy (the battle engine's `xpAwards`). */
function wildWinXp(level: number): number {
  const { perOpponentLevel, winMultiplier, minimum } = BATTLE_RULES.xp;
  return Math.max(minimum, Math.floor(perOpponentLevel * level * winMultiplier));
}

/** Wild wins a level-1 squishy needs to reach `level` at `multiplier` percent. */
function winsToReach(level: number, multiplier: number): number {
  let state = { level: 1, xp: 0 };
  let wins = 0;
  while (state.level < level) {
    state = addXp(state, grantedXp(wildWinXp(WILD_LEVEL), multiplier), GROWTH_RULES);
    wins += 1;
  }
  return wins;
}

function evolvesAt(speciesId: string): number {
  const level = SPECIES.find((s) => s.id === speciesId)?.evolutions[0]?.level;
  if (level === undefined) throw new Error(`${speciesId} has no evolution`);
  return level;
}

describe('growth pace', () => {
  it('grows a level-1 starter up after 12–15 wild wins at 1× care', () => {
    const wins = Object.fromEntries(
      STARTERS.speciesIds.map((id) => [id, winsToReach(evolvesAt(id), 100)]),
    );
    expect(wins).toEqual({ emberbun: 12, puddlepuff: 12, thistlepip: 15 });
  });

  it('grows a starter up faster with care: 7–9 wins at full care, 4–5 at the cap', () => {
    const wins = (percent: number) =>
      Object.fromEntries(
        STARTERS.speciesIds.map((id) => [id, winsToReach(evolvesAt(id), percent)]),
      );
    expect(wins(GROWTH_RULES.care.maxPercent)).toEqual({
      emberbun: 7,
      puddlepuff: 7,
      thistlepip: 9,
    });
    expect(wins(GROWTH_RULES.capPercent)).toEqual({ emberbun: 4, puddlepuff: 4, thistlepip: 5 });
  });

  it('keeps rarer evolutions proportionally slower', () => {
    const at = (level: number) => winsToReach(level, 100);
    // Evolution levels by rarity (species.ts): common 16 … legendary 30.
    expect([16, 18, 22, 26, 30].map(at)).toEqual([12, 15, 22, 31, 40]);
  });
});
