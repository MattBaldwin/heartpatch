import { describe, expect, it } from 'vitest';
import { BATTLE_RULES } from '../data/battle.js';
import { GROWTH_RULES } from '../data/care.js';
import { SPAWN_RULES } from '../data/server/spawn-rules.js';
import { SPECIES } from '../data/species.js';
import { STARTERS } from '../data/starters.js';
import { addXp, grantedXp, xpForLevel } from './growth.js';

// How fast a squishy grows up (owner decisions 2026-10-06, design review Q1
// and Q2). Wild squishies match the Partner's level (spawn rules
// `partnerOffset`), so a win pays about 30 × its level, and the curve does
// the pacing: a starter grows up after about 22 wild wins at 1× care, and
// past the knees at 16 and 30 each level takes more wins than the last.
// Pins `BATTLE_RULES.xp` and `SPAWN_RULES.partnerOffset` against
// `GROWTH_RULES.xpCurve` and the evolution levels, so a change to any of
// them shows up here. `pnpm sim:progression` turns this into days.

const OFFSET = SPAWN_RULES.partnerOffset ?? { min: 0, max: 0 };

/** Base XP for beating one wild squishy (the battle engine's `xpAwards`). */
function wildWinXp(level: number): number {
  const { perOpponentLevel, winMultiplier, minimum } = BATTLE_RULES.xp;
  return Math.max(minimum, Math.floor(perOpponentLevel * level * winMultiplier));
}

/** The wild squishy a Partner at `level` meets on its `win`-th win: offsets in turn. */
function wildLevel(partner: number, win: number): number {
  const span = OFFSET.max - OFFSET.min + 1;
  return Math.max(SPAWN_RULES.levels.min, partner + OFFSET.min + (win % span));
}

/** Wild wins a squishy at level `from` needs to reach `level` at `multiplier` percent. */
function winsToReach(level: number, multiplier: number, from = 1): number {
  let state = { level: from, xp: xpForLevel(from, GROWTH_RULES) };
  let wins = 0;
  while (state.level < level) {
    const xp = grantedXp(wildWinXp(wildLevel(state.level, wins)), multiplier);
    state = addXp(state, xp, GROWTH_RULES);
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
  it('matches wild squishies to the Partner: −2 to +1 levels', () => {
    expect(OFFSET).toEqual({ min: -2, max: 1 });
  });

  it('grows a level-1 starter up after 22–29 wild wins at 1× care', () => {
    const wins = Object.fromEntries(
      STARTERS.speciesIds.map((id) => [id, winsToReach(evolvesAt(id), 100)]),
    );
    expect(wins).toEqual({ emberbun: 22, puddlepuff: 22, thistlepip: 29 });
  });

  it('grows a starter up faster with care: 13–17 wins at full care, 8–11 at the cap', () => {
    const wins = (percent: number) =>
      Object.fromEntries(
        STARTERS.speciesIds.map((id) => [id, winsToReach(evolvesAt(id), percent)]),
      );
    expect(wins(GROWTH_RULES.care.maxPercent)).toEqual({
      emberbun: 13,
      puddlepuff: 13,
      thistlepip: 17,
    });
    expect(wins(GROWTH_RULES.capPercent)).toEqual({ emberbun: 8, puddlepuff: 8, thistlepip: 11 });
  });

  it('makes each level past the knees take more wins than the last (at 2×)', () => {
    const perLevel = [16, 20, 25, 30, 40, 60, 80, 99].map((from) =>
      winsToReach(from + 1, 200, from),
    );
    expect(perLevel).toEqual([2, 5, 8, 10, 25, 39, 46, 51]);
  });
});
