// Operator password reset (tech spec §9), for players with no map owner to
// help. Run on the host, never over HTTP:
//   docker compose exec server node dist/ops/reset-password.js <username>
// Locally: pnpm --filter @heartpatch/server ops:reset-password <username>
//
// Sets a temporary password, logs the player out everywhere and prints a new
// recovery code. The player can then pick their own password with
// "Forgot your password?" and the new recovery code.
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from '../db/client.js';
import { createAuthRepo } from '../modules/auth/repo.js';
import { createAuthService } from '../modules/auth/service.js';

const log = pino({ name: 'ops' });
const username = process.argv[2];

if (!username) {
  log.fatal('usage: reset-password.js <username>');
  process.exit(2);
}

const config = loadConfig();
const client = createDbClient(config.DATABASE_URL, { max: 1 });
try {
  const service = createAuthService({
    repo: createAuthRepo(client.db),
    signupCode: config.HP_SIGNUP_CODE,
  });
  const result = await service.operatorReset(username);
  if (!result) {
    log.error({ username }, 'no such user');
    process.exitCode = 1;
  } else {
    // Secrets go to the operator's terminal only, not to the log stream.
    log.info({ userId: result.user.id }, 'password reset; all sessions revoked');
    process.stdout.write(
      [
        `Reset ${result.user.username}.`,
        `Temporary password: ${result.temporaryPassword}`,
        `New recovery code:  ${result.recoveryCode}`,
        'They can choose their own password with "Forgot your password?" and the recovery code.',
        '',
      ].join('\n'),
    );
  }
} catch (err) {
  log.fatal({ err }, 'reset failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
