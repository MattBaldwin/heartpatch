import {
  BATTLE_RULES,
  COMMUNITY_RULES,
  communityReach,
  deriveSeed,
  EXPLORE_RULES,
  exploreJoy,
  exploreLayout,
  GAME_DATA,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  hollowedOpenAt,
  exploreNeeds,
  isExplorable,
  isFullyExplored,
  isSearched,
  KEY_SPOT,
  keyInReach,
  keySpot,
  placeEchoes,
  Rng,
  searchedCount,
  searchSpots,
  withSearched,
  type DevHomesteadRequest,
  type ExploreNotable,
  type Hex,
  type HollowedExplore,
  type ExploreTileResponse,
  type ItemCounts,
  type PublicUser,
  type SearchSpot,
  type SearchSpotRequest,
  type SearchSpotResponse,
  type ToolId,
} from '@heartpatch/shared';
import {
  EXPLORE_FINDS,
  HOLLOWED_FINDS,
  LORE_PAGES,
  NOTHING_FOUND,
  rollExploreFind,
  withFoundItems,
} from '@heartpatch/shared/server';
import { uuidv7 } from 'uuidv7';
import type { Database, Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import { latestLocalMinute, mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { applyXp, growthEvents, type Growth } from '../care/service.js';
import { settleKeys } from '../communities/key-moves.js';
import { createCommunitiesRepo } from '../communities/repo.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { createLoreRepo } from '../lore/repo.js';
import { requireMember } from '../maps/members.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import { grantRekindledPiece, rekindledDrop } from '../wardrobe/rekindled.js';
import { homesteadOf, refreshHomesteads } from './homesteads.js';
import {
  createExploreRepo,
  exploreTransaction,
  type ExploreKeyHunt,
  type ExploreRepo,
  type ExploreRow,
  type ExploreTxRepo,
  type ExploreTileRow,
  type ExploreVillage,
} from './repo.js';

/*
 * Exploring your land (#199, owner design 2026-10-07): zoom into a tile you
 * own and search its spots with your Keeper and crafted tools. The server is
 * the authority (CLAUDE.md rule 1): it owns where the spots are (from the
 * secret map seed), which are done, what each one gives (secret tables, rule
 * 6) and the tool wear. A search is one transaction (rule 7): the tile, the
 * player's row for it, homesteads when it finishes the tile, the team's XP,
 * the bag, found clothing, then the events.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noTile: "We couldn't find that spot.",
  notYours: 'You can only explore your own land.',
  cantExplore: "There's nothing to search here yet!",
  noSpot: "We couldn't find that spot.",
  searched: 'You already searched there!',
  needTool: (tool: string) => `You need a ${tool} for that! 🛠️`,
  // A grey village tile (#306 2a), the panel's own words.
  villageAway: 'Claim land next to it to explore!',
  villageNight: 'Too spooky after dark! Come back in the morning 🌙',
  // The cellar key's glinting spot (#306, owner decision 2026-10-22).
  keyFound: 'You already found this key! 🔑',
} as const;

const TOOL_NAMES = new Map(EXPLORE_RULES.tools.map((t) => [t.id, t.name]));
const LORE_TITLES = new Map(LORE_PAGES.map((p) => [p.id, p.title]));

export interface ExploreServiceOptions {
  db: Database;
  clock?: Clock;
  /** Live sync (`wsHub.publish`) after a commit. */
  publish?: (mapId: string) => Promise<void> | void;
  /** Tests swap the find roll. */
  rng?: () => Rng;
}

/** The seed a map's spots come from (server-only; a hand-authored map has none: derive one, as territory does). */
async function seedOf(tx: Executor, mapId: string): Promise<string> {
  return (await createTerritoryRepo(tx).mapSeed(mapId)) ?? deriveSeed('hand-authored-map', mapId);
}

/** A grey village tile as one visit sees it: the village, and when this morning's spots began. */
interface Grey {
  readonly village: ExploreVillage;
  readonly morning: Date;
}

/**
 * The grey village a wild tile belongs to, if I may explore it now (#306
 * 2a): my land touches the village and it's day on the map. Null on any
 * other tile (mine, or someone's land, which the owner check refuses).
 */
async function greyVillage(
  repo: ExploreRepo,
  mapId: string,
  tile: ExploreTileRow | null,
  userId: string,
  at: Date,
): Promise<Grey | null> {
  if (!tile?.communityId || tile.ownerUserId !== null) return null;
  const village = await repo.findVillage(tile.id);
  if (!village) return null;
  const { reach } = communityReach(village.tiles, await repo.listTiles(mapId), userId);
  if (reach !== 'touching') throw new AppError('FORBIDDEN', MESSAGES.villageAway);
  const zone = await repo.mapTimeZone(mapId);
  const rules = { ...HOME_BASE_RULES, ...HOLLOW_RULES };
  if (!hollowedOpenAt(mapLocalTime(at, zone), rules)) {
    throw new AppError('FORBIDDEN', MESSAGES.villageNight);
  }
  return { village, morning: latestLocalMinute(at, zone, HOLLOW_RULES.morningMinute) };
}

/** My tile (or a grey village tile I may explore) and its spots, or a kid-readable error. */
function tileSpots(
  seed: string,
  tile: ExploreTileRow | null,
  userId: string,
  grey: Grey | null,
): { tile: ExploreTileRow; spots: SearchSpot[] } {
  if (!tile) throw new AppError('NOT_FOUND', MESSAGES.noTile);
  if (!grey && tile.ownerUserId !== userId) throw new AppError('FORBIDDEN', MESSAGES.notYours);
  if (!isExplorable(tile.terrain, EXPLORE_RULES)) {
    throw new AppError('CONFLICT', MESSAGES.cantExplore);
  }
  const spots = searchSpots(seed, tile, EXPLORE_RULES) ?? [];
  if (spots.length === 0) throw new AppError('CONFLICT', MESSAGES.cantExplore);
  return { tile, spots };
}

/**
 * A row's progress, counted against its terrain's layout today
 * (`exploreLayout`). A row made on another terrain (a converted tile) starts
 * fresh. One made under an older layout of the same terrain (a new kit,
 * #335) starts fresh while half-searched, but a finished one stays finished,
 * so a new kit never takes a homestead away (owner decision 2026-10-09).
 */
function searchedMask(
  row: ExploreRow | null,
  tile: ExploreTileRow,
  spots: readonly SearchSpot[],
): number {
  if (!row || row.terrain !== tile.terrain) return 0;
  if (row.layout === exploreLayout(tile.terrain, EXPLORE_RULES)) return row.searched;
  // Finished: every spot of today's kit is done. The row's stored `searched`
  // and `spot_count` stay the old kit's on purpose; it's never written again.
  return row.completedAt ? spots.reduce((mask, s) => withSearched(mask, s.index), 0) : 0;
}

/**
 * A grey village tile's progress (#306 2a): only today's searches count
 * (its spots refill each morning), on today's layout.
 */
function greyMask(row: ExploreRow | null, tile: ExploreTileRow, grey: Grey): number {
  if (!row || row.terrain !== tile.terrain) return 0;
  if (row.layout !== exploreLayout(tile.terrain, EXPLORE_RULES)) return 0;
  return row.updatedAt.getTime() >= grey.morning.getTime() ? row.searched : 0;
}

/** A grey village tile's explore extras: its name, today's joy and its echoes. */
function greyView(
  grey: Grey,
  tile: Hex,
  spots: readonly SearchSpot[],
  searched: number,
): HollowedExplore {
  return {
    id: grey.village.id,
    name: grey.village.name,
    joy: exploreJoy({ searched, total: spots.length }),
    echoes: placeEchoes(grey.village.seed, tile, spots, COMMUNITY_RULES.echoesPerTile),
  };
}

/** Uses left of each tool in a bag (a tool is counted in uses). */
function toolUses(items: ItemCounts): Record<ToolId, number> {
  return {
    shovel: items['shovel'] ?? 0,
    net: items['net'] ?? 0,
    rope: items['rope'] ?? 0,
    lantern: items['lantern'] ?? 0,
  };
}

/** The find worth telling the patch about, if any (never which items or how many). */
function notableOf(items: ItemCounts, lore: string | null, clothing: string | null) {
  const notable: ExploreNotable | null = lore
    ? 'lore'
    : clothing
      ? 'cosmetic'
      : (items['heartdust'] ?? 0) > 0
        ? 'heartdust'
        : null;
  return notable;
}

/**
 * My own tile that can't be explored (cleared land, #242), or null: the
 * cellar key may still hide there (a homestead cleared after the key was
 * placed, or an older patch's key), so its glint is offered on it alone
 * (#306). Refusing to clear the key tile instead would tell a rival where it is.
 */
function keyOnly(
  tile: ExploreTileRow | null,
  userId: string,
  grey: Grey | null,
): ExploreTileRow | null {
  if (!tile || grey || tile.ownerUserId !== userId) return null;
  return isExplorable(tile.terrain, EXPLORE_RULES) ? null : tile;
}

/**
 * The hunt whose cellar key `userId` can find on this tile of theirs (#306,
 * owner decision 2026-10-22), or null: the key hides on it, or, on a patch
 * with no challenges, on someone else's land right next to it with no wild
 * tile near enough to move to (`settleKeys` ran first; `keyInReach`).
 */
async function huntOn(
  repo: ExploreRepo,
  mapId: string,
  tile: ExploreTileRow,
  userId: string,
  found = false,
): Promise<ExploreKeyHunt | null> {
  if (tile.ownerUserId !== userId) return null;
  const hunts = await repo.listKeyHunts(mapId, userId, found);
  if (hunts.length === 0) return null;
  const here = hunts.find((h) => h.keyTileId === tile.id);
  if (here) return here;
  const pvpMode = await repo.mapPvpMode(mapId);
  return (
    hunts.find((h) =>
      keyInReach(
        h,
        [tile, { q: h.q, r: h.r, ownerUserId: h.ownerUserId, homeSlot: null }],
        userId,
        pvpMode,
      ),
    ) ?? null
  );
}

/**
 * The cellar key's glinting spot on this tile (#306, owner decision
 * 2026-10-22), or null: only on a tile of mine where I can find the key of
 * a village I won (`huntOn`), while I'm still hunting for it. Its place
 * comes from the secret map seed; nobody else exploring the tile ever sees
 * it (rule 6).
 */
async function keySpotOn(
  repo: ExploreRepo,
  mapId: string,
  seed: string,
  tile: ExploreTileRow,
  userId: string,
  spots: readonly SearchSpot[],
): Promise<SearchSpot | null> {
  if (!(await huntOn(repo, mapId, tile, userId))) return null;
  return keySpot(deriveSeed(seed, 'cellar-key', tile.q, tile.r), spots, EXPLORE_RULES);
}

/**
 * Searching the cellar key's glinting spot (#306, owner decision
 * 2026-10-22): the key is found, nothing else changes. The tile is locked
 * already (step 6), then the village's community row (step 6, after the
 * tile), then `maps`. The tile's own spots, progress and the bag stay as
 * they were; `key.found` tells the patch.
 */
async function findKey(
  repo: ExploreTxRepo,
  tx: Executor,
  input: {
    mapId: string;
    userId: string;
    tile: ExploreTileRow;
    spots: readonly SearchSpot[];
    at: Date;
  },
): Promise<SearchSpotResponse> {
  const { mapId, userId, tile, spots, at } = input;
  const hunt = await huntOn(repo, mapId, tile, userId);
  if (!hunt) {
    // Found already from here (a double tap's second search, on the key's
    // tile or, next door, beside it), else no key to find here.
    const done = await huntOn(repo, mapId, tile, userId, true);
    throw done
      ? new AppError('CONFLICT', MESSAGES.keyFound)
      : new AppError('NOT_FOUND', MESSAGES.noSpot);
  }
  const communities = createCommunitiesRepo(tx);
  // Under the lock: a double tap's second search finds the key gone.
  const community = await communities.lockCommunity(hunt.id);
  if (!community || community.ownerUserId !== userId || community.keyTileId !== hunt.keyTileId) {
    throw new AppError('NOT_FOUND', MESSAGES.noSpot);
  }
  if (community.keyRevealedAt !== null) throw new AppError('CONFLICT', MESSAGES.keyFound);
  await communities.revealKey(community.id, at);
  await repo.appendEvent({
    mapId,
    type: 'key.found',
    actorUserId: userId,
    payload: { communityId: community.id, userId, q: hunt.q, r: hunt.r },
  });
  const row = await repo.findRow(userId, tile.id);
  const mask = row ? searchedMask(row, tile, spots) : 0;
  return {
    spot: KEY_SPOT.index,
    found: {},
    lore: null,
    clothing: null,
    notable: null,
    xp: [],
    tool: null,
    progress: { searched: searchedCount(mask, spots.length), total: spots.length },
    explored: false,
    homestead: homesteadOf(row),
    items: await createInventoryRepo(tx).list({ mapId, userId }),
    cellarKey: { communityId: community.id, name: hunt.name },
  };
}

export function createExploreService(options: ExploreServiceOptions) {
  const now = options.clock ?? (() => new Date());
  const rngFor = options.rng ?? (() => Rng.fromSeed(newSeed()));
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  return {
    /** Dev only (`HP_DEV_SQUISHY_GRANTS`): a ready homestead next to home (#295, e2e). */
    devHomestead: async (
      user: PublicUser,
      mapId: string,
      ask: DevHomesteadRequest = {},
    ): Promise<{ q: number; r: number }> => {
      if (ask.terrain !== undefined && !GAME_DATA.terrains.some((t) => t.id === ask.terrain)) {
        throw new AppError('BAD_REQUEST', `No terrain "${ask.terrain}".`);
      }
      if (
        ask.nodeResource !== undefined &&
        !GAME_DATA.resources.some((r) => r.id === ask.nodeResource)
      ) {
        throw new AppError('BAD_REQUEST', `No resource "${ask.nodeResource}".`);
      }
      const made = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        return repo.devMakeHomestead(mapId, user.id, now(), await seedOf(tx, mapId), ask);
      });
      if (!made) throw new AppError('CONFLICT', MESSAGES.noTile);
      published(mapId);
      return made;
    },

    /** Dev only (`HP_DEV_SQUISHY_GRANTS`): my land reaches my nearest grey village (#306 2a, e2e). */
    devHollowedReach: async (
      user: PublicUser,
      mapId: string,
    ): Promise<{ q: number; r: number }> => {
      const square = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        return repo.devHollowedReach(mapId, user.id);
      });
      if (!square) throw new AppError('CONFLICT', MESSAGES.noTile);
      published(mapId);
      return square;
    },

    /** `GET /maps/:mapId/explore?q=&r=`: the explore view of one of my tiles (or a grey village tile). */
    view: async (
      user: PublicUser,
      mapId: string,
      at: { q: number; r: number },
    ): Promise<ExploreTileResponse> => {
      const db = options.db;
      await requireMember(db, user, mapId, ['multiplayer']);
      // My hunted keys off claimed land on a patch with no challenges (#306), before the glint is placed.
      await settleKeys(db, mapId, user.id);
      const repo = createExploreRepo(db);
      const found = await repo.findTileAt(mapId, at.q, at.r);
      const grey = await greyVillage(repo, mapId, found, user.id, now());
      const seed = await seedOf(db, mapId);
      // My own land no one can explore (cleared land): only the cellar key's glint, if it hides there.
      const bare = keyOnly(found, user.id, grey);
      const { tile, spots } = bare
        ? { tile: bare, spots: [] }
        : tileSpots(seed, found, user.id, grey);
      const row = await repo.findRow(user.id, tile.id);
      const mask = grey ? greyMask(row, tile, grey) : searchedMask(row, tile, spots);
      const items = await createInventoryRepo(db).list({ mapId, userId: user.id });
      const searched = searchedCount(mask, spots.length);
      // The cellar key glints here for its hunter only, past the tile's own spots.
      const key = grey ? null : await keySpotOn(repo, mapId, seed, tile, user.id, spots);
      if (bare && !key) throw new AppError('CONFLICT', MESSAGES.cantExplore);
      return {
        q: tile.q,
        r: tile.r,
        terrain: tile.terrain,
        spots: [
          ...spots.map((s) => ({ ...s, done: isSearched(mask, s.index) })),
          ...(key ? [{ ...key, done: false }] : []),
        ],
        needs: exploreNeeds(tile.terrain, EXPLORE_RULES),
        progress: { searched, total: spots.length },
        homestead: grey ? null : homesteadOf(row),
        tools: toolUses(items),
        ...(grey ? { community: greyView(grey, tile, spots, searched) } : {}),
      };
    },

    /** `POST /maps/:mapId/explore/search`: search one spot on one of my tiles. */
    search: async (
      user: PublicUser,
      mapId: string,
      request: SearchSpotRequest,
    ): Promise<SearchSpotResponse> => {
      const at = now();
      if (request.spot === KEY_SPOT.index) await settleKeys(options.db, mapId, user.id);
      const result = await exploreTransaction(options.db, async (repo, tx) => {
        await requireMember(tx, user, mapId, ['multiplayer']);
        const seed = await seedOf(tx, mapId);
        // Step 6: the tile, so its owner can't change mid-search. A grey
        // village's own rows are only read: restoring (PR 3) locks the tile first.
        const locked = await repo.lockTileAt(mapId, request.q, request.r);
        const grey = await greyVillage(repo, mapId, locked, user.id, at);
        const bare = keyOnly(locked, user.id, grey);
        if (bare && request.spot === KEY_SPOT.index) {
          return findKey(repo, tx, { mapId, userId: user.id, tile: bare, spots: [], at });
        }
        const { tile, spots } = tileSpots(seed, locked, user.id, grey);
        if (request.spot === KEY_SPOT.index && !grey) {
          return findKey(repo, tx, { mapId, userId: user.id, tile, spots, at });
        }
        const spot = spots.find((s) => s.index === request.spot);
        if (!spot) throw new AppError('NOT_FOUND', MESSAGES.noSpot);

        // A stale row still marked explored (a converted tile) is one of the
        // player's explored rows, which a capture or a finished tile may be
        // locking in order: take that whole set first, in `(user_id,
        // tile_id)` order, so the refresh below can't invert it. (A finished
        // row under an older layout of the same terrain stays finished.)
        const seen = await repo.findRow(user.id, tile.id);
        const maskOf = (r: ExploreRow) =>
          grey ? greyMask(r, tile, grey) : searchedMask(r, tile, spots);
        if (seen?.completedAt && maskOf(seen) === 0) {
          await repo.lockExplored(mapId, [user.id]);
        }
        // Then the player's row for it.
        const row =
          (await repo.lockRow(user.id, tile.id)) ??
          (await repo.insertRow({
            userId: user.id,
            tileId: tile.id,
            mapId,
            layout: exploreLayout(tile.terrain, EXPLORE_RULES),
            terrain: tile.terrain,
            spotCount: spots.length,
            at,
          }));
        const before = maskOf(row);
        if (isSearched(before, spot.index)) throw new AppError('CONFLICT', MESSAGES.searched);

        // A friendly word before `consumeItems` would refuse it.
        const owner = { mapId, userId: user.id };
        if (spot.tool !== null) {
          const have = (await createInventoryRepo(tx).list(owner))[spot.tool] ?? 0;
          if (have < 1) {
            throw new AppError(
              'CONFLICT',
              MESSAGES.needTool(TOOL_NAMES.get(spot.tool) ?? spot.tool),
            );
          }
        }

        const searched = withSearched(before, spot.index);
        // A grey village tile never finishes: its spots refill each morning,
        // and it isn't my land to join home (#306 2a).
        const explored = !grey && isFullyExplored(searched, spots.length);
        const fresh = before === 0 && row.searched !== 0;
        // Only a finished row is a homestead (`tile_explore_homestead_after_explored`):
        // one that isn't finished after this search drops its homestead
        // columns, so a row that's somehow joined but short of spots ends up
        // half-searched, not a 500 (#511). On a grey tile only an old
        // finished row (from before it was a village) has any to drop.
        const unjoin = grey
          ? row.completedAt !== null || row.joinedAt !== null
          : fresh || (!explored && row.joinedAt !== null);
        await repo.updateProgress(
          user.id,
          tile.id,
          {
            layout: exploreLayout(tile.terrain, EXPLORE_RULES),
            terrain: tile.terrain,
            searched,
            spotCount: spots.length,
            completedAt: explored ? at : null,
            // A row restarted on a new terrain or layout isn't explored, so it isn't a homestead.
            ...(unjoin ? { joinedAt: null, pausedAt: null, resumedAt: null } : {}),
          },
          at,
        );
        // Still with the explore rows (before squishies and the bag): a
        // finished tile may join home, and may join land beyond it too.
        // A row restarted under a new layout may have been a homestead: the
        // land joined through it is worked out again too.
        const homesteadEvents =
          explored || unjoin ? await refreshHomesteads(tx, mapId, [user.id], at) : [];

        // What it found: the server rolls it (rule 1); a page already found isn't rolled again.
        const foundLore = new Set(
          (await createLoreRepo(tx).listFound(user.id)).map((f) => f.pageId),
        );
        const roll = rollExploreFind(
          grey ? HOLLOWED_FINDS : EXPLORE_FINDS,
          { kind: spot.kind, terrain: tile.terrain },
          rngFor(),
          foundLore,
        );

        // A grey village search may find some of the Rekindled set too (#306
        // PR 5): rolled now, so its finds join the one bag grant below.
        const rekindled = grey
          ? await rekindledDrop(
              tx,
              { place: 'village', userId: user.id, mapId, at },
              { rng: rngFor() },
            )
          : NOTHING_FOUND;
        const found = withFoundItems(roll.items, rekindled);

        // Step 10: the team's XP, plain, like Training Grounds (squishies in id order).
        const team = await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize);
        const growths: Growth[] = [];
        for (const squishyId of team.map((s) => s.id).sort()) {
          const growth = await applyXp(tx, squishyId, EXPLORE_RULES.xpPerSquishy, at, {
            plain: true,
          });
          if (growth) growths.push(growth);
        }

        // Step 11: the bag, every row it spends or grants locked in item order.
        const searchId = uuidv7();
        const wear: ItemCounts = spot.tool ? { [spot.tool]: 1 } : {};
        await lockGrantRows(tx, mapId, [{ userId: user.id, items: { ...wear, ...found } }]);
        if (spot.tool) await consumeItems(tx, owner, wear, 'explore', searchId);
        if (Object.keys(found).length > 0) {
          await grantItems(tx, owner, found, 'explore', searchId);
        }

        // Found clothing appends its own event first; ours stay the last writes.
        // A Rekindled piece is this search's one piece of clothing.
        const drop = { source: 'explore' as const, refId: searchId, userId: user.id, mapId, at };
        const clothing =
          (await grantRekindledPiece(tx, drop, rekindled)) ??
          (await rollFoundDrop(tx, { ...drop, tileId: tile.id }));
        const notable = notableOf(found, roll.lore, clothing);
        const coords = { q: tile.q, r: tile.r };
        const events: NewGameEvent[] = [
          {
            mapId,
            type: 'explore.searched',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              ...coords,
              terrain: tile.terrain,
              searchId,
              spot: spot.index,
              kind: spot.kind,
              tool: spot.tool,
              items: found,
              lorePage: roll.lore,
              notable,
            },
          },
          ...(explored
            ? [
                {
                  mapId,
                  type: 'tile.explored' as const,
                  actorUserId: user.id,
                  payload: { userId: user.id, ...coords, terrain: tile.terrain },
                },
              ]
            : []),
          ...homesteadEvents,
          ...growthEvents(growths),
        ];
        for (const event of events) await repo.appendEvent(event);

        const items = await createInventoryRepo(tx).list(owner);
        const homestead = grey ? null : homesteadOf(await repo.findRow(user.id, tile.id));
        const progress = { searched: searchedCount(searched, spots.length), total: spots.length };
        return {
          spot: spot.index,
          found,
          lore: roll.lore ? { id: roll.lore, title: LORE_TITLES.get(roll.lore) ?? '' } : null,
          clothing,
          notable,
          xp: growths.map((g) => ({ squishyId: g.squishyId, xp: g.xp })),
          tool: spot.tool ? { id: spot.tool, usesLeft: items[spot.tool] ?? 0 } : null,
          progress,
          explored,
          homestead,
          items,
          ...(grey ? { joy: exploreJoy(progress) } : {}),
        } satisfies SearchSpotResponse;
      });
      published(mapId);
      return result;
    },
  };
}

export type ExploreService = ReturnType<typeof createExploreService>;
