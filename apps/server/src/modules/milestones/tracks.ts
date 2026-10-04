import { MILESTONE_TRACKS, type MilestoneTrack } from '@heartpatch/shared';
import { SECRET_MILESTONES } from '@heartpatch/shared/server';

// Every milestone track and title (design doc §24, #44): plain data, so the
// maps repo can name a member's worn title without the milestones service.

/** Every track, public then secret. */
export const ALL_MILESTONES: readonly MilestoneTrack[] = [
  ...MILESTONE_TRACKS,
  ...SECRET_MILESTONES,
];

const TITLE_NAMES = new Map(
  ALL_MILESTONES.flatMap((t) => t.tiers.map((tier) => [tier.title.id, tier.title.name] as const)),
);

/**
 * A worn title's name for other players (`MapMember.title`), or null. Only
 * earned titles can be worn (`equipTitle` checks), so a secret one shown here
 * was earned by its wearer.
 */
export const titleName = (titleId: string | null): string | null =>
  titleId === null ? null : (TITLE_NAMES.get(titleId) ?? null);
