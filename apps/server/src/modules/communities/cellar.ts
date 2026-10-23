import {
  BATTLE_RULES,
  cellarSpots,
  COMMUNITY_RULES,
  EXPLORE_RULES,
  hexKey,
  hexNeighbors,
  isBigChest,
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
import {
  CELLAR_FINDS,
  CELLAR_RULES,
  LORE_PAGES,
  NOTHING_FOUND,
  rollExploreFind,
  withFoundItems,
  type FoundSetRoll,
} from '@heartpatch/shared/server';
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
import { grantFoundPiece, rollFoundDrop } from '../wardrobe/drops.js';
import { createWardrobeRepo } from '../wardrobe/repo.js';
import { grantRekindledPiece, rekindledDrop } from '../wardrobe/rekindled.js';
import {
  communitiesTransaction,
  createCommunitiesRepo,
  type CellarRow,
  type CommunityRow,
} from './repo.js';
import { communitiesView, villageMorning } from './service.js';

/*
 * The key hunt and the hidden cellar (#306 PR 2c, owner decision 5 of
 * 2026-10-18). Winning a village gives its winner a treasure map to the tile
 * where the village squishies hid the cellar key (`CommunityView.cellar`).
 * They find it by exploring that tile once it's theirs (owner decision
 * 2026-10-22: a glinting spot, modules/explore), then open the cellar under
 * the square: a stone vault (owner decision of 2026-10-22) whose small
 * chests each open once for better finds than a grey tile's (`CELLAR_FINDS`),
 * and whose big chest gives the cellar's best loot, a big pile and the
 * Hollow kind's keepsake (`CELLAR_RULES.bigChest`). A chest is a cellar spot,
 * so opening one is a search. The server is the authority (rule 1): the
 * key's tile, the chests (from the village's secret seed), the finds and the
 * keepsakes stay here (rule 6). The key and the cellar are the village's
 * winner's alone.
 *
 * Lock order (tech spec §7): the community row, then the square's
 * `community_tiles` row (step 6); a search then the team's squishies (10)
 * and the bag (11); `maps` last.
 */

const MESSAGES = {
  noVillage: "We couldn't find that place.",
  notWinner: 'Only the Keeper who brought this Hollow back has its map! 🗺️',
  noKey: 'Find the cellar key first! 🗺️',
  cellarOpen: 'The cellar is already open! 🕯️',
  cellarShut: 'Open the cellar with its key first! 🔑',
  noSpot: "We couldn't find that spot.",
  searched: 'You already opened that chest!',
  smallFirst: 'Open the little chests first! 🗝️',
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
  /** Open the cellar under the square with the key. */
  open: (user: PublicUser, mapId: string, communityId: string) => Promise<CommunityView>;
  /** The open cellar up close: its spots and which are done. */
  view: (user: PublicUser, mapId: string, communityId: string) => Promise<CellarView>;
  /** Open one cellar chest (a spot: the big chest is the last). */
  search: (
    user: PublicUser,
    mapId: string,
    communityId: string,
    request: CellarSearchRequest,
  ) => Promise<SearchSpotResponse>;
  /** Dev and e2e only (`HP_DEV_SQUISHY_GRANTS`): I hold a village's key tile, won or not (when it's wild). */
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

/**
 * A big chest's keepsake (#306): one-of-a-kind, so never a second copy for a
 * Keeper who has it from another Hollow of the same kind. Returns the item
 * granted, or null.
 */
export async function grantKeepsake(
  tx: Executor,
  drop: Parameters<typeof grantFoundPiece>[1],
  itemId: string,
): Promise<string | null> {
  // Only read (no lock): the cellar's row lock holds one village, so two
  // same-kind cellars opened at the same instant on two patches could each
  // give one. Harmless for an untradable piece (TECH_SPEC lock order).
  const owned = await createWardrobeRepo(tx).countOwned(drop.userId);
  if ((owned.get(itemId) ?? 0) > 0) return null;
  return grantFoundPiece(tx, drop, itemId);
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
        const big = isBigChest(spot);
        const { bigChest } = CELLAR_RULES;
        if (
          big &&
          bigChest.afterSmall &&
          spots.some((s) => !isBigChest(s) && !isSearched(before, s.index))
        ) {
          throw new AppError('CONFLICT', MESSAGES.smallFirst);
        }
        const searched = withSearched(before, spot.index);
        await repo.setCellarSearched(tileId, searched);

        // What it found: the server decides (rule 1). The big chest holds its
        // fixed pile; a small chest rolls, and a page already found isn't
        // rolled again.
        const terrain = COMMUNITY_RULES.cellar.terrain;
        let roll: { items: ItemCounts; lore: string | null };
        let rekindled: FoundSetRoll = NOTHING_FOUND;
        if (big) {
          roll = { items: { ...bigChest.items }, lore: null };
        } else {
          const foundLore = new Set(
            (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
          );
          roll = rollExploreFind(CELLAR_FINDS, { kind: spot.kind, terrain }, rngFor(), foundLore);
          // The Rekindled set's cellar odds (#306 PR 5): rolled now, so its finds
          // join the one bag grant below. Reads only, so the lock order holds.
          rekindled = await rekindledDrop(
            tx,
            { place: 'cellar', userId: user.id, mapId, at },
            { rng: rngFor() },
          );
        }
        const found = withFoundItems(roll.items, rekindled);

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
        if (Object.keys(found).length > 0) {
          await lockGrantRows(tx, mapId, [{ userId: user.id, items: found }]);
          await grantItems(tx, owner, found, 'explore', searchId);
        }
        // Found clothing appends its own event first; ours stay the last writes.
        // The big chest's keepsake, or a Rekindled piece, is this search's one
        // piece of clothing. A keepsake already owned (a second Hollow of the
        // same kind) isn't given twice: the pile still is.
        const drop = { source: 'explore' as const, refId: searchId, userId: user.id, mapId, at };
        const clothing = big
          ? await grantKeepsake(tx, drop, bigChest.keepsakes[community.kind])
          : ((await grantRekindledPiece(tx, drop, rekindled)) ??
            (await rollFoundDrop(tx, { ...drop, tileId })));
        const notable = notableOf(found, roll.lore, clothing);
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
              items: found,
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
          found,
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
        // Dev only, so e2e can claim the key's tile before the win: the
        // community row is only read, and the tiles lock first (step 6). A
        // key on someone else's land has to be won in a battle instead.
        const community = await repo.findCommunity(mapId, communityId);
        if (!community) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        const key = await repo.tileById(community.keyTileId);
        if (!key) throw new AppError('NOT_FOUND', MESSAGES.noVillage);
        const tiles = await createTerritoryRepo(tx).listTiles(mapId);
        if (keyInReach(key, tiles, user.id)) return { q: key.q, r: key.r };
        // Breadth first out from my land over free wild tiles, to the key's own tile.
        const byKey = new Map(tiles.map((t) => [hexKey(t), t]));
        const free = (t: (typeof tiles)[number]) =>
          t.ownerUserId === null &&
          t.homeSlot === null &&
          t.communityId === null &&
          !isTradingPost(t) &&
          t.terrain !== 'junipers-gap';
        const goal = hexKey(key);
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
              if (nk === goal) {
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
