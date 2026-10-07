// Grant or take away the admin console role (#196). Run on the host, never
// over HTTP (owner decision 2026-10-07):
//   docker compose exec server node dist/ops/grant-admin.js <username>
//   docker compose exec server node dist/ops/grant-admin.js <username> --revoke
// Locally: pnpm --filter @heartpatch/server ops:grant-admin <username> [--revoke]
//
// A new admin then sets up their authenticator app with ops/enrol-totp.js;
// they can't sign in to /admin until they have. Each grant is in the audit log.
import { parseArgs } from 'node:util';
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from '../db/client.js';
import { grantAdmin, revokeAdmin } from '../modules/admin/grants.js';

const log = pino({ name: 'ops' });
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { revoke: { type: 'boolean' } },
});
const [username] = positionals;

if (!username || positionals.length > 1) {
  log.fatal('usage: grant-admin.js <username> [--revoke]');
  process.exit(2);
}

const config = loadConfig();
const client = createDbClient(config.DATABASE_URL, { max: 1 });
try {
  const revoke = values.revoke === true;
  const result = await (revoke ? revokeAdmin : grantAdmin)(client.db, username);
  if (result === 'no_such_user') {
    log.error({ username }, 'no such user');
    process.exitCode = 1;
  } else if (result === 'unchanged') {
    process.stdout.write(`${username} ${revoke ? 'is not an admin' : 'is already an admin'}.\n`);
  } else {
    log.info({ username }, revoke ? 'admin revoked' : 'admin granted');
    process.stdout.write(
      revoke
        ? `${username} is no longer an admin. Their admin sessions and authenticator are gone.\n`
        : `${username} is now an admin. Next: node dist/ops/enrol-totp.js ${username}\n`,
    );
  }
} catch (err) {
  log.fatal({ err }, 'grant-admin failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
