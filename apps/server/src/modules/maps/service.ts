import { randomInt } from 'node:crypto';
import {
  formatInviteCode,
  GAME_DATA,
  generateMap,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAP_MAX_PLAYERS,
  type CreateMapRequest,
  type Hex,
  type Invite,
  type MapDetail,
  type MapMember,
  type MapView,
  type MemberPasswordResetResponse,
  type MyJoinRequest,
  type MyMapsResponse,
  type PublicUser,
  type PvpMode,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import { newSeed } from '../../lib/rng.js';
import { canonicalTimeZone, type Clock } from '../../lib/time.js';
import { isUniqueViolation } from '../../db/errors.js';
import { createAuthRepo } from '../auth/repo.js';
import { newResetCredentials } from '../auth/secrets.js';
import { INVITE_CODE_TTL_MS } from './limits.js';
import { createMapsRepo, type JoinRequestRow, type MapsRepo, type MemberRow } from './repo.js';

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
  clock?: Clock;
}

// Kid-readable messages (style guide §6). Players call maps "patches".
const MESSAGES = {
  notFound: "We couldn't find that patch.",
  ownerOnly: 'Only the patch owner can do that.',
  tutorialFirst: 'Finish your first adventure with Sprout, then come back!',
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
  const { db, tutorialRequired } = options;
  const now = options.clock ?? (() => new Date());
  const store = createMapsRepo(db);

  const assertTutorialDone = async (user: PublicUser) => {
    if (!tutorialRequired) return;
    if ((await store.tutorialCompletedAt(user.id)) === null) {
      throw new AppError('FORBIDDEN', MESSAGES.tutorialFirst);
    }
  };

  /**
   * The map and the player's role. NOT_FOUND for non-members and tutorial
   * maps, so other maps can't be probed.
   */
  const requireMember = async (repo: MapsRepo, user: PublicUser, mapId: string) => {
    const [map, membership] = await Promise.all([
      repo.findMap(mapId),
      repo.membership(mapId, user.id),
    ]);
    if (map?.kind !== 'multiplayer' || membership?.status !== 'active') {
      throw new AppError('NOT_FOUND', MESSAGES.notFound);
    }
    return { map, role: membership.role };
  };

  const requireOwner = async (repo: MapsRepo, user: PublicUser, mapId: string) => {
    const found = await requireMember(repo, user, mapId);
    if (found.role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.ownerOnly);
    return found.map;
  };

  const detail = async (user: PublicUser, mapId: string): Promise<MapDetail> => {
    const { map, role } = await requireMember(store, user, mapId);
    const members = await store.listMembers(mapId);
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
    store.transaction(async (repo) => {
      // Lock order: seats, the player, tiles, then maps (appendGameEvent).
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
      return detail(user, mapId);
    },

    get: detail,

    view: async (user, mapId) => {
      const { map } = await requireMember(store, user, mapId);
      const [members, tiles] = await Promise.all([
        store.listMembers(mapId),
        store.listTiles(mapId),
      ]);
      return {
        map: {
          id: map.id,
          name: map.name,
          timeZone: map.timeZone,
          pvpMode: map.pvpMode,
          maxPlayers: map.maxPlayers,
        },
        members: members.map(toMember),
        tiles,
      };
    },

    regenerateInvite: async (user, mapId) => {
      await requireOwner(store, user, mapId);
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
      await requireOwner(store, user, mapId);
      await store.revokeInvites(mapId, now());
    },

    join: async (user, code) => {
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
      await requireOwner(store, user, mapId);
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
    },

    deny: async (user, mapId, requestId) => {
      await requireOwner(store, user, mapId);
      if (!(await store.decideJoinRequest({ mapId, requestId, status: 'denied', now: now() }))) {
        throw new AppError('CONFLICT', MESSAGES.requestAnswered);
      }
    },

    removeMember: async (user, mapId, memberId) => {
      await requireOwner(store, user, mapId);
      if (memberId === user.id) throw new AppError('FORBIDDEN', MESSAGES.removeSelf);
      await depart(mapId, memberId, user, 'member.removed');
    },

    leave: async (user, mapId) => {
      const { role } = await requireMember(store, user, mapId);
      if (role === 'owner') throw new AppError('FORBIDDEN', MESSAGES.ownerLeave);
      await depart(mapId, user.id, user, 'member.left');
    },

    setPvpMode: async (user, mapId, pvpMode) => {
      await requireOwner(store, user, mapId);
      await store.transaction(async (repo) => {
        if (!(await repo.setPvpMode(mapId, pvpMode))) return;
        await repo.appendEvent({
          mapId,
          type: 'map.updated',
          actorUserId: user.id,
          payload: { pvpMode },
        });
      });
      return pvpMode;
    },

    resetMemberPassword: async (user, mapId, memberId) => {
      await requireOwner(store, user, mapId);
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
