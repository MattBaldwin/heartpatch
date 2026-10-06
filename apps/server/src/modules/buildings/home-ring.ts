import { GAME_DATA, missingHomeRingNodes } from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { mapLocalTime } from '../../lib/time.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { toPublicBuilding } from './hearthfire.js';
import { createBuildingsRepo } from './repo.js';

/** Where `seedHomeRingNodes` reports a home whose seasonal nodes have nowhere to go. */
export interface HomeRingLog {
  warn: (details: object, message: string) => void;
}

/**
 * Homes whose missing nodes are waiting for room, by map (for the admin
 * console later). Each map is logged once per process.
 */
const waiting = new Map<string, number>();
export const homeRingWaiting = (): ReadonlyMap<string, number> => waiting;

/**
 * Gives every home on the map the home-ring nodes it's missing (owner
 * decision 2026-10-06: a seasonal Pumpkin node and leaf pile in every home
 * ring), the next time the map or a home is read, instead of a backfill. A
 * map generated now already has them, so this is one cheap read; an older map
 * gets them once (shared `missingHomeRingNodes`).
 *
 * When no bare ring tile has a free middle, the building in one tile's middle
 * moves to a free side spot on the same tile first (coordinator decision
 * 2026-10-06), keeping its id, level, fuel, residents and trainees (they point
 * at the building), and a fire's reach (measured from its tile). Each move
 * appends `building.moved`, so open home views follow it live.
 *
 * One transaction, tech spec §7 order: every home tile on the map (step 6, id
 * order, the lock building placement and moves take), then the buildings it
 * moves (step 8, id order), then `maps` for the events. It plans again under
 * the locks, so a retry or a second reader adds and moves nothing twice.
 * Nodes only show and gather in their season (client and gathering). The
 * Tutorial Glade keeps its hand-made layout (it has no seasons).
 */
export async function seedHomeRingNodes(
  db: Executor,
  mapId: string,
  at: Date,
  log?: HomeRingLog,
): Promise<boolean> {
  const maps = createMapsRepo(db);
  const { homeRingNodes } = GAME_DATA.mapGen;
  const [home, map, seed] = await Promise.all([
    maps.listHomeRingTiles(mapId),
    maps.findMap(mapId),
    createTerritoryRepo(db).mapSeed(mapId),
  ]);
  if (map?.kind !== 'multiplayer') return false;
  const first = missingHomeRingNodes(home, homeRingNodes, seed);
  if (first.add.length === 0) {
    noteWaiting(mapId, first.waiting, log);
    return false;
  }
  const local = mapLocalTime(at, map.timeZone);
  const result = await createBuildingsRepo(db).transaction(async (repo, tx) => {
    const tileRepo = createMapsRepo(tx);
    const locked = await tileRepo.listHomeRingTiles(mapId, true);
    const plan = missingHomeRingNodes(locked, homeRingNodes, seed);
    const tileAt = new Map(locked.map((t) => [`${String(t.q)},${String(t.r)}`, t]));
    const onMap = await repo.listOnMap(mapId);
    const movers = plan.add.flatMap((node) => {
      const tile = tileAt.get(`${String(node.q)},${String(node.r)}`);
      if (!tile || node.moveMiddleTo === null) return [];
      const row = onMap.find((b) => b.tileId === tile.id && b.spot === 0);
      return row ? [{ row, tileId: tile.id, spot: node.moveMiddleTo }] : [];
    });
    // Step 8, id order, after every tile lock.
    const ordered = [...movers].sort((a, b) => (a.row.id < b.row.id ? -1 : 1));
    for (const m of ordered) await repo.lockBuilding(m.row.id);
    for (const m of movers) await repo.moveBuilding(m.row.id, { tileId: m.tileId, spot: m.spot });
    for (const node of plan.add) {
      const tile = tileAt.get(`${String(node.q)},${String(node.r)}`);
      if (tile) await tileRepo.addHomeNode(tile.id, node.resource);
    }
    for (const m of movers) {
      await repo.appendEvent({
        mapId,
        type: 'building.moved',
        actorUserId: null,
        payload: {
          userId: m.row.ownerUserId,
          from: { q: m.row.q, r: m.row.r, spot: m.row.spot },
          building: {
            ...toPublicBuilding({ ...m.row, spot: m.spot }, local),
            q: m.row.q,
            r: m.row.r,
          },
        },
      });
    }
    return { moved: movers.length, waiting: plan.waiting };
  });
  noteWaiting(mapId, result.waiting, log);
  return result.moved > 0;
}

function noteWaiting(mapId: string, count: number, log: HomeRingLog | undefined): void {
  if (count === 0) {
    waiting.delete(mapId);
    return;
  }
  if (!waiting.has(mapId)) {
    log?.warn({ mapId, waiting: count }, 'home-ring nodes waiting for a free spot');
  }
  waiting.set(mapId, count);
}
