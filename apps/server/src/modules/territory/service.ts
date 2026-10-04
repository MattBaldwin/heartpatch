import {
  attackTargetProblem,
  challengeRewardPercent,
  dailyLossCap,
  deriveSeed,
  GAME_DATA,
  landCount,
  RAID_RULES,
  stancePolicy,
  TERRITORY_RULES,
  tileBattleKindFor,
  type AttackTargetProblem,
  type AttackTileRequest,
  type BattleSideSetup,
  type BattleSquishySetup,
  type DefenseStance,
  type PublicUser,
  type SetDefendersRequest,
  type Species,
  type TerritoryRules,
  type TerritoryStatus,
} from '@heartpatch/shared';
import {
  GUARDIAN_RULES,
  resolveGuardians,
  SERVER_GAME_DATA,
  type GuardianData,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { localDate, MINUTE_MS, spawnWindowFor, type Clock } from '../../lib/time.js';
import type {
  BattlesService,
  PrepareTileBattle,
  StartResult,
  TileBattlePort,
} from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapRow } from '../maps/repo.js';
import { createTerritoryRepo, type DefenderRow, type TerritoryTileRow } from './repo.js';

/*
 * Territory (#15; design doc §11; decisions B and C). Players claim neutral
 * land next to theirs by beating its guardians, and challenge another
 * player's land by beating the squishies standing watch there. Home bases are
 * never battled for. Every raid rule (cooldown, new-player shield, daily
 * attempts, the per-defender daily loss cap, PvP mode) is checked here, on the
 * server, in the battle's start transaction under row locks. The battles
 * service runs the battle and calls back through `createTileBattlePort` when
 * it ends, so the capture commits with the result (CLAUDE.md rule 7).
 */

export interface TerritoryService {
  /** Battles for a tile (claim or challenge), or resumes the battle going. */
  attack: (user: PublicUser, mapId: string, request: AttackTileRequest) => Promise<StartResult>;
  status: (user: PublicUser, mapId: string) => Promise<TerritoryStatus>;
  setDefenders: (
    user: PublicUser,
    mapId: string,
    request: SetDefendersRequest,
  ) => Promise<TerritoryStatus>;
}

export interface TerritoryServiceOptions {
  db: Executor;
  battles: Pick<BattlesService, 'startTile'>;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass their own raid rules and guardians. */
  rules?: TerritoryRules;
  guardians?: GuardianData;
}

// Kid-readable messages (style guide §3, §6, §9: "Claim" and "Challenge").
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  noTile: "We couldn't find that spot.",
  home: 'Home bases are safe. Nobody can ever take one!',
  mine: "That's already your land!",
  tooFar: "That spot's too far away. Try one next to your land!",
  pvpOff: 'Challenges are off on this patch. Claim wild land instead!',
  movedOn: 'That land just changed hands. Take another look!',
  cooldown: 'This land needs a little rest. Try again later!',
  noAttempts: "You've used all your tries for today. Come back tomorrow!",
  shielded: 'This Keeper is new here. Their land is safe for now. Try wild land!',
  lossCap: "This Keeper's land has had enough fun for today. Try again tomorrow!",
  nobodyGuards: 'Nobody is guarding this spot right now. Try again later!',
  notYours: 'You can only guard your own land.',
  homeWatch: 'Home bases are safe already. Pick land outside your home!',
  tooMany: (max: number) => `Up to ${String(max)} squishies can stand watch on one spot.`,
  notYourSquishy: "That's not one of your squishies.",
  inHollow: 'That squishy is in the Hollow. Rescue them first!',
  housed: (name: string) => `Move ${name} out of their habitat first!`,
} as const;

const PROBLEMS: Record<AttackTargetProblem, { code: 'FORBIDDEN' | 'CONFLICT'; message: string }> = {
  home: { code: 'FORBIDDEN', message: MESSAGES.home },
  mine: { code: 'CONFLICT', message: MESSAGES.mine },
  'too-far': { code: 'FORBIDDEN', message: MESSAGES.tooFar },
  'pvp-off': { code: 'FORBIDDEN', message: MESSAGES.pvpOff },
};

const HOUR_MS = 60 * MINUTE_MS;

/** Every species the server knows: public, then secret. */
const ALL_SPECIES: readonly Species[] = [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies];
const SPECIES_BY_ID = new Map(ALL_SPECIES.map((s) => [s.id, s]));
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));

/** What to call one of my squishies in a message: its nickname, else its species. */
const squishyName = (s: { nickname: string | null; speciesId: string }): string =>
  s.nickname ?? SPECIES_BY_ID.get(s.speciesId)?.name ?? 'your squishy';

export function defaultGuardianData(): GuardianData {
  return {
    rules: GUARDIAN_RULES,
    species: SPECIES_BY_ID,
    seasons: GAME_DATA.seasons,
  };
}

/**
 * A tile's guardian team for the window holding `at` (tech spec §8 "No
 * rerolls"): what a claim battle meets, and what the map view's
 * `guardianHint` describes (owner decision 10). Pure; the seed never leaves
 * the server. `map.seed` is the map's secret seed, null on hand-authored maps,
 * whose guardians key off the map id.
 */
export function tileGuardians(
  map: { id: string; timeZone: string; seed: string | null },
  tile: Pick<TerritoryTileRow, 'q' | 'r' | 'terrain' | 'guardianStrength'>,
  at: Date,
  data: GuardianData = defaultGuardianData(),
): BattleSquishySetup[] {
  const mapSeed = map.seed ?? deriveSeed('hand-authored-map', map.id);
  const window = spawnWindowFor(at, map.timeZone, data.rules.windowHours);
  const seed = deriveSeed(mapSeed, 'guardian', tile.q, tile.r, window.id);
  return resolveGuardians(
    { seed, terrain: tile.terrain, strength: tile.guardianStrength, window },
    data,
  );
}

/**
 * Who plays the defending side of a tile battle, and with whom. The owner's
 * squishies on watch when there are any, else the tile's own guardians. The
 * server's AI always plays it, so the owner never has to be online (design
 * doc §3, §6 "offline defense"): squishies on watch follow the owner's
 * defense stance (#16), guardians the `guardian` policy. The policy is stored
 * in the battle's setup, so a replay needs no lookup.
 */
export function defendingSide(
  defenders: readonly DefenderRow[],
  guardians: readonly BattleSquishySetup[],
  stance: DefenseStance = RAID_RULES.defaultStance,
): BattleSideSetup {
  if (defenders.length > 0) {
    return {
      controller: { type: 'ai', policy: stancePolicy(stance) },
      squishies: defenders.map(({ id, speciesId, level, element, feeling }) => ({
        id,
        speciesId,
        level,
        element,
        feeling,
      })),
    };
  }
  return { controller: { type: 'ai', policy: 'guardian' }, squishies: [...guardians] };
}

export function createTerritoryService(options: TerritoryServiceOptions): TerritoryService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? TERRITORY_RULES;
  const guardianData = options.guardians ?? defaultGuardianData();
  const store = createTerritoryRepo(db);
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** The tile's guardians this window (tech spec §8 "No rerolls"; the seed never leaves). */
  const guardiansOf = async (
    tx: Executor,
    map: MapRow,
    tile: TerritoryTileRow,
    at: Date,
  ): Promise<BattleSquishySetup[]> =>
    tileGuardians(
      { id: map.id, timeZone: map.timeZone, seed: await createTerritoryRepo(tx).mapSeed(map.id) },
      tile,
      at,
      guardianData,
    );

  /** Raid rules, checked in the battle's start transaction (see `PrepareTileBattle`). */
  const prepare =
    (user: PublicUser, target: AttackTileRequest): PrepareTileBattle =>
    async (tx, { map, at }) => {
      const repo = createTerritoryRepo(tx);
      const seen = await repo.findTile(map.id, target.q, target.r);
      if (!seen) throw new AppError('NOT_FOUND', MESSAGES.noTile);
      // Lock order: the defender's member row (their daily loss cap), then
      // the tile; the battle and the attempt log come after, `maps` last.
      const defenderId = seen.ownerUserId;
      const defender =
        defenderId !== null && defenderId !== user.id
          ? await createMapsRepo(tx).lockMember(map.id, defenderId)
          : null;
      const tile = await repo.lockTile(seen.id);
      if (!tile || tile.ownerUserId !== defenderId)
        throw new AppError('CONFLICT', MESSAGES.movedOn);

      const tiles = await repo.listTiles(map.id);
      const problem = attackTargetProblem(tile, tiles, user.id, map.pvpMode);
      if (problem) throw new AppError(PROBLEMS[problem].code, PROBLEMS[problem].message);

      const cooldown = await repo.cooldownUntil(tile.id);
      if (cooldown && cooldown > at) throw new AppError('CONFLICT', MESSAGES.cooldown);
      const today = localDate(at, map.timeZone);
      const used = await repo.attemptsOn(map.id, user.id, today, map.timeZone);
      if (used >= rules.attemptsPerDay) throw new AppError('CONFLICT', MESSAGES.noAttempts);

      let rewardPercent = 100;
      let defenders: DefenderRow[] = [];
      if (defenderId !== null) {
        if (!defender) throw new AppError('CONFLICT', MESSAGES.movedOn);
        if (defender.joinedAt.getTime() + rules.newPlayerShieldHours * HOUR_MS > at.getTime()) {
          throw new AppError('FORBIDDEN', MESSAGES.shielded);
        }
        // Losses today plus challenges still going, so two at once can't
        // both slip under the cap (the member lock serializes the count).
        const lost = await repo.lossesOn(map.id, defenderId, today, map.timeZone);
        const going = await repo.challengesGoing(
          map.id,
          defenderId,
          new Date(at.getTime() - rules.abandonMinutes * MINUTE_MS),
        );
        if (lost + going >= dailyLossCap(rules, map.pvpMode)) {
          throw new AppError('CONFLICT', MESSAGES.lossCap);
        }
        rewardPercent = challengeRewardPercent(
          rules,
          map.pvpMode,
          landCount(tiles, user.id),
          landCount(tiles, defenderId),
        );
        defenders = await repo.listDefenders(tile.id, defenderId);
      }

      // The defender's stance, read under their member lock (#16).
      const side = defendingSide(
        defenders,
        defenders.length === 0 ? await guardiansOf(tx, map, tile, at) : [],
        defender?.defenseStance,
      );
      if (side.squishies.length === 0) throw new AppError('CONFLICT', MESSAGES.nobodyGuards);
      const kind = tileBattleKindFor(tile);
      const cooldownUntil = new Date(at.getTime() + rules.cooldownHours * HOUR_MS);

      return {
        kind,
        side,
        tile: { q: tile.q, r: tile.r },
        started: async (startTx, battle) => {
          const attack = await createTerritoryRepo(startTx).insertAttack({
            mapId: map.id,
            tileId: tile.id,
            attackerUserId: user.id,
            defenderUserId: defenderId,
            battleId: battle.id,
            rewardPercent,
            startedAt: battle.startedAt,
            cooldownUntil,
          });
          const event: NewGameEvent<'tile.attacked'> = {
            mapId: map.id,
            type: 'tile.attacked',
            actorUserId: user.id,
            payload: {
              attackId: attack.id,
              battleId: battle.id,
              kind,
              attackerUserId: user.id,
              defenderUserId: defenderId,
              q: tile.q,
              r: tile.r,
              cooldownUntil: cooldownUntil.toISOString(),
            },
          };
          return [event];
        },
      };
    };

  const status = async (tx: Executor, user: PublicUser, map: MapRow): Promise<TerritoryStatus> => {
    const repo = createTerritoryRepo(tx);
    const at = now();
    const [used, joinedAt, defenders, squishies] = await Promise.all([
      repo.attemptsOn(map.id, user.id, localDate(at, map.timeZone), map.timeZone),
      repo.joinedAt(map.id, user.id),
      repo.myDefenders(map.id, user.id),
      repo.mySquishies(map.id, user.id),
    ]);
    const shieldEnds =
      joinedAt === null
        ? null
        : new Date(joinedAt.getTime() + rules.newPlayerShieldHours * HOUR_MS);
    return {
      attemptsLeft: Math.max(0, rules.attemptsPerDay - used),
      attemptsPerDay: rules.attemptsPerDay,
      shieldUntil: shieldEnds && shieldEnds > at ? shieldEnds.toISOString() : null,
      defenders,
      squishies,
      // Their own squishies' species, so the picker can name a secret one
      // they befriended (a player who owns one has met it, CLAUDE.md rule 6).
      speciesDefs: [...new Set(squishies.map((s) => s.speciesId))].flatMap((id) => {
        const species = SPECIES_BY_ID.get(id);
        return species && !PUBLIC_SPECIES.has(id) ? [species] : [];
      }),
      now: at.toISOString(),
    };
  };

  return {
    attack: (user, mapId, request) =>
      options.battles.startTile(user, mapId, prepare(user, request)),

    status: async (user, mapId) => status(db, user, (await requireMember(db, user, mapId)).map),

    setDefenders: async (user, mapId, request) => {
      if (request.squishyIds.length > rules.maxDefenders) {
        throw new AppError('VALIDATION_FAILED', MESSAGES.tooMany(rules.maxDefenders));
      }
      const { map } = await requireMember(db, user, mapId);
      const changed = await store.transaction(async (repo, tx) => {
        // One guard change at a time per player (a double tap moving the same
        // squishy twice): lock order is the player, then tiles, `maps` last.
        if (!(await createMapsRepo(tx).lockMember(map.id, user.id))) {
          throw new AppError('NOT_FOUND', MESSAGES.noMap);
        }
        const seen = await repo.findTile(map.id, request.q, request.r);
        if (!seen) throw new AppError('NOT_FOUND', MESSAGES.noTile);
        // Squishies moving here leave their old posts, whose counts change too.
        const leaving = (await repo.postsOf(request.squishyIds)).filter((t) => t.id !== seen.id);
        // Tile locks (in id order): a capture can't land between the check and the write.
        const locked = new Map<string, TerritoryTileRow>();
        for (const id of [...new Set([seen.id, ...leaving.map((t) => t.id)])].sort()) {
          const row = await repo.lockTile(id);
          if (row) locked.set(id, row);
        }
        const tile = locked.get(seen.id);
        if (!tile || tile.ownerUserId !== user.id) {
          throw new AppError('FORBIDDEN', MESSAGES.notYours);
        }
        if (tile.homeSlot !== null) throw new AppError('FORBIDDEN', MESSAGES.homeWatch);
        // Squishy locks after the tiles (in id order): housing one locks it too.
        const homes = new Map(
          (await repo.lockSquishies(request.squishyIds)).map((s) => [s.id, s.habitatBuildingId]),
        );
        const mine = new Map((await repo.mySquishies(map.id, user.id)).map((s) => [s.id, s]));
        const before = await repo.listDefenders(tile.id, user.id);
        const here = new Set(before.map((d) => d.id));
        for (const id of request.squishyIds) {
          const squishy = mine.get(id);
          if (!squishy) throw new AppError('FORBIDDEN', MESSAGES.notYourSquishy);
          if (squishy.state !== 'active') throw new AppError('CONFLICT', MESSAGES.inHollow);
          // Housed or on watch, not both (owner decision 2026-10-03). One
          // already here from before that rule may stay; it counts as on
          // watch only (no habitat bonus) until it moves.
          if (!here.has(id) && (homes.get(id) ?? null) !== null) {
            throw new AppError('CONFLICT', MESSAGES.housed(squishyName(squishy)));
          }
        }
        const same =
          before.length === request.squishyIds.length &&
          before.every((d, i) => d.id === request.squishyIds[i]);
        if (same) return false;
        await repo.replaceDefenders(map.id, tile.id, request.squishyIds, now());
        // One event per tile whose guards changed: this one, and any they left.
        const changedTiles = [tile, ...leaving.flatMap((t) => locked.get(t.id) ?? [])];
        for (const changedTile of changedTiles) {
          const ids =
            changedTile.id === tile.id
              ? [...request.squishyIds]
              : (await repo.listDefenders(changedTile.id, user.id)).map((d) => d.id);
          await repo.appendEvent({
            mapId: map.id,
            type: 'defenders.changed',
            actorUserId: user.id,
            payload: {
              userId: user.id,
              q: changedTile.q,
              r: changedTile.r,
              count: ids.length,
              squishyIds: ids,
            },
          });
        }
        return true;
      });
      if (changed) published(map.id);
      return status(db, user, map);
    },
  };
}

/**
 * The battles service's `tileBattles` port (#15): the attempt log and
 * captures, written on the battle's own transaction.
 */
export function createTileBattlePort(rules: TerritoryRules = TERRITORY_RULES): TileBattlePort {
  return {
    abandonAfterMs: rules.abandonMinutes * MINUTE_MS,

    lastActionAt: async (tx, battleId) =>
      (await createTerritoryRepo(tx).findAttack(battleId))?.lastActionAt ?? null,

    acted: (tx, battleId, at) => createTerritoryRepo(tx).touchAttack(battleId, at),

    noContest: (tx, battleId, at) => createTerritoryRepo(tx).endAttack(battleId, 'no-contest', at),

    ended: async (tx, battle, winner, at) => {
      const repo = createTerritoryRepo(tx);
      const attack = await repo.findAttack(battle.id);
      if (!attack) return { events: [], xpPercent: 100, drop: null };
      // Gentle's share applies to the battle's XP too, win or lose (owner
      // decision 2026-10-03), as well as to the capture rewards.
      const xpPercent = attack.rewardPercent;
      if (winner !== 'a') {
        // Lost, tied, or left (a forfeit): no land changes hands.
        await repo.endAttack(battle.id, 'lost', at);
        return { events: [], xpPercent, drop: null };
      }
      const tile = await repo.lockTile(attack.tileId);
      // The tile is taken only from whoever held it when the battle began
      // (or from nobody, if they left the map meanwhile), and never a home tile.
      const takeable =
        tile !== null &&
        tile.homeSlot === null &&
        tile.ownerUserId !== attack.attackerUserId &&
        (tile.ownerUserId === attack.defenderUserId || tile.ownerUserId === null);
      if (!tile || !takeable) {
        await repo.endAttack(battle.id, 'won', at);
        return { events: [], xpPercent, drop: null };
      }
      // Squishies on watch go home, never lost (issue #15).
      const returned = await repo.clearDefenders(tile.id);
      await repo.setOwner(tile.id, attack.attackerUserId);
      await repo.endAttack(battle.id, 'captured', at);
      const event: NewGameEvent<'tile.captured'> = {
        mapId: attack.mapId,
        type: 'tile.captured',
        actorUserId: attack.attackerUserId,
        payload: {
          attackId: attack.id,
          battleId: battle.id,
          kind: battle.kind === 'rival-tile' ? 'rival-tile' : 'tile',
          userId: attack.attackerUserId,
          fromUserId: tile.ownerUserId,
          q: tile.q,
          r: tile.r,
          terrain: tile.terrain,
          rewardPercent: attack.rewardPercent,
          returnedSquishyIds: returned,
        },
      };
      // Battles rolls the capture's found clothing (#84) once it has locked
      // the squishies; Gentle's share scales the chance like the XP.
      return {
        events: [event],
        xpPercent,
        drop: { tileId: tile.id, percent: attack.rewardPercent },
      };
    },
  };
}
