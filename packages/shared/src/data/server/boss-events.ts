import type { BossEventRules } from '../../schemas/data/boss-events.js';

/**
 * When, where and who a mini-boss visits (#190 plan §2). Secret (CLAUDE.md
 * rule 6). The bag holds the four boss forms (#234); production stays dark
 * until the server's mini-boss switch opens it (#234 plan, `HP_MINI_BOSSES`).
 */
export const BOSS_EVENTS: BossEventRules = {
  windowHours: 48, // TUNE: out for two days (owner decision 2026-11-15)
  opensAtHour: 16, // TUNE: after school, patch time
  minPartnerLevel: 18, // TUNE: no visits until some member's Partner is this grown
  minPlayerLevel: 12, // TUNE: under this, "Too big for now!"
  levelBonus: 2, // TUNE: a couple of levels above the Keeper's Partner
  minLevel: 15, // TUNE: so an early visit still feels BIG
  triesPerDay: 3, // TUNE: a loss costs nothing; the boss stays
  idleMinutes: 10, // TUNE: plan §12, "ten minutes with no action is a leave"
  // Each boss visits once before any repeats (`bossVisitFor`); its tile
  // prefers a terrain it likes (`// TUNE:` all four lists).
  bag: [
    { speciesId: 'rakelet', terrains: ['forest', 'pumpkin-fields', 'old-forest'] }, // TUNE:
    { speciesId: 'mommentum', terrains: ['hills', 'meadow'] }, // TUNE:
    { speciesId: 'papa-brrr', terrains: ['mountains', 'hills'] }, // TUNE:
    { speciesId: 'rickeyride', terrains: ['meadow', 'clearing'] }, // TUNE:
  ],
  // TUNE: a win's sure bundle; 3 Heart Charms is one befriend ask (190c).
  bundle: { 'heart-charm': 3, heartdust: 5, treats: 3 },
  // Owner decision 2026-11-15 (#190 open questions 3 and 4).
  befriend: {
    charmsPerAsk: 3, // TUNE: one ask
    asksPerWin: 2, // TUNE: then it stomps off until next visit
    askHours: 24, // TUNE: plan §12, asks stay open a day after the win
    basePercent: 20, // TUNE
    perStandingPercent: 5, // TUNE: per squishy of yours still standing
    perMissPercent: 15, // TUNE: warmth per earlier "not yet" from this boss kind
    sureAfterMisses: 4, // TUNE: so the 5th ask always works
    joinLevelPercent: 50, // TUNE: half the Partner's level…
    minJoinLevel: 5, // TUNE: …at least 5
  },
  // Christmas Eve (#37 C0b; addendum on #37, owner answers 2026-11-27).
  // X1 schedules it, X2 runs the bar, X3 adds the species: Snowbundle, the
  // Christmas-only frost BIG squishy (owner answer 1), never in `bag`.
  christmasEve: {
    speciesId: 'snowbundle',
    terrains: ['meadow', 'hills', 'mountains'], // TUNE: fallback when the tree's post can't be used
    day: '12-24', // TUNE: Christmas Eve, patch time
    noticeDays: 3, // TUNE: the notice from Dec 21, like "Long Night in 3 days"
    opensAtHour: 16, // TUNE: after school, like the weekly visit
    closesAtHour: 10, // TUNE: 10:00 on Dec 25, a Christmas-morning catch-up (owner answer 2)
    // Owner answer 3: every Keeper can chip in, with the usual level scaling.
    gates: {
      minPlayerLevel: 5, // TUNE: so a little sibling can fight
      minPartnerLevel: null, // TUNE: no patch gate on Christmas Eve
      levelBonus: 2, // TUNE: the weekly scaling
      minLevel: 10, // TUNE: the sim must still pass at this floor (X3)
    },
    // Owner answer 2: one fight finished before the close, win or lose.
    contributorMinFights: 1, // TUNE
    bar: {
      pointsPerWin: 100, // TUNE: one full win is 100 however strong the boss
      // TUNE: kept by `pnpm sim:boss --patch` (X3): a Keeper chips ~75 a
      // fight, ~226 over an evening's 3 tries (Christmas morning gives 3
      // more), so about half the patch using its evening tries, or a quarter
      // using every try, fills it: a cozy night where it usually falls.
      goalPerKeeper: 120,
      minGoal: 200, // TUNE
      maxGoal: 1200, // TUNE
      headStartPerLightPercent: 2, // TUNE: per lit Twinkle Lights tile…
      headStartLightsMaxPercent: 20, // TUNE: …at most 20 % from lights…
      headStartStarPercent: 10, // TUNE: …plus 10 % for a lit star
    },
    // TUNE: the fall's Christmas bundle; 6 Heart Charms pays its two asks.
    fallBundle: { 'heart-charm': 6, heartdust: 10, presents: 1 },
    fallAsks: 2, // TUNE: owner answer 2, "two befriend asks"
    // TUNE: owner answer 4, a smaller thanks and no asks.
    dozedBundle: { heartdust: 5, treats: 3 },
  },
};
