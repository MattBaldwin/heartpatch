import type { Executor } from '../../db/client.js';
import type { Clock } from '../../lib/time.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { createMapsRepo } from '../maps/repo.js';
import { createBuildingsRepo } from './repo.js';
import { applyTileUses, type TileUseOwner } from './tile-uses.js';

/*
 * Tiles still holding two or more buildings when migration B adds the
 * unique index on `buildings.tile_id` (#295, owner decision 2026-10-18).
 * Every building on such a tile comes down with everything spent on it
 * given back, the same as the tidy-up pass packs one with nowhere to go:
 * the build and every upgrade paid (`packUpRefund`), a fire's unburned fuel,
 * and a Factory's batches (made things banked, unfinished inputs back).
 * Trainees land their XP and residents move out first. The player gets a
 * one-time note in the morning report (`packed_crowded_tiles`), and can
 * build again.
 *
 * The migrate command runs this (`cli.ts`, through `runMigrations`) after
 * the migrations before migration B and before it, so the index never meets
 * a crowded tile; the boot pass runs after migrate and can't be relied on. It does nothing once
 * the index exists (no tile can be crowded then) or no tile is crowded, so
 * it's safe on an empty, clean or already-migrated database. Every kind of
 * map, the Tutorial Glade too: the index holds on all of them.
 *
 * One transaction per player, in the tidy-up pass's lock order: the
 * crowded tiles they build on (step 6, one id-ordered `FOR NO KEY UPDATE`),
 * then `applyTileUses`: the buildings (step 8, id order), a Factory's
 * batches (step 8), trainees and residents (step 10, id order), the bag's
 * rows (step 11, one `lockGrantRows`), trainees' XP, the note, then `maps`.
 */

/** What one pack-up did, for the migrate log. */
export interface CrowdedTilesPacked {
  /** Players whose buildings came down. */
  readonly players: number;
  /** Buildings that came down. */
  readonly packed: number;
  /** Players whose pack-up failed (reported to `onError`); the index would fail on them. */
  readonly failed: number;
}

/**
 * Packs up every building on a tile that holds two or more. A player whose
 * pack-up fails is reported to `onError` and the rest go on.
 */
export async function packCrowdedTiles(
  db: Executor,
  clock: Clock,
  options: { readonly onError?: (owner: TileUseOwner, err: unknown) => void } = {},
): Promise<CrowdedTilesPacked> {
  const none = { players: 0, packed: 0, failed: 0 };
  // Once migration B's index is in, no tile can hold two buildings.
  if (await createBuildingsRepo(db).hasOneBuildingPerTileKey()) return none;
  let players = 0;
  let packed = 0;
  let failed = 0;
  for (const owner of await createBuildingsRepo(db).crowdedOwners()) {
    try {
      const done = await packOne(db, clock, owner);
      if (done === 0) continue;
      players += 1;
      packed += done;
    } catch (err) {
      failed += 1;
      options.onError?.(owner, err);
    }
  }
  return { players, packed, failed };
}

/** One player's crowded tiles, in one transaction. How many buildings came down. */
async function packOne(db: Executor, clock: Clock, owner: TileUseOwner): Promise<number> {
  return createBuildingsRepo(db).transaction(async (repo, tx) => {
    const at = clock();
    // Step 6: the crowded tiles, then read again under the lock (a command
    // may have taken a building down since the scan). Only tiles held here.
    const locked = new Set(await repo.crowdedTilesOf(owner.mapId, owner.userId));
    await createSquishyJobsRepo(tx).lockTiles([...locked]);
    const crowded = new Set(
      (await repo.crowdedTilesOf(owner.mapId, owner.userId)).filter((id) => locked.has(id)),
    );
    if (crowded.size === 0) return 0;
    const map = await createMapsRepo(tx).findMap(owner.mapId);
    if (!map) return 0;
    const rows = (await repo.listOwned(owner.mapId, owner.userId)).filter((r) =>
      crowded.has(r.tileId),
    );
    const pack = rows.map((r) => r.id).sort();
    await applyTileUses(
      repo,
      tx,
      map,
      at,
      // Nothing moves, so no tiles to move to.
      { owner, tiles: [], rows, plan: { stay: [], move: [], pack }, gatherers: [] },
      (note) => repo.notePackedCrowded(owner.mapId, owner.userId, note.refund, at),
    );
    return pack.length;
  });
}

/**
 * The migrate command's step before migration B (`runMigrations`'
 * `beforeOneBuildingPerTile`): packs up crowded tiles and logs what it did.
 * The index would fail on a player still crowded, so a failure stops the
 * migrate here, and the next one tries them again.
 */
export async function packBeforeOneBuildingPerTile(
  db: Executor,
  clock: Clock,
  log: {
    info: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  },
): Promise<void> {
  const done = await packCrowdedTiles(db, clock, {
    onError: (owner, err) => {
      log.error({ err, ...owner }, 'crowded-tile pack-up failed for a player');
    },
  });
  if (done.players > 0) {
    log.info(done, 'packed up crowded tiles before the one-building-per-tile index');
  }
  if (done.failed > 0) {
    throw new Error(`crowded-tile pack-up failed for ${String(done.failed)} player(s)`);
  }
}
