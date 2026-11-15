import type { Executor } from '../../db/client.js';
import { removeMemberBuildings } from '../buildings/service.js';
import { createCommunitiesRepo } from '../communities/repo.js';
import { removeMemberFences } from '../fences/service.js';
import { createHouseRepo } from '../house/repo.js';
import { contentmentCheckpointsOf, writeContentmentCheckpoints } from '../jobs/contentment.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import type { Hex } from '@heartpatch/shared';
import type { NewGameEvent } from '../../db/game-events.js';
import type { MapsTxRepo } from './repo.js';

/** The Heart Seed: the centre of a home base (a tile and its full ring). */
export function heartSeedOf(homeTiles: readonly Hex[]): Hex {
  const n = homeTiles.length;
  if (n === 0) throw new Error('heartSeedOf: no home tiles');
  const sum = homeTiles.reduce((acc, h) => ({ q: acc.q + h.q, r: acc.r + h.r }), { q: 0, r: 0 });
  return { q: sum.q / n, r: sum.r / n };
}

export interface DepartInput {
  mapId: string;
  memberId: string;
  /** Who did it: the leaver, the owner (a removal), or the owner's switch / a joiner (#386). */
  actorUserId: string;
  type: 'member.removed' | 'member.left';
  at: Date;
  /** A computer patch-mate (#386) is leaving: marked on the event. */
  computer?: true;
  /** It leaves to make room for this real Keeper (#386). */
  madeRoomFor?: string;
  /**
   * Collect the events here instead of appending them, so a caller that
   * departs several members appends every event last (`maps` is step 13).
   */
  collect?: NewGameEvent[];
}

/**
 * Archives a member and frees their land and home base, inside the caller's
 * transaction (`maps.leave`/`removeMember`, and computer patch-mates, #386).
 * Lock order: seats, the player, tiles, buildings, then maps (appendGameEvent).
 * Taking the seats lock again in a transaction that already holds it is a no-op.
 * Returns the released tile count, or why nothing happened.
 */
export async function departWithin(
  repo: MapsTxRepo,
  tx: Executor,
  input: DepartInput,
): Promise<{ releasedTiles: number } | 'not-member' | 'owner'> {
  const { mapId, memberId, at } = input;
  await repo.lockSeats(mapId);
  await repo.lockUser(memberId);
  const membership = await repo.membership(mapId, memberId);
  if (membership?.status !== 'active') return 'not-member';
  if (membership.role === 'owner') return 'owner';
  await repo.archiveMember(mapId, memberId);
  // Their guards and gatherers stop with the land, and trainees with
  // their Training Grounds (#376): what each job held so far is worked
  // out while the land is still theirs, and written once it's released.
  const jobs = createSquishyJobsRepo(tx);
  // Only those whose job stops here: guards on their land, gatherers at
  // work there and trainees. Any other row (the team, the Hollow, a
  // trade) keeps its own count, and a rescue may be writing it right now.
  const mine = await jobs.listMine(mapId, memberId);
  const theirs = mine
    .filter((r) => r.squishy.state === 'active' && (r.onWatch || r.atWork || r.training !== null))
    .map((r) => r.squishy.id);
  // Residents leaving the house (#381) fade at the normal rate from now:
  // the time so far counts at the perk's (only those home to enjoy it;
  // one in the Hollow or a trade already fades at the normal rate).
  const living = mine
    .filter((r) => r.squishy.state === 'active' && r.houseRoomId !== null)
    .map((r) => r.squishy.id);
  const checkpoints = await contentmentCheckpointsOf(
    tx,
    mapId,
    [...new Set([...theirs, ...living])],
    at,
  );
  const releasedTiles = await repo.releaseTiles(mapId, memberId);
  // A won village's ring goes back with the land, and its name with it
  // (#306 PR 3, owner 2026-10-19): the village stays restored, ownerless.
  // The community rows after the tiles `releaseTiles` holds (step 6).
  await createCommunitiesRepo(tx).uproot(mapId, memberId);
  // Written here, before the buildings (tech spec §7 exception): the
  // member's own commands wait on the archive and the account lock above,
  // and every other writer of a guard or gatherer takes its tile first,
  // which `releaseTiles` holds. Their residents' checkpoints join this
  // early read on the same footing (#381): a move in or out is one of the
  // member's own commands, behind the member row.
  // Their residents leave the house under their squishy locks (step 10),
  // taken with the job squishies in one id-ordered lock and before any
  // inventory row (step 11), as every residency writer does.
  const house = createHouseRepo(tx);
  const residents = await house.residentSquishyIds(mapId, memberId);
  await jobs.lockSquishies([...new Set([...theirs, ...residents])]);
  await writeContentmentCheckpoints(tx, checkpoints, at);
  await house.deleteResidents(residents);
  // A returning player gets a fresh home base (#4), so their buildings go
  // (#18); fires on their captured land give back what a lost fire does (#202).
  const map = await repo.findMap(mapId);
  const lostFires = map ? await removeMemberBuildings(tx, map, memberId, at) : [];
  // Their fences come down too, with the take-down share back (#203).
  // After the buildings' grants: safe, as every fence command takes the
  // tile lock first, and this transaction already holds their tiles.
  const lostFences = await removeMemberFences(tx, mapId, memberId);
  // Their house goes with the buildings (#381; plan Q5), its gifts by
  // cascade (step 8c; the residents left above, under their squishy locks).
  await house.deleteHouse(mapId, memberId);
  const events: NewGameEvent[] = [...lostFires, ...lostFences];
  events.push({
    mapId,
    type: input.type,
    actorUserId: input.actorUserId,
    payload: {
      userId: memberId,
      releasedTiles,
      ...(input.computer ? { computer: true as const } : {}),
      ...(input.madeRoomFor ? { madeRoomFor: input.madeRoomFor } : {}),
    },
  });
  if (input.collect) input.collect.push(...events);
  else for (const event of events) await repo.appendEvent(event);
  return { releasedTiles };
}
