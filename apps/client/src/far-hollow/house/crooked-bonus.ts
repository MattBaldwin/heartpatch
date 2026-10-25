import {
  CROOKED_HOUSE,
  type CrookedDoor,
  type CrookedHouseView,
  type CrookedRoom,
  type JobSquishy,
  type JobsView,
} from '@heartpatch/shared';
import type { FloorPoint } from './crooked-plan.js';

// The Crooked House's bonus rooms (#306 6e), pure so every case is
// unit-tested: where a bonus room's chest stands, when it's in reach, and who
// on my battle team can wake a sleeping door (owner decision 7: any squishy
// of the door's element on the team, any level, free, every time). The
// server checks all of it again (rule 1); a chest's loot and its rare
// friend's odds never reach the client (rule 6).

export const CROOKED_CHEST = {
  /** The chest stands this share of the room's depth north of its middle (by the far wall). */
  north: 0.2, // TUNE
  /** The big button names the chest this close, metres. */
  reach: 1.5, // TUNE
} as const;

/** The rooms with a bonus chest. The attic's big chest is #306 6f's. */
export function chestRooms(): CrookedRoom[] {
  return CROOKED_HOUSE.rooms.filter((r) => r.kind === 'bonus');
}

/** Where a bonus room's chest stands, floor metres. */
export function chestPoint(room: CrookedRoom): FloorPoint {
  return { x: room.box.x, z: room.box.z + room.box.d * CROOKED_CHEST.north };
}

export function chestOpened(room: CrookedRoom, view: Pick<CrookedHouseView, 'chestsOpened'>) {
  return view.chestsOpened.includes(room.id);
}

/** A bonus room's unopened chest, in reach. */
export interface ChestTarget {
  readonly kind: 'chest';
  readonly room: CrookedRoom;
  readonly at: FloorPoint;
}

export function chestTarget(
  room: CrookedRoom,
  view: Pick<CrookedHouseView, 'chestsOpened'>,
  at: FloorPoint,
): ChestTarget | null {
  if (room.kind !== 'bonus' || chestOpened(room, view)) return null;
  const p = chestPoint(room);
  return Math.hypot(p.x - at.x, p.z - at.z) <= CROOKED_CHEST.reach
    ? { kind: 'chest', room, at: p }
    : null;
}

/**
 * My battle team as the server picks it for a power (`listTeam`): the
 * squishies I put on the team, in slot order; with none picked, my strongest
 * free ones. Busy squishies (guards, gatherers, trainees) and those in the
 * Hollow never count.
 */
export function crookedTeam(jobs: Pick<JobsView, 'squishies' | 'rules'>): JobSquishy[] {
  const free = jobs.squishies.filter(
    (s) => s.squishy.state === 'active' && (s.job === 'team' || s.job === 'resting'),
  );
  const picked = free
    .filter((s) => s.job === 'team' && s.teamSlot !== null)
    .sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0));
  const team =
    picked.length > 0 ? picked : [...free].sort((a, b) => b.squishy.level - a.squishy.level);
  return team.slice(0, jobs.rules.teamSize);
}

/** One row of the "Who can help?" picker. */
export interface Helper {
  readonly id: string;
  readonly name: string;
  readonly speciesId: string;
  readonly element: string;
  readonly accessory: string | null;
  /** Of the door's element: this one can help. */
  readonly helps: boolean;
}

/** The picker's rows for a sleeping door: my team, those who can help first. */
export function helpersFor(
  door: Pick<CrookedDoor, 'power'>,
  jobs: Pick<JobsView, 'squishies' | 'rules' | 'names'>,
): Helper[] {
  const rows = crookedTeam(jobs).map((s) => ({
    id: s.squishy.id,
    name: jobs.names[s.squishy.id] ?? s.squishy.nickname ?? 'Your squishy',
    speciesId: s.squishy.speciesId,
    element: s.squishy.element,
    accessory: s.squishy.accessory ?? null,
    helps: door.power !== undefined && s.squishy.element === door.power,
  }));
  // Stable: the team's own order within each group.
  return [...rows.filter((r) => r.helps), ...rows.filter((r) => !r.helps)];
}
