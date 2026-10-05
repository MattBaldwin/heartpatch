import { randomInt } from 'node:crypto';
import {
  formatInviteCode,
  GAME_DATA,
  generateMap,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAP_MAX_PLAYERS,
  type CreateMapRequest,
  type GuardianHint,
  type Hex,
  type Invite,
  type MapDetail,
  type MapMember,
  type MapView,
  type MemberPasswordResetResponse,
  type MyJoinRequest,
  type MyMapsResponse,
  type PublicUser,
  type PublicTile,
  type PvpMode,
} from '@heartpatch/shared';
import { hintForGuardians, type GuardianData } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import { newSeed } from '../../lib/rng.js';
import { canonicalTimeZone, type Clock } from '../../lib/time.js';
import { createAuthRepo } from '../auth/repo.js';
import { listPublicBuildings, removeMemberBuildings } from '../buildings/service.js';
import { createKeepersRepo } from '../keepers/repo.js';
import { starterPick } from '../starters/service.js';
import { newResetCredentials } from '../auth/secrets.js';
import { INVITE_CODE_TTL_MS } from './limits.js';
import { requireMember } from './members.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { defaultGuardianData, tileGuardians } from '../territory/service.js';
import { createMapsRepo, type JoinRequestRow, type MemberRow, type TileViewRow } from './repo.js';

export interface MapsService {
  myMaps: (user: PublicUser) => Promise<MyMapsResponse>;
  /** Makes a map with `user` as owner; returns it as they now see it. */
  create: (user: PublicUser, input: CreateMapRequest) => Promise<MapDetail>;
  get: (user: PublicUser, mapId: string) => Promise<MapDetail>;
  /** Everything a member needs to draw the map. */
  view: (user: PublicUser, mapId: string) => Promise<MapView>;
  /** A fresh invite code; the old one stops working. Owner only. */
  regenerateInvite: (user: PublicUser, mapId: string) => Promise<Invite>;
  revokeInvite: (user: PublicUser, mapId: string) => Promise<void>;
  /** Enters an invite code: asks the owner to let `user` in. */
  join: (user: PublicUser, code: string) => Promise<{ request: MyJoinRequest; created: boolean }>;
  approve: (user: PublicUser, mapId: string, requestId: string) => Promise<void>;
  deny: (user: PublicUser, mapId: string, requestId: string) => Promise<void>;
  removeMember: (user: PublicUser, mapId: string, memberId: string) => Promise<void>;
  leave: (user: PublicUser, mapId: string) => Promise<void>;
  setPvpMode: (user: PublicUser, mapId: string, pvpMode: PvpMode) => Promise<PvpMode>;
  /** Owner resets a member's password (decision D). Shown once. */
  resetMemberPassword: (
    user: PublicUser,
    mapId: string,
    memberId: string,
  ) => Promise<MemberPasswordResetResponse>;
}

export interface MapsServiceOptions {
  db: Executor;
  /** `HP_TUTORIAL_REQUIRED`: creating or joining needs a finished tutorial. */
  tutorialRequired: boolean;
  /** `HP_KEEPER_REQUIRED`: creating or joining needs a Keeper (#42). */
  keeperRequired: boolean;
  clock?: Clock;
  /**
   * Live sync (`wsHub.publish`): called after a command that wrote game events
   * commits, so members see it right away. Never rejects.
   */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass their own guardians (the view's `guardianHint`). */
  guardians?: GuardianData;
}

/** The maps the maps API manages; tutorial maps are the tutorial module's. */
const PATCHES = ['multiplayer'] as const;

// Kid-readable messages (style guide §6). Players call maps "patches".
const MESSAGES = {
  notFound: "We couldn't find that patch.",
  ownerOnly: 'Only the patch owner can do that.',
  tutorialFirst: 'Finish your first adventure with Sprout, then come back!',
  keeperFirst: 'Pick your Keeper first, then come back!',
  timeZone: "Hmm, we couldn't read your clock. Please try again!",
  badCode: "That code doesn't work. It may be too old. Ask for a new one!",
  alreadyMember: "You're already in this patch!",
  full: `This patch is full! It fits ${MAP_MAX_PLAYERS} Keepers.`,
  requestNotFound: "We couldn't find that request.",
  requestAnswered: 'That request was already answered.',
  notAMember: "That Keeper isn't in this patch.",
  removeSelf: "You own this patch, so you can't remove yourself.",
  ownerLeave: "You own this patch, so you can't leave it.",
  resetSelf: 'Use your recovery code to reset your own password.',
  resetOutOfScope:
    "This Keeper also plays in a patch you don't own. Ask the grown-up who runs Heartpatch to reset it.",
  noRoom: "This patch can't take new Keepers.",
} as const;

/** How many times to retry on the (very unlikely) chance a new code is taken. */
const CODE_ATTEMPTS = 3;

function newInviteCode(): string {
  return Array.from({ length: INVITE_CODE_LENGTH }, () =>
    INVITE_CODE_ALPHABET.charAt(randomInt(INVITE_CODE_ALPHABET.length)),
  ).join('');
}

/**
 * A tile as members see it: every public field named, so the secret
 * `guardianStrength` can never ride along (tech spec §8).
 */
function toPublicTile(
  tile: TileViewRow,
  guardianHint: GuardianHint | null,
  buildings: PublicTile['buildings'],
): PublicTile {
  return {
    q: tile.q,
    r: tile.r,
    terrain: tile.terrain,
    ownerUserId: tile.ownerUserId,
    nodeResource: tile.nodeResource,
    homeSlot: tile.homeSlot,
    gathering: tile.gathering,
    cooldownUntil: tile.cooldownUntil,
    defenders: tile.defenders,
    workers: tile.workers,
    guardianHint,
    buildings,
  };
}

/** The Heart Seed: the centre of a home base (a tile and its full ring). */
function heartSeedOf(homeTiles: readonly Hex[]): Hex {
  const n = homeTiles.length;
  if (n === 0) throw new Error('heartSeedOf: no home tiles');
  const sum = homeTiles.reduce((acc, h) => ({ q: acc.q + h.q, r: acc.r + h.r }), { q: 0, r: 0 });
  return { q: sum.q / n, r: sum.r / n };
}

const toRequest = (r: JoinRequestRow): MyJoinRequest => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
});

const toMember = (m: MemberRow): MapMember => ({ ...m, joinedAt: m.joinedAt.toISOString() });

/** Retries `fn` when it hits a unique violation (a freshly drawn invite code was taken). */
async function withFreshCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(newInviteCode());
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= CODE_ATTEMPTS) throw err;
    }
  }
}

export function createMapsService(options: MapsServiceOptions): MapsService {
  const { db, tutorialRequired, keeperRequired } = options;
  const now = options.clock ?? (() => new Date());
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };
  const guardians = options.guardians ?? defaultGuardianData();
  const store = createMapsRepo(db);
  const keepersRepo = createKeepersRepo(db);

  const assertTutorialDone = async (user: PublicUser) => {
    if (!tutorialRequired) return;
    if ((await store.tutorialCompletedAt(user.id)) === null) {
      throw new AppError('FORBIDDEN', MESSAGES.tutorialFirst);
    }
  };

  /** Other players see each member's Keeper, so a new account picks one first (#42). */
  const assertKeeperChosen = async (user: PublicUser) => {
    if (!keeperRequired) return;
    if ((await keepersRepo.find(user.id)) === null) {
      throw new AppError('FORBIDDEN', MESSAGES.keeperFirst);
    }
  };

  /**
   * For reading the map view only: besides patches it lets a player see their
   * own active tutorial run (the client draws the Tutorial Glade as a normal
   * map, tech spec §7). An archived run (replayed or skipped) stays NOT_FOUND.
   * Everything else here (invites, admin, leave) is for patches only
   * (`PATCHES`), so tutorial maps are NOT_FOUND there.
   */
  const requireViewer = async (tx: Executor, user: PublicUser, mapId: string) =>
    (await requireMember(tx, user, mapId, ['multiplayer', 'tutorial'])).map;

  const requireOwner = async (tx: Executor, user: PublicUser, mapId: string) => {
    const found = await requireMember(tx, user, mapId, PATCHES);
    if (found.role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.ownerOnly);
    return found.map;
  };

  const detail = async (user: PublicUser, mapId: string): Promise<MapDetail> => {
    const { map, role } = await requireMember(db, user, mapId, PATCHES);
    const [members, starter] = await Promise.all([
      store.listMembers(mapId),
      starterPick(db, mapId, user.id),
    ]);
    let admin: MapDetail['admin'] = null;
    if (role === 'owner') {
      const [invite, requests] = await Promise.all([
        store.liveInvite(mapId, now()),
        store.listPendingRequests(mapId),
      ]);
      admin = {
        invite: invite
          ? { code: formatInviteCode(invite.code), expiresAt: invite.expiresAt.toISOString() }
          : null,
        requests: requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
      };
    }
    return {
      id: map.id,
      name: map.name,
      timeZone: map.timeZone,
      pvpMode: map.pvpMode,
      role,
      maxPlayers: map.maxPlayers,
      members: members.map(toMember),
      ...starter,
      admin,
    };
  };

  /** Archives a member and frees their land and home base, in one transaction. */
  const depart = (
    mapId: string,
    memberId: string,
    actor: PublicUser,
    type: 'member.removed' | 'member.left',
  ) =>
    store.transaction(async (repo, tx) => {
      // Lock order: seats, the player, tiles, buildings, then maps (appendGameEvent).
      await repo.lockSeats(mapId);
      await repo.lockUser(memberId);
      const membership = await repo.membership(mapId, memberId);
      if (membership?.status !== 'active') {
        throw new AppError(
          'NOT_FOUND',
          type === 'member.left' ? MESSAGES.notFound : MESSAGES.notAMember,
        );
      }
      if (membership.role === 'owner') {
        throw new AppError(
          'FORBIDDEN',
          type === 'member.left' ? MESSAGES.ownerLeave : MESSAGES.removeSelf,
        );
      }
      await repo.archiveMember(mapId, memberId);
      const releasedTiles = await repo.releaseTiles(mapId, memberId);
      // A returning player gets a fresh home base (#4), so their buildings go (#18).
      await removeMemberBuildings(tx, mapId, memberId);
      await repo.appendEvent({
        mapId,
        type,
        actorUserId: actor.id,
        payload: { userId: memberId, releasedTiles },
      });
    });

  return {
    myMaps: async (user) => {
      const [maps, requests] = await Promise.all([
        store.listMyMaps(user.id),
        store.listMyPendingRequests(user.id),
      ]);
      return { maps, requests: requests.map(toRequest) };
    },

    create: async (user, input) => {
      assertAllowedText(input.name, 'name');
      const timeZone = canonicalTimeZone(input.timeZone);
      if (timeZone === null) throw new AppError('VALIDATION_FAILED', MESSAGES.timeZone);
      await assertKeeperChosen(user);
      await assertTutorialDone(user);

      // Generate once and store it all (design doc §3): every seat's home base
      // exists from the start, so joining never resizes the map. The seed is
      // secret and never leaves the server (tech spec §8).
      const seed = newSeed();
      const maxPlayers = MAP_MAX_PLAYERS;
      const generated = generateMap(GAME_DATA, { seed, playerCount: maxPlayers });
      const homeSlot = 0;

      const mapId = await withFreshCode((code) =>
        store.transaction(async (repo) => {
          // Ordered against an owner resetting this player (decision D scope check).
          await repo.lockUser(user.id);
          const map = await repo.insertMap({ name: input.name, timeZone, seed, maxPlayers });
          await repo.upsertMember({
            mapId: map.id,
            userId: user.id,
            role: 'owner',
            homeSlot,
            joinedAt: now(),
          });
          await repo.insertTiles(map.id, generated.tiles);
          const home = await repo.claimHomeTiles(map.id, homeSlot, user.id);
          await repo.insertInvite({
            mapId: map.id,
            code,
            createdByUserId: user.id,
            expiresAt: new Date(now().getTime() + INVITE_CODE_TTL_MS),
          });
          await repo.appendEvent({
            mapId: map.id,
            type: 'map.created',
            actorUserId: user.id,
            payload: {
              name: input.name,
              timeZone,
              pvpMode: map.pvpMode,
              maxPlayers,
              homeSlot,
              heartSeed: heartSeedOf(home),
            },
          });
          return map.id;
        }),
      );
      published(mapId);
      return detail(user, mapId);
    },

    get: detail,

    // One snapshot, so the seq matches the tiles and members exactly: live
    // sync replays everything after it and nothing before (tech spec §5).
    view: (user, mapId) =>
      store.snapshot(async (repo, tx) => {
        const map = await requireViewer(tx, user, mapId);
        const at = now();
        const [members, tiles, buildings, seed] = await Promise.all([
          repo.listMembers(mapId),
          repo.listTiles(mapId),
          // Fires and habitats (#18), with `lit` as of now.
          listPublicBuildings(tx, mapId, at, map.timeZone),
          createTerritoryRepo(tx).mapSeed(mapId),
        ]);
        // Neutral land's guardians today (#15's team), as a count and a word
        // (owner decision 10): the same for every member, and never who.
        const hintFor = (tile: TileViewRow): GuardianHint | null =>
          tile.ownerUserId === null && tile.homeSlot === null
            ? hintForGuardians(
                tileGuardians({ ...map, seed }, tile, at, guardians),
                guardians.rules,
              )
            : null;
        return {
          map: {
            id: map.id,
            name: map.name,
            timeZone: map.timeZone,
            pvpMode: map.pvpMode,
            maxPlayers: map.maxPlayers,
          },
          members: members.map(toMember),
          tiles: tiles.map((tile) =>
            toPublicTile(
              tile,
              hintFor(tile),
              buildings.get(`${String(tile.q)},${String(tile.r)}`) ?? [],
            ),
          ),
          seq: map.eventSeq,
        };
      }),

    regenerateInvite: async (user, mapId) => {
      await requireOwner(db, user, mapId);
      return withFreshCode((code) =>
        store.transaction(async (repo) => {
          const at = now();
          const expiresAt = new Date(at.getTime() + INVITE_CODE_TTL_MS);
          await repo.revokeInvites(mapId, at);
          await repo.insertInvite({ mapId, code, createdByUserId: user.id, expiresAt });
          return { code: formatInviteCode(code), expiresAt: expiresAt.toISOString() };
        }),
      );
    },

    revokeInvite: async (user, mapId) => {
      await requireOwner(db, user, mapId);
      await store.revokeInvites(mapId, now());
    },

    join: async (user, code) => {
      await assertKeeperChosen(user);
      await assertTutorialDone(user);
      const attempt = () =>
        store.transaction(async (repo) => {
          const invite = await repo.findLiveInviteByCode(code, now());
          if (!invite) throw new AppError('NOT_FOUND', MESSAGES.badCode);
          // Ordered against approvals (which lock the joiner too), so a second
          // tap during an approval sees the new membership.
          await repo.lockUser(user.id);
          const [membership, owner, map] = await Promise.all([
            repo.membership(invite.mapId, user.id),
            repo.owner(invite.mapId),
            repo.findMap(invite.mapId),
          ]);
          if (membership?.status === 'active') {
            throw new AppError('CONFLICT', MESSAGES.alreadyMember);
          }
          if (!owner || !map) throw new Error(`join: map ${invite.mapId} has no owner`);
          const asRequest = (r: { id: string; createdAt: Date }) =>
            toRequest({ ...r, mapName: invite.mapName, owner });

          const pending = await repo.findPendingRequest(invite.mapId, user.id);
          if (pending) return { request: asRequest(pending), created: false };
          // A courtesy check so nobody waits on a full patch; approval re-checks under lock.
          if ((await repo.activeHomeSlots(invite.mapId)).count >= map.maxPlayers) {
            throw new AppError('CONFLICT', MESSAGES.full);
          }
          const created = await repo.insertJoinRequest({
            mapId: invite.mapId,
            userId: user.id,
            inviteCodeId: invite.id,
          });
          return { request: asRequest(created), created: true };
        });
      try {
        return await attempt();
      } catch (err) {
        // A double tap raced us to the one-pending-request index; return that one.
        if (isUniqueViolation(err)) return attempt();
        throw err;
      }
    },

    approve: async (user, mapId, requestId) => {
      await requireOwner(db, user, mapId);
      await store.transaction(async (repo) => {
        // Lock order: seats, request, the player, tiles, then maps (appendGameEvent).
        // Seats first, so two approvals racing for the last seat run one at a time.
        await repo.lockSeats(mapId);
        const request = await repo.lockJoinRequest(mapId, requestId);
        if (!request) throw new AppError('NOT_FOUND', MESSAGES.requestNotFound);
        if (request.status !== 'pending') throw new AppError('CONFLICT', MESSAGES.requestAnswered);
        await repo.lockUser(request.userId);
        // Already in (a stale request): close it without a second home base.
        if ((await repo.membership(mapId, request.userId))?.status === 'active') {
          await repo.decideJoinRequest({ mapId, requestId, status: 'approved', now: now() });
          return;
        }

        const map = await repo.findMap(mapId);
        if (!map) throw new AppError('NOT_FOUND', MESSAGES.notFound);
        // Read after taking the seats lock, so it sees every committed join.
        const seats = await repo.activeHomeSlots(mapId);
        if (seats.count >= map.maxPlayers) throw new AppError('CONFLICT', MESSAGES.full);
        const homeSlot = Array.from({ length: map.maxPlayers }, (_, i) => i).find(
          (slot) => !seats.slots.has(slot),
        );
        if (homeSlot === undefined) throw new AppError('CONFLICT', MESSAGES.full);

        const joiner = await repo.findUser(request.userId);
        if (!joiner) throw new Error(`approve: user ${request.userId} missing`);
        await repo.upsertMember({
          mapId,
          userId: joiner.id,
          role: 'member',
          homeSlot,
          joinedAt: now(),
        });
        const home = await repo.claimHomeTiles(mapId, homeSlot, joiner.id);
        // Hand-authored maps have no home slots to give.
        if (home.length === 0) throw new AppError('CONFLICT', MESSAGES.noRoom);
        await repo.decideJoinRequest({ mapId, requestId, status: 'approved', now: now() });
        await repo.appendEvent({
          mapId,
          type: 'member.joined',
          actorUserId: user.id,
          payload: {
            userId: joiner.id,
            username: joiner.username,
            homeSlot,
            heartSeed: heartSeedOf(home),
          },
        });
      });
      published(mapId);
    },

    deny: async (user, mapId, requestId) => {
      await requireOwner(db, user, mapId);
      if (!(await store.decideJoinRequest({ mapId, requestId, status: 'denied', now: now() }))) {
        throw new AppError('CONFLICT', MESSAGES.requestAnswered);
      }
    },

    removeMember: async (user, mapId, memberId) => {
      await requireOwner(db, user, mapId);
      if (memberId === user.id) throw new AppError('FORBIDDEN', MESSAGES.removeSelf);
      await depart(mapId, memberId, user, 'member.removed');
      published(mapId);
    },

    leave: async (user, mapId) => {
      const { role } = await requireMember(db, user, mapId, PATCHES);
      if (role === 'owner') throw new AppError('FORBIDDEN', MESSAGES.ownerLeave);
      await depart(mapId, user.id, user, 'member.left');
      published(mapId);
    },

    setPvpMode: async (user, mapId, pvpMode) => {
      await requireOwner(db, user, mapId);
      await store.transaction(async (repo) => {
        if (!(await repo.setPvpMode(mapId, pvpMode))) return;
        await repo.appendEvent({
          mapId,
          type: 'map.updated',
          actorUserId: user.id,
          payload: { pvpMode },
        });
      });
      published(mapId);
      return pvpMode;
    },

    resetMemberPassword: async (user, mapId, memberId) => {
      await requireOwner(db, user, mapId);
      if (memberId === user.id) throw new AppError('FORBIDDEN', MESSAGES.resetSelf);

      // Hash before taking any locks; Argon2 is slow on purpose.
      const credentials = await newResetCredentials();

      const member = await store.transaction(async (repo, tx) => {
        // Locking the account holds off joins and new maps (approve and create
        // lock it too), so the scope check below stays true until the reset commits.
        await repo.lockUser(memberId);
        const membership = await repo.membership(mapId, memberId);
        const target = await repo.findUser(memberId);
        if (membership?.status !== 'active' || !target) {
          throw new AppError('NOT_FOUND', MESSAGES.notAMember);
        }
        // Decision D: only if every game map they're in is this owner's.
        if ((await repo.countMapsOwnedByOthers(memberId, user.id)) > 0) {
          throw new AppError('FORBIDDEN', MESSAGES.resetOutOfScope);
        }
        // Revokes their sessions and rotates their recovery code (auth contract).
        await createAuthRepo(tx).resetPassword({
          userId: memberId,
          passwordHash: credentials.passwordHash,
          newRecoveryCodeHash: credentials.newRecoveryCodeHash,
          now: now(),
        });
        return target;
      });
      return {
        user: member,
        temporaryPassword: credentials.temporaryPassword,
        recoveryCode: credentials.recoveryCode,
      };
    },
  };
}
