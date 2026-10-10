import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import { GAME_EVENT_TYPES, type GameEventType } from '@heartpatch/shared';
import type { Executor } from '../db/client.js';
import { REPLAY_WINDOW } from '../ws/limits.js';
import type { EventConsumer } from './consumers.js';
import {
  EVENT_RETENTION_BATCH,
  EVENT_RETENTION_CRON,
  EVENT_RETENTION_DAYS,
  EVENT_RETENTION_MAX_BATCHES,
  EVENT_RETENTION_SHORT_DAYS,
} from './limits.js';
import { ensureQueue } from './queues.js';
import { createJobsRepo, type RetentionMap } from './repo.js';

/*
 * `game_events` retention (#352; tech spec §7 "Game event stream"). Old
 * events only serve WebSocket replay: consumers that need history (the raid
 * log, milestones, the Hollow, the Lorebook, the tutorial) keep their own
 * tables, and a client whose missed events are gone gets `ws.resync`. So an
 * event may go once it is past its keep and no longer needed by either:
 *
 * - **consumers:** below every `event_consumers.last_seq` on its map (a
 *   consumer that reads the map's kind and has no row yet keeps everything);
 * - **replay:** outside the map's latest `REPLAY_WINDOW` seqs, the most the
 *   hub replays before it sends `ws.resync` anyway.
 */

/**
 * Event types that only matter while a live battle or a challenge is on: a
 * battle's picks, turns and cheers, and every `challenge.*` and `defense.*`
 * ("Defend now?", #29-C) type. Matched
 * against the shared registry, so only registered types count, and a new
 * challenge type is short-lived from the day it's registered.
 */
const SHORT_LIVED = /^(?:battle\.(?:picked|turned|cheered)|(?:challenge|defense)\..+)$/;

export const isShortLived = (type: string): boolean => SHORT_LIVED.test(type);

/** The registered event types kept `EVENT_RETENTION_SHORT_DAYS` rather than `EVENT_RETENTION_DAYS`. */
export const SHORT_LIVED_EVENT_TYPES: readonly GameEventType[] =
  GAME_EVENT_TYPES.filter(isShortLived);

/**
 * The first seq of the map that must stay: the lowest consumer position
 * (consumers of this map kind with no row yet count as 0), and the start of
 * the replay window. Everything below it may go once it's old enough.
 */
export function keepFromSeq(
  map: Pick<RetentionMap, 'kind' | 'eventSeq' | 'positions'>,
  consumers: readonly Pick<EventConsumer, 'name' | 'mapKinds'>[],
  replayWindow: number,
): number {
  let keepFrom = map.eventSeq - replayWindow + 1;
  for (const seq of map.positions.values()) keepFrom = Math.min(keepFrom, seq);
  for (const consumer of consumers) {
    if (consumer.mapKinds.includes(map.kind)) {
      keepFrom = Math.min(keepFrom, map.positions.get(consumer.name) ?? 0);
    }
  }
  return keepFrom;
}

export interface PruneOptions {
  now: Date;
  /** Only these maps (tests and ops); every map by default. */
  mapIds?: readonly string[];
  replayWindow?: number;
  shortLivedTypes?: readonly string[];
  batchSize?: number;
  maxBatches?: number;
}

export interface PruneResult {
  deleted: number;
  batches: number;
  /** The run stopped after `maxBatches` full batches, maybe with more to delete; the next run carries on. */
  capped: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes each map's events that are past their keep and below its
 * `keepFromSeq`, in batches of `batchSize`. A run stops after `maxBatches`
 * full batches in all; a map's last, short batch doesn't count, so a map
 * with nothing to delete never uses up the run and starves the maps after it.
 * Each batch is its own statement, so it holds its row locks only briefly
 * and never touches `maps` or `event_consumers`: positions and the head only
 * move up, so a floor read before the deletes stays safe.
 */
export async function pruneGameEvents(
  db: Executor,
  consumers: readonly Pick<EventConsumer, 'name' | 'mapKinds'>[],
  options: PruneOptions,
): Promise<PruneResult> {
  const repo = createJobsRepo(db);
  const batchSize = options.batchSize ?? EVENT_RETENTION_BATCH;
  const maxBatches = options.maxBatches ?? EVENT_RETENTION_MAX_BATCHES;
  const replayWindow = options.replayWindow ?? REPLAY_WINDOW;
  const at = options.now.getTime();
  const result: PruneResult = { deleted: 0, batches: 0, capped: false };
  let full = 0;
  for (const map of await repo.retentionMaps(options.mapIds)) {
    const belowSeq = keepFromSeq(map, consumers, replayWindow);
    if (belowSeq <= 1) continue;
    for (;;) {
      if (full >= maxBatches) {
        result.capped = true;
        return result;
      }
      const deleted = await repo.deleteOldEvents(map.id, {
        belowSeq,
        before: new Date(at - EVENT_RETENTION_DAYS * DAY_MS),
        shortLivedTypes: options.shortLivedTypes ?? SHORT_LIVED_EVENT_TYPES,
        shortLivedBefore: new Date(at - EVENT_RETENTION_SHORT_DAYS * DAY_MS),
        limit: batchSize,
      });
      result.batches += 1;
      result.deleted += deleted;
      if (deleted < batchSize) break;
      full += 1;
    }
  }
  return result;
}

export const RETENTION_QUEUE = 'game-events.retention';

/**
 * The `game-events.retention` job: `pruneGameEvents` on `EVENT_RETENTION_CRON`
 * (`short`, so a slow run never stacks a second one behind it).
 */
export async function startRetention(
  boss: PgBoss,
  db: Executor,
  consumers: readonly EventConsumer[],
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<void> {
  await ensureQueue(boss, logger, RETENTION_QUEUE, { policy: 'short' });
  await boss.work(RETENTION_QUEUE, async () => {
    const pruned = await pruneGameEvents(db, consumers, { now: new Date() });
    if (pruned.deleted > 0) logger.info(pruned, 'pruned old game events');
  });
  if (schedule) await boss.schedule(RETENTION_QUEUE, EVENT_RETENTION_CRON);
}
