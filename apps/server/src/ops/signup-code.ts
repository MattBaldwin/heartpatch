// Operator family signup codes (#195). Run on the host, never over HTTP:
//   docker compose exec server node dist/ops/signup-code.js create "<label>" [--uses N] [--days N]
//   docker compose exec server node dist/ops/signup-code.js list
//   docker compose exec server node dist/ops/signup-code.js revoke <code-id>
// Locally: pnpm --filter @heartpatch/server ops:signup-code <command> ...
//
// The operator's codes have no cap. A code is printed once and stored hashed;
// `list` shows ids, labels, uses and who made each (patch owners' codes too).
import { parseArgs } from 'node:util';
import { SignupCodeLabelSchema, SignupCodeParamsSchema } from '@heartpatch/shared';
import { pino } from 'pino';
import { loadConfig } from '../config.js';
import { createDbClient } from '../db/client.js';
import { createSignupCodesService } from '../modules/signup-codes/service.js';

const log = pino({ name: 'ops' });
const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE = [
  'usage: signup-code.js create "<label>" [--uses N] [--days N]',
  '       signup-code.js list',
  '       signup-code.js revoke <code-id>',
].join('\n');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { uses: { type: 'string' }, days: { type: 'string' } },
});
const [command, arg] = positionals;

/** A whole number from 1 to `max`, or undefined when the flag is absent. */
function positiveInt(flag: string, raw: string | undefined, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    log.fatal(`--${flag} must be a whole number from 1 to ${String(max)}`);
    process.exit(2);
  }
  return n;
}

if (command !== 'list' && !(command === 'create' || command === 'revoke')) {
  log.fatal(USAGE);
  process.exit(2);
}
if ((command === 'create' || command === 'revoke') && !arg) {
  log.fatal(USAGE);
  process.exit(2);
}
const label = command === 'create' ? SignupCodeLabelSchema.safeParse(arg) : undefined;
if (label && !label.success) {
  log.fatal(label.error.issues[0]?.message ?? 'bad label');
  process.exit(2);
}
if (command === 'revoke' && !SignupCodeParamsSchema.safeParse({ codeId: arg }).success) {
  log.fatal('revoke takes a code id from `list`');
  process.exit(2);
}
const maxUses = positiveInt('uses', values.uses, 1000);
const days = positiveInt('days', values.days, 365);

const config = loadConfig();
const client = createDbClient(config.DATABASE_URL, { max: 1 });
try {
  const service = createSignupCodesService({ db: client.db, bootstrapCode: undefined });
  if (command === 'create' && label?.success) {
    const result = await service.operatorCreate({
      label: label.data,
      ...(maxUses !== undefined ? { maxUses } : {}),
      ...(days !== undefined ? { ttlMs: days * DAY_MS } : {}),
    });
    // The code goes to the operator's terminal only, not to the log stream.
    log.info({ codeId: result.signupCode.id }, 'signup code created');
    const { signupCode } = result;
    process.stdout.write(
      [
        `Family code for "${signupCode.label}": ${result.code}`,
        `Works ${String(signupCode.maxUses)} times, until ${signupCode.expiresAt}.`,
        `Id (to revoke): ${signupCode.id}`,
        'It is shown only now. They type it on the sign-up screen.',
        '',
      ].join('\n'),
    );
  } else if (command === 'list') {
    const codes = await service.operatorList();
    const lines = codes.map((c) =>
      [
        c.id,
        c.status.padEnd(8),
        `${String(c.uses)}/${String(c.maxUses)}`.padEnd(7),
        c.expiresAt,
        c.createdBy ?? '(operator)',
        JSON.stringify(c.label),
        c.usedBy.length > 0 ? `used by ${c.usedBy.join(', ')}` : '',
      ].join('  '),
    );
    process.stdout.write(`${lines.length > 0 ? lines.join('\n') : 'No recent codes.'}\n`);
  } else if (arg) {
    if (await service.operatorRevoke(arg)) {
      log.info({ codeId: arg }, 'signup code revoked');
      process.stdout.write('Turned off. Accounts already made with it stay.\n');
    } else {
      log.error({ codeId: arg }, 'no such code, or already off');
      process.exitCode = 1;
    }
  }
} catch (err) {
  log.fatal({ err }, 'signup-code failed');
  process.exitCode = 1;
} finally {
  await client.close();
}
