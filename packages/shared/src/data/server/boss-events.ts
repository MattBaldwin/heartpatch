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
};
