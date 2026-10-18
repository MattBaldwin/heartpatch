import type { PerfReport, PublicUser } from '@heartpatch/shared';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The on-device perf report (#501 PR A): a client whose drawn frames stayed
 * under 10 fps for 5 s sends one row, which goes to the log and nowhere
 * else. The row is numbers and badge counts; the only player data is the
 * session's user id, so rows from one device line up. Read them with
 * `docker compose logs server | grep perf-report` (README).
 */
export interface PerfService {
  record(user: PublicUser, report: PerfReport, log: FastifyBaseLogger): void;
}

export function createPerfService(): PerfService {
  return {
    record(user, report, log) {
      log.info({ userId: user.id, perfReport: report }, 'perf-report');
    },
  };
}
