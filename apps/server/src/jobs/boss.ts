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
import { ensureQueue } from './queues.js';
import { createJobsRepo, pgBossOnTransaction } from './repo.js';
import { startRetention } from './retention.js';

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
 * consumer with the `short` policy and the map id as `singletonKey`, so a
 * burst of wake-ups for one map collapses into one queued job; a worker that
 * applies events with `runConsumer`; the wake-up `appendGameEvent` enqueues
 * inside each command's transaction; the periodic catch-up job; the
 * `game_events` retention job (`retention.ts`); and, given a runner, the
 * Hollow Man's nightfall (`nightfall.ts`).
 *
 * Why `short` and not `stately`: `stately` also allows only one *active* job
 * per key, enforced by a unique index on the job table. pg-boss's fetch only
 * skips keys it cached as active (refreshed once a minute), so a wake-up
 * that arrives while that map's job is running gets fetched by an idle
 * worker, trips the index, and Postgres logs a "duplicate key" error on
 * every poll until the job ends (the fetch is retried, so nothing is lost,
 * but the log fills up and the map's next job waits). Nothing here needs
 * that guarantee: `runConsumer` already serializes the (consumer, map) pair
 * on the `event_consumers` row lock, so a second job for a running map just
 * takes its turn, and a wake-up during a run becomes a job of its own, which
 * is what makes it never lost.
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
    await ensureQueue(boss, logger, queue, {
      // One queued job per map (`job_i1`); an active one never blocks a fetch.
      policy: 'short',
      retryLimit: CONSUMER_RETRY_LIMIT,
      retryDelay: CONSUMER_RETRY_DELAY_SECONDS,
      retryBackoff: true,
      notify: true,
    });
    // Several maps at once; one map's events never overlap (`runConsumer`'s row lock).
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

  await ensureQueue(boss, logger, CATCH_UP_QUEUE, { policy: 'short' });
  await boss.work(CATCH_UP_QUEUE, async () => {
    const woken = await catchUp();
    if (woken > 0) logger.info({ woken }, 'woke lagging event consumers');
  });
  if (options.schedule ?? true) {
    await boss.schedule(CATCH_UP_QUEUE, CATCH_UP_CRON);
  }
  // A crash may have left events behind: catch up once at boot.
  await catchUp();

  await startRetention(boss, db, consumers, logger, options.schedule ?? true);

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
