import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import type { PushSweepResult } from '../modules/push/sweep.js';
import { PUSH_SWEEP_CRON } from './limits.js';
import { ensureQueue } from './queues.js';

/** The push module's sweep (#726c), for the job. */
export interface PushSweepRunner {
  /** False while `HP_PUSH` is off: the queue stays (so `ensureQueue` is stable), the sweep does nothing. */
  enabled: boolean;
  /** Sends the nudges due now, each at most once (`push_sends`). */
  sweep: () => Promise<PushSweepResult>;
}

export const PUSH_SWEEP_QUEUE = 'push.sweep';

/**
 * The `push.sweep` job (#726 plan, "How sends are triggered"), shaped like
 * `nightfall.sweep`: every minute (`short`, so a slow run never stacks a
 * second behind it) and once at boot, it asks the database whose nudge is
 * due. `push_sends`' unique key makes an overlap (the boot sweep meeting a
 * scheduled one) send nothing twice. A dusk window missed while the server
 * was down sends nothing.
 */
export async function startPushSweep(
  boss: PgBoss,
  runner: PushSweepRunner,
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<{ sweep: () => Promise<PushSweepResult | null> }> {
  const sweep = async () => {
    if (!runner.enabled) return null;
    const result = await runner.sweep();
    if (result.claimed > 0 || result.quiet > 0 || result.capped > 0) {
      logger.info(result, 'push nudges swept');
    }
    return result;
  };

  await ensureQueue(boss, logger, PUSH_SWEEP_QUEUE, { policy: 'short' });
  await boss.work(PUSH_SWEEP_QUEUE, async () => {
    await sweep();
  });
  if (schedule) await boss.schedule(PUSH_SWEEP_QUEUE, PUSH_SWEEP_CRON);
  // A restart may land inside a window: sweep once at boot.
  await sweep();
  return { sweep };
}
