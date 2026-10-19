import {
  communityCount,
  GAME_DATA,
  firstHomeTiles,
  heartSeedOf,
  placeCommunities,
  type ExistingCommunity,
  type Hex,
  type PlacedCommunity,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { createMapsRepo, type PostPlacementTileRow } from '../maps/repo.js';
import { createCommunitiesRepo, type PlacedCommunityRow } from './repo.js';
import { storeCommunities } from './service.js';

/*
 * Hollowed Communities for patches made before them (#306), the trading
 * posts' twin (`maps/trading-posts.ts`). Every boot runs this pass after the
 * posts' one; it's idempotent: a map with all its villages is never touched
 * again. New maps are made with theirs by `generateMap`.
 *
 * It runs the same rule (`placeCommunities`) over the stored tiles, with busy
 * tiles (a building, fence, guard, gatherer, unfinished gather or battle, or
 * another village) counted as taken, so nobody loses land and nothing is cut
 * off mid-way. It tries the rule as written, then with `relaxedMaxFromSeed`,
 * then as many as fit (`partial`). A map with no room is left alone and
 * reported; the next boot tries again.
 *
 * One transaction per map: the chosen village and key tiles locked in id
 * order (tech spec §7 step 6, `FOR NO KEY UPDATE`), planned again under the
 * lock (`moved` if anything changed), stored, then `community.placed` with
 * `maps` last. The key tile never goes in the event (rule 6).
 */

/** What one pass did, for the boot log. */
export interface CommunitiesPlaced {
  /** Maps that got (some of) their missing villages. */
  readonly placed: number;
  /** Maps with no room for a missing village yet, for the log. */
  readonly skipped: readonly string[];
}

const RULES = GAME_DATA.mapGen.communities;
const keyOf = (h: Hex) => `${String(h.q)},${String(h.r)}`;

/** The rule's input from stored tiles: busy tiles count as taken. */
function plan(
  rows: readonly PostPlacementTileRow[],
  seed: string,
  existing: readonly PlacedCommunityRow[],
): PlacedCommunity[] | null {
  // First homes (#306 PR 3): a won village's ring shares its winner's slot.
  const first = firstHomeTiles(rows);
  const slots = new Set(first.flatMap((t) => (t.homeSlot === null ? [] : [t.homeSlot])));
  const homes = [...slots]
    .sort((a, b) => a - b)
    .flatMap((slot) => heartSeedOf(first.filter((t) => t.homeSlot === slot)) ?? []);
  const base = {
    tiles: rows.map((t) => ({ ...t, ownerUserId: t.busy ? 'busy' : t.ownerUserId })),
    homes,
    gapTerrain: GAME_DATA.mapGen.gapTerrain,
    rules: RULES,
    seed,
    existing: existing.map((c): ExistingCommunity => ({
      square: c.square,
      tiles: c.tiles,
      kind: c.kind,
      name: c.name,
      keyTile: c.keyTile,
    })),
  };
  const placed =
    placeCommunities({ ...base, maxFromSeed: RULES.maxFromSeed }) ??
    placeCommunities({ ...base, maxFromSeed: RULES.relaxedMaxFromSeed }) ??
    placeCommunities({ ...base, maxFromSeed: RULES.relaxedMaxFromSeed, partial: true });
  return placed === null || placed.length === 0 ? null : placed;
}

/** One plan as a string, to tell whether the plan under the lock is the same. */
const planKey = (placed: readonly PlacedCommunity[]) =>
  placed
    .map((c) => `${c.kind}:${c.name}:${c.tiles.map(keyOf).join(' ')}:${keyOf(c.keyTile)}`)
    .join('|');

/**
 * Places the missing Hollowed Communities on every patch that has fewer than
 * `communityCount(seats)`, map by map. A map whose pass fails is reported to
 * `onError` and the rest go on. `publish` sends a placed map's
 * `community.placed` to members already watching, after its commit.
 */
export async function placeMissingCommunities(
  db: Executor,
  onError: (mapId: string, err: unknown) => void,
  publish?: (mapId: string) => Promise<void>,
): Promise<CommunitiesPlaced> {
  let placed = 0;
  const skipped: string[] = [];
  for (const map of await createCommunitiesRepo(db).listPatchCommunityCounts()) {
    if (map.communities >= communityCount(map.maxPlayers, RULES)) continue;
    try {
      const done = await placeOne(db, map.id, map.seed);
      if (done === 'placed') {
        placed += 1;
        await publish?.(map.id);
      } else if (done === 'no-room') {
        skipped.push(map.id);
      }
      // 'moved': another boot placed them, or the land changed under the
      // lock; the next boot looks again if need be.
    } catch (err) {
      onError(map.id, err);
    }
  }
  return { placed, skipped };
}

/**
 * One map, in one transaction: `placed`, `no-room` (no room for a missing
 * village) or `moved` (something changed between the read and the lock).
 */
async function placeOne(
  db: Executor,
  mapId: string,
  seed: string,
): Promise<'placed' | 'no-room' | 'moved'> {
  const existing = await createCommunitiesRepo(db).listPlaced(mapId);
  const first = plan(await createMapsRepo(db).listPostPlacementTiles(mapId), seed, existing);
  if (first === null) return 'no-room';
  return createMapsRepo(db).transaction(async (repo, tx) => {
    const before = await repo.listPostPlacementTiles(mapId);
    const idAt = new Map(before.map((t) => [keyOf(t), t.id]));
    const hexes = first.flatMap((c) => [...c.tiles, c.keyTile]);
    const ids = [...new Set(hexes.flatMap((h) => idAt.get(keyOf(h)) ?? []))];
    // Under the lock: a claim, a gather or another boot may have got there first.
    const locked = await repo.listPostPlacementTiles(mapId, ids);
    const now = await createCommunitiesRepo(tx).listPlaced(mapId);
    if (now.length !== existing.length) return 'moved';
    const again = plan(locked, seed, now);
    if (again === null || planKey(again) !== planKey(first)) return 'moved';
    const stored = await storeCommunities(tx, {
      mapId,
      mapSeed: seed,
      placed: first,
      firstIndex: existing.length,
    });
    await repo.appendEvent({
      mapId,
      type: 'community.placed',
      actorUserId: null,
      payload: {
        communities: stored.map(({ id, placed }) => ({
          communityId: id,
          name: placed.name,
          kind: placed.kind,
          tiles: placed.tiles.map((h) => ({ q: h.q, r: h.r })),
        })),
      },
    });
    return 'placed';
  });
}
