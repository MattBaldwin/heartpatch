import { describe, expect, it } from 'vitest';
import { BATTLE_RULES } from '../data/battle.js';
import { GROWTH_RULES } from '../data/care.js';
import { SPAWN_RULES } from '../data/server/spawn-rules.js';
import { SPECIES } from '../data/species.js';
import { STARTERS } from '../data/starters.js';
import { addXp, grantedXp } from './growth.js';

// How fast a squishy grows up (coordinator tuning, 2026-10-04): a player's
// starter, picked at level 1, should first evolve after about 12–15 wild wins
// at 1× care and about 5–6 at the care × habitat cap, with rarer forms
// proportionally slower. Pins `BATTLE_RULES.xp` against `GROWTH_RULES.xpCurve`
// and the evolution levels, so a change to any of them shows up here.

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

  it('grows a starter up after 5–6 wild wins at the care × habitat cap', () => {
    for (const id of STARTERS.speciesIds) {
      expect(winsToReach(evolvesAt(id), GROWTH_RULES.capPercent)).toBeLessThanOrEqual(6);
    }
  });

  it('keeps rarer evolutions proportionally slower', () => {
    const at = (level: number) => winsToReach(level, 100);
    // Evolution levels by rarity (species.ts): common 16 … legendary 30.
    expect(at(16)).toBeLessThan(at(18));
    expect(at(22)).toBeGreaterThan(at(16) * 1.6);
    expect(at(30)).toBeGreaterThan(at(16) * 3);
  });
});
