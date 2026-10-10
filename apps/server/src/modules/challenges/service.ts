import {
  BATTLE_RULES,
  CHALLENGE_RULES,
  type AnswerChallengeRequest,
  type AnswerChallengeResponse,
  type ChallengeRules,
  type ChallengesResponse,
  type ChallengeView,
  type PublicUser,
  type SendChallengeRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { isUniqueViolation } from '../../db/errors.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import type { BattlesService } from '../battles/service.js';
import { createBattlesRepo } from '../battles/repo.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createChallengesRepo, type ChallengeRow, type ChallengesTxRepo } from './repo.js';

/*
 * Friendly battles (#29): "Battle me?" between two Keepers who are both on
 * the patch. Nothing at stake (no tries, land, XP or potions), so it works
 * in every PvP mode; the owner can switch it off. The asks are rate-limited
 * from the table itself (per pair, per player, and a rest after "Not now!").
 * Expiry is a timestamp, noticed on the next read (CLAUDE.md rule 4).
 */

export interface ChallengesService {
  view: (user: PublicUser, mapId: string) => Promise<ChallengesResponse>;
  send: (user: PublicUser, mapId: string, request: SendChallengeRequest) => Promise<ChallengeView>;
  answer: (
    user: PublicUser,
    challengeId: string,
    request: AnswerChallengeRequest,
  ) => Promise<AnswerChallengeResponse>;
  cancel: (user: PublicUser, challengeId: string) => Promise<void>;
  /** The owner's switch: off calls off every waiting friendly ask. */
  setFriendly: (user: PublicUser, mapId: string, on: boolean) => Promise<boolean>;
}

export interface ChallengesServiceOptions {
  db: Executor;
  battles: Pick<BattlesService, 'startFriendly' | 'get'>;
  /** Is this player's app open on this map (`wsHub.isOnline`)? Without one, nobody is. */
  isOnline?: (mapId: string, userId: string) => boolean;
  clock?: Clock;
  publish?: (mapId: string) => Promise<void>;
  rules?: ChallengeRules;
}

// Kid-readable (style guide §6).
const MESSAGES = {
  notFound: "We couldn't find that ask.",
  tutorial: 'Friendly battles happen on a patch with friends!',
  off: 'Friendly battles are switched off on this patch.',
  self: "You can't battle yourself, silly!",
  notHere: "They're not here right now. Try when they're on!",
  alreadyAsked: 'You already asked someone! Wait for their answer.',
  theyHaveAsk: "They're thinking about another battle. Try again soon!",
  tooMany: "That's a lot of asks! Take a little break, then try again.",
  rest: 'They said Not now! Give them a few minutes.',
  gone: 'That ask floated away. You can ask again!',
  busy: 'Someone is already in a battle. Try again in a bit!',
  notOwner: 'Only the patch owner can change that.',
} as const;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export function createChallengesService(options: ChallengesServiceOptions): ChallengesService {
  const { db, battles } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? CHALLENGE_RULES;
  const isOnline = options.isOnline ?? (() => false);
  const store = createChallengesRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** A player's battle team's top level (0 with nobody to battle with). */
  const teamLevel = async (tx: Executor, mapId: string, userId: string): Promise<number> => {
    const team = await createBattlesRepo(tx).listTeam(mapId, userId, BATTLE_RULES.teamSize);
    return team.reduce((top, s) => Math.max(top, s.level), 0);
  };

  const toView = async (row: ChallengeRow): Promise<ChallengeView> => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    fromTeamLevel: await teamLevel(db, row.mapId, row.fromUserId),
    toTeamLevel: await teamLevel(db, row.mapId, row.toUserId),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    battleId: row.battleId,
  });

  const pair = (row: ChallengeRow) => ({
    challengeId: row.id,
    kind: row.kind,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
  });

  /** Waiting asks past their time float away (`challenge.cancelled`, `expired`). */
  const expireStale = async (repo: ChallengesTxRepo, mapId: string, at: Date) => {
    const stale = await repo.lockExpired(mapId, at);
    for (const row of stale) await repo.settle(row.id, { status: 'expired', at });
    for (const row of stale) {
      await repo.appendEvent({
        mapId,
        type: 'challenge.cancelled',
        actorUserId: null,
        payload: { ...pair(row), reason: 'expired' },
      });
    }
    return stale.length;
  };

  /** Expires stale asks in their own transaction; publishes if any went. */
  const expireNow = async (mapId: string) => {
    const expired = await store.transaction((repo) => expireStale(repo, mapId, now()));
    if (expired > 0) published(mapId);
  };

  /** The ask, if this player is in it and still on its map. */
  const requireAsk = async (user: PublicUser, challengeId: string, as: 'from' | 'to') => {
    const row = await store.find(challengeId);
    const mine = row && (as === 'from' ? row.fromUserId : row.toUserId) === user.id;
    if (!row || !mine || row.kind !== 'friendly') {
      throw new AppError('NOT_FOUND', MESSAGES.notFound);
    }
    await requireMember(db, user, row.mapId);
    return row;
  };

  /** Locks a waiting ask that's still in time, or refuses it. */
  const lockLive = async (repo: ChallengesTxRepo, challengeId: string, at: Date) => {
    const row = await repo.lock(challengeId);
    if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= at.getTime()) {
      throw new AppError('CONFLICT', MESSAGES.gone);
    }
    return row;
  };

  return {
    view: async (user, mapId) => {
      await requireMember(db, user, mapId);
      await expireNow(mapId);
      const battlesRepo = createBattlesRepo(db);
      const memberIds = (await store.memberIds(mapId)).filter(
        (id) => id !== user.id && isOnline(mapId, id),
      );
      const names = await store.usernames(memberIds);
      const online = [];
      for (const userId of memberIds) {
        online.push({
          userId,
          username: names.get(userId) ?? '',
          inBattle: (await battlesRepo.findActive(mapId, userId)) !== null,
          teamLevel: await teamLevel(db, mapId, userId),
        });
      }
      const pending = await store.pendingFor(mapId, user.id);
      const friendly = pending.filter((row) => row.kind === 'friendly');
      const outgoing = friendly.find((row) => row.fromUserId === user.id);
      return {
        friendlyChallenges: await store.friendlyEnabled(mapId),
        myTeamLevel: await teamLevel(db, mapId, user.id),
        online,
        incoming: await Promise.all(friendly.filter((row) => row.toUserId === user.id).map(toView)),
        outgoing: outgoing ? await toView(outgoing) : null,
      };
    },

    send: async (user, mapId, { toUserId }) => {
      const { map } = await requireMember(db, user, mapId);
      if (map.kind !== 'multiplayer') throw new AppError('CONFLICT', MESSAGES.tutorial);
      if (toUserId === user.id) throw new AppError('VALIDATION_FAILED', MESSAGES.self);
      if (!(await store.memberIds(mapId)).includes(toUserId)) {
        throw new AppError('NOT_FOUND', MESSAGES.notHere);
      }
      if (!isOnline(mapId, toUserId)) throw new AppError('CONFLICT', MESSAGES.notHere);
      const begin = () =>
        store.transaction(async (repo, tx) => {
          // Both member rows, in id order (lock order step 2), so the limits
          // below hold against a double tap and a crossing ask.
          const maps = createMapsRepo(tx);
          for (const id of [user.id, toUserId].sort()) {
            if (!(await maps.lockMember(mapId, id))) {
              throw new AppError('NOT_FOUND', MESSAGES.notHere);
            }
          }
          if (!(await repo.friendlyEnabled(mapId))) throw new AppError('CONFLICT', MESSAGES.off);
          const at = now();
          await expireStale(repo, mapId, at);
          const waiting = await repo.pendingFor(mapId, user.id);
          if (waiting.some((row) => row.fromUserId === user.id)) {
            throw new AppError('CONFLICT', MESSAGES.alreadyAsked);
          }
          if ((await repo.pendingFor(mapId, toUserId)).some((row) => row.toUserId === toUserId)) {
            throw new AppError('CONFLICT', MESSAGES.theyHaveAsk);
          }
          const since = (minutes: number) => new Date(at.getTime() - minutes * MINUTE_MS);
          const [toThem, toAnyone, notNowAt] = await Promise.all([
            repo.sentSince(mapId, user.id, since(rules.perPair.minutes), toUserId),
            repo.sentSince(mapId, user.id, since(rules.perPlayer.minutes)),
            repo.lastNotNow(mapId, user.id, toUserId),
          ]);
          if (toThem >= rules.perPair.max || toAnyone >= rules.perPlayer.max) {
            throw new AppError('RATE_LIMITED', MESSAGES.tooMany);
          }
          if (notNowAt && notNowAt.getTime() > since(rules.notNowRestMinutes).getTime()) {
            throw new AppError('RATE_LIMITED', MESSAGES.rest);
          }
          const battlesRepo = createBattlesRepo(tx);
          for (const id of [user.id, toUserId]) {
            if (await battlesRepo.findActive(mapId, id)) {
              throw new AppError('CONFLICT', MESSAGES.busy);
            }
          }
          const row = await repo.insert({
            mapId,
            kind: 'friendly',
            fromUserId: user.id,
            toUserId,
            createdAt: at,
            expiresAt: new Date(at.getTime() + rules.expireSeconds * SECOND_MS),
          });
          await repo.appendEvent({
            mapId,
            type: 'challenge.sent',
            actorUserId: user.id,
            payload: pair(row),
          });
          return row;
        });
      let row: ChallengeRow;
      try {
        row = await begin();
      } catch (err) {
        // A double tap raced us to the one-ask-at-a-time index.
        if (isUniqueViolation(err)) throw new AppError('CONFLICT', MESSAGES.alreadyAsked);
        throw err;
      }
      published(mapId);
      return toView(row);
    },

    answer: async (user, challengeId, { answer }) => {
      const asked = await requireAsk(user, challengeId, 'to');
      const { mapId } = asked;
      if (answer === 'not-now') {
        await store.transaction(async (repo) => {
          const at = now();
          const row = await lockLive(repo, challengeId, at);
          await repo.settle(row.id, { status: 'declined', at });
          await repo.appendEvent({
            mapId,
            type: 'challenge.answered',
            actorUserId: user.id,
            payload: { ...pair(row), answer: 'not-now', battleId: null },
          });
        });
        published(mapId);
        const row = await store.find(challengeId);
        return { challenge: await toView(row ?? asked), battle: null };
      }
      let battleId: string;
      try {
        battleId = await battles.startFriendly({
          mapId,
          aUserId: asked.fromUserId,
          bUserId: asked.toUserId,
          // The ask is locked after the member rows and the new battle
          // (lock order step 9c), and settles with the battle (rule 7).
          started: async (tx, battle): Promise<NewGameEvent[]> => {
            const repo = createChallengesRepo(tx);
            const at = battle.startedAt;
            const row = await repo.lock(challengeId);
            if (!row || row.status !== 'pending' || row.expiresAt.getTime() <= at.getTime()) {
              throw new AppError('CONFLICT', MESSAGES.gone);
            }
            await repo.settle(row.id, { status: 'accepted', at, battleId: battle.id });
            return [
              {
                mapId,
                type: 'challenge.answered',
                actorUserId: user.id,
                payload: { ...pair(row), answer: 'yes', battleId: battle.id },
              },
            ];
          },
        });
      } catch (err) {
        // Too late: let it float away for both of them, then say so.
        if (err instanceof AppError && err.message === MESSAGES.gone) await expireNow(mapId);
        throw err;
      }
      const row = await store.find(challengeId);
      return {
        challenge: await toView(row ?? asked),
        battle: await battles.get(user, battleId),
      };
    },

    cancel: async (user, challengeId) => {
      const asked = await requireAsk(user, challengeId, 'from');
      await store.transaction(async (repo) => {
        const at = now();
        const row = await lockLive(repo, challengeId, at);
        await repo.settle(row.id, { status: 'cancelled', at });
        await repo.appendEvent({
          mapId: asked.mapId,
          type: 'challenge.cancelled',
          actorUserId: user.id,
          payload: { ...pair(row), reason: 'cancelled' },
        });
      });
      published(asked.mapId);
    },

    setFriendly: async (user, mapId, on) => {
      const { role } = await requireMember(db, user, mapId);
      if (role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.notOwner);
      const changed = await store.transaction(async (repo, tx) => {
        if ((await repo.friendlyEnabled(mapId)) === on) return false;
        const at = now();
        // Off: every waiting ask goes (step 9c, id order), then the map.
        const waiting = on ? [] : await repo.lockPending(mapId, 'friendly');
        for (const row of waiting) await repo.settle(row.id, { status: 'cancelled', at });
        await repo.setFriendly(mapId, on);
        for (const row of waiting) {
          await repo.appendEvent({
            mapId,
            type: 'challenge.cancelled',
            actorUserId: user.id,
            payload: { ...pair(row), reason: 'switched-off' },
          });
        }
        // The patch's other settings as this transaction reads them.
        const map = await createMapsRepo(tx).findMap(mapId);
        await repo.appendEvent({
          mapId,
          type: 'map.updated',
          actorUserId: user.id,
          payload: {
            pvpMode: map?.pvpMode ?? 'gentle',
            ...(map && { tradingEnabled: map.tradingEnabled }),
            friendlyChallenges: on,
          },
        });
        return true;
      });
      if (changed) published(mapId);
      return on;
    },
  };
}
