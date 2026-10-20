import { hexKey, parseGameEventPayload, villageRing, villageWinner } from '@heartpatch/shared';
import type { Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import type { Clock } from '../../lib/time.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createCommunitiesRepo } from './repo.js';
import { placesOf, plantRingGap, winVillage, type Planted } from './win.js';

/**
 * Winning a Hollowed village in a battle (#306 PR 4, tech spec §7 "Event
 * consumers"). A restored village tile is ordinary land while its village is
 * being restored, so its last tile can change hands in a battle. On each
 * `tile.captured` of a village tile, or of a ring tile of the capturer's won
 * village, in its own transaction:
 *
 * - the village has no winner (never won, or its winner left), every tile is
 *   restored and the capturer holds them all (`villageWinner`): it's won and
 *   its ring planted, exactly as the restore path's last piece does
 *   (`winVillage`);
 * - the capturer won the village and the tile is a gap in their ring: it
 *   becomes home (`plantRingGap`).
 *
 * Here rather than in the capture's transaction: that one holds the target
 * tile first, and locking the ring after it would reverse the restore path's
 * id-ordered lock. Idempotent: each case re-reads the village under its tile
 * lock, so a replay finds it won or planted already and writes nothing.
 * Lock order: `event_consumers` (step 1), then the restore path's (step 6:
 * the village and ring tiles, the guards, explored rows, the community rows;
 * 8: fences; 10: guards; 11: the fences' share), then `maps`.
 */
export function createCommunitySettleConsumer(options: { clock?: Clock } = {}): EventConsumer {
  const now = options.clock ?? (() => new Date());
  return {
    name: 'community-settle',
    mapKinds: ['multiplayer'],
    handle: async (tx: Transaction, event: GameEvent) => {
      if (event.type !== 'tile.captured') return;
      const { userId, q, r } = parseGameEventPayload('tile.captured', event.payload);
      const { mapId } = event;
      const repo = createCommunitiesRepo(tx);
      const seen = await createTerritoryRepo(tx).findTile(mapId, q, r);
      if (!seen) return;
      const at = { q, r };
      // Its village: the tile's own, else a won village of mine whose ring holds it.
      const communityId =
        seen.communityId ??
        (await repo.wonVillages(mapId)).find(
          (v) =>
            v.ownerUserId === userId && villageRing(v.square).some((h) => hexKey(h) === hexKey(at)),
        )?.id ??
        null;
      if (communityId === null) return;
      const found = await repo.findCommunity(mapId, communityId);
      if (!found) return;
      const before = await repo.listCommunityTiles(communityId);
      const seed = before.find((t) => t.tileId === found.seedTileId);
      if (!seed) return;
      const square = { q: seed.q, r: seed.r };
      const member = await createMapsRepo(tx).membership(mapId, userId);
      if (member?.status !== 'active' || member.homeSlot === null) return;

      // Step 6: the village and its ring, one id-ordered lock, as a piece takes
      // them. Its rows read now hold until this commits.
      const locked = await repo.lockTilesAt(mapId, placesOf(square, before));
      const community = await repo.findCommunity(mapId, communityId);
      const village = await repo.listCommunityTiles(communityId);
      if (!community) return;
      const when = now();
      let planted: Planted | null = null;
      if (community.ownerUserId === null) {
        const owners = new Map(locked.map((t) => [t.id, t.ownerUserId]));
        const winner = villageWinner(
          village.map((t) => ({
            restored: t.restoredAt !== null,
            ownerUserId: owners.get(t.tileId) ?? null,
          })),
        );
        if (winner !== userId) return;
        planted = await winVillage(tx, {
          mapId,
          userId,
          homeSlot: member.homeSlot,
          community,
          square,
          locked,
          at: when,
        });
      } else if (community.ownerUserId === userId) {
        const tile = locked.find((t) => hexKey(t) === hexKey(at));
        const inRing = villageRing(square).some((h) => hexKey(h) === hexKey(at));
        if (!tile || !inRing || tile.ownerUserId !== userId || tile.homeSlot !== null) return;
        planted = await plantRingGap(tx, {
          mapId,
          userId,
          homeSlot: member.homeSlot,
          community: { id: community.id, name: community.restoredName ?? community.name },
          square,
          tile,
          at: when,
        });
      }
      if (!planted) return;

      // Step 11: my fences' share, then `maps` last.
      const { events, fences } = planted;
      const owner = { mapId, userId };
      const refunds = fences.filter((f) => Object.keys(f.refund).length > 0);
      if (refunds.length > 0) {
        const items: Record<string, number> = {};
        for (const f of refunds) {
          for (const [id, n] of Object.entries(f.refund)) items[id] = (items[id] ?? 0) + n;
        }
        await lockGrantRows(tx, mapId, [{ userId, items }]);
        for (const f of refunds) await grantItems(tx, owner, f.refund, 'build-refund', f.fenceId, when);
      }
      for (const f of fences) events.push(f.event);
      for (const e of events) await appendGameEvent(tx, e);
    },
  };
}
