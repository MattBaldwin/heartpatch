import {
  addDays,
  GROWTH_RULES,
  type BossVisit,
  type BossVisitEvent,
  type BossWindowKind,
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
  type ChristmasEveGates,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocalDate, localDate, localDayStart, type Clock } from '../../lib/time.js';
import type { BattlesService, MinibossBattlePort, StartResult } from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { befriendBoss, bossBattleView, joinedOn, type BefriendResult } from './befriend.js';
import { chipOnFinish, openBar, settleBars, thankKeeper, triesFrom } from './patch-bar.js';
import { createBossRepo, type BossMapRow, type BossRepo, type BossWindowRow } from './repo.js';
import { MINIBOSSES_OFF, minibossOpenFor, type MinibossSwitch } from './switch.js';

// Kid-readable messages (style guide §6).
const MESSAGES = {
  gone: 'No big squishy around right now. Keep an eye out!',
  tooBig: 'Too big for now! Grow your team and come back.',
  beaten: 'You already beat this big squishy! It’ll stomp back another week.',
  // Christmas Eve (#37 X5a): it said yes, so it's a friend now, not a fight.
  friend: 'It’s your friend now! Thanks for helping. 💙',
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
  /**
   * Dev/test only (`POST /maps/:mapId/dev/christmas-eve-now`, #37 X2): this
   * week's visit becomes a Christmas Eve one from now for the Eve's usual
   * length, with a fresh bar, so a dry run can fight it any day.
   */
  devChristmasEveNow: (
    user: PublicUser,
    mapId: string,
  ) => Promise<{ window: string; opensAt: string; closesAt: string }>;
}

/** The gates of a `boss_windows` row of this kind: the weekly ones, or Christmas Eve's lowered ones (#37 X1). */
export function bossGatesFor(kind: string, rules: BossEventRules): ChristmasEveGates {
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
  kind: BossWindowKind;
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
    winPays: async (tx, battle) => {
      const repo = createBossRepo(tx);
      // Both already held by this finish (`ended` took them at step 5e), so
      // these re-reads take no new lock: the bar's `FOR UPDATE` lines up every
      // Eve finish on this visit, so a Keeper's second win waits for the
      // first to commit and then sees it (READ COMMITTED reads per statement).
      const visit = await repo.shareVisitOf(battle.mapId, battle.startedAt);
      if (visit?.kind !== 'christmas-eve' || !rules.christmasEve) return true;
      const bar = await repo.lockBar(visit.mapId, visit.windowId);
      // A weekly fight from before the Eve's opening pays as a weekly win.
      if (!bar || battle.startedAt < bar.opensAt) return true;
      // The Eve pays its win once per Keeper (owner decision, #37): only the
      // first won Eve fight of this visit, however many they win after.
      return !(await repo.wonOtherBetween(
        battle.mapId,
        battle.playerUserId,
        bar.opensAt,
        visit.endsAt,
        battle.id,
      ));
    },
    ended: async (tx, battle, winner, at) => {
      const repo = createBossRepo(tx);
      // Shared, right after the battle's lock (step 5e): a conversion to
      // the Eve can't commit between this read and the win or chip below
      // (#37 X1's READ COMMITTED race, closed in X2).
      const visit = await repo.shareVisitOf(battle.mapId, battle.startedAt);
      if (!visit) return [];
      const eve = rules.christmasEve;
      if (visit.kind === 'christmas-eve' && eve) {
        const bar = await lockEveBar(repo, tx, visit, rules);
        // A weekly fight still going when the Eve took over its row: it
        // never met the Eve visit, so it neither wins it nor chips it.
        if (!bar || battle.startedAt < bar.opensAt) return [];
        // On the Eve a win doesn't end the visit for its Keeper: every
        // fight chips the bar until their tries run out (#37 X2).
        return chipOnFinish(tx, battle, bar, eve, at);
      }
      if (winner === 'a') {
        await repo.markWon(battle.mapId, battle.playerUserId, battle.startedAt, battle.id);
      }
      return [];
    },
  };
}

/**
 * The Eve's own opening for a `christmas-eve` row: the planned one in the
 * map's zone (a converted weekly row keeps its earlier `opens_at`), else
 * the row's own (a dev pin).
 */
async function eveOpensAt(
  repo: BossRepo,
  window: BossWindowRow,
  rules: BossEventRules,
): Promise<Date> {
  const map = await repo.findMap(window.mapId);
  const plan = map ? plannedBossVisit(map, window.windowId, rules) : null;
  return plan?.kind === 'christmas-eve' && plan.opensAt > window.opensAt
    ? plan.opensAt
    : window.opensAt;
}

/**
 * The Eve visit's bar `FOR UPDATE` (step 5e, after its window's share
 * lock), opened first if the visit has none yet (one pinned before X2).
 */
async function lockEveBar(
  repo: BossRepo,
  tx: Executor,
  window: BossWindowRow,
  rules: BossEventRules,
) {
  const eve = rules.christmasEve;
  if (!eve) return null;
  const bar = await repo.lockBar(window.mapId, window.windowId);
  if (bar) return bar;
  await openBar(tx, window, await eveOpensAt(repo, window, rules), eve);
  return repo.lockBar(window.mapId, window.windowId);
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
    // Only if it was pinned on the Sunday; one nobody opened by then is
    // "missed whole", like any visit while the server was down.
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
      const converted = await repo.transaction(async (tx, inner) => {
        // `opens_at` stays the weekly one (earlier): fights started on the
        // weekly visit still find this row (`visitOf`).
        const row = await tx.convertToChristmasEve(map.id, week, {
          speciesId: plan.boss.speciesId,
          endsAt: plan.endsAt,
        });
        if (!row) return null;
        if (rules.christmasEve) await openBar(inner, row, plan.opensAt, rules.christmasEve);
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
    // (no patch gate on Christmas Eve, but someone active to fight it).
    const { minPartnerLevel } = bossGatesFor(plan.kind, rules);
    const top = await repo.topPartnerLevel(map.id);
    if (top === null || (minPartnerLevel !== null && top < minPartnerLevel)) return null;
    const ground = await repo.groundTiles(map.id);
    const homes = await repo.homes(map.id);
    const tile =
      bossTileFor(map.seed, week, plan.boss, ground.neutral, homes) ??
      bossTileFor(map.seed, week, plan.boss, ground.gap, homes);
    if (!tile) return null;
    const opened = await repo.transaction(async (tx, inner) => {
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
      // The Eve's bar opens with its visit (#37 X2): goal and head start now.
      if (plan.kind === 'christmas-eve' && rules.christmasEve) {
        await openBar(inner, row, opensAt, rules.christmasEve);
      }
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

  /** Tries left today on this visit (keyed by window, #37 X2: see `triesFrom`). */
  const triesLeft = async (
    tx: Executor,
    map: BossMapRow,
    window: BossWindowRow,
    userId: string,
    at: Date,
  ) => {
    const day = localDayStart(at, map.timeZone);
    const from = await triesFrom(tx, window);
    const used = await createBossRepo(tx).triesSince(map.id, userId, from > day ? from : day);
    return Math.max(0, rules.triesPerDay - used);
  };

  /**
   * A Keeper's Christmas Eve thanks, if the bar fell and it's due (#37 X2):
   * paid lazily on their read, published once committed.
   */
  const thankOnRead = async (window: BossWindowRow, userId: string, at: Date) => {
    if (window.kind !== 'christmas-eve') return;
    const bar = await createBossRepo(db).findBar(window.mapId, window.windowId);
    if (bar?.state === 'fell' && (await thankKeeper(db, rules, bar, userId, at))) {
      published(window.mapId);
    }
  };

  return {
    current: async (user, mapId) => {
      const at = now();
      const found = await visitFor(user, mapId, at);
      if (!found) return null;
      const { map, window } = found;
      await thankOnRead(window, user.id, at);
      const repo = createBossRepo(db);
      const partner = (await createSpawnsRepo(db).partnerLevel(mapId, user.id)) ?? 0;
      const gates = bossGatesFor(window.kind, rules);
      const encounter = await repo.findEncounter(mapId, user.id, window.windowId);
      const state = joinedOn(encounter, window.kind)
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
        // A friend is never fought, on the Eve too (★ #900 item 2: `start` refuses it).
        triesLeftToday: state === 'here' ? await triesLeft(db, map, window, user.id, at) : 0,
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
        // An Eve ask said yes (★ #900 item 2): as the `friend` view, no more fights.
        if (joinedOn(encounter, window.kind)) throw new AppError('CONFLICT', MESSAGES.friend);
        if ((await triesLeft(tx, map, window, user.id, at)) === 0) {
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
      const at = now();
      // A Christmas Eve ask needs the fall's thanks paid first (#37 X2).
      const visit = await createBossRepo(db).visitOfBattle(battleId, user.id);
      if (visit) await thankOnRead(visit, user.id, at);
      const { mapId, fresh, ...result } = await befriendBoss(db, rules, user, battleId, ask, at);
      // A yes appended `squishy.captured` (and maybe `squishy.celebrated`):
      // send it live now it's committed. A "not yet" or a replay added none.
      if (fresh && result.outcome === 'joined') published(mapId);
      return { ...result, battle: await battles.get(user, battleId) };
    },

    devChristmasEveNow: async (user, mapId) => {
      await requireMember(db, user, mapId);
      const eve = rules.christmasEve;
      const map = await createBossRepo(db).findMap(mapId);
      if (!eve || !map) throw new AppError('NOT_FOUND', MESSAGES.gone);
      const at = now();
      const week = bossWeekOf(localDate(at, map.timeZone));
      // The Eve's usual length: its opening hour to its closing hour next morning.
      const hours = 24 - eve.opensAtHour + eve.closesAtHour;
      const closesAt = new Date(at.getTime() + hours * 3_600_000);
      const repo = createBossRepo(db);
      const pinned = await repo.findWindow(mapId, week);
      const plan = plannedBossVisit(map, week, rules);
      const speciesId = eve.speciesId ?? pinned?.speciesId ?? plan?.boss.speciesId;
      if (!speciesId) throw new AppError('NOT_FOUND', MESSAGES.gone);
      let tile = pinned ? { q: pinned.q, r: pinned.r } : null;
      if (!tile && plan) {
        const ground = await repo.groundTiles(mapId);
        const homes = await repo.homes(mapId);
        tile =
          bossTileFor(map.seed, week, plan.boss, ground.neutral, homes) ??
          bossTileFor(map.seed, week, plan.boss, ground.gap, homes);
      }
      if (!tile) throw new AppError('NOT_FOUND', MESSAGES.gone);
      const where = tile;
      await repo.transaction(async (tx, inner) => {
        const row = await tx.devEveNow({
          mapId,
          windowId: week,
          speciesId,
          q: where.q,
          r: where.r,
          opensAt: at,
          endsAt: closesAt,
        });
        await openBar(inner, row, at, eve);
        await tx.appendEvent({
          mapId,
          type: 'boss.appeared',
          actorUserId: null,
          payload: { window: week, q: row.q, r: row.r, endsAt: row.endsAt.toISOString() },
        });
      });
      published(mapId);
      return { window: week, opensAt: at.toISOString(), closesAt: closesAt.toISOString() };
    },

    sweep: async (only) => {
      const at = now();
      // Christmas Eve bars first (#37 X2): a short one dozes off at its
      // close and every settled one thanks its contributors, even with the
      // switch off (what a Keeper earned is still paid).
      for (const mapId of await settleBars(db, rules, at, only)) published(mapId);
      if (!anyBoss || miniBosses.mode === 'off') return 0;
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
