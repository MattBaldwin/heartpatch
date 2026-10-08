import {
  otherSide,
  parseGameEventPayload,
  setupSpecies,
  stanceOfPolicy,
  type BattleSideId,
  type RaidOutcome,
} from '@heartpatch/shared';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import { createBattlesRepo } from '../battles/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import type { ChallengeRow } from './repo.js';
import { createRaidsTxRepo } from './repo.js';

/**
 * How a challenge ended for the defender: who won the battle (from
 * `battle.ended`, where the challenger is `playerSide`) and what the attempt
 * log says happened to the land.
 */
export function raidOutcome(
  winner: BattleSideId | 'draw' | null,
  playerSide: BattleSideId,
  land: ChallengeRow['outcome'],
): RaidOutcome {
  if (land === 'no-contest' || winner === null) return 'no-contest';
  if (land === 'captured') return 'taken';
  if (winner === 'draw') return 'tie';
  // Won by the defenders, or the challenger left (a forfeit is the other side's win).
  if (winner === otherSide(playerSide)) return 'held';
  return 'lost';
}

/**
 * The raid log's event consumer (#16, tech spec §7 "Event consumers"). For
 * each `battle.ended` of a challenge (`rival-tile`), in seq order: write the
 * defender's `raids` row and append `raid.resolved` so their client hears it
 * live. Idempotent on the battle (the `raids.battle_id` unique key), on top of
 * the runner's exactly-once (`jobs/consumers.ts`).
 *
 * A consumer rather than a write in the battle's own transaction: the battle
 * has already settled everything that must commit together (the attempt and
 * the tile, CLAUDE.md rule 7), the log only reports it, and `battle.ended`
 * carries the ending reason the territory port doesn't see. So battles and
 * territory don't change, and a broken raid log can only delay a report,
 * never a showdown.
 */
export function createRaidsConsumer(): EventConsumer {
  return {
    name: 'raid-log',
    mapKinds: ['multiplayer'],
    handle: async (tx: Transaction, event: GameEvent) => {
      if (event.type !== 'battle.ended') return;
      const ended = parseGameEventPayload('battle.ended', event.payload);
      if (ended.kind !== 'rival-tile') return;
      const repo = createRaidsTxRepo(tx);
      const challenge = await repo.challengeFor(ended.battleId);
      // A neutral tile's guardians (the land had no owner when it started) has no defender.
      if (challenge?.defenderUserId == null) return;
      const battle = await createBattlesRepo(tx).findBattle(ended.battleId);
      if (!battle) return;

      const defending = battle.setup[otherSide(ended.playerSide)];
      const outcome = raidOutcome(ended.winner, ended.playerSide, challenge.outcome);
      const raid = await repo.insertRaid({
        mapId: event.mapId,
        battleId: battle.id,
        tileId: challenge.tileId,
        attackerUserId: challenge.attackerUserId,
        defenderUserId: challenge.defenderUserId,
        outcome,
        reason: ended.reason,
        stance:
          defending.controller.type === 'ai' ? stanceOfPolicy(defending.controller.policy) : null,
        resolvedAt: battle.endedAt ?? event.createdAt,
      });
      if (!raid) return; // already logged
      // The defender's squishies met the challenger's team in a showdown
      // that played out: their catalog knows them now, so the replay can name
      // a secret one (CLAUDE.md rule 6). A called-off one has no replay.
      if (battle.status === 'finished') {
        await createSpawnsRepo(tx).markSeen(
          event.mapId,
          challenge.defenderUserId,
          setupSpecies(battle.setup[ended.playerSide].squishies),
          battle.endedAt ?? event.createdAt,
        );
      }
      await repo.appendEvent({
        mapId: event.mapId,
        type: 'raid.resolved',
        actorUserId: null,
        payload: {
          raidId: raid.id,
          battleId: battle.id,
          attackerUserId: challenge.attackerUserId,
          defenderUserId: challenge.defenderUserId,
          q: challenge.q,
          r: challenge.r,
          outcome,
        },
      });
    },
  };
}
