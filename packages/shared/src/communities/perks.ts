import type { Hex } from '../hex/index.js';
import type { SafeFire } from '../home/safe-tiles.js';
import type {
  CommunityKind,
  CommunityKindId,
  CommunityRules,
} from '../schemas/data/communities.js';

// Village perks (#306 PR 3b, plan Q4): each won village's kind does one fixed
// thing for its winner, read from `COMMUNITY_RULES.kinds[].effect`. The server
// applies them; the client reads the same functions to show them, so the two
// never disagree.

/** A village as the perks need it: its kind, its winner (null while Hollowed) and its square. */
export interface PerkVillage {
  readonly kind: CommunityKindId;
  readonly ownerUserId: string | null;
  readonly square: Hex;
}

/** A kind's data. Throws for a kind the rules don't list (the schema makes that impossible). */
export function villageKind(
  kind: CommunityKindId,
  rules: Pick<CommunityRules, 'kinds'>,
): CommunityKind {
  const found = rules.kinds.find((k) => k.id === kind);
  if (!found) throw new Error(`unknown village kind ${kind}`);
  return found;
}

/**
 * The night light of every won village whose perk is a light (the Lantern
 * Tower), as fires for `safeTiles`: lit every night, no fuel, for everyone's
 * squishies standing there.
 */
export function villageLights(
  villages: readonly PerkVillage[],
  rules: Pick<CommunityRules, 'kinds'>,
): SafeFire[] {
  return villages.flatMap((v) => {
    const { effect } = villageKind(v.kind, rules);
    return v.ownerUserId !== null && effect.type === 'light'
      ? [{ at: v.square, radius: effect.radius }]
      : [];
  });
}

/** The extra Crafting Factory batches `userId`'s won villages give them (the Workshop). */
export function extraFactoryBatches(
  villages: readonly PerkVillage[],
  userId: string,
  rules: Pick<CommunityRules, 'kinds'>,
): number {
  let extra = 0;
  for (const v of villages) {
    if (v.ownerUserId !== userId) continue;
    const { effect } = villageKind(v.kind, rules);
    if (effect.type === 'factory-batches') extra += effect.extra;
  }
  return extra;
}

/**
 * How many levels the Watchtowers `userId` won add to their guard level floor
 * (#529) on their land: their guards, or the guardians standing in, fight at
 * least this much higher.
 */
export function extraGuardLevels(
  villages: readonly PerkVillage[],
  userId: string,
  rules: Pick<CommunityRules, 'kinds'>,
): number {
  let extra = 0;
  for (const v of villages) {
    if (v.ownerUserId !== userId) continue;
    const { effect } = villageKind(v.kind, rules);
    if (effect.type === 'guard-levels') extra += effect.levels;
  }
  return extra;
}

/** What a village of this kind gives its winner each morning (the Old Well, the Bakery), or null. */
export function morningGiftOf(
  kind: CommunityKindId,
  rules: Pick<CommunityRules, 'kinds'>,
): Record<string, number> | null {
  const { effect } = villageKind(kind, rules);
  return effect.type === 'morning-gift' ? effect.items : null;
}
