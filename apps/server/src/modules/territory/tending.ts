import {
  addDays,
  canFade,
  fadePercent,
  HOLLOW_RULES,
  heartSeedOf,
  landMood,
  missesYouAt,
  TERRITORY_RULES,
  tilesGoingWild,
  wildFrom,
  wildPerNight,
  type Hex,
  type LandTending,
  type LocalDate,
  type PublicUser,
  type TerritoryRules,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { localDate, type Clock } from '../../lib/time.js';
import { createSquishyJobsRepo } from '../jobs/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTendingRepo, createTerritoryRepo, type TendingTileRow } from './repo.js';
import { rewildTiles } from './rewild.js';

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
  /** Dev only: ages my land `days`, then tonight's land goes wild. */
  devAge: (user: PublicUser, mapId: string, days: number) => Promise<LandTending>;
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

/** Nothing missing, nothing gone wild: a tutorial map's land. */
const quiet = (at: Date): LandTending => ({
  missing: [],
  wentWild: [],
  nextMissesYouAt: null,
  now: at.toISOString(),
});

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

  const service: LandTendingService = {
    status: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      // Tutorial land never goes wild, so it never misses anyone.
      if (map.kind === 'tutorial') return quiet(now());
      return statusOf(db, user.id, mapId, map.timeZone, now());
    },

    visit: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const at = now();
      if (map.kind === 'tutorial') return quiet(at);
      return store.transaction(async (repo, tx) => {
        // My tiles first (id order), then their tending rows: a nightfall
        // that wants the same land waits, or Visit waits for it.
        const mine = await repo.lockMyOuterTiles(mapId, user.id);
        await repo.tend(mapId, mine, at);
        return statusOf(tx, user.id, mapId, map.timeZone, at);
      });
    },

    nightfall: async (mapId, night) => {
      const map = await createMapsRepo(db).findMap(mapId);
      if (!map || map.kind === 'tutorial') return null;
      // Land held before tending existed gets a row (tended now), on its own:
      // inserts only, before the transaction below takes any tile lock.
      await store.fillMissing(mapId, now());
      const result = await store.transaction(async (repo, tx) => {
        // The cutoff is the job's own time, a few minutes past nightfall at
        // most (retries); the per-night cap bounds what that can change.
        const at = now();
        const [tiles, homes, done] = await Promise.all([
          repo.outerTiles(mapId),
          createSquishyJobsRepo(tx).homeTiles(mapId),
          repo.wildCounts(mapId, night),
        ]);
        // One cap a night per player for all land lost, the Hollow Man's
        // reclaims (#277, run first) counted in `done` (owner decision
        // 2026-10-08, Q6).
        const cap = Math.min(
          wildPerNight(rules, map.pvpMode),
          HOLLOW_RULES.strength.landLostPerNight,
        );
        const candidates = tiles.map((t) => ({ ...t, homeSlot: null, tendedAt: t.tendedAt ?? at }));
        // The cap is per player per night: a second run tops up to it, never past.
        const left = new Map<string, number>();
        const picked = tilesGoingWild(candidates, heartSeeds(homes), at, cap, rules).filter((t) => {
          const n = left.get(t.ownerUserId) ?? cap - (done.get(t.ownerUserId) ?? 0);
          left.set(t.ownerUserId, n - 1);
          return n > 0;
        });
        if (picked.length === 0) return { wild: 0 };

        // Lock order (tech spec §7): the tiles (id order), their tending rows
        // (tile id order), who stands watch, the gatherers, their bags, `maps`.
        const territory = createTerritoryRepo(tx);
        const ids = picked.map((t) => t.id);
        const owners = new Map((await repo.lockTiles(ids)).map((t) => [t.id, t.ownerUserId]));
        const tended = await repo.lockTending(ids);
        const going: TendingTileRow[] = [];
        for (const tile of picked) {
          // Still theirs, still untended (a Visit may have landed since the
          // read), and no battle for it in the last few hours.
          if (owners.get(tile.id) !== tile.ownerUserId) continue;
          const fresh = tended.get(tile.id);
          if (!fresh || landMood(fresh, at, rules) !== 'going-wild') continue;
          // A skipped tile isn't swapped for the next one: a gentler night.
          const cooldown = await territory.cooldownUntil(tile.id);
          if (cooldown !== null && cooldown > at) continue;
          going.push(tile);
        }
        if (going.length === 0) return { wild: 0 };

        const events = await rewildTiles(tx, map, going, night, at, 'untended');
        for (const event of events) await repo.appendEvent(event);
        return { wild: going.length };
      });
      if (result.wild > 0) void options.publish?.(mapId);
      return result;
    },

    devAge: async (user, mapId, days) => {
      const { map } = await requireMember(db, user, mapId);
      await store.fillMissing(mapId, now());
      await store.transaction(async (repo) => {
        await repo.ageTending(await repo.lockMyOuterTiles(mapId, user.id), days);
      });
      await service.nightfall(mapId, localDate(now(), map.timeZone));
      return statusOf(db, user.id, mapId, map.timeZone, now());
    },
  };
  return service;
}
