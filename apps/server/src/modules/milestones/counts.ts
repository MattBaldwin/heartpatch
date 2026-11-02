import { MILESTONE_RULES, type MilestoneRules } from '@heartpatch/shared';
import type { MapContext } from './repo.js';

/**
 * Whether milestones count on this patch (design doc §24, decision F): a
 * multiplayer patch with `minMembers` active members, never the Tutorial
 * Glade. The one rule the consumer, the Rekindled drops and
 * `GET /milestones?mapId=` (`countsHere`) all use, so they can't drift. When
 * members are counted (`mapContext`'s `at`) is the caller's choice.
 */
export const milestonesCount = (
  map: Pick<MapContext, 'kind' | 'members'>,
  rules: Pick<MilestoneRules, 'minMembers'> = MILESTONE_RULES,
): boolean => map.kind === 'multiplayer' && map.members >= rules.minMembers;
