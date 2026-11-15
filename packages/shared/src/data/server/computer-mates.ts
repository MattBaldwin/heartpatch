import type { ComputerMatesSecrets } from '../../schemas/data/computer-mates.js';

/**
 * How computer patch-mates play (#386, plan §3). Server-only (CLAUDE.md
 * rule 6): kids see names, never the pacing. Every number is a guess.
 */
export const COMPUTER_MATES: ComputerMatesSecrets = {
  rules: {
    fillTo: 4, // TUNE: owner decision 4 (a solo kid gets 3 mates, two kids get 2)
    toggleCooldownHours: 24, // TUNE: so the switch can't reset per-pair caps
    warmMinutes: 30, // TUNE
    catchUpSteps: 4, // TUNE
    stepMinutes: { min: 20, max: 60 }, // TUNE: seeded jitter between a mate's steps
    landCapPercent: 60, // TUNE: of a fair share (claimable tiles ÷ seats)
    kidHomeBuffer: 2, // TUNE
    minKidTiles: 6, // TUNE
    fireEveryTiles: 6, // TUNE
    guardedTiles: 2, // TUNE
    completedPerPatchDay: 3, // TUNE
    giftsPerPatchWeek: 2, // TUNE
    giftMaxValue: 6, // TUNE: about one gather cycle of a common resource
    minFairPercent: 85, // TUNE
    offerValue: { min: 12, max: 32 }, // TUNE: 386d, a few stacks of everyday goodies
    shelfPerItem: 10, // TUNE: 386d, made at the answer (mates have no bag)
    challengesPerPatchWeek: { on: 4, gentle: 2, off: 0 }, // TUNE: owner decision 2
    quietHours: { from: 21, to: 7 }, // TUNE: patch time
    teamSize: { min: 3, max: 4 }, // TUNE
  },
  personas: [
    // TUNE: every persona number.
    {
      id: 'bramble',
      claimsPerDay: 2,
      levelOffset: -1,
      stance: 'balanced',
      answerMinutes: 10,
      offersPerWeek: 1,
      weights: { claim: 4, trade: 2, gift: 1, guard: 2, challenge: 1 },
    },
    {
      id: 'marigold',
      claimsPerDay: 1,
      levelOffset: -2,
      stance: 'balanced',
      answerMinutes: 5,
      offersPerWeek: 2,
      weights: { claim: 2, trade: 4, gift: 2, guard: 1, challenge: 1 },
    },
    {
      id: 'pocket',
      claimsPerDay: 2,
      levelOffset: -3,
      stance: 'aggressive',
      answerMinutes: 15,
      offersPerWeek: 1,
      weights: { claim: 4, trade: 1, gift: 2, guard: 1, challenge: 2 },
    },
    {
      id: 'thistle',
      claimsPerDay: 1,
      levelOffset: -1,
      stance: 'defensive',
      answerMinutes: 30,
      offersPerWeek: 1,
      weights: { claim: 2, trade: 1, gift: 1, guard: 4, challenge: 1 },
    },
    {
      id: 'wren',
      claimsPerDay: 1,
      levelOffset: -2,
      stance: 'balanced',
      answerMinutes: 20,
      offersPerWeek: 2,
      weights: { claim: 3, trade: 3, gift: 3, guard: 1, challenge: 0 },
    },
    {
      id: 'fennel',
      claimsPerDay: 2,
      levelOffset: -2,
      stance: 'defensive',
      answerMinutes: 10,
      offersPerWeek: 1,
      weights: { claim: 3, trade: 2, gift: 1, guard: 3, challenge: 1 },
    },
  ],
};
