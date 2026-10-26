import type { MyBuilding } from '@heartpatch/shared';
import { needChips, type NeedChip } from '../home/home-view.js';

// The "Fix it" offer on a knocked building's card (#621 W1-9). A storm
// "knocks a building about"; you "fix it". Nothing here says damage or destroy.

export const FIX_TEXT = {
  fixIt: 'Fix it',
  knocked: (name: string): string => `A storm knocked your ${name} about. It's taking a rest.`,
  youNeed: 'Fixing it takes',
  fixed: (name: string, buildingId: string): string =>
    /fish|pier|dock/.test(buildingId)
      ? 'All fixed! Back to fishing 🐟'
      : `All fixed! Your ${name} is working again ✨`,
} as const;

export interface RepairOffer {
  readonly needs: NeedChip[];
  readonly affordable: boolean;
}

/** What fixing a knocked building asks and whether the bag has it; null when it isn't knocked. */
export function repairOffer(
  items: Readonly<Record<string, number>>,
  b: Pick<MyBuilding, 'knocked' | 'repairCost'>,
): RepairOffer | null {
  if (b.knocked !== true || !b.repairCost) return null;
  const needs = needChips(items, b.repairCost);
  return { needs, affordable: needs.every((n) => n.ok) };
}
