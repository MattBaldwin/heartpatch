import {
  CARE_RULES,
  COMPUTER_PERSONAS,
  deriveSeed,
  GAME_DATA,
  Rng,
  type ComputerMatesState,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import {
  COMPUTER_MATES,
  SERVER_GAME_DATA,
  type ComputerMateRules,
  type ComputerMatesSecrets,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { newSeed } from '../../lib/rng.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { departWithin, heartSeedOf } from '../maps/depart.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo, type MapsTxRepo } from '../maps/repo.js';
import { createRaidsRepo } from '../raids/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createComputerMatesRepo, type MateRow } from './repo.js';
import { COMPUTER_MATES_OFF, computerMatesOpenFor, type ComputerMatesSwitch } from './switch.js';

const HOUR_MS = 60 * 60 * 1000;

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notFound: "We couldn't find that patch.",
  ownerOnly: 'Only the patch owner can do that.',
  cooldown: 'Your computer friends are resting. Try again tomorrow!',
} as const;

export interface ComputerMatesServiceOptions {
  db: Executor;
  /** `HP_COMPUTER_MATES`; off when left out. */
  computerMates?: ComputerMatesSwitch;
  clock?: Clock;
  /** Tests pass their own tuning. */
  secrets?: ComputerMatesSecrets;
  /** Live sync, after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** After commit, per mate that left: its open offers go home (`maps.departed`). */
  departed?: (mapId: string, userId: string, actorUserId: string) => Promise<void>;
  log?: { warn: (obj: object, msg: string) => void };
}

export interface ComputerMatesService {
  /** The owner's switch (#386). Returns the switch as it now stands. */
  setEnabled: (user: PublicUser, mapId: string, enabled: boolean) => Promise<ComputerMatesState>;
  /** The switch for a patch's detail, or undefined while it's closed for this patch. */
  stateFor: (
    mapId: string,
    owner: Pick<PublicUser, 'username'>,
  ) => Promise<ComputerMatesState | undefined>;
}

/** The most Keepers the switch fills a patch to: `fillTo`, or fewer on a smaller patch. */
export const fillTarget = (rules: ComputerMateRules, maxPlayers: number): number =>
  Math.min(rules.fillTo, maxPlayers);

/** When the switch may next turn on, or null for now (while it's off). */
export function changeAtOf(
  rules: ComputerMateRules,
  changedAt: Date | null,
  at: Date,
): Date | null {
  if (changedAt === null) return null;
  const next = new Date(changedAt.getTime() + rules.toggleCooldownHours * HOUR_MS);
  return next > at ? next : null;
}

/**
 * Base forms (nothing evolves into them) of common and uncommon species that
 * the patch's year-round spawn tables can hold: a computer mate's team.
 */
export function teamSpecies(): Species[] {
  const evolved = new Set(GAME_DATA.species.flatMap((s) => s.evolutions.map((e) => e.into)));
  const spawnable = new Set(
    SERVER_GAME_DATA.spawnTables
      .filter((t) => t.season === undefined)
      .flatMap((t) => t.entries.map((e) => e.species)),
  );
  return GAME_DATA.species.filter(
    (s) =>
      (s.rarity === 'common' || s.rarity === 'uncommon') &&
      s.season === undefined &&
      !evolved.has(s.id) &&
      spawnable.has(s.id),
  );
}

/**
 * Seats computer mates until the patch holds `fillTarget` Keepers, inside the
 * caller's transaction. The caller holds the seats lock (step 3) and the
 * patch's mate rows (step 3a). Reuses departed personas' rows first, so the
 * same `users` rows come back. Returns the mates seated.
 */
async function fillWithin(
  repo: MapsTxRepo,
  tx: Executor,
  input: {
    mapId: string;
    actorUserId: string;
    at: Date;
    secrets: ComputerMatesSecrets;
    /** Events to append last (`maps` is step 13). */
    collect: NewGameEvent[];
  },
): Promise<string[]> {
  const { mapId, at, secrets } = input;
  const mates = createComputerMatesRepo(tx);
  const map = await repo.findMap(mapId);
  if (!map) throw new AppError('NOT_FOUND', MESSAGES.notFound);
  const all = await mates.listMates(mapId);
  const players = await mates.countActivePlayers(mapId);
  const want =
    fillTarget(secrets.rules, map.maxPlayers) - players - all.filter((m) => m.active).length;
  if (want <= 0) return [];

  const owner = await repo.owner(mapId);
  // The kid's Partner level (#529's floor), read once: the team is set at creation.
  const partnerLevel =
    (owner ? await createTerritoryRepo(tx).defenderFloorLevel(mapId, owner.id) : null) ?? 1;
  const known = new Map(all.map((m) => [m.personaId, m]));
  // No mate shares a seated kid's name (rule 9): a pre-0064 kid named Bramble
  // keeps the name, and Bramble the computer friend sits this patch out. Six
  // personas for at most three seats, so the fill still completes.
  const taken = await mates.activePlayerNames(mapId);
  // Step 4 for every returning mate, in user id order, before the first
  // home claim (tiles, step 6): a lock after a tile would break the order.
  // A mate made below is a row this transaction inserts, which doesn't count.
  for (const mate of [...all]
    .filter((m) => !m.active)
    .sort((a, b) => (a.userId < b.userId ? -1 : 1))) {
    await repo.lockUser(mate.userId);
  }
  const seated: string[] = [];
  for (const persona of COMPUTER_PERSONAS) {
    if (seated.length >= want) break;
    const existing = known.get(persona.id);
    if (existing?.active) continue;
    if (taken.has(persona.name.toLowerCase())) continue;
    const seats = await repo.activeHomeSlots(mapId);
    const homeSlot = Array.from({ length: map.maxPlayers }, (_, i) => i).find(
      (slot) => !seats.slots.has(slot),
    );
    if (homeSlot === undefined) break;
    const tuning = secrets.personas.find((p) => p.id === persona.id);
    if (!tuning) continue;
    let userId = existing?.userId;
    let seed = existing?.seed;
    if (userId === undefined) {
      seed = newSeed();
      userId = await mates.insertMate({
        mapId,
        personaId: persona.id,
        username: persona.name,
        timeZone: map.timeZone,
        seed,
      });
    }
    await repo.upsertMember({ mapId, userId, role: 'member', homeSlot, joinedAt: at });
    // Its guards play with the persona's stance (plan §1 E). The row was
    // just written above, so this takes no new lock.
    await createRaidsRepo(tx).setStance(mapId, userId, tuning.stance);
    const home = await repo.claimHomeTiles(mapId, homeSlot, userId);
    // A hand-authored map has no home slots: nobody to seat.
    if (home.length === 0) throw new AppError('CONFLICT', "This patch can't take new Keepers.");
    // The team, once, at creation (refreshing levels is #386c's).
    if (existing === undefined && seed !== undefined) {
      const rng = Rng.fromSeed(deriveSeed(seed, 'team'));
      const pool = teamSpecies();
      const size = rng.int(secrets.rules.teamSize.min, secrets.rules.teamSize.max);
      const level = Math.max(1, partnerLevel + tuning.levelOffset);
      const battles = createBattlesRepo(tx);
      for (let i = 0; i < size && pool.length > 0; i++) {
        const species = rng.pick(pool);
        await battles.insertSquishy({
          mapId,
          ownerUserId: userId,
          speciesId: species.id,
          element: species.element,
          feeling: species.feeling,
          level,
          contentment: CARE_RULES.startContentment,
          at,
        });
      }
    }
    await mates.setNextActAt(userId, at);
    input.collect.push({
      mapId,
      type: 'member.joined',
      actorUserId: input.actorUserId,
      payload: {
        userId,
        username: persona.name,
        homeSlot,
        heartSeed: heartSeedOf(home),
        computer: true as const,
      },
    });
    seated.push(userId);
  }
  return seated;
}

/** One mate leaves through `depart` (land goes wild), and goes off the patch. */
async function departMate(
  repo: MapsTxRepo,
  tx: Executor,
  input: {
    mapId: string;
    mate: MateRow;
    actorUserId: string;
    at: Date;
    madeRoomFor?: string;
    collect: NewGameEvent[];
  },
): Promise<void> {
  await departWithin(repo, tx, {
    mapId: input.mapId,
    memberId: input.mate.userId,
    actorUserId: input.actorUserId,
    type: 'member.left',
    at: input.at,
    computer: true,
    ...(input.madeRoomFor ? { madeRoomFor: input.madeRoomFor } : {}),
    collect: input.collect,
  });
  await createComputerMatesRepo(tx).setNextActAt(input.mate.userId, null);
}

/**
 * A real friend always wins the seat (#386 rule B). Called by `approve`
 * after it checked real Keepers only: departs computer mates, the one with
 * the least land first, until the joiner has a free home slot and the patch
 * stays within `fillTarget` (or its real Keepers, if more). The caller holds
 * the seats lock and the patch's mate rows (`lockMatesFor`). Returns who left.
 */
export async function makeRoomWithin(
  repo: MapsTxRepo,
  tx: Executor,
  input: {
    mapId: string;
    joinerId: string;
    /** The joiner's username: a mate with the same name leaves first (rule 9). */
    joinerName: string;
    actorUserId: string;
    maxPlayers: number;
    at: Date;
    /** Events to append last, after the joiner's own writes. */
    collect: NewGameEvent[];
  },
  secrets: ComputerMatesSecrets = COMPUTER_MATES,
): Promise<string[]> {
  const mates = createComputerMatesRepo(tx);
  const left: string[] = [];
  // No mate shares a kid's name (rule 9): a pre-0064 kid named Wren joining
  // beside Wren the computer friend sends Wren home first, room or not.
  const name = input.joinerName.toLowerCase();
  const namesake = (await mates.listMates(input.mapId)).find(
    (m) =>
      m.active && COMPUTER_PERSONAS.find((p) => p.id === m.personaId)?.name.toLowerCase() === name,
  );
  if (namesake) {
    await departMate(repo, tx, { ...input, mate: namesake, madeRoomFor: input.joinerId });
    left.push(namesake.userId);
  }
  for (;;) {
    const active = (await mates.listMates(input.mapId)).filter((m) => m.active);
    if (active.length === 0) return left;
    const players = await mates.countActivePlayers(input.mapId);
    const seats = await repo.activeHomeSlots(input.mapId);
    const keepers = players + 1 + active.length;
    const roomy =
      seats.count < input.maxPlayers &&
      keepers <= Math.max(fillTarget(secrets.rules, input.maxPlayers), players + 1);
    if (roomy) return left;
    // Least land first; ties go to the earliest-created mate (`listMates` order, a stable sort).
    const [mate] = [...active].sort((a, b) => a.tiles - b.tiles);
    if (!mate) return left;
    await departMate(repo, tx, { ...input, mate, madeRoomFor: input.joinerId });
    left.push(mate.userId);
  }
}

/** Step 3a for `approve`: right after the seats lock. */
export const lockMatesFor = (tx: Executor, mapId: string) =>
  createComputerMatesRepo(tx).lockMates(mapId);

export function createComputerMatesService(
  options: ComputerMatesServiceOptions,
): ComputerMatesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const toggle = options.computerMates ?? COMPUTER_MATES_OFF;
  const secrets = options.secrets ?? COMPUTER_MATES;
  const store = createMapsRepo(db);

  const afterDeparture = async (mapId: string, userId: string, actorUserId: string) => {
    try {
      await options.departed?.(mapId, userId, actorUserId);
    } catch (error) {
      options.log?.warn(
        { mapId, userId, error },
        'trades: calling off a computer mate’s offers failed',
      );
    }
  };

  return {
    setEnabled: async (user, mapId, enabled) => {
      // Patches only: a Tutorial Glade is NOT_FOUND here, as every owner setting.
      const found = await requireMember(db, user, mapId, ['multiplayer']);
      if (found.role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.ownerOnly);
      if (!computerMatesOpenFor(toggle, user)) throw new AppError('NOT_FOUND', MESSAGES.notFound);
      const at = now();
      const departed: string[] = [];
      const state = await store.transaction(async (repo, tx) => {
        // Lock order: seats (3), the patch's mate rows (3a), then each
        // mate's users row (4), tiles, …, maps last (tech spec §7).
        await repo.lockSeats(mapId);
        const mates = createComputerMatesRepo(tx);
        await mates.lockMates(mapId);
        const current = await mates.switchOf(mapId);
        if (!current) throw new AppError('NOT_FOUND', MESSAGES.notFound);
        if (current.computerMates === enabled) {
          // Already on: top up any seat a mate left (a friend who left, a
          // mate that departed), up to fillTo again (#811 follow-up).
          if (enabled) {
            const events: NewGameEvent[] = [];
            await fillWithin(repo, tx, {
              mapId,
              actorUserId: user.id,
              at,
              secrets,
              collect: events,
            });
            for (const event of events) await repo.appendEvent(event);
          }
          return {
            enabled,
            changeAt: enabled
              ? null
              : changeAtOf(secrets.rules, current.computerMatesChangedAt, at),
          };
        }
        if (enabled && changeAtOf(secrets.rules, current.computerMatesChangedAt, at) !== null) {
          throw new AppError('CONFLICT', MESSAGES.cooldown);
        }
        const events: NewGameEvent[] = [];
        if (enabled) {
          await fillWithin(repo, tx, { mapId, actorUserId: user.id, at, secrets, collect: events });
        } else {
          for (const mate of (await mates.listMates(mapId)).filter((m) => m.active)) {
            await departMate(repo, tx, { mapId, mate, actorUserId: user.id, at, collect: events });
            departed.push(mate.userId);
          }
        }
        // `maps` last (step 13): the switch, then every event.
        await mates.setSwitch(mapId, enabled, at);
        await repo.appendEvent({
          mapId,
          type: 'map.updated',
          actorUserId: user.id,
          payload: { pvpMode: found.map.pvpMode, computerMates: enabled },
        });
        for (const event of events) await repo.appendEvent(event);
        return { enabled, changeAt: enabled ? null : changeAtOf(secrets.rules, at, at) };
      });
      for (const userId of departed) await afterDeparture(mapId, userId, user.id);
      void options.publish?.(mapId);
      return { enabled: state.enabled, changeAt: state.changeAt?.toISOString() ?? null };
    },

    stateFor: async (mapId, owner) => {
      if (!computerMatesOpenFor(toggle, owner)) return undefined;
      const row = await createComputerMatesRepo(db).switchOf(mapId);
      if (!row) return undefined;
      const changeAt = row.computerMates
        ? null
        : changeAtOf(secrets.rules, row.computerMatesChangedAt, now());
      return { enabled: row.computerMates, changeAt: changeAt?.toISOString() ?? null };
    },
  };
}
