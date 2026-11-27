import {
  addDays,
  GROWTH_RULES,
  type BossVisit,
  type BossVisitEvent,
  type PublicUser,
} from '@heartpatch/shared';
import {
  BOSS_EVENTS,
  bossLevelFor,
  bossTileFor,
  bossVisitFor,
  bossWeekOf,
  christmasEveVisitFor,
  type BossBagEntry,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocalDate, localDate, localDayStart, type Clock } from '../../lib/time.js';
import type { BattlesService, MinibossBattlePort, StartResult } from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { befriendBoss, bossBattleView, joinedOn, type BefriendResult } from './befriend.js';
import { createBossRepo, type BossMapRow, type BossWindowRow } from './repo.js';
import { MINIBOSSES_OFF, minibossOpenFor, type MinibossSwitch } from './switch.js';

// Kid-readable messages (style guide §6).
const MESSAGES = {
  gone: 'No big squishy around right now. Keep an eye out!',
  tooBig: 'Too big for now! Grow your team and come back.',
  beaten: 'You already beat this big squishy! It’ll stomp back another week.',
  noTries: 'Phew, that’s enough stomping for today. Try again tomorrow!',
  // The visit's last patch day: it won't be here tomorrow.
  noTriesLastDay: 'Phew, that’s enough stomping for today!',
} as const;

export interface BossServiceOptions {
  db: Executor;
  battles: BattlesService;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after a visit opens or a boss joins. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** The schedule and bag; tests pass a stand-in boss. */
  rules?: BossEventRules;
  /**
   * The mini-boss switch (#234, `HP_MINI_BOSSES`), off by default: a closed
   * patch behaves as an empty bag (no visit, a start is NOT_FOUND, the sweep
   * skips it). A fight already going still finishes and can still befriend.
   */
  miniBosses?: MinibossSwitch;
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
  /** Asks a beaten boss to be a friend (`POST /battles/:battleId/befriend`, #190 plan §3). */
  befriend: (
    user: PublicUser,
    battleId: string,
    ask: number,
  ) => Promise<BefriendResult & { battle: Awaited<ReturnType<BattlesService['get']>> }>;
}

/** One visit's level gates: the weekly ones, or Christmas Eve's lowered ones (#37 X1). */
export interface BossGates {
  /** A Keeper whose Partner is under this sees it but can't fight yet. */
  minPlayerLevel: number;
  /** The patch gate to open it (some member's Partner this grown); null: none. */
  minPartnerLevel: number | null;
  levelBonus: number;
  minLevel: number;
}

/** The gates of a `boss_windows` row of this kind (rules unchanged for a weekly visit). */
export function bossGatesFor(kind: string, rules: BossEventRules): BossGates {
  const eve = rules.christmasEve;
  if (kind === 'christmas-eve' && eve) return eve.gates;
  return {
    minPlayerLevel: rules.minPlayerLevel,
    minPartnerLevel: rules.minPartnerLevel,
    levelBonus: rules.levelBonus,
    minLevel: rules.minLevel,
  };
}

/** `BossVisit.event` for a visit that isn't the weekly one (#37 X1); undefined on a weekly one. */
export function bossVisitEvent(window: BossWindowRow): BossVisitEvent | undefined {
  if (window.kind !== 'christmas-eve') return undefined;
  // `ends_at` is the close: the window's end and the event's never disagree.
  return { kind: 'christmas-eve', gatesLowered: true, closesAt: window.endsAt.toISOString() };
}

/** A week's visit as instants, before it's pinned. */
export interface PlannedVisit {
  kind: 'weekly' | 'christmas-eve';
  boss: BossBagEntry;
  opensAt: Date;
  endsAt: Date;
}

/**
 * The week's visit on a patch (#190 plan §2, #37 X1): the Christmas Eve visit
 * in the week holding its day, else the bag draw. Pure but for the zone math.
 */
export function plannedBossVisit(
  map: Pick<BossMapRow, 'seed' | 'timeZone' | 'longNightWeekday'>,
  week: string,
  rules: BossEventRules,
): PlannedVisit | null {
  const eve = rules.christmasEve && christmasEveVisitFor(map.seed, week, rules);
  if (eve && rules.christmasEve) {
    const { opensAtHour, closesAtHour } = rules.christmasEve;
    return {
      kind: 'christmas-eve',
      boss: eve.boss,
      opensAt: instantOfLocalDate({ date: eve.opensOn, minute: opensAtHour * 60 }, map.timeZone),
      endsAt: instantOfLocalDate({ date: eve.closesOn, minute: closesAtHour * 60 }, map.timeZone),
    };
  }
  const plan = bossVisitFor(map.seed, week, map.longNightWeekday, rules);
  if (!plan) return null;
  const opensAt = instantOfLocalDate(
    { date: plan.opensOn, minute: rules.opensAtHour * 60 },
    map.timeZone,
  );
  return {
    kind: 'weekly',
    boss: plan.boss,
    opensAt,
    endsAt: new Date(opensAt.getTime() + rules.windowHours * 3_600_000),
  };
}

/** The boss module's side of a fight's end (#190): a win ends the visit for its Keeper. */
export function createMinibossBattlePort(rules: BossEventRules = BOSS_EVENTS): MinibossBattlePort {
  return {
    bundle: () => ({ ...rules.bundle }),
    abandonAfterMs: rules.idleMinutes * 60_000,
    view: (tx, battle, at) => bossBattleView(tx, rules, battle, at),
    lastActionAt: (tx, battle) =>
      createBossRepo(tx).lastActionAt(battle.mapId, battle.playerUserId, battle.startedAt),
    acted: (tx, battle, at) =>
      createBossRepo(tx).touch(battle.mapId, battle.playerUserId, battle.startedAt, at),
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
  const miniBosses = options.miniBosses ?? MINIBOSSES_OFF;
  /** Whether any boss can come: a bag to draw from, or a Christmas Eve species. */
  const anyBoss = rules.bag.length > 0 || (rules.christmasEve?.speciesId ?? null) !== null;
  /** Whether a boss may visit this patch at all: a boss to send and the switch open. */
  const openOn = (map: BossMapRow) => anyBoss && minibossOpenFor(miniBosses, map.ownerUsername);
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
   * the sweep hasn't reached yet. Null while none is out. In the week holding
   * Christmas Eve the visit is the Eve one (#37 X1, `kind` `christmas-eve`).
   */
  const openVisit = async (
    map: BossMapRow,
    at: Date,
    { onlyNew = false } = {},
  ): Promise<BossWindowRow | null> => {
    // Closed (switch off, or no boss to send): as if no boss ever comes.
    if (!openOn(map)) return null;
    const repo = createBossRepo(db);
    const today = localDate(at, map.timeZone);
    const week = bossWeekOf(today);
    // The Eve visit closes the morning after, which is the next week's
    // Monday when Christmas Eve is a Sunday (2028): still out until then.
    const yesterdayWeek = bossWeekOf(addDays(today, -1));
    if (yesterdayWeek !== week) {
      const before = await repo.findWindow(map.id, yesterdayWeek);
      if (before?.kind === 'christmas-eve' && before.opensAt <= at && at < before.endsAt) {
        return onlyNew ? null : before;
      }
    }
    const plan = plannedBossVisit(map, week, rules);
    const out = (row: Pick<BossWindowRow, 'opensAt' | 'endsAt'>) =>
      row.opensAt <= at && at < row.endsAt;
    let pinned = await repo.findWindow(map.id, week);
    // A weekly visit pinned in the Eve's week before X1 shipped: the Eve
    // visit takes its row when it opens (the `(map_id, window_id)` key is
    // taken), rather than the weekly one silently staying.
    if (pinned?.kind === 'weekly' && plan?.kind === 'christmas-eve' && out(plan)) {
      const converted = await repo.transaction(async (tx) => {
        const row = await tx.convertToChristmasEve(map.id, week, {
          speciesId: plan.boss.speciesId,
          opensAt: plan.opensAt,
          endsAt: plan.endsAt,
        });
        if (!row) return null;
        await tx.appendEvent({
          mapId: map.id,
          type: 'boss.appeared',
          actorUserId: null,
          payload: { window: week, q: row.q, r: row.r, endsAt: row.endsAt.toISOString() },
        });
        return row;
      });
      if (converted) {
        published(map.id);
        return converted;
      }
      pinned = await repo.findWindow(map.id, week);
    }
    // The sweep counts only visits it opens; one already pinned isn't news.
    if (pinned) return !onlyNew && out(pinned) ? pinned : null;
    if (!plan) return null;
    const { opensAt, endsAt } = plan;
    // Not yet, or missed whole (the server was down): nothing to pin.
    if (!out(plan)) return null;
    // It starts when the patch is ready: some member's Partner grown enough
    // (no patch gate on Christmas Eve).
    const { minPartnerLevel } = bossGatesFor(plan.kind, rules);
    if (minPartnerLevel !== null && ((await repo.topPartnerLevel(map.id)) ?? 0) < minPartnerLevel) {
      return null;
    }
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
        kind: plan.kind,
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
    if (onlyNew) return opened;
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
      const gates = bossGatesFor(window.kind, rules);
      const encounter = await repo.findEncounter(mapId, user.id, window.windowId);
      const state = joinedOn(encounter)
        ? 'friend'
        : encounter?.wonBattleId != null
          ? 'beaten'
          : partner < gates.minPlayerLevel
            ? 'too-big'
            : 'here';
      // A Keeper too small to fight still sees it (#190 plan §2): its name
      // shows for them as for a Keeper who has met it.
      const met =
        state === 'too-big' ||
        state === 'friend' ||
        (await repo.hasSeen(mapId, user.id, window.speciesId));
      const event = bossVisitEvent(window);
      return {
        window: { id: window.windowId, endsAt: window.endsAt.toISOString() },
        tile: { q: window.q, r: window.r },
        species: met ? window.speciesId : null,
        state,
        triesLeftToday: state === 'here' ? await triesLeft(db, map, user.id, at) : 0,
        ...(event ? { event } : {}),
      };
    },

    start: async (user, mapId) => {
      // A fight going resumes first, as every start does: a Keeper mid-fight
      // when the visit closes still gets their battle back, not "gone".
      const going = await battles.current(user, mapId);
      if (going?.status === 'active') return { battle: going, created: false };
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
        const gates = bossGatesFor(window.kind, rules);
        if (partner < gates.minPlayerLevel) throw new AppError('CONFLICT', MESSAGES.tooBig);
        const encounter = await repo.findEncounter(mapId, user.id, window.windowId);
        if (encounter?.wonBattleId != null) throw new AppError('CONFLICT', MESSAGES.beaten);
        if ((await triesLeft(tx, map, user.id, at)) === 0) {
          // Tomorrow's patch-local start (+30 h from today's lands in it on a DST day too).
          const today = localDayStart(at, map.timeZone);
          const tomorrow = localDayStart(new Date(today.getTime() + 30 * 3_600_000), map.timeZone);
          const lastDay = window.endsAt <= tomorrow;
          throw new AppError('CONFLICT', lastDay ? MESSAGES.noTriesLastDay : MESSAGES.noTries);
        }
        return {
          boss: {
            id: `boss-${window.windowId}`,
            speciesId: window.speciesId,
            level: bossLevelFor(partner, gates, GROWTH_RULES.maxLevel),
          },
          tile: { q: window.q, r: window.r },
          // The Keeper's row for this visit (step 5e), right after the battle.
          // (`startWith` then marks the boss seen (step 11, once per Keeper and
          // species, `ON CONFLICT DO NOTHING`), so the marker names it; #190g's test.)
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

    befriend: async (user, battleId, ask) => {
      const { mapId, fresh, ...result } = await befriendBoss(db, rules, user, battleId, ask, now());
      // A yes appended `squishy.captured` (and maybe `squishy.celebrated`):
      // send it live now it's committed. A "not yet" or a replay added none.
      if (fresh && result.outcome === 'joined') published(mapId);
      return { ...result, battle: await battles.get(user, battleId) };
    },

    sweep: async (only) => {
      if (!anyBoss || miniBosses.mode === 'off') return 0;
      const at = now();
      let opened = 0;
      for (const map of await createBossRepo(db).listMaps()) {
        if (only && !only.includes(map.id)) continue;
        if (!openOn(map)) continue;
        if (await openVisit(map, at, { onlyNew: true })) opened += 1;
      }
      return opened;
    },
  };
}
