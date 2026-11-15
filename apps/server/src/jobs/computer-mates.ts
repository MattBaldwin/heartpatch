import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import {
  COMPUTER_MATES_CONCURRENCY,
  COMPUTER_MATES_RETRY_DELAY_SECONDS,
  COMPUTER_MATES_RETRY_LIMIT,
  COMPUTER_MATES_SWEEP_CRON,
  COMPUTER_MATES_SWEEP_LIMIT,
} from './limits.js';
import { ensureQueue } from './queues.js';

/** Finds computer patch-mates due a step, and runs one (`modules/computer-mates/intents.ts`). */
export interface ComputerMatesRunner {
  /** Mates due a step on patches a real member opened in the last `warmMinutes`. */
  due: (limit?: number) => Promise<{ userId: string; step: number }[]>;
  /** One step; a step number already taken, or a departed mate, does nothing. */
  act: (userId: string, step: number) => Promise<unknown>;
}

interface MateStepJob {
  userId: string;
  step: number;
}

export const COMPUTER_MATE_ACT_QUEUE = 'computer-mate.act';
const SWEEP_QUEUE = 'computer-mates.sweep';

/**
 * Computer patch-mates act (#386c, plan §5), the `nightfall` shape: a sweep
 * every 2 minutes selects mates whose `next_act_at` has passed on warm
 * patches and enqueues one `computer-mate.act` per mate and step, keyed
 * `userId/step` (`short`: one queued per key). The mate's row is the real
 * guard: `act` locks it and does nothing unless the step number matches, so
 * a retry, a duplicate or a restart can't act twice. Timestamps, not a
 * ticking loop: a patch nobody opens is never selected and costs nothing.
 */
export async function startComputerMates(
  boss: PgBoss,
  runner: ComputerMatesRunner,
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<{ sweep: () => Promise<number> }> {
  await ensureQueue(boss, logger, COMPUTER_MATE_ACT_QUEUE, {
    policy: 'short',
    retryLimit: COMPUTER_MATES_RETRY_LIMIT,
    retryDelay: COMPUTER_MATES_RETRY_DELAY_SECONDS,
    retryBackoff: true,
  });
  await boss.work<MateStepJob>(
    COMPUTER_MATE_ACT_QUEUE,
    { localConcurrency: COMPUTER_MATES_CONCURRENCY },
    async ([job]) => {
      if (!job) return;
      const { userId, step } = job.data;
      try {
        await runner.act(userId, step);
      } catch (err) {
        logger.error({ err, userId, step }, 'computer mate step failed');
        throw err;
      }
    },
  );

  const sweep = async () => {
    const due = await runner.due(COMPUTER_MATES_SWEEP_LIMIT);
    for (const { userId, step } of due) {
      await boss.send(COMPUTER_MATE_ACT_QUEUE, { userId, step } satisfies MateStepJob, {
        singletonKey: `${userId}/${step}`,
      });
    }
    return due.length;
  };

  await ensureQueue(boss, logger, SWEEP_QUEUE, { policy: 'short' });
  await boss.work(SWEEP_QUEUE, async () => {
    await sweep();
  });
  if (schedule) await boss.schedule(SWEEP_QUEUE, COMPUTER_MATES_SWEEP_CRON);
  return { sweep };
}
