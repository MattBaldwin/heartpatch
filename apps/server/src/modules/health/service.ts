import type { HealthResponse, ReadyResponse } from '@heartpatch/shared';

/** A dependency the server needs before it can serve traffic (e.g. the database). */
export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

export interface HealthService {
  health: () => HealthResponse;
  ready: () => Promise<ReadyResponse>;
}

export function createHealthService(options: {
  version: string;
  /** The build number and short sha (#198); null when not built from git. */
  build: number | null;
  commit: string | null;
  checks: readonly ReadinessCheck[];
  now?: () => number;
}): HealthService {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();

  return {
    health: () => ({
      status: 'ok',
      version: options.version,
      build: options.build,
      commit: options.commit,
      uptimeSeconds: Math.floor((now() - startedAt) / 1000),
    }),

    ready: async () => {
      const results = await Promise.allSettled(options.checks.map((c) => c.check()));
      const checks: ReadyResponse['checks'] = {};
      options.checks.forEach((c, i) => {
        checks[c.name] = results[i]?.status === 'fulfilled' ? 'ok' : 'failed';
      });
      const allOk = Object.values(checks).every((status) => status === 'ok');
      return { status: allOk ? 'ready' : 'not_ready', checks };
    },
  };
}
