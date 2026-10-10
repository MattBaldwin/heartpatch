import {
  addDays,
  CARE_RULES,
  deriveSeed,
  firstHollowNight,
  GAME_DATA,
  gameplayOverrides,
  heartSeedOf,
  hexKey,
  hollowWalk,
  HOLLOW_RULES,
  HOME_BASE_RULES,
  isFreshTile,
  isLocalBefore,
  isNightAt,
  isOnWatch,
  isTradingPost,
  keeperNightOf,
  lastNightOf,
  minutesUntilNightChange,
  nightfall,
  pickReclaimed,
  rescueReward,
  rollStrikes,
  safeTiles,
  stageOf,
  strengthOf,
  tonightOf,
  parseGameEventPayload,
  type Hex,
  type HexKey,
  type MapLocalTime,
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
import { addNightWatchLean } from '../care/evolution.js';
import {
  RESCUE_GUARDIANS,
  resolveRescueGuardians,
  SERVER_GAME_DATA,
} from '@heartpatch/shared/server';
import type { Executor, Transaction } from '../../db/client.js';
import type { GameEvent, NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { instantOfLocal, localDate, mapLocalTime, MINUTE_MS, type Clock } from '../../lib/time.js';
import type { BattlesService, StartResult } from '../battles/service.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { litSafeTiles } from '../buildings/hearthfire.js';
import { grantItems } from '../inventory/service.js';
import { createCareRepo } from '../care/repo.js';
import { landTraining, leaveWork } from '../jobs/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { createTendingRepo } from '../territory/repo.js';
import { rewildTiles } from '../territory/rewild.js';
import { rollFoundDrop } from '../wardrobe/drops.js';
import {
  createHollowRepo,
  createHollowTxRepo,
  type HollowRepo,
  type HollowTxRepo,
  type NightTileRow,
  type StoredOutcome,
} from './repo.js';

/*
 * The Hollow Man (#21; design doc §2, §14; decision C). At nightfall
 * (19:00 map time, #277) he visits each map once. On each Keeper's dark land
 * (outside every lit Hearthfire's light, not home, not claimed today) he
 * grows bolder night by night (#277): each strike takes one squishy left in
 * the dark to the Hollow and wins back one dark tile, which goes wild in the
 * night's reclaim step (`reclaim`, #194's path). He walks each Keeper's
 * border on the way, a show the client plays from 7:00 to 7:30 PM. The night's `hollow_events` row makes it exactly once (a
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
  /**
   * The night's dark land he won back goes wild (#277), in its own
   * transaction after `runNightfall`. Safe to run again: land already gone
   * is skipped. Null for a missing map.
   */
  reclaim: (mapId: string, night: LocalDate) => Promise<{ wild: number } | null>;
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

/** The farthest any Hearthfire's light reaches: how far a fire site can light land (#277, Q5). */
const MAX_FIRE_RADIUS = Math.max(
  ...GAME_DATA.buildings.flatMap((b) =>
    b.kind === 'hearthfire' ? b.levels.map((l) => l.safeRadius) : [],
  ),
);

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
   * Tiles safe tonight: every home base, the land lit fires reach, and land
   * claimed since the last nightfall (#277 guardrail b).
   */
  const safeOn = (
    map: MapRow,
    night: LocalDate,
    fires: Parameters<typeof litSafeTiles>[0],
    homeTiles: readonly Hex[],
    mapTiles: readonly NightTileRow[],
  ): Set<HexKey> => {
    const safe = litSafeTiles(fires, homeTiles, { date: night, minute: 0 });
    for (const t of mapTiles) {
      if (t.ownerUserId === null || t.homeSlot !== null || t.claimedAt === null) continue;
      if (isFreshTile(mapLocalTime(t.claimedAt, map.timeZone), night, nightRules)) {
        safe.add(hexKey(t));
      }
    }
    return safe;
  };

  /**
   * Land a fire could ever light (#277, owner decision 2026-10-08 Q5): within
   * the farthest fire's reach of a tile a fire can stand on (not home, and
   * no resource node in its middle while `nodesBlockFires`). Null: all of it.
   */
  const lightableOn = (mapTiles: readonly NightTileRow[]): Set<HexKey> | null => {
    if (!rules.strength.nodesBlockFires) return null;
    // A trading post (#269) is never owned, so no fire stands on one.
    const sites = mapTiles.filter(
      (t) => t.homeSlot === null && t.nodeResource === null && !isTradingPost(t),
    );
    return safeTiles(sites.map((t) => ({ at: t, radius: MAX_FIRE_RADIUS })));
  };

  /** A Keeper's night on the patch, from when they joined (game clock). */
  const keeperNight = (map: MapRow, joinedAt: Date, night: LocalDate) =>
    keeperNightOf(mapLocalTime(joinedAt, map.timeZone), night, nightRules);

  /**
   * Night falls: claims the night's row, works out who is exposed, how many
   * times the Hollow Man strikes each Keeper, which squishies he takes and
   * which dark tiles he wins back, records it all (and his walk) and appends
   * the events, in one transaction. The tiles go wild in `reclaim`.
   */
  const fall = async (
    repo: HollowTxRepo,
    tx: Executor,
    map: MapRow,
    night: LocalDate,
  ): Promise<{ taken: number } | null> => {
    const at = now();
    // Step 6 before the night's row and the squishies: a guard taken tonight
    // leaves its post under its tile's lock, as posting writes it.
    await repo.lockPostTiles(map.id);
    const nightRowId = await repo.claimNight(map.id, night, at);
    if (nightRowId === null) return null;

    const [members, homeTiles, squishyRows, buildings, seed, mapTiles, cooling, percent, lost] =
      await Promise.all([
        repo.activeMembers(map.id),
        repo.homeTiles(map.id),
        repo.nightSquishies(map.id),
        createBuildingsRepo(tx).listOnMap(map.id),
        mapSeedOf(repo, map.id),
        repo.nightTiles(map.id),
        repo.coolingTiles(map.id, at),
        repo.strengthPercent(map.id),
        createTendingRepo(tx).wildCounts(map.id, night),
      ]);
    const homes = new Map<string, { q: number; r: number }[]>();
    for (const { ownerUserId, q, r } of homeTiles) {
      homes.set(ownerUserId, [...(homes.get(ownerUserId) ?? []), { q, r }]);
    }
    // Every home base, fresh land, and the land the fires lit for this night keep safe.
    const safe = safeOn(
      map,
      night,
      buildings.filter((b) => b.kind === 'hearthfire'),
      homeTiles,
      mapTiles,
    );
    const lightable = lightableOn(mapTiles);
    const canTake = gameplayOverrides(map.kind)?.hollowManCanTake ?? true;
    const canStrike = canTake && percent > 0;
    // Kid-safety caps (owner decision 2026-10-08): the admin percent never raises them.
    const cap = map.pvpMode === 'gentle' ? rules.strength.gentleCap : rules.strength.cap;
    const asNight = (s: (typeof squishyRows)[number]): NightSquishy => ({
      id: s.id,
      ownerUserId: s.ownerUserId,
      state: s.state,
      // A gatherer spends the night out on its work tile (owner decisions
      // 2026-10-04), a trainee on its Training Grounds' homestead (#277),
      // and a guard on its post (owner decision 2026-10-07): out on land
      // beyond a lit fire's light, any of them is exposed.
      sleepsAt: s.work ?? s.training ?? s.habitat ?? heartSeedOf(homes.get(s.ownerUserId) ?? []),
      post:
        s.postOwnerUserId === undefined || s.post === null
          ? null
          : { tileOwnerUserId: s.postOwnerUserId, at: s.post },
    });
    const keepers = members.map(({ userId, joinedAt }) => {
      const nightNo = keeperNight(map, joinedAt, night);
      const strength = strengthOf(nightNo, rules);
      // First-night grace (owner decision 2026-10-03), on the game clock.
      const grace = night < firstHollowNight(mapLocalTime(joinedAt, map.timeZone), nightRules);
      const strikes =
        canTake && !grace
          ? rollStrikes(
              strength.chances,
              percent,
              cap,
              // Secret, never revealed: derived from the map seed (tech spec §8).
              deriveSeed(seed, 'hollow-strength', night, userId),
            )
          : 0;
      // Where he can't strike (the Glade, or a patch at 0 %) he only watches:
      // the same stage `tonight` shows, and no walk to play.
      const stage = canStrike ? strength.stage : 'watching';
      return { userId, keeperNight: nightNo, stage, grace, strikes };
    });
    const outcomes = nightfall(
      keepers.map(({ userId, grace, strikes }) => ({
        userId,
        squishies: squishyRows.filter((s) => s.ownerUserId === userId).map(asNight),
        grace,
        strikes,
      })),
      safe,
      // Secret, never revealed: derived from the map seed (tech spec §8).
      (userId) => deriveSeed(seed, 'hollow', night, userId),
      canTake,
    );

    const stored: StoredOutcome[] = [];
    const taken: GameEventPayload<'hollow.nightfall'>['taken'] = [];
    const walks: NonNullable<GameEventPayload<'hollow.nightfall'>['walks']> = [];
    for (const [i, outcome] of outcomes.entries()) {
      const keeper = keepers[i];
      if (!keeper) continue;
      const { userId } = outcome;
      // Under its row lock; a squishy that left the map meanwhile is skipped.
      const took: string[] = [];
      for (const squishyId of outcome.taken) {
        if (await repo.hollow(squishyId)) took.push(squishyId);
      }
      for (const squishyId of took) taken.push({ userId, squishyId });
      // The dark tiles he wins back: farthest from home first, never home,
      // lit, fresh, unlightable or mid-fight land, and within the night's
      // one cap on land lost (shared with untended land, Q6).
      const heartSeed = heartSeedOf(homes.get(userId) ?? []);
      const room = Math.max(0, rules.strength.landLostPerNight - (lost.get(userId) ?? 0));
      const dark = mapTiles.filter(
        (t) =>
          t.ownerUserId === userId &&
          t.homeSlot === null &&
          !isTradingPost(t) &&
          !safe.has(hexKey(t)) &&
          !cooling.has(t.id) &&
          (lightable === null || lightable.has(hexKey(t))),
      );
      const reclaimed = pickReclaimed(dark, heartSeed, Math.min(keeper.strikes, room));
      const reclaimedIds = new Set(reclaimed.map((t) => t.id));
      const fences = await repo.fencesOn([...reclaimedIds]);
      const on = (kind: string) =>
        buildings.filter((b) => b.kind === kind && reclaimedIds.has(b.tileId)).length;
      // Where the taken ones slept, for the walk.
      const takenAt = took.flatMap((id) => {
        const row = squishyRows.find((s) => s.id === id);
        if (!row) return [];
        const sq = asNight(row);
        // Where it spent the night, as `shelterOf` reads it.
        const where = sq.post && isOnWatch(sq, sq.post) ? sq.post.at : sq.sleepsAt;
        return where ? [where] : [];
      });
      const land = mapTiles.filter((t) => t.ownerUserId === userId);
      const walk = !canStrike
        ? []
        : hollowWalk({
            land,
            safe,
            strikes: [...reclaimed, ...takenAt],
            heartSeed,
            seed: deriveSeed(seed, 'hollow-walk', night, userId),
          });
      const reclaimedAt = reclaimed.map(({ q, r }) => ({ q, r }));
      stored.push({
        ...outcome,
        taken: took,
        keeperNight: keeper.keeperNight,
        strikes: keeper.strikes,
        stage: keeper.stage,
        reclaimed: reclaimedAt,
        walk,
        lostBuildings: {
          fires: on('hearthfire'),
          fences: [...fences.values()].reduce((a, b) => a + b, 0),
          trainingGrounds: on('training-grounds'),
        },
      });
      walks.push({ userId, stage: keeper.stage, reclaimed: reclaimedAt, walk });
    }
    // A guard taken to the Hollow leaves the watch; its tile falls back to its
    // land's guardians, as with any guard that can't stand watch.
    const guards = taken.filter((t) =>
      squishyRows.some((s) => s.id === t.squishyId && s.postOwnerUserId !== undefined),
    );
    await repo.leavePosts(guards.map((t) => t.squishyId));
    // Everyone who stood watch tonight leans a little Spooky (#32), taken or not.
    await addNightWatchLean(
      tx,
      squishyRows
        .filter((s) => s.postOwnerUserId !== undefined && s.post !== null)
        .map((s) => s.id),
      at,
    );
    // One `defenders.changed` per tile whose guards changed, as posting and
    // jobs send, so every map shows the watch as it now stands.
    const takenIds = new Set(taken.map((t) => t.squishyId));
    const postEvents: NewGameEvent<'defenders.changed'>[] = [];
    const seenPosts = new Set<string>();
    for (const { userId, squishyId } of guards) {
      const post = squishyRows.find((s) => s.id === squishyId)?.post;
      if (!post || seenPosts.has(hexKey(post))) continue;
      seenPosts.add(hexKey(post));
      const ids = squishyRows
        .filter(
          (s) =>
            s.post?.q === post.q &&
            s.post.r === post.r &&
            s.state === 'active' &&
            !takenIds.has(s.id),
        )
        .map((s) => s.id);
      postEvents.push({
        mapId: map.id,
        type: 'defenders.changed',
        actorUserId: null,
        payload: { userId, q: post.q, r: post.r, count: ids.length, squishyIds: ids },
      });
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
    for (const event of [...postEvents, ...workEvents, ...trainingEvents]) {
      await repo.appendEvent(event);
    }
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
        payload: { night, taken, walks },
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

  const reclaim: HollowService['reclaim'] = async (mapId, night) => {
    const map = await createMapsRepo(db).findMap(mapId);
    if (!map) return null;
    const row = await store.nightOf(mapId, night);
    const wanted = new Set(
      (row?.outcomes ?? []).flatMap((o) =>
        (o.reclaimed ?? []).map((h) => `${o.userId}/${hexKey(h)}`),
      ),
    );
    if (wanted.size === 0) return { wild: 0 };
    const tending = createTendingRepo(db);
    // Land held before tending existed gets a row first, on its own, as
    // untended land's nightfall does (tech spec §7).
    await tending.fillMissing(mapId, now());
    const result = await tending.transaction(async (repo, tx) => {
      const at = now();
      // Every owned tile, homesteads included (untended land's `outerTiles`
      // leaves them out: they never fade, but he can win them back).
      const hollowRepo = createHollowRepo(tx);
      const picked = (await hollowRepo.nightTiles(mapId)).flatMap((t) =>
        t.ownerUserId !== null && t.homeSlot === null && wanted.has(`${t.ownerUserId}/${hexKey(t)}`)
          ? [{ ...t, ownerUserId: t.ownerUserId, tendedAt: null }]
          : [],
      );
      if (picked.length === 0) return { wild: 0 };
      // Lock order (tech spec §7): the tiles (id order), their tending rows,
      // then `rewildTiles` (defenders, homesteads, buildings, fences,
      // squishies, bags, `maps`).
      const ids = picked.map((t) => t.id);
      const owners = new Map((await repo.lockTiles(ids)).map((t) => [t.id, t.ownerUserId]));
      await repo.lockTending(ids);
      // Read again under the locks: a capture writes `claimed_at` under its tile's lock.
      const claimed = new Map(
        (await hollowRepo.nightTiles(mapId))
          .filter((t) => ids.includes(t.id))
          .map((t) => [t.id, t.claimedAt]),
      );
      const cooling = await hollowRepo.coolingTiles(mapId, at);
      const decidedAt = row?.ranAt ?? at;
      // Still theirs (a retry finds the land already wild and skips it), not
      // claimed since the night was decided (won back after an earlier run of
      // this step: theirs anew, never his again on a retry), and no battle
      // for it since (a retry can come minutes later).
      const going = picked.filter((t) => {
        const claimedAt = claimed.get(t.id) ?? null;
        return (
          owners.get(t.id) === t.ownerUserId &&
          (claimedAt === null || claimedAt <= decidedAt) &&
          !cooling.has(t.id)
        );
      });
      if (going.length === 0) return { wild: 0 };
      const events = await rewildTiles(tx, map, going, night, at, 'hollow');
      for (const event of events) await repo.appendEvent(event);
      return { wild: going.length };
    });
    if (result.wild > 0) published(mapId);
    return result;
  };

  /** What one night did to me, or null if I wasn't there or had nothing to see. */
  const reportOf = (outcomes: readonly StoredOutcome[], userId: string): StoredOutcome | null => {
    const mine = outcomes.find((o) => o.userId === userId);
    if (!mine) return null;
    const quiet =
      mine.taken.length === 0 &&
      mine.exposed === 0 &&
      mine.sheltered === 0 &&
      (mine.reclaimed ?? []).length === 0 &&
      (mine.walk ?? []).length === 0;
    return quiet ? null : mine;
  };

  /** When a night falls, and when the show's strike lands (#277). */
  const showTimes = (map: MapRow, night: LocalDate, near: Date) => {
    const local: MapLocalTime = { date: night, minute: nightRules.nightfallMinute };
    const nightfallAt = instantOfLocal(local, map.timeZone, near);
    return {
      nightfallAt: nightfallAt.toISOString(),
      strikeAt: new Date(nightfallAt.getTime() + rules.show.prowlMinutes * MINUTE_MS).toISOString(),
    };
  };

  return {
    status: async (user, mapId) => {
      const { map } = await requireMember(db, user, mapId);
      const at = now();
      const local = mapLocalTime(at, map.timeZone);
      const lastNight = lastNightOf(local, nightRules);
      const since = addDays(lastNight, 1 - rules.reportNights);
      const tonight = tonightOf(local, nightRules);
      const [
        nights,
        hollowed,
        rewarded,
        members,
        buildings,
        homeTiles,
        squishyRows,
        packed,
        packedTraining,
      ] = await Promise.all([
        store.nightsSince(mapId, since, rules.reportNights),
        store.hollowedOf(mapId, user.id),
        store.rewardedOn(mapId, user.id, local.date, map.timeZone),
        store.activeMembers(mapId),
        createBuildingsRepo(db).listOnMap(mapId),
        store.homeTiles(mapId),
        store.nightSquishies(mapId, { lock: false }),
        createBuildingsRepo(db).packedFires(mapId, user.id),
        createBuildingsRepo(db).packedTraining(mapId, user.id),
      ]);
      // Until the Hollow Man's first visit to me (first-night grace), a
      // nudge to light a fire while one of mine would sleep in the dark
      // tonight: a gatherer or a guard out on land no lit fire reaches. Home
      // is always safe (owner decisions 2026-10-07).
      const joinedAt = members.find((m) => m.userId === user.id)?.joinedAt;
      const firstVisit = joinedAt
        ? firstHollowNight(mapLocalTime(joinedAt, map.timeZone), nightRules)
        : null;
      const safeTonight = litSafeTiles(
        buildings.filter((b) => b.kind === 'hearthfire'),
        homeTiles,
        { date: tonight, minute: 0 },
      );
      const inTheDark = squishyRows.some((s) => {
        if (s.ownerUserId !== user.id || s.state !== 'active') return false;
        // On watch on my own land: it spends the night on its post.
        if (s.postOwnerUserId === user.id && s.post) return !safeTonight.has(hexKey(s.post));
        // A gatherer on its tile, a trainee on its homestead (#277).
        const out = s.work ?? s.training;
        return out !== null && !safeTonight.has(hexKey(out));
      });
      const mine = nights.flatMap((n) => {
        const outcome = reportOf(n.outcomes, user.id);
        return outcome ? [{ night: n.night, outcome }] : [];
      });
      // Last night he came by and let my squishies in the dark be (grace, or
      // my last friend, owner decision 2026-10-05): the nudge stays on, since
      // the report says he took nobody and a fire is still the next step.
      const sparedLastNight =
        mine[0]?.night === lastNight &&
        mine[0].outcome.taken.length === 0 &&
        mine[0].outcome.exposed > 0;
      const fireHint =
        (gameplayOverrides(map.kind)?.hollowManCanTake ?? true) &&
        firstVisit !== null &&
        (tonight <= firstVisit || sparedLastNight) &&
        inTheDark;
      const takenIds = mine.flatMap((n) => n.outcome.taken);
      const takenRows = new Map((await store.squishiesById(takenIds)).map((s) => [s.id, s]));
      const stageOn = (night: LocalDate) =>
        joinedAt ? stageOf(keeperNight(map, joinedAt, night), rules) : 'watching';
      // Where he can't strike (the Glade, or turned off at 0 %), he only watches.
      const strikes =
        (gameplayOverrides(map.kind)?.hollowManCanTake ?? true) &&
        (await store.strengthPercent(mapId)) > 0;
      const reports: MorningReport[] = mine.map(({ night, outcome }) => ({
        night,
        taken: outcome.taken.flatMap((id) => {
          const squishy = takenRows.get(id);
          return squishy
            ? [
                {
                  squishyId: squishy.id,
                  speciesId: squishy.speciesId,
                  nickname: squishy.nickname,
                  inHollow: squishy.state === 'hollowed',
                },
              ]
            : [];
        }),
        sheltered: outcome.sheltered,
        exposed: outcome.exposed,
        reclaimed: outcome.reclaimed ?? [],
        // Nights before #277 kept no stage: worked out from when I joined.
        stage: outcome.stage ?? stageOn(night),
        walk: outcome.walk ?? [],
        lostBuildings: outcome.lostBuildings ?? { fires: 0, fences: 0, trainingGrounds: 0 },
      }));
      // The night the show is about: the one that has fallen until morning,
      // else the coming one.
      const showNight = isNightAt(local, nightRules) ? lastNight : tonight;
      const speciesIds = new Set([
        ...hollowed.map((s) => s.speciesId),
        ...[...takenRows.values()].map((s) => s.speciesId),
      ]);
      return {
        night: {
          isNight: isNightAt(local, nightRules),
          changesInMinutes: minutesUntilNightChange(local, nightRules),
        },
        tonight: {
          night: showNight,
          // A night that has fallen keeps the stage it was decided with
          // (the admin percent may have changed since).
          stage:
            (showNight === lastNight
              ? mine.find((n) => n.night === lastNight)?.outcome.stage
              : undefined) ?? (strikes ? stageOn(showNight) : 'watching'),
          ...showTimes(map, showNight, at),
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
        homeFirePacked: packed
          ? { refund: packed.refund, at: packed.packedAt.toISOString() }
          : null,
        trainingGroundsPacked: packedTraining
          ? { refund: packedTraining.refund, at: packedTraining.packedAt.toISOString() }
          : null,
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

    reclaim,

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
        if (result) {
          // The dark land he won back goes wild too, as in the nightly job.
          await reclaim(mapId, night);
          return { night, taken: result.taken };
        }
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
