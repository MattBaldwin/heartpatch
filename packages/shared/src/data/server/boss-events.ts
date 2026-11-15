import type { BossEventRules } from '../../schemas/data/boss-events.js';

/**
 * When, where and who a mini-boss visits (#190 plan §2). Secret (CLAUDE.md
 * rule 6). The bag is empty until the boss content lands (#234), so no
 * boss visits in production and nothing half-made shows (#735).
 */
export const BOSS_EVENTS: BossEventRules = {
  windowHours: 48, // TUNE: out for two days (owner decision 2026-11-15)
  opensAtHour: 16, // TUNE: after school, patch time
  minPartnerLevel: 18, // TUNE: no visits until some member's Partner is this grown
  minPlayerLevel: 12, // TUNE: under this, "Too big for now!"
  levelBonus: 2, // TUNE: a couple of levels above the Keeper's Partner
  minLevel: 15, // TUNE: so an early visit still feels BIG
  triesPerDay: 3, // TUNE: a loss costs nothing; the boss stays
  bag: [],
  // TUNE: a win's sure bundle; 3 Heart Charms is one befriend ask (190c).
  bundle: { 'heart-charm': 3, heartdust: 5, treats: 3 },
};
