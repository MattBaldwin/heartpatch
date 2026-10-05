import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss, Queue } from 'pg-boss';

/**
 * Creates a pg-boss queue with these settings, or brings an existing one up
 * to date with them. pg-boss's `createQueue` is a no-op on an existing
 * queue, so settings changed in code would otherwise never reach a database
 * that already has the queue (the dev DB, the server), only CI's fresh one.
 * The retry and notify settings are applied with `updateQueue`; the policy
 * can't be (pg-boss keeps the one a queue was created with), so a queue
 * whose policy differs is dropped, with its jobs, and made again. Every
 * queue here is rebuilt from game state at boot (the catch-up wakes every
 * lagging consumer, the sweep re-enqueues every due nightfall), so its
 * pending jobs are safe to drop.
 */
export async function ensureQueue(
  boss: PgBoss,
  logger: FastifyBaseLogger,
  name: string,
  // No `partition`: `updateQueue` refuses it, which would fail a boot, not the build.
  options: Omit<Queue, 'name' | 'partition'> & { policy: NonNullable<Queue['policy']> },
): Promise<void> {
  const { policy, ...settings } = options;
  const existing = await boss.getQueue(name);
  if (existing && existing.policy !== policy) {
    logger.warn(
      { queue: name, from: existing.policy, to: policy },
      'job queue policy changed: recreating the queue',
    );
    await boss.deleteQueue(name);
  } else if (existing && Object.keys(settings).length > 0) {
    await boss.updateQueue(name, settings);
    return;
  }
  await boss.createQueue(name, options);
}
