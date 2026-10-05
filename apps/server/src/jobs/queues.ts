import type { FastifyBaseLogger } from 'fastify';
import type { PgBoss, Queue } from 'pg-boss';

/**
 * Creates a pg-boss queue, or leaves an existing one as it is, unless its
 * policy no longer matches. pg-boss keeps the policy a queue was created
 * with: `createQueue` is a no-op on an existing queue and `updateQueue`
 * refuses a new policy. So a policy changed in code would never reach a
 * database that already has the queue (the dev DB, the server) and only
 * CI's fresh one. Such a queue is dropped, with its jobs, and made again.
 * Every queue here is rebuilt from game state at boot (the catch-up wakes
 * every lagging consumer, the sweep re-enqueues every due nightfall), so
 * its pending jobs are safe to drop.
 */
export async function ensureQueue(
  boss: PgBoss,
  logger: FastifyBaseLogger,
  name: string,
  options: Omit<Queue, 'name'> & { policy: Queue['policy'] },
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (existing && existing.policy !== options.policy) {
    logger.warn(
      { queue: name, from: existing.policy, to: options.policy },
      'job queue policy changed: recreating the queue',
    );
    await boss.deleteQueue(name);
  }
  await boss.createQueue(name, options);
}
