import type { BattleRules } from '../schemas/data/battle.js';

/** Battle tunables (design doc §6–7). Checked by `checkBattleRules` in tests. */
export const BATTLE_RULES: BattleRules = {
  teamSize: 3, // TUNE: design doc §6 [DEFAULT: 3]
  maxTurns: 50, // TUNE: long enough to finish, short enough for a phone session

  // TUNE: stats land near a classic monster-battler curve (a 50 base stat
  // is 15 at level 10 and 55 at level 50).
  stats: { levelDivisor: 50, flat: 5, hpPerLevel: 1, hpFlat: 10 },

  damage: {
    // TUNE: two equal level-10 squishies take ~5 hits of a 40-power move.
    levelDivisor: 2.5,
    levelOffset: 2,
    powerDivisor: 50,
    flat: 2,
    minimum: 1,
    varianceMin: 0.9, // TUNE: design doc §6 random(0.9–1.1)
    varianceMax: 1.1, // TUNE: design doc §6 random(0.9–1.1)
  },

  statStages: { maxStages: 4, perStage: 0.5 }, // TUNE:

  status: {
    // TUNE: dizzy squishies wobble and sometimes miss their turn.
    dizzy: { minTurns: 2, maxTurns: 4, skipChance: 33, clearsOnSwap: true },
    // TUNE: sleepy squishies nap through their turns, then wake up.
    sleepy: { minTurns: 1, maxTurns: 3, skipChance: 100, clearsOnSwap: false },
  },

  // TUNE: thresholds on element × feeling (0.4× to 2.5× with the current matrices).
  effectiveness: [
    { id: 'super', atLeast: 1.5, line: 'Super cozy!' },
    { id: 'good', atLeast: 1.2, line: 'Ooh, nice one!' },
    { id: 'normal', atLeast: 0.85 },
    { id: 'weak', atLeast: 0, line: 'Just a little boop.' },
  ],

  // TUNE: a fresh squishy is a long shot; a nearly tuckered-out one almost
  // always says yes. Rarer squishies are shyer.
  capture: {
    atFull: 15,
    nearlyOut: 90,
    rarity: {
      common: 100,
      uncommon: 85,
      rare: 70,
      epic: 55,
      legendary: 40,
      mythic: 30,
      secret: 40,
    },
  },

  // TUNE: a win pays 20 × the opponents' levels × 1.5 (×1 on a loss). How
  // fast that grows a squishy is pinned by `growth-pace.test.ts` (server
  // side, with the spawn rules) and `pnpm sim:progression`.
  xp: { perOpponentLevel: 20, winMultiplier: 1.5, minimum: 20 },

  // TUNE: every policy. Wild squishies play for fun; guardians and the
  // Bold (aggressive) stance play to win; Careful (defensive) heals and swaps.
  ai: {
    wild: {
      focus: 1,
      damage: 1,
      heal: 1,
      healBelow: 50,
      boost: 0.15,
      status: 0.3,
      swap: 0,
      swapBelow: 0,
    },
    guardian: {
      focus: 3,
      damage: 1,
      heal: 1.5,
      healBelow: 40,
      boost: 0.15,
      status: 0.4,
      swap: 0.5,
      swapBelow: 30,
    },
    aggressive: {
      focus: 4,
      damage: 1.5,
      heal: 0.5,
      healBelow: 25,
      boost: 0.1,
      status: 0.2,
      swap: 0,
      swapBelow: 0,
    },
    defensive: {
      focus: 3,
      damage: 0.8,
      heal: 2.5,
      healBelow: 60,
      boost: 0.25,
      status: 0.6,
      swap: 1,
      swapBelow: 50,
    },
    balanced: {
      focus: 2,
      damage: 1,
      heal: 1.5,
      healBelow: 45,
      boost: 0.15,
      status: 0.4,
      swap: 0.6,
      swapBelow: 35,
    },
  },

  // TUNE: one of each potion per side per battle (#214).
  items: { usesEach: 1 },

  // Steady and Big moves (#587, owner decision 2026-10-19).
  moveKinds: {
    openPercent: 25, // TUNE: a big move's user takes 25% more from the next hit
    guardPercent: 25, // TUNE: a steady move's user takes 25% less from the next hit
    gentleFloor: 1, // TUNE: a gentle hit leaves a wild squishy a sliver of energy
    // TUNE: Bold leans big, Careful leans steady, wild squishies play for fun.
    ai: {
      wild: { open: 0, guard: 0 },
      guardian: { open: 0.25, guard: 0 },
      aggressive: { open: 0, guard: 0 },
      defensive: { open: 0.5, guard: 0.25 },
      balanced: { open: 0.25, guard: 0 },
    },
    // TUNE: Thundermop's three 65–90 attacks all read Big, leaving it open nearly
    // every turn (32% in `pnpm sim`); Belly Flop as a second Steady brings it back.
    overrides: { thundermop: { 'belly-flop': 'steady' } },
  },
};
