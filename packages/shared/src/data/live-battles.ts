import type { LiveBattleRules } from '../schemas/data/live-battles.js';

/** Live battles (#29). Checked by `LiveBattleRulesSchema` in tests. */
export const LIVE_BATTLE_RULES: LiveBattleRules = {
  turnSeconds: 30, // TUNE: long enough for a 10-year-old to read four moves
  awayGraceSeconds: 60, // TUNE: a phone call or a quick switch to another app
  coverPolicy: 'balanced', // TUNE: a defender's own defense style covers them instead (#29-C)
  defensePromptSeconds: 20, // TUNE: time to notice the prompt and tap "Defend!"
  liveDefenseItems: false, // TUNE: no potions in a live defense until the owner confirms
};
