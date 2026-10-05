import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import type { LocalDate } from '@heartpatch/shared';
import {
  NIGHTFALL_CONCURRENCY,
  NIGHTFALL_RETRY_DELAY_SECONDS,
  NIGHTFALL_RETRY_LIMIT,
  NIGHTFALL_SWEEP_CRON,
} from './limits.js';
import { ensureQueue } from './queues.js';

/** Finds maps whose nightfall is due, and runs one (the hollow module, #21). */
export interface NightfallRunner {
  /** `(mapId, night)` pairs whose latest nightfall hasn't run yet. */
  due: () => Promise<{ mapId: string; night: LocalDate }[]>;
  /** Night falls on the map; a night that already ran does nothing. */
  run: (mapId: string, night: LocalDate) => Promise<unknown>;
}

/** One map's night: the job's data, and its singleton key (`job, scope, date`, tech spec §7). */
interface NightfallJob {
  mapId: string;
  night: LocalDate;
}

export const NIGHTFALL_QUEUE = 'nightfall';
const SWEEP_QUEUE = 'nightfall.sweep';

/**
 * The `nightfall` job (tech spec §7; design doc §14): night falls on each map
 * at 21:00 in its own time zone. Rather than one cron per map (zones and
 * daylight saving move it), a sweep every minute asks which maps' latest
 * nightfall hasn't run, and enqueues one `nightfall` job per map and night,
 * keyed `mapId/night` (`short`: one queued per key; see `boss.ts` for why
 * not `stately`). The night's `hollow_events` row is the real guard, claimed
 * first thing in the transaction: a retry, a duplicate or a restart finds it
 * and takes nothing. After downtime the sweep runs the latest missed night
 * once (with only the squishies there at nightfall).
 */
export async function startNightfall(
  boss: PgBoss,
  runner: NightfallRunner,
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<{ sweep: () => Promise<number> }> {
  await ensureQueue(boss, logger, NIGHTFALL_QUEUE, {
    policy: 'short',
    retryLimit: NIGHTFALL_RETRY_LIMIT,
    retryDelay: NIGHTFALL_RETRY_DELAY_SECONDS,
    retryBackoff: true,
  });
  await boss.work<NightfallJob>(
    NIGHTFALL_QUEUE,
    { localConcurrency: NIGHTFALL_CONCURRENCY },
    async ([job]) => {
      if (!job) return;
      const { mapId, night } = job.data;
      try {
        await runner.run(mapId, night);
      } catch (err) {
        // pg-boss retries; the night's row makes a retry safe.
        logger.error({ err, mapId, night }, 'nightfall failed');
        throw err;
      }
    },
  );

  const sweep = async () => {
    const due = await runner.due();
    for (const { mapId, night } of due) {
      await boss.send(NIGHTFALL_QUEUE, { mapId, night } satisfies NightfallJob, {
        singletonKey: `${mapId}/${night}`,
      });
    }
    return due.length;
  };

  await ensureQueue(boss, logger, SWEEP_QUEUE, { policy: 'short' });
  await boss.work(SWEEP_QUEUE, async () => {
    const queued = await sweep();
    if (queued > 0) logger.info({ queued }, 'night fell on maps');
  });
  if (schedule) await boss.schedule(SWEEP_QUEUE, NIGHTFALL_SWEEP_CRON);
  // A restart may have missed one: sweep once at boot.
  await sweep();
  return { sweep };
}
