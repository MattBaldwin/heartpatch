import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import {
  WEATHER_CONCURRENCY,
  WEATHER_RETENTION_CRON,
  WEATHER_RETRY_DELAY_SECONDS,
  WEATHER_RETRY_LIMIT,
  WEATHER_SWEEP_CRON,
} from './limits.js';
import { ensureQueue } from './queues.js';

/** Rolls Wild Isle storms and tidies old plans (the weather module, #621). */
export interface WeatherRunner {
  /** Every Wild Isle map's id. */
  maps: () => Promise<string[]>;
  /** Rolls every player's storms on the map up to now; safe to repeat. */
  sweep: (mapId: string) => Promise<number>;
  /** Deletes plans past retention. */
  retain: () => Promise<number>;
}

interface WeatherJob {
  mapId: string;
}

export const WEATHER_QUEUE = 'weather.sweep';
const SCAN_QUEUE = 'weather.scan';
const RETENTION_QUEUE = 'weather.retention';

/**
 * The weather jobs (#621, plan §4): every hour a scan enqueues one
 * `weather.sweep` per Wild Isle map (`singletonKey: mapId`, `short`: one
 * queued per map), which rolls each player's storms in their own
 * transaction, so patch-mates see knocks and a kid who's away gets the
 * right morning card. The rolls are seeded and `weather_checked_through`
 * only moves forward, so a retry, a duplicate or the settle racing it
 * knocks nothing twice. Once a day, plans past retention are deleted.
 */
export async function startWeather(
  boss: PgBoss,
  runner: WeatherRunner,
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<{ scan: () => Promise<number> }> {
  await ensureQueue(boss, logger, WEATHER_QUEUE, {
    policy: 'short',
    retryLimit: WEATHER_RETRY_LIMIT,
    retryDelay: WEATHER_RETRY_DELAY_SECONDS,
    retryBackoff: true,
  });
  await boss.work<WeatherJob>(
    WEATHER_QUEUE,
    { localConcurrency: WEATHER_CONCURRENCY },
    async ([job]) => {
      if (!job) return;
      const { mapId } = job.data;
      try {
        const knocked = await runner.sweep(mapId);
        if (knocked > 0) logger.info({ mapId, knocked }, 'storms knocked buildings about');
      } catch (err) {
        // pg-boss retries; the seeded rolls make a retry safe.
        logger.error({ err, mapId }, 'weather sweep failed');
        throw err;
      }
    },
  );

  const scan = async () => {
    const maps = await runner.maps();
    for (const mapId of maps) {
      await boss.send(WEATHER_QUEUE, { mapId } satisfies WeatherJob, { singletonKey: mapId });
    }
    return maps.length;
  };

  await ensureQueue(boss, logger, SCAN_QUEUE, { policy: 'short' });
  await boss.work(SCAN_QUEUE, async () => {
    await scan();
  });
  await ensureQueue(boss, logger, RETENTION_QUEUE, { policy: 'short' });
  await boss.work(RETENTION_QUEUE, async () => {
    const deleted = await runner.retain();
    if (deleted > 0) logger.info({ deleted }, 'old weather plans deleted');
  });
  if (schedule) {
    await boss.schedule(SCAN_QUEUE, WEATHER_SWEEP_CRON);
    await boss.schedule(RETENTION_QUEUE, WEATHER_RETENTION_CRON);
  }
  return { scan };
}
