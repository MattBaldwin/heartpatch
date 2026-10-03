import { PgBoss } from 'pg-boss';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { setEventWakeup } from '../db/game-events.js';
import { runConsumer, type EventConsumer } from './consumers.js';
import {
  CATCH_UP_CRON,
  CONSUMER_CONCURRENCY,
  CONSUMER_POLL_SECONDS,
  CONSUMER_RETRY_DELAY_SECONDS,
  CONSUMER_RETRY_LIMIT,
  JOBS_STOP_TIMEOUT_MS,
} from './limits.js';
import { startNightfall, type NightfallRunner } from './nightfall.js';
import { createJobsRepo, pgBossOnTransaction } from './repo.js';

/** pg-boss keeps its tables in their own schema, outside Drizzle's migrations. */
export const PG_BOSS_SCHEMA = 'pgboss';
const CATCH_UP_QUEUE = 'event-consumers.catch-up';

/** The queue that wakes one consumer; jobs carry `{ mapId }`, keyed by map. */
export const consumerQueue = (consumer: EventConsumer): string => `event-consumer.${consumer.name}`;

interface WakeUp {
  mapId: string;
}

export interface JobsOptions {
  /** Postgres for pg-boss's own pool (the app's `DATABASE_URL`). */
  connectionString: string;
  db: Database;
  consumers: readonly EventConsumer[];
  logger: FastifyBaseLogger;
  /** After each consumer event's transaction commits; pass `wsHub.publish` so handlers' events go out live. */
  publish?: (mapId: string) => Promise<void>;
  /** Run the periodic catch-up on its cron (default true; tests trigger `catchUp` by hand). */
  schedule?: boolean;
  /** The Hollow Man's nightfall (#21, `jobs/nightfall.ts`); none without it. */
  nightfall?: NightfallRunner;
}

export interface Jobs {
  /** Wakes every consumer on every map it lags on. Also runs at start and on `CATCH_UP_CRON`. */
  catchUp: () => Promise<number>;
  /** Enqueues every due nightfall now (also every minute, and at start). 0 without `nightfall`. */
  nightfallSweep: () => Promise<number>;
  /** Stops taking jobs, waits for running ones, and stops enqueuing wake-ups. */
  stop: () => Promise<void>;
}

/**
 * Boots pg-boss (tech spec §7, "Scheduled jobs"): one queue per event
 * consumer with the `stately` policy and the map id as `singletonKey`, so at
 * most one job per (consumer, map) is queued and one runs; a worker that
 * applies events with `runConsumer`; the wake-up `appendGameEvent` enqueues
 * inside each command's transaction; the periodic catch-up job; and, given a
 * runner, the Hollow Man's nightfall (`nightfall.ts`).
 */
export async function startJobs(options: JobsOptions): Promise<Jobs> {
  const { db, consumers, logger } = options;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: PG_BOSS_SCHEMA,
    max: 4, // TUNE: pg-boss's own pool; the app's is separate
    // Wake workers on commit (LISTEN/NOTIFY) instead of waiting for a poll, so
    // Sprout moves on right after a tap. Polling stays as the fallback.
    useListenNotify: true,
  });
  boss.on('error', (err) => {
    logger.error({ err }, 'pg-boss error');
  });
  await boss.start();

  const repo = createJobsRepo(db);
  const afterCommit = (mapId: string) => void options.publish?.(mapId);

  for (const consumer of consumers) {
    const queue = consumerQueue(consumer);
    await boss.createQueue(queue, {
      policy: 'stately',
      retryLimit: CONSUMER_RETRY_LIMIT,
      retryDelay: CONSUMER_RETRY_DELAY_SECONDS,
      retryBackoff: true,
      notify: true,
    });
    // Several maps at once; one map's jobs never overlap (stately key + row lock).
    await boss.work<WakeUp>(
      queue,
      {
        pollingIntervalSeconds: CONSUMER_POLL_SECONDS,
        // With NOTIFY on, pg-boss polls this slowly between notifies (default
        // 30 s); a backlog (boot catch-up, retries) must still drain fast.
        notifyPollingIntervalSeconds: CONSUMER_POLL_SECONDS,
        localConcurrency: CONSUMER_CONCURRENCY,
      },
      async ([job]) => {
        if (!job) return;
        const { mapId } = job.data;
        try {
          const applied = await runConsumer(db, consumer, mapId, { afterCommit });
          if (applied > 0)
            logger.debug({ consumer: consumer.name, mapId, applied }, 'consumer ran');
        } catch (err) {
          // pg-boss retries; log so a stuck event (a player's tutorial frozen) is visible.
          logger.error({ err, consumer: consumer.name, mapId }, 'event consumer failed');
          throw err;
        }
      },
    );
  }

  const wake = (
    consumer: EventConsumer,
    mapId: string,
    db?: ReturnType<typeof pgBossOnTransaction>,
  ) =>
    boss.send(consumerQueue(consumer), { mapId } satisfies WakeUp, {
      singletonKey: mapId,
      ...(db ? { db } : {}),
    });

  const catchUp = async () => {
    let woken = 0;
    for (const consumer of consumers) {
      for (const mapId of await repo.laggingMaps(consumer.name, consumer.mapKinds)) {
        await wake(consumer, mapId);
        woken += 1;
      }
    }
    return woken;
  };

  setEventWakeup(async (tx, event) => {
    for (const consumer of consumers) {
      if (consumer.mapKinds.includes(event.mapKind)) {
        await wake(consumer, event.mapId, pgBossOnTransaction(tx));
      }
    }
  });

  await boss.createQueue(CATCH_UP_QUEUE, { policy: 'stately' });
  await boss.work(CATCH_UP_QUEUE, async () => {
    const woken = await catchUp();
    if (woken > 0) logger.info({ woken }, 'woke lagging event consumers');
  });
  if (options.schedule ?? true) {
    await boss.schedule(CATCH_UP_QUEUE, CATCH_UP_CRON);
  }
  // A crash may have left events behind: catch up once at boot.
  await catchUp();

  const nightfall = options.nightfall
    ? await startNightfall(boss, options.nightfall, logger, options.schedule ?? true)
    : null;

  return {
    catchUp,
    nightfallSweep: () => nightfall?.sweep() ?? Promise.resolve(0),
    stop: async () => {
      setEventWakeup(null);
      await boss.stop({ graceful: true, timeout: JOBS_STOP_TIMEOUT_MS });
    },
  };
}
