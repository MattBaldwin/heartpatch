import {
  COMMUNITY_RULES,
  communityReach,
  HOLLOW_RULES,
  morningGiftOf,
  HOME_BASE_RULES,
  hexKey,
  hollowedOpenAt,
  MAP_GEN,
  pieceCost,
  restoredNameIdeas,
  restoreProblem,
  ringToPlant,
  villageRing,
  villageWinner,
  type CommunityKindId,
  type CommunityNameRequest,
  type CommunityTileQuery,
  type CommunityView,
  type Hex,
  type ItemCounts,
  type PublicUser,
  type RestorePieceRequest,
  type RestoreProblem,
  type RestoreTileResponse,
  type VillageGiftResponse,
} from '@heartpatch/shared';
import { HOLLOWED_HELPER_GIFT } from '@heartpatch/shared/server';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { refreshHomesteads } from '../explore/homesteads.js';
import { takeDownInnerFences } from '../fences/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { guardWatchesOf, writeGuardCheckpoints } from '../jobs/contentment.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTendingRepo, createTerritoryRepo } from '../territory/repo.js';
import {
  communitiesTransaction,
  createCommunitiesRepo,
  type CommunityTileRow,
  type RestoreTileRow,
} from './repo.js';
import { communitiesView, villageMorning } from './service.js';

/*
 * Restoring a grey village (#306 PR 3, plan v3 Q1–Q3). The server is the
 * authority (CLAUDE.md rule 1): it prices each piece from data, checks the
 * day and my reach, and decides who claims. A piece is one transaction
 * (rule 7): the Heartdust and resources it costs, the piece and its ledger
 * row, the tile's claim on its last piece and, on the village's last, the
 * win and the ring. Lock order (tech spec §7): the village's tiles and its
 * ring (step 6, one id-ordered lock), the guards leaving the ring (6), my
 * explored rows (`refreshHomesteads`, 6), the community row then its tiles'
 * rows (6), my fences facing the new land (8), those guards (10), my bag
 * (11), then `maps`.
 */

const MESSAGES = {
  noTile: "We couldn't find that spot.",
  problem: {
    won: 'This village is already restored! 🌈',
    restored: 'This spot is all fixed up! Try another grey tile 🛠️',
    night: 'Too spooky after dark! Come back in the morning 🌙',
    away: 'Claim land next to it to restore it!',
  } satisfies Record<RestoreProblem, string>,
  notWinner: 'Only the Keeper who restored it can name it!',
  notYourGift: 'Only the Keeper who restored it gets its gift!',
  noGift: 'This village has no morning gift.',
  giftTaken: 'You got today’s gift! Come back tomorrow morning 🌅',
  seedFirst: 'Your village’s Heart Seed needs to grow first 🌱',
} as const;

const PROBLEM_CODES: Record<RestoreProblem, 'CONFLICT' | 'FORBIDDEN'> = {
  won: 'CONFLICT',
  restored: 'CONFLICT',
  night: 'FORBIDDEN',
  away: 'FORBIDDEN',
};

/**
 * A village seed's level. Village seeds don't grow yet (#221 and plan Q8),
 * so a won village is named once; `named_at_level` opens a rename the day
 * they do, as a home's does.
 */
const VILLAGE_SEED_LEVEL = 1;

export interface RestoreServiceOptions {
  db: Database;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
}

export interface RestoreService {
  view: (
    user: PublicUser,
    mapId: string,
    communityId: string,
    tile: CommunityTileQuery,
  ) => Promise<RestoreTileResponse>;
  restore: (
    user: PublicUser,
    mapId: string,
    communityId: string,
    request: RestorePieceRequest,
  ) => Promise<RestoreTileResponse>;
  name: (
    user: PublicUser,
    mapId: string,
    communityId: string,
    request: CommunityNameRequest,
  ) => Promise<CommunityView>;
  /**
   * Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): the grey village my land
   * touches gets every unrestored tile to one piece short, and my bag what
   * those last pieces cost. Replies with the village, or NOT_FOUND.
   */
  devAlmost: (
    user: PublicUser,
    mapId: string,
    communityId?: string,
    kind?: CommunityKindId,
  ) => Promise<CommunityView>;
  /**
   * This morning's gift from a won village of a gift kind (PR 3b: the Old
   * Well, the Bakery), into its winner's bag, once a morning.
   */
  collectGift: (
    user: PublicUser,
    mapId: string,
    communityId: string,
  ) => Promise<VillageGiftResponse>;
}

/** Adds `items` into `into`. */
function addInto(into: ItemCounts, items: Readonly<Record<string, number>>): void {
  for (const [id, n] of Object.entries(items)) into[id] = (into[id] ?? 0) + n;
}

/** Every place the village and its ring cover, each once. */
function placesOf(square: Hex, village: readonly Hex[]): Hex[] {
  const seen = new Map<string, Hex>();
  for (const h of [...villageRing(square), ...village]) seen.set(hexKey(h), h);
  return [...seen.values()];
}

export function createRestoreService(options: RestoreServiceOptions): RestoreService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const published = (mapId: string) => {
    void Promise.resolve(options.publish?.(mapId)).catch(() => undefined);
  };

  /** The village and the tile asked for, unlocked; NOT_FOUND when either isn't there. */
  const findVillageTile = async (tx: Executor, mapId: string, communityId: string, at: Hex) => {
    const repo = createCommunitiesRepo(tx);
    const community = await repo.findCommunity(mapId, communityId);
    if (!community) throw new AppError('NOT_FOUND', MESSAGES.noTile);
    const village = await repo.listCommunityTiles(communityId);
    const square = village.find((t) => t.tileId === community.seedTileId);
    const tile = village.find((t) => t.q === at.q && t.r === at.r);
    if (!square || !tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
    return { community, village, square, tile };
  };

  /** The sheet for one tile, as `user` sees it now (read inside the caller's transaction). */
  const sheet = async (
    tx: Executor,
    user: PublicUser,
    mapId: string,
    communityId: string,
    at: Date,
    tile: CommunityTileRow,
    terrain: string,
    extra: Pick<RestoreTileResponse, 'outcome' | 'gift'> = {},
  ): Promise<RestoreTileResponse> => {
    const repo = createCommunitiesRepo(tx);
    const [mapTiles, map, helpers] = await Promise.all([
      createTerritoryRepo(tx).listTiles(mapId),
      createMapsRepo(tx).findMap(mapId),
      repo.helpers(tile.tileId),
    ]);
    if (!map) throw new AppError('NOT_FOUND', MESSAGES.noTile);
    const view = (
      await communitiesView(tx, {
        mapId,
        userId: user.id,
        tiles: mapTiles,
        morning: villageMorning(at, map.timeZone),
      })
    ).find((c) => c.id === communityId);
    if (!view) throw new AppError('NOT_FOUND', MESSAGES.noTile);
    const cost = pieceCost(terrain, COMMUNITY_RULES);
    const bag = await createInventoryRepo(tx).list({ mapId, userId: user.id });
    const have = Object.fromEntries(Object.keys(cost).map((id) => [id, bag[id] ?? 0]));
    const problem = restoreProblem({
      won: view.ownerUserId !== null,
      piecesDone: tile.piecesDone,
      piecesNeeded: tile.piecesNeeded,
      open: hollowedOpenAt(mapLocalTime(at, map.timeZone), { ...HOME_BASE_RULES, ...HOLLOW_RULES }),
      reach: view.reach,
    });
    return {
      community: view,
      tile: {
        q: tile.q,
        r: tile.r,
        piecesDone: tile.piecesDone,
        piecesNeeded: tile.piecesNeeded,
        restoredBy: tile.restoredBy,
      },
      cost,
      have,
      helpers,
      problem,
      ...extra,
    };
  };

  /** The terrain of a village tile (its row on the map). */
  const terrainOf = async (tx: Executor, mapId: string, at: Hex): Promise<string> =>
    (await createTerritoryRepo(tx).findTile(mapId, at.q, at.r))?.terrain ?? 'meadow';

  return {
    view: async (user, mapId, communityId, at) =>
      communitiesTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const { tile } = await findVillageTile(tx, mapId, communityId, at);
        return sheet(tx, user, mapId, communityId, now(), tile, await terrainOf(tx, mapId, at));
      }),

    restore: async (user, mapId, communityId, request) => {
      const result = await communitiesTransaction(db, async (repo, tx) => {
        const at = now();
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        const found = await findVillageTile(tx, mapId, communityId, request);

        // Step 6: the village and its ring, one id-ordered lock. Every
        // piece on this village takes the same tiles first, so pieces take
        // turns, and its rows read now hold until this one commits: every
        // writer of them (a piece, a leave's uproot) holds these tiles.
        const square: Hex = { q: found.square.q, r: found.square.r };
        const locked = await repo.lockTilesAt(mapId, placesOf(square, found.village));
        const community = await repo.findCommunity(mapId, communityId);
        const village = await repo.listCommunityTiles(communityId);
        const tile = village.find((t) => t.tileId === found.tile.tileId);
        const tileRow = locked.find((t) => t.id === found.tile.tileId);
        if (!community || !tile || !tileRow) throw new AppError('NOT_FOUND', MESSAGES.noTile);

        // A retry of a tap that already went in: nothing more to pay.
        if (request.piecesDone !== tile.piecesDone) {
          return sheet(tx, user, mapId, communityId, at, tile, tileRow.terrain);
        }

        const territory = createTerritoryRepo(tx);
        const mapTiles = await territory.listTiles(mapId);
        const { reach } = communityReach(
          village.map((t) => ({ q: t.q, r: t.r })),
          mapTiles,
          user.id,
        );
        const problem = restoreProblem({
          won: community.ownerUserId !== null,
          piecesDone: tile.piecesDone,
          piecesNeeded: tile.piecesNeeded,
          open: hollowedOpenAt(mapLocalTime(at, map.timeZone), {
            ...HOME_BASE_RULES,
            ...HOLLOW_RULES,
          }),
          reach,
        });
        if (problem) throw new AppError(PROBLEM_CODES[problem], MESSAGES.problem[problem]);
        // A grey tile is always wild (claims and challenges are refused on
        // village tiles); anything else is a tile we shouldn't touch.
        if (tileRow.ownerUserId !== null) {
          throw new AppError('CONFLICT', MESSAGES.problem.restored);
        }

        const cost = pieceCost(tileRow.terrain, COMMUNITY_RULES);
        const piecesDone = tile.piecesDone + 1;
        const last = piecesDone >= tile.piecesNeeded;
        // Every piece that doesn't claim its tile thanks its helper (plan Q2).
        const gift: ItemCounts = last ? {} : { ...HOLLOWED_HELPER_GIFT };
        let outcome: RestoreTileResponse['outcome'] = 'piece';
        /** Tiles that became mine just now: wild before (for my fences facing them). */
        const gained: RestoreTileRow[] = [];
        /** My own land the ring took in: its guards go home. */
        const converted: RestoreTileRow[] = [];
        /** The win: the name it wears and the ring planted. */
        let won: { name: string; ring: RestoreTileRow[] } | null = null;

        if (last) {
          outcome = 'tile';
          // First to finish claims the tile (plan Q2): ordinary land until the
          // village is won, tended now like any claim.
          await territory.setOwner(tile.tileId, user.id);
          await createTendingRepo(tx).claim(mapId, tile.tileId, at);
          gained.push(tileRow);

          // The village's last tile, and every one of them mine: it's won.
          const owners = new Map(locked.map((t) => [t.id, t.ownerUserId]));
          owners.set(tile.tileId, user.id);
          const winner = villageWinner(
            village.map((t) => ({
              restored: t.tileId === tile.tileId || t.restoredAt !== null,
              ownerUserId: owners.get(t.tileId) ?? null,
            })),
          );
          const slot = (await createMapsRepo(tx).membership(mapId, user.id))?.homeSlot ?? null;
          // Every seated member has a slot; a member without one (none on a
          // patch today) claims the tile but plants no ring.
          if (winner === user.id && slot !== null) {
            outcome = 'village';
            const [name = community.name] = restoredNameIdeas(
              community.name,
              COMMUNITY_RULES,
              MAP_GEN.communities,
            );
            // The ring (plan v3 Q3): the square and its neighbours that are
            // wild or mine become my home tiles; someone else's stay theirs.
            // My own tile with a building or a clear on it stays my land for
            // now (a gap): home tiles follow other building rules.
            const busy = await repo.busyTiles(
              locked.filter((t) => t.ownerUserId === user.id).map((t) => t.id),
            );
            const ring = ringToPlant(
              square,
              locked.map((t) => (t.id === tile.tileId ? { ...t, ownerUserId: user.id } : t)),
              user.id,
              communityId,
            ).filter((t) => !busy.has(t.id));
            await repo.plantRing(
              ring.map((t) => t.id),
              { userId: user.id, homeSlot: slot, communityId },
            );
            const ringIds = new Set(ring.map((t) => t.id));
            for (const t of locked) {
              if (!ringIds.has(t.id) || t.id === tile.tileId) continue;
              if (t.ownerUserId === null) gained.push(t);
              else converted.push(t);
            }
            won = { name, ring };
          }
        }

        // Guards on my land the ring took in go home: home tiles hold no
        // watch. Their watch so far held (#376): read before the posts go.
        const guardIds: string[] = [];
        for (const t of [...converted].sort((a, b) => (a.id < b.id ? -1 : 1))) {
          guardIds.push(...(await territory.listDefenders(t.id, user.id)).map((g) => g.id));
        }
        const watches = await guardWatchesOf(tx, guardIds);
        for (const t of converted) await territory.clearDefenders(t.id);

        // Homesteads (#199): new land may join or wake mine (step 6).
        const homesteads =
          gained.length > 0 ? await refreshHomesteads(tx, mapId, [user.id], at) : [];

        // The village's rows (step 6, after the tile rows above, as a leave's
        // uproot takes them): the piece, the tile's restorer, the win.
        await repo.lockCommunity(communityId);
        const fresh = (await repo.listCommunityTiles(communityId, true)).find(
          (t) => t.tileId === tile.tileId,
        );
        if (fresh?.piecesDone !== tile.piecesDone) {
          throw new Error('restore: a village tile changed under its tile lock');
        }
        const pieceId = await repo.addPiece({
          tileId: tile.tileId,
          userId: user.id,
          paid: cost,
          at,
        });
        const events: NewGameEvent[] = [
          {
            mapId,
            type: 'community.mended',
            actorUserId: user.id,
            payload: {
              communityId,
              userId: user.id,
              q: tile.q,
              r: tile.r,
              piecesDone,
              piecesNeeded: tile.piecesNeeded,
            },
          },
        ];
        if (last) {
          await repo.markRestored(tile.tileId, user.id, at);
          events.push({
            mapId,
            type: 'tile.restored',
            actorUserId: user.id,
            payload: { communityId, userId: user.id, q: tile.q, r: tile.r },
          });
        }
        if (won) {
          await repo.win(communityId, user.id, at, won.name);
          events.push({
            mapId,
            type: 'community.restored',
            actorUserId: user.id,
            payload: {
              communityId,
              userId: user.id,
              square,
              ring: won.ring.map((t) => ({ q: t.q, r: t.r })),
              name: won.name,
            },
          });
        }
        events.push(...homesteads);

        // My fences that faced the new land now stand inside it (step 8).
        const fences = await takeDownInnerFences(
          tx,
          mapId,
          gained,
          user.id,
          await territory.listTiles(mapId),
        );
        // Step 10: the guards that went home write their checkpoints.
        await createSquishyJobsRepo(tx).lockSquishies([...guardIds].sort());
        await writeGuardCheckpoints(tx, watches, at);

        // Step 11: my bag, once: the piece, the thank-you and the fences' share.
        const grants: ItemCounts = { ...gift };
        for (const f of fences) addInto(grants, f.refund);
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: { ...cost, ...grants } }]);
        const owner = { mapId, userId: user.id };
        // Short of something: CONFLICT ("You need 2 more Timber first!") and nothing is written.
        await consumeItems(tx, owner, cost, 'restore', pieceId, at);
        if (Object.keys(gift).length > 0) {
          await grantItems(tx, owner, gift, 'restore-gift', pieceId, at);
        }
        for (const f of fences) {
          if (Object.keys(f.refund).length > 0) {
            await grantItems(tx, owner, f.refund, 'build-refund', f.fenceId, at);
          }
        }

        // `maps` last.
        for (const f of fences) events.push(f.event);
        for (const event of events) await repo.appendEvent(event);
        const after = (await repo.listCommunityTiles(communityId)).find(
          (t) => t.tileId === tile.tileId,
        );
        return sheet(tx, user, mapId, communityId, at, after ?? tile, tileRow.terrain, {
          outcome,
          ...(Object.keys(gift).length > 0 ? { gift } : {}),
        });
      });
      published(mapId);
      return result;
    },

    devAlmost: async (user, mapId, communityId, kind) =>
      communitiesTransaction(db, async (repo, tx) => {
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        const morning = villageMorning(now(), map.timeZone);
        const village = (
          await communitiesView(tx, { mapId, userId: user.id, tiles, morning })
        ).find(
          (c) =>
            c.ownerUserId === null &&
            c.reach === 'touching' &&
            (communityId === undefined || c.id === communityId),
        );
        if (!village) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        const left = (await repo.listCommunityTiles(village.id)).filter(
          (t) => t.restoredAt === null,
        );
        const bill: ItemCounts = {};
        for (const t of left) {
          const terrain = tiles.find((m) => m.q === t.q && m.r === t.r)?.terrain ?? 'meadow';
          addInto(bill, pieceCost(terrain, COMMUNITY_RULES));
        }
        await repo.devAlmost(left.map((t) => t.tileId));
        if (kind) await repo.devKind(village.id, kind);
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: bill }]);
        await grantItems(tx, { mapId, userId: user.id }, bill, 'dev-grant');
        return kind ? { ...village, kind } : village;
      }),

    name: async (user, mapId, communityId, { name }) => {
      // The text filter before any lock (CLAUDE.md rule 9): VALIDATION_FAILED.
      assertAllowedText(name, 'name');
      const result = await communitiesTransaction(db, async (repo, tx) => {
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        if (!(await repo.findCommunity(mapId, communityId))) {
          throw new AppError('NOT_FOUND', MESSAGES.noTile);
        }
        // The community row (step 6; no tiles change), then `maps`.
        const community = await repo.lockCommunity(communityId);
        if (!community) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        if (community.ownerUserId !== user.id) {
          throw new AppError('FORBIDDEN', MESSAGES.notWinner);
        }
        if (community.namedAtLevel !== null && VILLAGE_SEED_LEVEL <= community.namedAtLevel) {
          throw new AppError('FORBIDDEN', MESSAGES.seedFirst);
        }
        await repo.setName(communityId, name, VILLAGE_SEED_LEVEL);
        await repo.appendEvent({
          mapId,
          type: 'community.named',
          actorUserId: user.id,
          payload: { communityId, userId: user.id, name },
        });
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        const morning = villageMorning(now(), map.timeZone);
        const view = (await communitiesView(tx, { mapId, userId: user.id, tiles, morning })).find(
          (c) => c.id === communityId,
        );
        if (!view) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        return view;
      });
      published(mapId);
      return result;
    },

    collectGift: async (user, mapId, communityId) => {
      const result = await communitiesTransaction(db, async (repo, tx) => {
        const at = now();
        const { map } = await requireMember(tx, user, mapId, ['multiplayer']);
        if (!(await repo.findCommunity(mapId, communityId))) {
          throw new AppError('NOT_FOUND', MESSAGES.noTile);
        }
        // The community row (step 6) holds a double tap until this one commits,
        // then my bag (11), then `maps` (the event).
        const community = await repo.lockCommunity(communityId);
        if (!community) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        if (community.ownerUserId !== user.id) {
          throw new AppError('FORBIDDEN', MESSAGES.notYourGift);
        }
        const gift = morningGiftOf(community.kind, COMMUNITY_RULES);
        if (!gift) throw new AppError('CONFLICT', MESSAGES.noGift);
        const morning = villageMorning(at, map.timeZone);
        if ((await repo.giftsCollectedSince(mapId, user.id, [communityId], morning)).size > 0) {
          throw new AppError('CONFLICT', MESSAGES.giftTaken);
        }
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: gift }]);
        await grantItems(tx, { mapId, userId: user.id }, gift, 'village-gift', communityId, at);
        await repo.appendEvent({
          mapId,
          type: 'community.gift',
          actorUserId: user.id,
          payload: { communityId, userId: user.id, items: { ...gift } },
        });
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        const view = (await communitiesView(tx, { mapId, userId: user.id, tiles, morning })).find(
          (c) => c.id === communityId,
        );
        if (!view) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        return { community: view, gift: { ...gift } };
      });
      published(mapId);
      return result;
    },
  };
}
