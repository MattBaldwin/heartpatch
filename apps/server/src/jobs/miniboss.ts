import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss } from 'pg-boss';
import { MINIBOSS_SWEEP_CRON } from './limits.js';
import { ensureQueue } from './queues.js';

export interface MinibossSweepRunner {
  /** Opens every patch's mini-boss visit that's due; returns how many opened. */
  sweep: () => Promise<number>;
}

export const MINIBOSS_SWEEP_QUEUE = 'miniboss.sweep';

/**
 * The mini-boss sweep (#190 plan §5): every few minutes it opens the visits
 * that are due, so `boss.appeared` lands near its time even when nobody is
 * looking. A visit is a timestamp window pinned once in `boss_windows` (the
 * insert is the idempotency), so a retry, a duplicate or a restart opens
 * nothing twice, and a read of the visit opens one the sweep hasn't reached.
 */
export async function startMinibossSweep(
  boss: PgBoss,
  runner: MinibossSweepRunner,
  logger: FastifyBaseLogger,
  schedule: boolean,
): Promise<{ sweep: () => Promise<number> }> {
  const sweep = async () => {
    const opened = await runner.sweep();
    if (opened > 0) logger.info({ opened }, 'mini-boss visits opened');
    return opened;
  };
  await ensureQueue(boss, logger, MINIBOSS_SWEEP_QUEUE, { policy: 'short' });
  await boss.work(MINIBOSS_SWEEP_QUEUE, async () => {
    await sweep();
  });
  if (schedule) await boss.schedule(MINIBOSS_SWEEP_QUEUE, MINIBOSS_SWEEP_CRON);
  // A restart may land after a visit's start: sweep once at boot.
  await sweep();
  return { sweep };
}
