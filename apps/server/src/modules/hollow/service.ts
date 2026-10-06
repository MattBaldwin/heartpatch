import {
  addDays,
  CARE_RULES,
  deriveSeed,
  firstHollowNight,
  GAME_DATA,
  gameplayOverrides,
  heartSeedOf,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  isLocalBefore,
  isNightAt,
  lastNightOf,
  minutesUntilNightChange,
  nightfall,
  protectsNight,
  rescueReward,
  tonightOf,
  parseGameEventPayload,
  type GameEventPayload,
  type HollowRules,
  type HollowStatus,
  type LocalDate,
  type MorningReport,
  type NightSquishy,
  type PublicUser,
  type RescueGuardianRules,
  type Species,
  type StartRescueRequest,
} from '@heartpatch/shared';
import {
  RESCUE_GUARDIANS,
  resolveRescueGuardians,
  SERVER_GAME_DATA,
} from '@heartpatch/shared/server';
import type { Executor, Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { localDate, mapLocalTime, type Clock } from '../../lib/time.js';
import type { BattlesService, StartResult } from '../battles/service.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { litSafeTiles } from '../buildings/hearthfire.js';
import { grantItems } from '../inventory/service.js';
import { createCareRepo } from '../care/repo.js';
import { landTraining, leaveWork } from '../jobs/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import {
  createHollowRepo,
  createHollowTxRepo,
  type HollowRepo,
  type HollowTxRepo,
  type StoredOutcome,
} from './repo.js';

/*
 * The Hollow Man (#21; design doc §2, §14; decision C). At nightfall
 * (21:00 map time) he visits each map once: for every player with squishies
 * left outside a lit Hearthfire's light, and not standing watch, he takes one
 * to the Hollow. The night's `hollow_events` row makes it exactly once (a
 * retry, a second job or a restart finds it and does nothing). Taken
 * squishies are never lost: a rescue expedition (a `rescue` battle against
 * shadow guardians, startable from anywhere) brings them home, with a little
 * Heartdust capped per day so exposing squishies on purpose isn't a farm.
 */

export interface HollowService {
  /** The night, my morning reports and my squishies in the Hollow. */
  status: (user: PublicUser, mapId: string) => Promise<HollowStatus>;
  /** Sets off to rescue a squishy from the Hollow, or resumes the battle going. */
  rescue: (user: PublicUser, mapId: string, request: StartRescueRequest) => Promise<StartResult>;
  /** Night falls on a map (the scheduled job). Null if this night already ran. */
  runNightfall: (mapId: string, night: LocalDate) => Promise<{ taken: number } | null>;
  /** `(mapId, night)` pairs whose latest nightfall hasn't run yet (the sweep). */
  dueNightfalls: () => Promise<{ mapId: string; night: LocalDate }[]>;
  /** Dev/test only: the next night that hasn't come yet falls now. */
  devNightfall: (user: PublicUser, mapId: string) => Promise<{ night: LocalDate; taken: number }>;
  /** Settles a rescue when its battle ends (the `hollow` event consumer). */
  settleRescue: (tx: Transaction, event: GameEvent) => Promise<void>;
}

export interface HollowServiceOptions {
  db: Executor;
  battles: Pick<BattlesService, 'startRescue'>;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass their own rules and shadows. */
  rules?: HollowRules;
  guardians?: RescueGuardianRules;
}

// Kid-readable messages (style guide §1, §6: "taken to the Hollow", always rescuable).
const MESSAGES = {
  noSquishy: "We couldn't find that squishy.",
  notInHollow: 'That squishy is safe at home already!',
  quiet: 'The Hollow is very quiet right now. Try again soon!',
} as const;

/** Every species the server knows: public, then secret. */
const ALL_SPECIES: readonly Species[] = [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies];
const SPECIES_BY_ID: ReadonlyMap<string, Species> = new Map(ALL_SPECIES.map((s) => [s.id, s]));
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));

/** Safety: dev nightfall looks this many nights ahead for one that hasn't come. */
const DEV_NIGHTS_AHEAD = 366;

export function createHollowService(options: HollowServiceOptions): HollowService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? HOLLOW_RULES;
  const guardianRules = options.guardians ?? RESCUE_GUARDIANS;
  const store = createHollowRepo(db);
  const nightRules = { ...HOME_BASE_RULES, ...rules };
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** The map's secret seed; hand-authored maps fall back to their id (like spawns). */
  const mapSeedOf = async (repo: Pick<HollowRepo, 'mapSeed'>, mapId: string) =>
    (await repo.mapSeed(mapId)) ?? deriveSeed('hand-authored-map', mapId);

  /**
   * Night falls: claims the night's row, works out who is exposed, takes at
   * most one squishy per player, records it all and appends the events, in
   * one transaction.
   */
  const fall = async (
    repo: HollowTxRepo,
    tx: Executor,
    map: MapRow,
    night: LocalDate,
  ): Promise<{ taken: number } | null> => {
    const at = now();
    const nightRowId = await repo.claimNight(map.id, night, at);
    if (nightRowId === null) return null;

    const [members, homeTiles, squishyRows, fires, seed] = await Promise.all([
      repo.activeMembers(map.id),
      repo.homeTiles(map.id),
      repo.nightSquishies(map.id),
      createBuildingsRepo(tx).listOnMap(map.id),
      mapSeedOf(repo, map.id),
    ]);
    const homes = new Map<string, { q: number; r: number }[]>();
    for (const { ownerUserId, q, r } of homeTiles) {
      homes.set(ownerUserId, [...(homes.get(ownerUserId) ?? []), { q, r }]);
    }
    // The fires lit for this night, and every tile they keep safe (#18).
    const safe = litSafeTiles(
      fires.filter((b) => b.kind === 'hearthfire'),
      (owner) => homes.get(owner) ?? [],
      { date: night, minute: 0 },
    );
    const asNight = (s: (typeof squishyRows)[number]): NightSquishy => ({
      id: s.id,
      ownerUserId: s.ownerUserId,
      state: s.state,
      // A gatherer spends the night out on its work tile (owner decisions
      // 2026-10-04): outside a lit fire's light it's exposed, like anyone.
      sleepsAt: s.work ?? s.habitat ?? heartSeedOf(homes.get(s.ownerUserId) ?? []),
      post: s.postOwnerUserId === undefined ? null : { tileOwnerUserId: s.postOwnerUserId },
    });
    const outcomes = nightfall(
      members.map(({ userId, joinedAt }) => ({
        userId,
        squishies: squishyRows.filter((s) => s.ownerUserId === userId).map(asNight),
        // First-night grace (owner decision 2026-10-03), on the game clock.
        grace: night < firstHollowNight(mapLocalTime(joinedAt, map.timeZone), nightRules),
      })),
      safe,
      // Secret, never revealed: derived from the map seed (tech spec §8).
      (userId) => deriveSeed(seed, 'hollow', night, userId),
      gameplayOverrides(map.kind)?.hollowManCanTake ?? true,
    );

    const stored: StoredOutcome[] = [];
    const taken: GameEventPayload<'hollow.nightfall'>['taken'] = [];
    for (const outcome of outcomes) {
      // Under its row lock; a squishy that left the map meanwhile is skipped.
      const squishyId = outcome.taken;
      const took = squishyId !== null && (await repo.hollow(squishyId));
      stored.push({ ...outcome, taken: took ? squishyId : null });
      if (took) taken.push({ userId: outcome.userId, squishyId });
    }
    // A gatherer taken to the Hollow stops work; what it had ready goes in the bag.
    const workers = taken.filter((t) => squishyRows.some((s) => s.id === t.squishyId && s.work));
    const workEvents =
      workers.length > 0
        ? await leaveWork(
            tx,
            map,
            workers.map((t) => t.squishyId),
            'resting',
            at,
          )
        : [];
    // A trainee taken to the Hollow stops training; what it earned lands first
    // (owner decision 2026-10-06). Only the ones really training are touched.
    const trainingEvents =
      taken.length > 0
        ? (
            await landTraining(
              tx,
              map,
              taken.map((t) => t.squishyId),
              at,
              true,
            )
          ).events
        : [];
    await repo.setOutcomes(nightRowId, stored);
    for (const event of [...workEvents, ...trainingEvents]) await repo.appendEvent(event);
    for (const t of taken) {
      await repo.appendEvent({
        mapId: map.id,
        type: 'squishy.hollowed',
        actorUserId: null,
        payload: { userId: t.userId, squishyId: t.squishyId, night },
      });
    }
    if (members.length > 0) {
      await repo.appendEvent({
        mapId: map.id,
        type: 'hollow.nightfall',
        actorUserId: null,
        payload: { night, taken },
      });
    }
    return { taken: taken.length };
  };

  const runNightfall: HollowService['runNightfall'] = async (mapId, night) => {
    const result = await store.transaction(async (repo, tx) => {
      const map = await createMapsRepo(tx).findMap(mapId);
      if (!map) return null;
      return fall(repo, tx, map, night);
    });
    if (result) published(mapId);
    return result;
  };

  /** What one night did to me, or null if I had nothing there (or wasn't there). */
  const reportOf = (outcomes: readonly StoredOutcome[], userId: string): StoredOutcome | null => {
    const mine = outcomes.find((o) => o.userId === userId);
    if (!mine || (mine.taken === null && mine.exposed === 0 && mine.sheltered === 0)) return null;
    return mine;
  };

  return {
    status: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const at = now();
      const local = mapLocalTime(at, map.timeZone);
      const lastNight = lastNightOf(local, nightRules);
      const since = addDays(lastNight, 1 - rules.reportNights);
      const tonight = tonightOf(local, nightRules);
      const [nights, hollowed, rewarded, members, buildings] = await Promise.all([
        store.nightsSince(mapId, since, rules.reportNights),
        store.hollowedOf(mapId, user.id),
        store.rewardedOn(mapId, user.id, local.date, map.timeZone),
        store.activeMembers(mapId),
        createBuildingsRepo(db).listOnMap(mapId),
      ]);
      // Until the Hollow Man's first visit to me (first-night grace), a
      // nudge to light a fire, unless one of mine is lit for tonight.
      const joinedAt = members.find((m) => m.userId === user.id)?.joinedAt;
      const firstVisit = joinedAt
        ? firstHollowNight(mapLocalTime(joinedAt, map.timeZone), nightRules)
        : null;
      const fireLit = buildings.some(
        (b) =>
          b.ownerUserId === user.id &&
          b.kind === 'hearthfire' &&
          protectsNight(b.fuelledThrough, tonight),
      );
      const mine = nights.flatMap((n) => {
        const outcome = reportOf(n.outcomes, user.id);
        return outcome ? [{ night: n.night, outcome }] : [];
      });
      // Last night he came by and let my squishies in the dark be (grace, or
      // my last friend, owner decision 2026-10-05): the nudge stays on, since
      // the report says he took nobody and a fire is still the next step.
      const sparedLastNight =
        mine[0]?.night === lastNight &&
        mine[0].outcome.taken === null &&
        mine[0].outcome.exposed > 0;
      const fireHint =
        (gameplayOverrides(map.kind)?.hollowManCanTake ?? true) &&
        firstVisit !== null &&
        (tonight <= firstVisit || sparedLastNight) &&
        !fireLit;
      const takenIds = mine.flatMap((n) => (n.outcome.taken ? [n.outcome.taken] : []));
      const takenRows = new Map((await store.squishiesById(takenIds)).map((s) => [s.id, s]));
      const reports: MorningReport[] = mine.map(({ night, outcome }) => {
        const squishy = outcome.taken ? takenRows.get(outcome.taken) : undefined;
        return {
          night,
          taken: squishy
            ? {
                squishyId: squishy.id,
                speciesId: squishy.speciesId,
                nickname: squishy.nickname,
                inHollow: squishy.state === 'hollowed',
              }
            : null,
          sheltered: outcome.sheltered,
          exposed: outcome.exposed,
        };
      });
      const speciesIds = new Set([
        ...hollowed.map((s) => s.speciesId),
        ...[...takenRows.values()].map((s) => s.speciesId),
      ]);
      return {
        night: {
          isNight: isNightAt(local, nightRules),
          changesInMinutes: minutesUntilNightChange(local, nightRules),
        },
        reports,
        hollowed,
        // Their own squishies' species, so a secret one they befriended has a
        // name (a player who owns one has met it, CLAUDE.md rule 6).
        speciesDefs: [...speciesIds].flatMap((id) => {
          const species = SPECIES_BY_ID.get(id);
          return species && !PUBLIC_SPECIES.has(id) ? [species] : [];
        }),
        rescue: {
          heartdust: rules.rescue.heartdust,
          rewardsLeftToday: Math.max(0, rules.rescue.rewardsPerDay - rewarded),
        },
        fireHint,
        now: at.toISOString(),
      };
    },

    rescue: async (user, mapId, request) => {
      const hollowedSquishy = async (repo: HollowRepo) => {
        const squishy = await repo.lockSquishy(request.squishyId);
        if (squishy?.mapId !== mapId || squishy.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        }
        if (squishy.state !== 'hollowed') throw new AppError('CONFLICT', MESSAGES.notInHollow);
        return squishy;
      };
      return options.battles.startRescue(user, mapId, {
        // All their squishies are in the Hollow: this one helps find the way out.
        soloTeam: async (tx) => {
          const squishy = await hollowedSquishy(createHollowRepo(tx));
          const { id, speciesId, level, element, feeling } = squishy;
          return [{ id, speciesId, level, element, feeling }];
        },
        opponent: async (tx, { map, at }) => {
          const repo = createHollowRepo(tx);
          const squishy = await hollowedSquishy(repo);
          const strongest = (await repo.strongestLevel(mapId, user.id)) ?? squishy.level;
          // Fixed per squishy per map-local day: trying again meets the same
          // shadows (tech spec §8 "No rerolls"). Never revealed.
          const seed = deriveSeed(
            await mapSeedOf(repo, mapId),
            'rescue',
            squishy.id,
            localDate(at, map.timeZone),
          );
          const shadows = resolveRescueGuardians(
            { seed, strongestLevel: strongest },
            guardianRules,
            SPECIES_BY_ID,
          );
          if (shadows.length === 0) throw new AppError('CONFLICT', MESSAGES.quiet);
          return {
            side: { controller: { type: 'ai', policy: 'guardian' }, squishies: shadows },
            started: async (startTx, battle) => {
              await createHollowRepo(startTx).insertRescue({
                mapId,
                userId: user.id,
                squishyId: squishy.id,
                battleId: battle.id,
                startedAt: battle.startedAt,
              });
              return [];
            },
          };
        },
      });
    },

    runNightfall,

    dueNightfalls: async () => {
      const at = now();
      return (await store.playedMaps()).flatMap((map) => {
        const local = mapLocalTime(at, map.timeZone);
        const night = lastNightOf(local, nightRules);
        // Nobody was playing there yet at that nightfall: wait for the next.
        const joined = mapLocalTime(map.firstJoinedAt, map.timeZone);
        if (!isLocalBefore(joined, { date: night, minute: HOME_BASE_RULES.nightfallMinute })) {
          return [];
        }
        if (map.lastNight !== null && map.lastNight >= night) return [];
        return [{ mapId: map.id, night }];
      });
    },

    devNightfall: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const local = mapLocalTime(now(), map.timeZone);
      let night = tonightOf(local, HOME_BASE_RULES);
      for (let i = 0; i < DEV_NIGHTS_AHEAD; i++, night = addDays(night, 1)) {
        const result = await runNightfall(mapId, night);
        if (result) return { night, taken: result.taken };
      }
      throw new AppError('CONFLICT', MESSAGES.quiet);
    },

    settleRescue: async (tx, event) => {
      if (event.type !== 'battle.ended') return;
      const ended = parseGameEventPayload('battle.ended', event.payload);
      if (ended.kind !== 'rescue') return;
      const repo = createHollowTxRepo(tx);
      const rescue = await repo.lockRescueByBattle(ended.battleId);
      if (rescue?.outcome !== 'active') return;
      const map = await createMapsRepo(tx).findMap(rescue.mapId);
      if (!map) return;
      // The battle's own end (game clock), so the day is the one the player saw.
      const at = rescue.battleEndedAt ?? now();
      if (ended.reason === 'no-contest' || ended.winner !== ended.playerSide) {
        const outcome = ended.reason === 'no-contest' ? 'no-contest' : 'lost';
        await repo.endRescue(rescue.id, outcome, 0, at);
        return;
      }
      // Back home, fully restored (design doc §14): active again, in its own
      // habitat bed (kept while it was away, #18), and as content as can be
      // (#19's contentment, set through care's own repo; it fades from now).
      const home = await repo.bringHome(rescue.squishyId);
      if (home) {
        await createCareRepo(tx).setContentment(rescue.squishyId, CARE_RULES.maxContentment, at);
      }
      const day = localDate(at, map.timeZone);
      const heartdust = home
        ? rescueReward(await repo.rewardedOn(map.id, rescue.userId, day, map.timeZone), rules)
        : 0;
      if (heartdust > 0) {
        await grantItems(
          tx,
          { mapId: map.id, userId: rescue.userId },
          { heartdust },
          'rescue',
          rescue.id,
        );
      }
      await repo.endRescue(rescue.id, 'rescued', heartdust, at);
      // A rewarded rescue may also find a little thank-you to wear (#43's
      // `rescue` drop table); past the day's cap it finds nothing, so
      // exposing squishies on purpose isn't a farm (decision C).
      if (heartdust > 0) {
        await rollFoundDrop(tx, {
          source: 'rescue',
          refId: rescue.id,
          userId: rescue.userId,
          mapId: map.id,
          tileId: null,
          at,
        });
      }
      if (home) {
        await repo.appendEvent({
          mapId: map.id,
          type: 'squishy.rescued',
          actorUserId: rescue.userId,
          payload: {
            userId: rescue.userId,
            squishyId: rescue.squishyId,
            battleId: rescue.battleId,
            heartdust,
          },
        });
      }
    },
  };
}
