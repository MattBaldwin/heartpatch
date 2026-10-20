import {
  COMMUNITY_RULES,
  hexKey,
  MAP_GEN,
  restoredNameIdeas,
  ringToPlant,
  villageRing,
  type Hex,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { refreshHomesteads } from '../explore/homesteads.js';
import { takeDownInnerFences, type LostFence } from '../fences/service.js';
import { guardWatchesOf, writeGuardCheckpoints } from '../jobs/contentment.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import {
  createCommunitiesRepo,
  type CommunitiesRepo,
  type CommunityRow,
  type RestoreTileRow,
} from './repo.js';

/*
 * Winning a Hollowed village (#306 PR 3, PR 4): the ring planted as the
 * winner's second home. Shared by the restore path (a village's last piece)
 * and the `community-settle` consumer (the last tile won in a battle), so
 * both win the same way in the same order. The caller has locked the
 * village's tiles and its ring (step 6, one id-ordered lock); from there
 * (tech spec §7): the ring's tiles, the guards leaving it (`tile_defenders`,
 * 6), the winner's explored rows (`refreshHomesteads`, 6), the community
 * row then its tiles' rows (6), the winner's fences facing the new land (8),
 * those guards (10). The caller then grants the fences' share (11) and
 * appends the events (`maps` last).
 */

/** Every place a village and its ring cover, each once. */
export function placesOf(square: Hex, village: readonly Hex[]): Hex[] {
  const seen = new Map<string, Hex>();
  for (const h of [...villageRing(square), ...village]) seen.set(hexKey(h), h);
  return [...seen.values()];
}

/** Ring tiles that became the winner's home, and what happens around them. */
interface Planting {
  mapId: string;
  userId: string;
  homeSlot: number;
  communityId: string;
  /** The ring tiles to plant (wild or the winner's). */
  ring: readonly RestoreTileRow[];
  /** Land that is the winner's from now on and wasn't before (for their fences facing it). */
  gained: readonly RestoreTileRow[];
  /** The winner's own land the ring took in: its guards go home. */
  converted: readonly RestoreTileRow[];
  at: Date;
  /** With the community rows locked (step 6): the writes there and their events. */
  withCommunity: (repo: CommunitiesRepo, community: CommunityRow) => Promise<NewGameEvent[]>;
}

/** What a planting wrote: its events so far, and the fences that came down. */
export interface Planted {
  /** In order: the community's (a piece, the win), then homesteads. Fences' come after the bag. */
  events: NewGameEvent[];
  /** The winner's fences that now stand inside their land: grant their share (step 11). */
  fences: LostFence[];
}

async function plant(tx: Executor, p: Planting): Promise<Planted> {
  const repo = createCommunitiesRepo(tx);
  const territory = createTerritoryRepo(tx);
  await repo.plantRing(
    p.ring.map((t) => t.id),
    { userId: p.userId, homeSlot: p.homeSlot, communityId: p.communityId },
  );

  // Guards on my land the ring took in go home: home tiles hold no watch.
  // Their watch so far held (#376): read before the posts go.
  const converted = [...p.converted].sort((a, b) => (a.id < b.id ? -1 : 1));
  const guardIds: string[] = [];
  for (const t of converted) {
    guardIds.push(...(await territory.listDefenders(t.id, p.userId)).map((g) => g.id));
  }
  const watches = await guardWatchesOf(tx, guardIds);
  for (const t of converted) await territory.clearDefenders(t.id);

  // Homesteads (#199): new land may join or wake mine (step 6).
  const homesteads =
    p.gained.length + p.converted.length > 0
      ? await refreshHomesteads(tx, p.mapId, [p.userId], p.at)
      : [];

  // The village's rows (step 6, after the tile rows above, as a leave's
  // uproot takes them).
  const community = await repo.lockCommunity(p.communityId);
  if (!community) throw new Error('winVillage: the village went away under its tile lock');
  await repo.listCommunityTiles(p.communityId, true);
  const events = [...(await p.withCommunity(repo, community)), ...homesteads];

  // My fences that faced the new land now stand inside it (step 8).
  const fences = await takeDownInnerFences(
    tx,
    p.mapId,
    p.gained,
    p.userId,
    await territory.listTiles(p.mapId),
  );
  // Step 10: the guards that went home write their checkpoints.
  await createSquishyJobsRepo(tx).lockSquishies([...guardIds].sort());
  await writeGuardCheckpoints(tx, watches, p.at);
  return { events, fences };
}

export interface WinVillageInput {
  mapId: string;
  /** The winner: every village tile is restored and theirs. */
  userId: string;
  /** The winner's home slot: the ring's tiles take it. */
  homeSlot: number;
  community: { id: string; name: string };
  square: Hex;
  /**
   * The village's tiles and its ring, locked by the caller (step 6, one
   * id-ordered lock), with their owners as they stand now (a tile the
   * caller just claimed already the winner's).
   */
  locked: readonly RestoreTileRow[];
  /** Land the caller made the winner's just before the win (a tile's last piece). */
  claimed?: readonly RestoreTileRow[];
  at: Date;
  /** With the community rows locked, before the win: the caller's own writes (a piece). */
  beforeWin?: (repo: CommunitiesRepo) => Promise<NewGameEvent[]>;
}

export interface VillageWin extends Planted {
  /** The name it wears until its winner types one. */
  name: string;
  ring: RestoreTileRow[];
}

/**
 * The village is won (plan v3 Q3): the square and its neighbours that are
 * wild or the winner's become their home tiles; someone else's stay theirs
 * (a gap, planted later if the winner wins it, `plantRingGap`). The
 * winner's own tile with a building or a clear on it stays their land for
 * now: home tiles follow other building rules. Appends `community.restored`
 * after the caller's events.
 */
export async function winVillage(tx: Executor, input: WinVillageInput): Promise<VillageWin> {
  const { mapId, userId, community, square, locked, at } = input;
  const repo = createCommunitiesRepo(tx);
  const claimed = new Set((input.claimed ?? []).map((t) => t.id));
  const [name = community.name] = restoredNameIdeas(
    community.name,
    COMMUNITY_RULES,
    MAP_GEN.communities,
  );
  const busy = await repo.busyTiles(locked.filter((t) => t.ownerUserId === userId).map((t) => t.id));
  const ring = ringToPlant(square, locked, userId, community.id).filter((t) => !busy.has(t.id));
  const ringIds = new Set(ring.map((t) => t.id));
  const gained: RestoreTileRow[] = [...(input.claimed ?? [])];
  const converted: RestoreTileRow[] = [];
  for (const t of locked) {
    if (!ringIds.has(t.id) || claimed.has(t.id)) continue;
    if (t.ownerUserId === null) gained.push(t);
    else converted.push(t);
  }
  const planted = await plant(tx, {
    mapId,
    userId,
    homeSlot: input.homeSlot,
    communityId: community.id,
    ring,
    gained,
    converted,
    at,
    withCommunity: async (rows, fresh) => {
      const events = (await input.beforeWin?.(rows)) ?? [];
      if (fresh.ownerUserId !== null) {
        throw new Error('winVillage: the village was won under its tile lock');
      }
      await rows.win(community.id, userId, at, name);
      events.push({
        mapId,
        type: 'community.restored',
        actorUserId: userId,
        payload: {
          communityId: community.id,
          userId,
          square,
          ring: ring.map((t) => ({ q: t.q, r: t.r })),
          name,
        },
      });
      return events;
    },
  });
  return { ...planted, name, ring };
}

export interface RingGapInput {
  mapId: string;
  /** The village's winner, who now holds `tile`. */
  userId: string;
  homeSlot: number;
  community: { id: string; name: string };
  square: Hex;
  /** The gap: a ring tile of the won village, now the winner's plain land, locked (step 6). */
  tile: RestoreTileRow;
  at: Date;
}

/**
 * A gap in a won village's ring that its winner took in a battle (PR 4)
 * becomes home as the ring did: `home_slot` and `community_id`, its guards
 * home, homesteads, inner fences. Null when it can't be home (another
 * home's tile, a trading post, another village's, or a building or a clear
 * on it). Appends `community.restored` with just that tile as the ring.
 */
export async function plantRingGap(tx: Executor, input: RingGapInput): Promise<Planted | null> {
  const { mapId, userId, community, square, tile, at } = input;
  const repo = createCommunitiesRepo(tx);
  const [fits] = ringToPlant(square, [tile], userId, community.id);
  if (fits?.ownerUserId !== userId || (await repo.busyTiles([tile.id])).has(tile.id)) return null;
  return plant(tx, {
    mapId,
    userId,
    homeSlot: input.homeSlot,
    communityId: community.id,
    ring: [tile],
    gained: [tile],
    converted: [tile],
    at,
    withCommunity: async () => [
      {
        mapId,
        type: 'community.restored',
        actorUserId: userId,
        payload: {
          communityId: community.id,
          userId,
          square,
          ring: [{ q: tile.q, r: tile.r }],
          name: community.name,
        },
      },
    ],
  });
}
