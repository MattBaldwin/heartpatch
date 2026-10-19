import {
  COMMUNITY_RULES,
  communityReach,
  deriveSeed,
  hexKey,
  type CommunityView,
  type PlacedCommunity,
  type ReachTile,
  type Seed,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { createCommunitiesRepo } from './repo.js';

/*
 * Hollowed Communities (#306): the grey villages. A new map stores the ones
 * `generateMap` placed (`storeCommunities`, in the map's own transaction);
 * an older patch gets them from the boot pass (`backfill.ts`). The view
 * (`communitiesView`) is public apart from the viewer's own reach; a
 * community's seed and cellar key tile never leave the server (rule 6).
 */

/** Pieces each tile of a village this size needs (`COMMUNITY_RULES.piecesBySize`). */
export function piecesNeededFor(size: number): number {
  const pieces = COMMUNITY_RULES.piecesBySize[String(size)];
  if (pieces === undefined) throw new Error(`no piecesBySize for a ${String(size)}-tile village`);
  return pieces;
}

/** A stored community, for the boot pass's `community.placed` event. */
export interface StoredCommunity {
  readonly id: string;
  readonly placed: PlacedCommunity;
}

/**
 * Stores placed communities on a map whose tiles are already stored: each
 * one's row (its seed `deriveSeed(mapSeed, 'community', index)`, `index`
 * counting from `firstIndex`), its `community_tiles` (the square holds the
 * cellar) and `tiles.community_id`. Run inside the caller's transaction.
 * Throws if a tile is missing or already in a village.
 */
export async function storeCommunities(
  tx: Executor,
  input: {
    mapId: string;
    mapSeed: Seed;
    placed: readonly PlacedCommunity[];
    firstIndex?: number;
  },
): Promise<StoredCommunity[]> {
  if (input.placed.length === 0) return [];
  const repo = createCommunitiesRepo(tx);
  const idAt = await repo.tileIdsByHex(input.mapId);
  const idOf = (h: { q: number; r: number }): string => {
    const id = idAt.get(`${String(h.q)},${String(h.r)}`);
    if (id === undefined) throw new Error(`no tile at ${String(h.q)},${String(h.r)}`);
    return id;
  };
  const stored: StoredCommunity[] = [];
  for (const [i, placed] of input.placed.entries()) {
    const index = (input.firstIndex ?? 0) + i;
    const piecesNeeded = piecesNeededFor(placed.tiles.length);
    const squareKey = hexKey(placed.square);
    const { id, marked } = await repo.insertCommunity(input.mapId, {
      name: placed.name,
      kind: placed.kind,
      // The kind's perk: one fixed perk a kind (owner decision 4).
      perkId: placed.kind,
      seed: deriveSeed(input.mapSeed, 'community', String(index)),
      seedTileId: idOf(placed.square),
      keyTileId: idOf(placed.keyTile),
      tiles: placed.tiles.map((t) => ({
        tileId: idOf(t),
        piecesNeeded,
        cellar: hexKey(t) === squareKey,
      })),
    });
    if (marked !== placed.tiles.length) {
      throw new Error(`marked ${String(marked)} of ${String(placed.tiles.length)} village tiles`);
    }
    stored.push({ id, placed });
  }
  return stored;
}

/**
 * The map's Hollowed Communities as `viewerUserId` sees them: public fields,
 * plus how they reach each (shared `communityReach` over the view's tiles).
 * Never a community's seed or key tile.
 */
export async function communitiesView(
  tx: Executor,
  input: { mapId: string; userId: string; tiles: readonly ReachTile[] },
): Promise<CommunityView[]> {
  const rows = await createCommunitiesRepo(tx).listForView(input.mapId);
  return rows.map((c) => {
    const village = c.tiles.map((t) => ({ q: t.q, r: t.r }));
    const { reach, distance } = communityReach(village, input.tiles, input.userId);
    return {
      id: c.id,
      name: c.restoredName ?? c.name,
      kind: c.kind,
      square: c.square,
      tiles: village,
      restored: c.tiles.filter((t) => t.restored).length,
      ownerUserId: c.ownerUserId,
      reach,
      distance,
    };
  });
}
