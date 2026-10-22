import {
  BATTLE_RULES,
  cellarSpots,
  COMMUNITY_RULES,
  EXPLORE_RULES,
  hexKey,
  hexNeighbors,
  isSearched,
  isTradingPost,
  keyInReach,
  Rng,
  searchedCount,
  withSearched,
  type CellarSearchRequest,
  type CellarView,
  type CommunityView,
  type ExploreNotable,
  type Hex,
  type HexKey,
  type ItemCounts,
  type PublicUser,
  type SearchSpotResponse,
  type ToolId,
} from '@heartpatch/shared';
import { CELLAR_FINDS, LORE_PAGES, rollExploreFind } from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { grantItems, lockGrantRows } from '../inventory/service.js';
import { createLoreRepo } from '../lore/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import {
  communitiesTransaction,
  createCommunitiesRepo,
  type CellarRow,
  type CommunityRow,
} from './repo.js';
import { communitiesView, villageMorning } from './service.js';

/*
 * The key hunt and the hidden cellar (#306 PR 2c, owner decision 5 of
 * 2026-10-18). Winning a village gives its winner a map to the tile where
 * the village squishies hid the cellar key (`CommunityView.cellar`). They
 * dig it up there once their land reaches it, then open the cellar under
 * the square and search its spots, once each, for better finds than a grey
 * tile's (`CELLAR_FINDS`). The server is the authority (rule 1): the key's
 * tile, the spots' layout (from the village's secret seed) and the finds
 * stay here (rule 6).
 *
 * The key's tile can be anyone's land, or busy (a building, a guard, a
 * battle): digging the key up only reads who holds the tiles around it and
 * writes nothing there, so it changes nobody's land. The key and the cellar
 * are the village's winner's alone.
 *
 * Lock order (tech spec §7): the community row, then the square's
 * `community_tiles` row (step 6); a search then the team's squishies (10)
 * and the bag (11); `maps` last.
 */

const MESSAGES = {
  noVillage: "We couldn't find that village.",
  notWinner: 'Only the Keeper who restored this village has its map! 🗺️',
  keyFound: 'You already found this key! 🔑',
  keyAway: 'Claim land next to it to dig for the key!',
  noKey: 'Find the cellar key first! 🗺️',
  cellarOpen: 'The cellar is already open! 🕯️',
  cellarShut: 'Open the cellar with its key first! 🔑',
  noSpot: "We couldn't find that spot.",
  searched: 'You already searched there!',
  noPath: 'No free land between you and the key.',
} as const;

const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));

export interface CellarServiceOptions {
  db: Database;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
  /** Tests swap the find roll. */
  rng?: () => Rng;
}

export interface CellarService {
  /** Dig the cellar key up on the tile the map points to. */
  digKey: (user: PublicUser, mapId: string, communityId: string) => Promise<CommunityView>;
  /** Open the cellar under the square with the key. */
  open: (user: PublicUser, mapId: string, communityId: string) => Promise<CommunityView>;
  /** The open cellar up close: its spots and which are done. */
  view: (user: PublicUser, mapId: string, communityId: string) => Promise<CellarView>;
  /** Search one cellar spot. */
  search: (
    user: PublicUser,
    mapId: string,
    communityId: string,
    request: CellarSearchRequest,
  ) => Promise<SearchSpotResponse>;
  /** Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): my land reaches a village's key tile, won or not. */
  devKeyReach: (user: PublicUser, mapId: string, communityId: string) => Promise<Hex>;
}

/** Uses left of each tool in a bag (the cellar needs none; the view shows them as explore does). */
function toolUses(items: ItemCounts): Record<ToolId, number> {
  return {
    shovel: items['shovel'] ?? 0,
    net: items['net'] ?? 0,
    rope: items['rope'] ?? 0,
    lantern: items['lantern'] ?? 0,
  };
}

/** The find worth telling the patch about, as explore tells it. */
function notableOf(items: ItemCounts, lore: string | null, clothing: string | null) {
  const notable: ExploreNotable | null = lore
    ? 'lore'
    : clothing
      ? 'cosmetic'
      : (items[COMMUNITY_RULES.joyResource] ?? 0) > 0
        ? 'heartdust'
        : null;
  return notable;
}

/** The village's square, where its cellar is. */
async function squareOf(tx: Executor, community: CommunityRow): Promise<Hex & { id: string }> {
  const square = await createCommunitiesRepo(tx).tileById(community.seedTileId);
  if (!square) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
  return square;
}

/** My won village's open cellar, or a kid-readable error. */
function openCellarOf(
  community: CommunityRow | null,
  cellar: CellarRow | null,
  userId: string,
): { community: CommunityRow; cellar: CellarRow } {
  if (!community || !cellar) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
  if (community.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notWinner);
  if (cellar.openedAt === null) throw new AppError('CONFLICT', MESSAGES.cellarShut);
  return { community, cellar };
}

export function createCellarService(options: CellarServiceOptions): CellarService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rngFor = options.rng ?? (() => Rng.fromSeed(newSeed()));
  const published = (mapId: string) => {
    void Promise.resolve(options.publish?.(mapId)).catch(() => undefined);
  };

  /** The village as `userId` sees it now (inside the caller's transaction). */
  const viewOf = async (
    tx: Executor,
    mapId: string,
    userId: string,
    communityId: string,
    at: Date,
  ): Promise<CommunityView> => {
    const map = await createMapsRepo(tx).findMap(mapId);
    if (!map) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
    const tiles = await createTerritoryRepo(tx).listTiles(mapId);
    const morning = villageMorning(at, map.timeZone);
    const view = (await communitiesView(tx, { mapId, userId, tiles, morning })).find(
      (c) => c.id === communityId,
    );
    if (!view) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
    return view;
  };

  /** My won village, its community row locked (step 6), or a kid-readable error. */
  const lockMine = async (tx: Executor, mapId: string, communityId: string, userId: string) => {
    const repo = createCommunitiesRepo(tx);
    if (!(await repo.findCommunity(mapId, communityId))) {
      throw new AppError('NOT_FOUND', MESSAGES.noVillage);
    }
    const community = await repo.lockCommunity(communityId);
    if (!community) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
    if (community.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notWinner);
    return community;
  };

  return {
    digKey: async (user, mapId, communityId) => {
      const result = await communitiesTransaction(db, async (repo, tx) => {
        const at = now();
        await requireMember(tx, user, mapId, ['multiplayer']);
        // The community row holds a double tap until this one commits.
        const community = await lockMine(tx, mapId, communityId, user.id);
        if (community.keyRevealedAt !== null) throw new AppError('CONFLICT', MESSAGES.keyFound);
        const key = await repo.tileById(community.keyTileId);
        if (!key) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        // Only read: whoever holds the key's tile keeps it, untouched.
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        if (!keyInReach(key, tiles, user.id)) throw new AppError('FORBIDDEN', MESSAGES.keyAway);
        await repo.revealKey(communityId, at);
        await repo.appendEvent({
          mapId,
          type: 'key.found',
          actorUserId: user.id,
          payload: { communityId, userId: user.id, q: key.q, r: key.r },
        });
        return viewOf(tx, mapId, user.id, communityId, at);
      });
      published(mapId);
      return result;
    },

    open: async (user, mapId, communityId) => {
      const result = await communitiesTransaction(db, async (repo, tx) => {
        const at = now();
        await requireMember(tx, user, mapId, ['multiplayer']);
        const community = await lockMine(tx, mapId, communityId, user.id);
        if (community.keyRevealedAt === null) throw new AppError('CONFLICT', MESSAGES.noKey);
        const cellar = await repo.cellarOf(communityId, true);
        if (!cellar) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        if (cellar.openedAt !== null) throw new AppError('CONFLICT', MESSAGES.cellarOpen);
        await repo.openCellar(cellar.tileId, at);
        await repo.appendEvent({
          mapId,
          type: 'cellar.opened',
          actorUserId: user.id,
          payload: { communityId, userId: user.id },
        });
        return viewOf(tx, mapId, user.id, communityId, at);
      });
      published(mapId);
      return result;
    },

    view: async (user, mapId, communityId) => {
      await requireMember(db, user, mapId, ['multiplayer']);
      const repo = createCommunitiesRepo(db);
      const found = await repo.findCommunity(mapId, communityId);
      const { community, cellar } = openCellarOf(
        found,
        found ? await repo.cellarOf(communityId) : null,
        user.id,
      );
      const square = await squareOf(db, community);
      const spots = cellarSpots(community.seed, COMMUNITY_RULES, EXPLORE_RULES);
      const { searched } = cellar;
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });
      return {
        q: square.q,
        r: square.r,
        terrain: COMMUNITY_RULES.cellar.terrain,
        spots: spots.map((s) => ({ ...s, done: isSearched(searched, s.index) })),
        needs: [],
        progress: { searched: searchedCount(searched, spots.length), total: spots.length },
        homestead: null,
        tools: toolUses(items),
        cellar: { communityId, name: community.restoredName ?? community.name },
      };
    },

    search: async (user, mapId, communityId, request) => {
      const at = now();
      const result = await communitiesTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        // Step 6: the community row (a leave's uproot takes it too), then the cellar's.
        const locked = await lockMine(tx, mapId, communityId, user.id);
        const { community, cellar } = openCellarOf(
          locked,
          await repo.cellarOf(communityId, true),
          user.id,
        );
        const { tileId, searched: before } = cellar;
        const spots = cellarSpots(community.seed, COMMUNITY_RULES, EXPLORE_RULES);
        const spot = spots.find((s) => s.index === request.spot);
        if (!spot) throw new AppError('NOT_FOUND', MESSAGES.noSpot);
        if (isSearched(before, spot.index)) throw new AppError('CONFLICT', MESSAGES.searched);
        const searched = withSearched(before, spot.index);
        await repo.setCellarSearched(tileId, searched);

        // What it found: the server rolls it (rule 1); a page already found isn't rolled again.
        const terrain = COMMUNITY_RULES.cellar.terrain;
        const foundLore = new Set(
          (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
        );
        const roll = rollExploreFind(
          CELLAR_FINDS,
          { kind: spot.kind, terrain },
          rngFor(),
          foundLore,
        );
        // PR 5 (Rekindled rewards) adds its cellar drop here, once its tables are on main.

        // Step 10: the team's XP, plain, as exploring gives it (squishies in id order).
        const team = await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize);
        const growths: Growth[] = [];
        for (const squishyId of team.map((s) => s.id).sort()) {
          const growth = await applyXp(tx, squishyId, EXPLORE_RULES.xpPerSquishy, at, {
            plain: true,
          });
          if (growth) growths.push(growth);
        }

        // Step 11: the bag.
        const owner = { mapId, userId: user.id };
        const searchId = uuidv7();
        if (Object.keys(roll.items).length > 0) {
          await lockGrantRows(tx, mapId, [{ userId: user.id, items: roll.items }]);
          await grantItems(tx, owner, roll.items, 'explore', searchId);
        }
        // Found clothing appends its own event first; ours stay the last writes.
        const clothing = await rollFoundDrop(tx, {
          source: 'explore',
          refId: searchId,
          userId: user.id,
          mapId,
          tileId,
          at,
        });
        const notable = notableOf(roll.items, roll.lore, clothing);
        const square = await squareOf(tx, community);
        // An explore search like any other, at the square: the lore pages
        // and the Seeker track count it the same way.
        const events: NewGameEvent[] = [
          {
            mapId,
            type: 'explore.searched',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              q: square.q,
              r: square.r,
              terrain,
              searchId,
              spot: spot.index,
              kind: spot.kind,
              tool: null,
              items: roll.items,
              lorePage: roll.lore,
              notable,
            },
          },
          ...growthEvents(growths),
        ];
        for (const event of events) await repo.appendEvent(event);

        const items = await createInventoryRepo(tx).list(owner);
        return {
          spot: spot.index,
          found: roll.items,
          lore: roll.lore ? { id: roll.lore, title: LORE_TITLES.get(roll.lore) ?? '' } : null,
          clothing,
          notable,
          xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
          tool: null,
          progress: { searched: searchedCount(searched, spots.length), total: spots.length },
          explored: false,
          homestead: null,
          items,
        } satisfies SearchSpotResponse;
      });
      published(mapId);
      return result;
    },

    devKeyReach: async (user, mapId, communityId) => {
      const result = await communitiesTransaction(db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        // Dev only, so e2e can claim toward the key before the win: the
        // community row is only read, and the tiles lock first (step 6).
        const community = await repo.findCommunity(mapId, communityId);
        if (!community) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        const key = await repo.tileById(community.keyTileId);
        if (!key) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        if (keyInReach(key, tiles, user.id)) return { q: key.q, r: key.r };
        // Breadth first out from my land over free wild tiles, to one next to the key.
        const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
        const free = (t: (typeof tiles)[number]) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          t.communityId === null &&
          !isTradingPost(t) &&
          t.terrain !== 'junipers-gap';
        const goal = new Set(hexNeighbors(key).map(hexKey));
        const from = new Map<HexKey, HexKey | null>();
        let frontier = tiles.filter((t) => t.ownerUserId === user.id).map(hexKey);
        for (const k of frontier) from.set(k, null);
        let end: HexKey | null = null;
        while (frontier.length > 0 && end === null) {
          const next: HexKey[] = [];
          for (const k of frontier) {
            const at = byKey.get(k);
            if (!at) continue;
            for (const n of hexNeighbors(at)) {
              const nk = hexKey(n);
              const tile = byKey.get(nk);
              if (from.has(nk) || !tile || !free(tile)) continue;
              from.set(nk, k);
              if (goal.has(nk)) {
                end = nk;
                break;
              }
              next.push(nk);
            }
            if (end !== null) break;
          }
          frontier = next;
        }
        if (end === null) throw new AppError('CONFLICT', MESSAGES.noPath);
        const path: string[] = [];
        for (let k: HexKey | null = end; k !== null; k = from.get(k) ?? null) {
          const tile = byKey.get(k);
          if (tile && tile.ownerUserId === null) path.push(tile.id);
        }
        await repo.devClaim(path, user.id);
        return { q: key.q, r: key.r };
      });
      published(mapId);
      return result;
    },
  };
}
