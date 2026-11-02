import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { PushSweepResult } from '../modules/push/sweep.js';
import { logPushSweep } from './push.js';

/** A logger that remembers which level each line went to. */
function recordingLogger() {
  const lines: { level: 'info' | 'debug'; obj: unknown; msg: string }[] = [];
  const logger = {
    info: (obj: unknown, msg: string) => lines.push({ level: 'info', obj, msg }),
    debug: (obj: unknown, msg: string) => lines.push({ level: 'debug', obj, msg }),
  } as unknown as FastifyBaseLogger;
  return { logger, lines };
}

const swept = (counts: Partial<PushSweepResult>): PushSweepResult => ({
  due: 0,
  claimed: 0,
  delivered: 0,
  quiet: 0,
  capped: 0,
  ...counts,
});

describe('logPushSweep', () => {
  it('logs at info only when the sweep claimed something', () => {
    const { logger, lines } = recordingLogger();
    const result = swept({ due: 2, claimed: 1, delivered: 1, quiet: 1 });
    logPushSweep(logger, result);
    expect(lines).toEqual([{ level: 'info', obj: result, msg: 'push nudges swept' }]);
  });

  it('a nudge dropped every minute (quiet hours, the cap) goes to debug', () => {
    const { logger, lines } = recordingLogger();
    logPushSweep(logger, swept({ due: 1, quiet: 1 }));
    logPushSweep(logger, swept({ due: 1, capped: 1 }));
    expect(lines.map((l) => l.level)).toEqual(['debug', 'debug']);
  });

  it('says nothing when nothing was due', () => {
    const { logger, lines } = recordingLogger();
    logPushSweep(logger, swept({}));
    expect(lines).toEqual([]);
  });
});
