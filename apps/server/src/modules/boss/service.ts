import { GROWTH_RULES, type BossVisit, type PublicUser } from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  bossLevelFor,
  bossTileFor,
  bossVisitFor,
  bossWeekOf,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocalDate, localDate, localDayStart, type Clock } from '../../lib/time.js';
import type { BattlesService, MinibossBattlePort, StartResult } from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { createBossRepo, type BossMapRow, type BossWindowRow } from './repo.js';

// Kid-readable messages (style guide §6).
const MESSAGES = {
  gone: 'No big squishy around right now. Keep an eye out!',
  tooBig: 'Too big for now! Grow your team and come back.',
  beaten: 'You already beat this big squishy! It’ll stomp back another week.',
  noTries: 'Phew, that’s enough stomping for today. Try again tomorrow!',
} as const;

export interface BossServiceOptions {
  db: Executor;
  battles: BattlesService;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after a visit opens. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** The schedule and bag; tests pass a stand-in boss (production's bag is empty). */
  rules?: BossEventRules;
}

export interface BossService {
  /** The patch's mini-boss visit as this Keeper sees it, or null (`GET /maps/:mapId/boss`). */
  current: (user: PublicUser, mapId: string) => Promise<BossVisit | null>;
  /** Starts a fight with the visiting boss, or resumes the battle going. */
  start: (user: PublicUser, mapId: string) => Promise<StartResult>;
  /**
   * Opens every patch's visit that's due (the sweep job); returns how many
   * opened. Tests narrow it to their own patches (the database is shared).
   */
  sweep: (only?: readonly string[]) => Promise<number>;
}

/** The boss module's side of a fight's end (#190): a win ends the visit for its Keeper. */
export function createMinibossBattlePort(
  rules: BossEventRules = BOSS_EVENTS,
): MinibossBattlePort {
  return {
    bundle: () => ({ ...rules.bundle }),
    ended: async (tx, battle, winner) => {
      if (winner === 'a') {
        await createBossRepo(tx).markWon(
          battle.mapId,
          battle.playerUserId,
          battle.startedAt,
          battle.id,
        );
      }
      return [];
    },
  };
}

export function createBossService(options: BossServiceOptions): BossService {
  const { db, battles } = options;
  const rules = options.rules ?? BOSS_EVENTS;
  const now = options.clock ?? (() => new Date());
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /**
   * This week's visit on the patch, opening it if it's due (#190 plan §2):
   * derived from the map's seed and the week, then pinned in `boss_windows`
   * with its tile, so land changing hands mid-visit never moves it. The
   * insert is the idempotency: whoever opens it appends `boss.appeared`
   * once. Lazy (rule 4): the sweep opens visits on time, and a read opens one
   * the sweep hasn't reached yet. Null while none is out.
   */
  const openVisit = async (map: BossMapRow, at: Date): Promise<BossWindowRow | null> => {
    if (rules.bag.length === 0) return null;
    const repo = createBossRepo(db);
    const week = bossWeekOf(localDate(at, map.timeZone));
    const pinned = await repo.findWindow(map.id, week);
    if (pinned) return pinned.opensAt <= at && at < pinned.endsAt ? pinned : null;
    const plan = bossVisitFor(map.seed, week, map.longNightWeekday, rules);
    if (!plan) return null;
    const opensAt = instantOfLocalDate(
      { date: plan.opensOn, minute: rules.opensAtHour * 60 },
      map.timeZone,
    );
    const endsAt = new Date(opensAt.getTime() + rules.windowHours * 3_600_000);
    // Not yet, or missed whole (the server was down): nothing to pin.
    if (at < opensAt || at >= endsAt) return null;
    // It starts when the patch is ready: some member's Partner grown enough.
    if (((await repo.topPartnerLevel(map.id)) ?? 0) < rules.minPartnerLevel) return null;
    const ground = await repo.groundTiles(map.id);
    const homes = await repo.homes(map.id);
    const tile =
      bossTileFor(map.seed, week, plan.boss, ground.neutral, homes) ??
      bossTileFor(map.seed, week, plan.boss, ground.gap, homes);
    if (!tile) return null;
    const opened = await repo.transaction(async (tx) => {
      const row = await tx.insertWindow({
        mapId: map.id,
        windowId: week,
        speciesId: plan.boss.speciesId,
        q: tile.q,
        r: tile.r,
        opensAt,
        endsAt,
      });
      if (!row) return null;
      await tx.appendEvent({
        mapId: map.id,
        type: 'boss.appeared',
        actorUserId: null,
        payload: { window: week, q: tile.q, r: tile.r, endsAt: endsAt.toISOString() },
      });
      return row;
    });
    if (opened) published(map.id);
    return opened ?? (await repo.findWindow(map.id, week));
  };

  /** A visit that's out now on a patch this user is on, or null. */
  const visitFor = async (user: PublicUser, mapId: string, at: Date) => {
    await requireMember(db, user, mapId);
    const map = await createBossRepo(db).findMap(mapId);
    if (!map) return null;
    const window = await openVisit(map, at);
    return window ? { map, window } : null;
  };

  const triesLeft = async (tx: Executor, map: BossMapRow, userId: string, at: Date) => {
    const used = await createBossRepo(tx).triesSince(
      map.id,
      userId,
      localDayStart(at, map.timeZone),
    );
    return Math.max(0, rules.triesPerDay - used);
  };

  return {
    current: async (user, mapId) => {
      const at = now();
      const found = await visitFor(user, mapId, at);
      if (!found) return null;
      const { map, window } = found;
      const repo = createBossRepo(db);
      const partner = (await createSpawnsRepo(db).partnerLevel(mapId, user.id)) ?? 0;
      const encounter = await repo.findEncounter(mapId, user.id, window.windowId);
      const state =
        encounter?.wonBattleId != null
          ? 'beaten'
          : partner < rules.minPlayerLevel
            ? 'too-big'
            : 'here';
      // A Keeper too small to fight still sees it (#190 plan §2): its name
      // shows for them as for a Keeper who has met it.
      const met = state === 'too-big' || (await repo.hasSeen(mapId, user.id, window.speciesId));
      return {
        window: { id: window.windowId, endsAt: window.endsAt.toISOString() },
        tile: { q: window.q, r: window.r },
        species: met ? window.speciesId : null,
        state,
        triesLeftToday: state === 'here' ? await triesLeft(db, map, user.id, at) : 0,
      };
    },

    start: async (user, mapId) => {
      const found = await visitFor(user, mapId, now());
      if (!found) throw new AppError('NOT_FOUND', MESSAGES.gone);
      const { map, window } = found;
      // Under the start transaction, after the player's battle seat (step 0):
      // two taps can't both spend the last try.
      return battles.startMiniboss(user, mapId, async (tx, { at }) => {
        if (!(window.opensAt <= at && at < window.endsAt)) {
          throw new AppError('NOT_FOUND', MESSAGES.gone);
        }
        const repo = createBossRepo(tx);
        const partner = (await createSpawnsRepo(tx).partnerLevel(mapId, user.id)) ?? 0;
        if (partner < rules.minPlayerLevel) throw new AppError('CONFLICT', MESSAGES.tooBig);
        const encounter = await repo.findEncounter(mapId, user.id, window.windowId);
        if (encounter?.wonBattleId != null) throw new AppError('CONFLICT', MESSAGES.beaten);
        if ((await triesLeft(tx, map, user.id, at)) === 0) {
          throw new AppError('CONFLICT', MESSAGES.noTries);
        }
        return {
          boss: {
            id: `boss-${window.windowId}`,
            speciesId: window.speciesId,
            level: bossLevelFor(partner, rules, GROWTH_RULES.maxLevel),
          },
          tile: { q: window.q, r: window.r },
          // The Keeper's row for this visit (step 5e), right after the battle.
          started: async (inner, battle) => {
            await createBossRepo(inner).insertEncounter(
              mapId,
              user.id,
              window.windowId,
              battle.startedAt,
            );
            return [];
          },
        };
      });
    },

    sweep: async (only) => {
      if (rules.bag.length === 0) return 0;
      const at = now();
      let opened = 0;
      for (const map of await createBossRepo(db).listMaps()) {
        if (only && !only.includes(map.id)) continue;
        const week = bossWeekOf(localDate(at, map.timeZone));
        const before = await createBossRepo(db).findWindow(map.id, week);
        if (before) continue;
        if (await openVisit(map, at)) opened += 1;
      }
      return opened;
    },
  };
}
