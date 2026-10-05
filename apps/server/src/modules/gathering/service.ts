import {
  canGather,
  GAME_DATA,
  gameplayOverrides,
  gatherSeconds,
  gatherYield,
  type CollectResponse,
  type GatherResponse,
  type InventoryResponse,
  type PublicUser,
  type StartGatherRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { createInventoryService, grantItems, seasonsOn, toGather } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import { createGatheringRepo, type GatherRow } from './repo.js';

/*
 * Gathering on resource nodes (#17, design doc §12). A gather is two
 * timestamps (CLAUDE.md rule 4): starting stores `started_at` and `ready_at`;
 * collecting checks the game clock then, so it finishes correctly while the
 * player is logged out, and nothing ticks in between. Only on tiles the
 * player owns, one gather per node, seasonal nodes only in their season.
 */

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noTile: "We couldn't find that spot.",
  notYours: 'You can only gather on your own land.',
  noNode: "There's nothing to gather here.",
  already: "You're already gathering here!",
  noGather: "We couldn't find that.",
  collected: 'Already collected!',
  lost: 'Someone else looks after that spot now.',
  notYoursNow: "That spot isn't yours anymore.",
  notReady: 'Not ready yet. Check back soon!',
  outOfSeason: (name: string, season: string) => `${name} only turn up around ${season}!`,
} as const;

export interface GatheringService {
  /** Starts gathering the node on a tile the player owns. */
  start: (user: PublicUser, mapId: string, at: StartGatherRequest) => Promise<GatherResponse>;
  /** Puts a finished gather in the bag. */
  collect: (user: PublicUser, mapId: string, gatherId: string) => Promise<CollectResponse>;
  /**
   * Dev and test only (`HP_DEV_SQUISHY_GRANTS`): the player's gathers on this
   * map finish now, so Collect can be tried without the wait. Returns the bag
   * as `GET /inventory` does.
   */
  devReady: (user: PublicUser, mapId: string) => Promise<InventoryResponse>;
}

export interface GatheringServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createGatheringService(options: GatheringServiceOptions): GatheringService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createGatheringRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  return {
    start: async (user, mapId, { q, r }) => {
      const at = now();
      let result: GatherResponse;
      try {
        result = await store.transaction(async (repo, tx) => {
          const { map } = await requireMember(tx, user, mapId);
          // Share-locked: the tile can't change hands while this starts.
          const tile = await repo.lockTileAt(mapId, q, r);
          if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
          if (tile.ownerUserId !== user.id) throw new AppError('FORBIDDEN', MESSAGES.notYours);
          const resource = tile.nodeResource ? RESOURCES.get(tile.nodeResource) : undefined;
          if (!resource?.gather) throw new AppError('CONFLICT', MESSAGES.noNode);
          const seasons = new Set(seasonsOn(at, map.timeZone));
          if (!canGather(resource, seasons)) {
            const season = SEASON_NAMES.get(resource.season ?? '') ?? 'their season';
            throw new AppError('CONFLICT', MESSAGES.outOfSeason(resource.name, season));
          }

          const running = await repo.findActiveOnTile(tile.id);
          if (running?.userId === user.id) throw new AppError('CONFLICT', MESSAGES.already);
          // Left behind by a previous owner: the node is the new owner's now.
          if (running) await repo.endGather(running.id, { status: 'lost', at });

          const seconds = gatherSeconds(resource, gameplayOverrides(map.kind));
          const gather = await repo.insertGather({
            mapId,
            userId: user.id,
            tileId: tile.id,
            resource: resource.id,
            items: gatherYield(resource, GAME_DATA.resources, seasons),
            startedAt: at,
            readyAt: new Date(at.getTime() + seconds * 1000),
          });
          await repo.appendEvent({
            mapId,
            type: 'gather.started',
            actorUserId: user.id,
            payload: {
              gatherId: gather.id,
              userId: user.id,
              q: gather.q,
              r: gather.r,
              resource: gather.resource,
              readyAt: gather.readyAt.toISOString(),
            },
          });
          return { gather: toGather(gather), now: at.toISOString() };
        });
      } catch (err) {
        // A double tap raced us to the one-gather-per-node index.
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.already);
        throw err;
      }
      published(mapId);
      return result;
    },

    collect: async (user, mapId, gatherId) => {
      const at = now();
      const owner = { mapId, userId: user.id };
      const result = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const isMine = (row: GatherRow | null): row is GatherRow =>
          row !== null && row.mapId === mapId && row.userId === user.id;
        // Lock order (tech spec §7): the tile, then the gather, like `start`.
        // A gather's tile never changes, so read it unlocked first.
        const found = await repo.findGather(gatherId);
        if (!isMine(found)) throw new AppError('NOT_FOUND', MESSAGES.noGather);
        // Share-locked like `start`, so a capture can't land mid-collect.
        const tileOwner = await repo.lockTileOwner(found.tileId);
        const gather = await repo.lockGather(gatherId);
        if (!isMine(gather)) throw new AppError('NOT_FOUND', MESSAGES.noGather);
        if (gather.status === 'collected') throw new AppError('CONFLICT', MESSAGES.collected);
        if (gather.status === 'lost') throw new AppError('CONFLICT', MESSAGES.lost);
        if (tileOwner !== user.id) throw new AppError('CONFLICT', MESSAGES.notYoursNow);
        if (gather.readyAt > at) throw new AppError('CONFLICT', MESSAGES.notReady);

        // Lock order: tile, gather, inventory rows, then `maps` via appendEvent.
        await grantItems(tx, owner, gather.items, 'gather', gather.id);
        await repo.endGather(gather.id, { status: 'collected', at });
        // A little luck: maybe a piece of clothing turned up too (#43).
        await rollFoundDrop(tx, {
          source: 'gather',
          refId: gather.id,
          userId: user.id,
          mapId,
          tileId: gather.tileId,
          at,
        });
        await repo.appendEvent({
          mapId,
          type: 'resource.gathered',
          actorUserId: user.id,
          payload: {
            gatherId: gather.id,
            userId: user.id,
            q: gather.q,
            r: gather.r,
            resource: gather.resource,
            items: gather.items,
          },
        });
        return {
          granted: gather.items,
          items: await createInventoryRepo(tx).list(owner),
          now: at.toISOString(),
        };
      });
      published(mapId);
      return result;
    },

    devReady: async (user, mapId) => {
      const at = now();
      await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        await repo.makeReady(mapId, user.id, at);
      });
      return createInventoryService({ db, clock: now }).get(user, mapId);
    },
  };
}
