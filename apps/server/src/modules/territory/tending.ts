import {
  addDays,
  canFade,
  fadePercent,
  heartSeedOf,
  landMood,
  missesYouAt,
  TERRITORY_RULES,
  tilesGoingWild,
  wildFrom,
  wildPerNight,
  type GameEventPayload,
  type Hex,
  type LandTending,
  type LocalDate,
  type PublicUser,
  type TerritoryRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { leaveWork } from '../jobs/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTendingRepo, createTerritoryRepo, type TendingTileRow } from './repo.js';

/*
 * Land that misses you (owner decision 2026-10-06, design review Q2;
 * `TERRITORY_RULES.tending`). Claiming a tile tends it, and Visit tends all
 * of a player's land at once. Untended land fades (only its owner sees that)
 * and, at a nightfall, a few of a player's long-untended tiles go wild
 * again: neutral, with their guardians back, farthest from home first. Home
 * tiles and the ring round them never fade; tutorial maps never do. Nothing
 * ticks: fading is worked out on read, and going wild runs in the nightfall
 * job after the Hollow Man (`src/index.ts`).
 */

export interface LandTendingService {
  /** My land that misses me and what went wild lately. */
  status: (user: PublicUser, mapId: string) => Promise<LandTending>;
  /** Visit: tends all my land at once. */
  visit: (user: PublicUser, mapId: string) => Promise<LandTending>;
  /**
   * Nightfall on a map: long-untended land goes wild. Safe to run twice for
   * one night (the per-night cap counts what already went). Null for a
   * missing or tutorial map.
   */
  nightfall: (mapId: string, night: LocalDate) => Promise<{ wild: number } | null>;
}

export interface LandTendingOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  rules?: TerritoryRules;
}

/** Nights of "went wild" the status lists (the welcome-back card). */
const WENT_WILD_NIGHTS = 14; // TUNE: guess; a two-week trip

/** Each owner's Heart Seed, from the map's home tiles. */
function heartSeeds(homeTiles: readonly { ownerUserId: string; q: number; r: number }[]) {
  const homes = new Map<string, Hex[]>();
  for (const { ownerUserId, q, r } of homeTiles) {
    homes.set(ownerUserId, [...(homes.get(ownerUserId) ?? []), { q, r }]);
  }
  return new Map([...homes].map(([owner, tiles]) => [owner, heartSeedOf(tiles)]));
}

export function createLandTending(options: LandTendingOptions): LandTendingService {
  const { db } = options;
  const store = createTendingRepo(db);
  const now = options.clock ?? (() => new Date());
  const rules = (options.rules ?? TERRITORY_RULES).tending;

  /** The status, read with `executor` (a visit reads it in its own transaction). */
  const statusOf = async (
    executor: Executor,
    userId: string,
    mapId: string,
    timeZone: string,
    at: Date,
  ): Promise<LandTending> => {
    const repo = createTendingRepo(executor);
    const today = localDate(at, timeZone);
    const [tiles, homes, wentWild] = await Promise.all([
      repo.outerTiles(mapId, userId),
      createSquishyJobsRepo(executor).homeTiles(mapId),
      repo.wentWildSince(mapId, userId, addDays(today, -WENT_WILD_NIGHTS)),
    ]);
    const seed = heartSeeds(homes).get(userId) ?? null;
    const missing: LandTending['missing'] = [];
    let next: number | null = null;
    for (const tile of tiles) {
      if (!canFade({ ...tile, homeSlot: null }, seed, rules)) continue;
      // No row yet: land held before tending existed; nightfall gives it one.
      const tendedAt = tile.tendedAt ?? at;
      if (landMood(tendedAt, at, rules) === 'happy') {
        const starts = missesYouAt(tendedAt, rules).getTime();
        next = next === null ? starts : Math.min(next, starts);
        continue;
      }
      missing.push({
        q: tile.q,
        r: tile.r,
        fade: fadePercent(tendedAt, at, rules),
        wildFrom: wildFrom(tendedAt, rules).toISOString(),
      });
    }
    return {
      missing,
      wentWild,
      nextMissesYouAt: next === null ? null : new Date(next).toISOString(),
      now: at.toISOString(),
    };
  };

  return {
    status: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      return statusOf(db, user.id, mapId, map.timeZone, now());
    },

    visit: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const at = now();
      return store.transaction(async (repo, tx) => {
        const mine = await repo.outerTiles(mapId, user.id);
        await repo.tend(
          mapId,
          mine.map((t) => t.id),
          at,
        );
        return statusOf(tx, user.id, mapId, map.timeZone, at);
      });
    },

    nightfall: async (mapId, night) => {
      const result = await store.transaction(async (repo, tx) => {
        const map = await createMapsRepo(tx).findMap(mapId);
        if (!map || map.kind === 'tutorial') return null;
        const at = now();
        await repo.fillMissing(mapId, at);
        const [tiles, homes, done] = await Promise.all([
          repo.outerTiles(mapId),
          createSquishyJobsRepo(tx).homeTiles(mapId),
          repo.wildCounts(mapId, night),
        ]);
        const cap = wildPerNight(rules, map.pvpMode);
        const candidates = tiles.map((t) => ({ ...t, homeSlot: null, tendedAt: t.tendedAt ?? at }));
        // The cap is per player per night: a second run tops up to it, never past.
        const left = new Map<string, number>();
        const picked = tilesGoingWild(candidates, heartSeeds(homes), at, cap, rules).filter((t) => {
          const n = left.get(t.ownerUserId) ?? cap - (done.get(t.ownerUserId) ?? 0);
          left.set(t.ownerUserId, n - 1);
          return n > 0;
        });
        if (picked.length === 0) return { wild: 0 };

        // Tiles first (id order), then who stands watch, then gatherers.
        const territory = createTerritoryRepo(tx);
        const locked = new Map(
          (await repo.lockTiles(picked.map((t) => t.id))).map((t) => [t.id, t.ownerUserId]),
        );
        const going: TendingTileRow[] = [];
        for (const tile of picked) {
          // Still theirs, and no battle for it in the last few hours.
          if (locked.get(tile.id) !== tile.ownerUserId) continue;
          const cooldown = await territory.cooldownUntil(tile.id);
          if (cooldown !== null && cooldown > at) continue;
          going.push(tile);
        }
        if (going.length === 0) return { wild: 0 };
        const returned = new Map<string, string[]>();
        for (const tile of going) {
          const ids = await territory.clearDefenders(tile.id);
          returned.set(tile.ownerUserId, [...(returned.get(tile.ownerUserId) ?? []), ...ids]);
        }
        // Gatherers bank what they had ready and rest (as when land changes hands).
        const workers = await repo.workersOn(going.map((t) => t.id));
        await createSquishyJobsRepo(tx).lockSquishies(workers);
        const events: NewGameEvent[] =
          workers.length > 0 ? await leaveWork(tx, map, workers, 'resting', at) : [];

        const byOwner = new Map<string, TendingTileRow[]>();
        for (const tile of going) {
          byOwner.set(tile.ownerUserId, [...(byOwner.get(tile.ownerUserId) ?? []), tile]);
        }
        for (const [userId, owned] of [...byOwner].sort(([a], [b]) => (a < b ? -1 : 1))) {
          await repo.goWild(
            owned.map((t) => t.id),
            userId,
            night,
          );
          const payload: GameEventPayload<'tile.rewilded'> = {
            userId,
            night,
            tiles: owned.map(({ q, r, terrain }) => ({ q, r, terrain })),
            returnedSquishyIds: returned.get(userId) ?? [],
          };
          events.push({ mapId, type: 'tile.rewilded', actorUserId: null, payload });
        }
        for (const event of events) await repo.appendEvent(event);
        return { wild: going.length };
      });
      if (result && result.wild > 0) void options.publish?.(mapId);
      return result;
    },
  };
}
