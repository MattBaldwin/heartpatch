import {
  canFade,
  heartSeedOf,
  hexKey,
  patchRules,
  supplyMap,
  type Hex,
  type PatchRules,
  type Supply,
  type TravelRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { createRoadsRepo } from '../roads/repo.js';
import { createTendingRepo, createTerritoryRepo } from './repo.js';

/*
 * The supply line home on a Wild Isle (#621): land cut off from its owner's
 * home (shared `supplyMap`: their own land, bridges, roads' reach) is
 * stranded, fades, and goes wild at a nightfall once
 * `TRAVEL_RULES.stranded.afterHours` have passed. `refreshSupply` runs where
 * land or roads change (a capture, land going wild, a road laid, raised or
 * taken up) and at each nightfall; a Cozy Patch has no travel rules, so it
 * writes nothing there and reach stays as it always was.
 */

const HOUR_MS = 60 * 60 * 1000;

/** Each owner's Heart Seed, from the map's home tiles (their first home's: #306 PR 3). */
export function heartSeeds(
  homeTiles: readonly { ownerUserId: string; q: number; r: number; communityId: string | null }[],
): Map<string, Hex | null> {
  const homes = new Map<string, Hex[]>();
  for (const { ownerUserId, q, r, communityId } of homeTiles) {
    if (communityId !== null) continue;
    homes.set(ownerUserId, [...(homes.get(ownerUserId) ?? []), { q, r }]);
  }
  return new Map([...homes].map(([owner, tiles]) => [owner, heartSeedOf(tiles)]));
}

/** The rules a map plays by, from `maps.patch_type`; null for a missing map. */
export async function mapPatchRules(tx: Executor, mapId: string): Promise<PatchRules | null> {
  const patchType = await createRoadsRepo(tx).patchType(mapId);
  return patchType === null ? null : patchRules(patchType);
}

/** A player's supply line home on a Wild Isle, read in `tx`. */
export async function supplyFor(
  tx: Executor,
  mapId: string,
  userId: string,
  travel: TravelRules,
): Promise<Supply> {
  const roads = createRoadsRepo(tx);
  const [tiles, live, bridges] = await Promise.all([
    createTerritoryRepo(tx).listTiles(mapId),
    roads.listLive(mapId),
    roads.bridges(mapId),
  ]);
  return supplyMap(tiles, live, bridges, userId, travel);
}

export interface RefreshSupplyOptions {
  /**
   * Wait for tending rows another transaction holds (nightfall's own pass,
   * holding no tile locks). Otherwise those rows are skipped, never waited
   * for, and the next nightfall puts them right.
   */
  wait?: boolean;
  /**
   * The supply line was a bridge or dock that came down (W1-5b): newly cut-off
   * land starts to strand `graceHoursAfterBridgeLoss` from now.
   */
  lostCrossing?: boolean;
}

/**
 * Works out these players' supply lines and marks their outer land stranded
 * (from `at`, or later after a lost crossing; an earlier time stands) or
 * supplied again, returning `tile.stranded` / `tile.supplied` to append.
 * Home tiles, the kept ring round the Heart Seed and joined homesteads never
 * strand. Nothing on a Cozy Patch. Tending rows are step 6 (with the tiles,
 * tile id order); land with no row yet waits for nightfall's.
 */
export async function refreshSupply(
  tx: Executor,
  mapId: string,
  userIds: readonly string[],
  at: Date,
  options: RefreshSupplyOptions = {},
): Promise<NewGameEvent[]> {
  const rules = await mapPatchRules(tx, mapId);
  const travel = rules?.travel ?? null;
  if (!rules || !travel) return [];
  const players = [...new Set(userIds)].sort();
  if (players.length === 0) return [];
  const tending = createTendingRepo(tx);
  const roads = createRoadsRepo(tx);
  const [tiles, live, bridges, homes] = await Promise.all([
    createTerritoryRepo(tx).listTiles(mapId),
    roads.listLive(mapId),
    roads.bridges(mapId),
    createSquishyJobsRepo(tx).homeTiles(mapId),
  ]);
  const seeds = heartSeeds(homes);
  const since = options.lostCrossing
    ? new Date(at.getTime() + travel.stranded.graceHoursAfterBridgeLoss * HOUR_MS)
    : at;
  const events: NewGameEvent[] = [];
  for (const userId of players) {
    const { supplied } = supplyMap(tiles, live, bridges, userId, travel);
    const seed = seeds.get(userId) ?? null;
    const outer = (await tending.outerTiles(mapId, userId)).filter(
      (t) =>
        t.tendedAt !== null && canFade({ ...t, homeSlot: null }, seed, rules.territory.tending),
    );
    const cut = outer.filter((t) => (t.strandedSince ?? null) === null && !supplied.has(hexKey(t)));
    const joined = outer.filter(
      (t) => (t.strandedSince ?? null) !== null && supplied.has(hexKey(t)),
    );
    if (cut.length + joined.length === 0) continue;
    const held = new Set(
      await tending.lockForSupply(
        [...cut, ...joined].map((t) => t.id),
        !options.wait,
      ),
    );
    const stranded = cut.filter((t) => held.has(t.id));
    const resupplied = joined.filter((t) => held.has(t.id));
    await tending.strand(
      stranded.map((t) => t.id),
      since,
    );
    await tending.unstrand(resupplied.map((t) => t.id));
    const place = ({ q, r }: Hex) => ({ q, r });
    if (stranded.length > 0) {
      events.push({
        mapId,
        type: 'tile.stranded',
        actorUserId: null,
        payload: { userId, tiles: stranded.map(place) },
      });
    }
    if (resupplied.length > 0) {
      events.push({
        mapId,
        type: 'tile.supplied',
        actorUserId: null,
        payload: { userId, tiles: resupplied.map(place) },
      });
    }
  }
  return events;
}
