import {
  otherSide,
  fencePercent,
  RAID_RULES,
  RaidSchema,
  startBattle,
  type BattleContent,
  type MarkRaidsSeenRequest,
  type PublicUser,
  type Raid,
  type RaidReplay,
  type RaidReport,
  type RaidRules,
  type SetDefenseStyleRequest,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo, setupOf } from '../battles/repo.js';
import { defaultBattleContent, PLAYER_SIDE, playerBattleView } from '../battles/service.js';
import { requireMember } from '../maps/members.js';
import { createRaidsRepo, type RaidRow } from './repo.js';

/*
 * Offline defense and the raid log (#16; design doc §3, §6). The defender's
 * side of a challenge is always the server's AI following their defense
 * stance (territory's `defendingSide`), so they never have to be online. The
 * raid-log consumer (`consumer.ts`) writes a `raids` row for every finished
 * challenge; this service shows the defender their report ("morning report",
 * style guide §6), marks it seen, sets their stance, and replays a raid
 * through the battle screen's own view (#13).
 */

export interface RaidsService {
  /** My defense style and my latest raids on this map. */
  report: (user: PublicUser, mapId: string) => Promise<RaidReport>;
  setStyle: (
    user: PublicUser,
    mapId: string,
    request: SetDefenseStyleRequest,
  ) => Promise<RaidReport>;
  markSeen: (user: PublicUser, mapId: string, request: MarkRaidsSeenRequest) => Promise<RaidReport>;
  /** One of my raids as the battle screen plays it, from my side. */
  replay: (user: PublicUser, mapId: string, raidId: string) => Promise<RaidReplay>;
}

export interface RaidsServiceOptions {
  db: Executor;
  clock?: Clock;
  /** The content battles are played with (`defaultBattleContent`); tests pass their own. */
  content?: BattleContent;
  rules?: RaidRules;
}

// Kid-readable messages (style guide §2, §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  noRaid: "We couldn't find that showdown.",
  calledOff: 'That showdown was called off, so there’s nothing to watch.',
  tooOld: 'That showdown is from before the squishies learned new tricks, so it can’t be replayed.',
} as const;

/** A fence battle's line in my report (#203): broken, or how much energy it has left. */
function fenceLine(row: RaidRow): Raid['fence'] {
  if (row.fenceBuildingId === null || row.fenceHpAfter === null) return null;
  const broken = row.fenceHpAfter === 0;
  return {
    buildingId: row.fenceBuildingId,
    broken,
    percent: broken ? 0 : fencePercent(row.fenceHpAfter, row.fenceMaxHp ?? row.fenceHpAfter),
  };
}

/** The defender sees the challenger as side `a`; their own squishies are the other side. */
const DEFENDER_SIDE = otherSide(PLAYER_SIDE);

export function createRaidsService(options: RaidsServiceOptions): RaidsService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const content = options.content ?? defaultBattleContent();
  const rules = options.rules ?? RAID_RULES;
  const store = createRaidsRepo(db);

  const replayable = (row: RaidRow): boolean =>
    row.battleStatus === 'finished' && row.contentHash === content.contentHash;

  const toRaid = (row: RaidRow): Raid => ({
    id: row.id,
    battleId: row.battleId,
    attackerUserId: row.attackerUserId,
    attackerName: row.attackerName,
    q: row.q,
    r: row.r,
    outcome: row.outcome,
    // Plain text in the database; checked on the way out.
    reason: RaidSchema.shape.reason.parse(row.reason),
    stance: row.stance,
    resolvedAt: row.resolvedAt.toISOString(),
    seenAt: row.seenAt?.toISOString() ?? null,
    replayable: replayable(row),
    live: row.liveBattleId !== null,
    lostFire: row.lostFire ?? null,
    fence: fenceLine(row),
    lostFences: row.lostFences ?? null,
  });

  const report = async (user: PublicUser, mapId: string): Promise<RaidReport> => {
    await requireMember(db, user, mapId);
    const stance = await store.stanceOf(mapId, user.id);
    // Removed from the map since the check: the same NOT_FOUND.
    if (stance === null) throw new AppError('NOT_FOUND', MESSAGES.noMap);
    const raids = (await store.listFor(mapId, user.id, rules.reportLimit)).map(toRaid);
    return { stance, unseen: raids.filter((r) => r.seenAt === null).length, raids };
  };

  return {
    report,

    setStyle: async (user, mapId, request) => {
      const changed = await store.transaction((repo) =>
        repo.setStance(mapId, user.id, request.stance),
      );
      if (!changed) throw new AppError('NOT_FOUND', MESSAGES.noMap);
      return report(user, mapId);
    },

    markSeen: async (user, mapId, request) => {
      await requireMember(db, user, mapId);
      // Only the defender's own raids; anyone else's ids change nothing.
      await store.markSeen(mapId, user.id, request.raidIds, now());
      return report(user, mapId);
    },

    replay: async (user, mapId, raidId) => {
      await requireMember(db, user, mapId);
      const row = await store.findRaid(raidId);
      // Only the defender's own raids (the challenger has the battle already).
      if (row?.mapId !== mapId || row.defenderUserId !== user.id) {
        throw new AppError('NOT_FOUND', MESSAGES.noRaid);
      }
      if (row.battleStatus !== 'finished') throw new AppError('CONFLICT', MESSAGES.calledOff);
      // Re-tuned since: the stored result and log are the truth, and
      // replaying with today's rules would tell a different story (tech spec §8).
      if (row.contentHash !== content.contentHash) throw new AppError('CONFLICT', MESSAGES.tooOld);
      const battle = await createBattlesRepo(db).findBattle(row.battleId);
      if (!battle) throw new AppError('NOT_FOUND', MESSAGES.noRaid);
      // The first turn from the stored seed and setup; the screen then plays
      // the finished battle's log from there (the same path as a live battle).
      const first = startBattle(content, setupOf(battle));
      return {
        start: playerBattleView(content, battle, { mySide: DEFENDER_SIDE, state: first }),
        end: playerBattleView(content, battle, { mySide: DEFENDER_SIDE }),
      };
    },
  };
}
