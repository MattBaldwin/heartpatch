// Set up an admin's authenticator app (#196). Run on the host, never over
// HTTP (owner decision 2026-10-07). Two steps:
//   docker compose exec server node dist/ops/enrol-totp.js <username>
//     prints a secret and an otpauth:// link to add to the authenticator app
//   docker compose exec server node dist/ops/enrol-totp.js <username> --confirm <6 digits>
//     checks a code the app shows; admin sign-in works from then on
// Locally: pnpm --filter @heartpatch/server ops:enrol-totp <username> [--confirm 123456]
//
// Running the first step again replaces the authenticator (a lost phone) and
// ends that admin's sessions. The account must be an admin (ops/grant-admin.js).
import { parseArgs } from 'node:util';
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from '../db/client.js';
import { confirmTotp, startTotp } from '../modules/admin/grants.js';
import { otpauthUri } from '../modules/admin/totp.js';

const log = pino({ name: 'ops' });
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { confirm: { type: 'string' } },
});
const [username] = positionals;

if (!username || positionals.length > 1) {
  log.fatal('usage: enrol-totp.js <username> [--confirm <6-digit code>]');
  process.exit(2);
}

const config = loadConfig();
// Real time, never HP_DEV_NOW: the authenticator app follows the real clock.
const clock = () => new Date();
const client = createDbClient(config.DATABASE_URL, { max: 1 });
try {
  if (values.confirm === undefined) {
    const started = await startTotp(client.db, username, clock);
    if (!started) {
      log.error({ username }, 'not an admin (run grant-admin.js first)');
      process.exitCode = 1;
    } else {
      // The secret goes to the operator's terminal only, not to the log stream.
      log.info({ username }, 'authenticator setup started');
      process.stdout.write(
        [
          `Add this to the authenticator app for ${started.username}:`,
          `  Secret (type it in): ${started.secret}`,
          `  Or open this link:   ${otpauthUri(started.username, started.secret)}`,
          'Then confirm with a code the app shows:',
          `  node dist/ops/enrol-totp.js ${started.username} --confirm <6 digits>`,
          '',
        ].join('\n'),
      );
    }
  } else {
    const result = await confirmTotp(client.db, username, values.confirm, clock);
    if (result === 'enrolled') {
      log.info({ username }, 'authenticator enrolled');
      process.stdout.write(`Done. ${username} can sign in at /admin with the app's codes.\n`);
    } else {
      log.error(
        { username },
        result === 'wrong_code'
          ? "that code doesn't match; check the phone's clock and try a fresh code"
          : 'no setup waiting (run enrol-totp.js without --confirm first)',
      );
      process.exitCode = 1;
    }
  }
} catch (err) {
  log.fatal({ err }, 'enrol-totp failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
