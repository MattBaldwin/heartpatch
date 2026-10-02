import type { BattleAiPolicy } from '../schemas/data/battle.js';
import { DefenseStanceSchema, type DefenseStance, type RaidRules } from '../schemas/data/raids.js';

/**
 * Offline defense (design doc §6, issue #16). Each stance plays with the
 * engine's AI policy of the same name (`BATTLE_RULES.ai`). Checked by
 * `checkRaidRules` in tests.
 */
export const RAID_RULES: RaidRules = {
  stancePolicies: { aggressive: 'aggressive', defensive: 'defensive', balanced: 'balanced' },
  defaultStance: 'balanced', // design doc §6 / issue #16: balanced until the player picks
  reportLimit: 20, // TUNE: guess; a few days of challenges on a busy patch
};

/** The AI policy a defender's squishies on watch play with. */
export function stancePolicy(
  stance: DefenseStance,
  rules: Pick<RaidRules, 'stancePolicies'> = RAID_RULES,
): BattleAiPolicy {
  return rules.stancePolicies[stance];
}

/** The stance a defending side played with, from its stored policy; null for guardians. */
export function stanceOfPolicy(
  policy: BattleAiPolicy,
  rules: Pick<RaidRules, 'stancePolicies'> = RAID_RULES,
): DefenseStance | null {
  return (
    DefenseStanceSchema.options.find((stance) => rules.stancePolicies[stance] === policy) ?? null
  );
}
