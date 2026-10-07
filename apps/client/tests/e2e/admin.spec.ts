import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD, uniqueName } from './players.js';

// The operator admin console (#196): an admin made with the host scripts signs
// in with an authenticator code, finds a player, resets their password, and
// sees it in the audit log.

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const HEADERS = { 'x-requested-with': 'heartpatch' };

/** Runs a server host script the way the operator would (locally, through tsx). */
function hostScript(script: 'grant-admin' | 'enrol-totp', ...args: string[]): string {
  return execFileSync(
    'pnpm',
    ['--silent', '--filter', '@heartpatch/server', `ops:${script}`, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

/** RFC 6238 (SHA-1, 30 s, 6 digits): what the admin's authenticator app shows. */
function totp(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30_000);

async function signUpByApi(request: APIRequestContext, username: string): Promise<void> {
  const res = await request.post('/api/v1/auth/signup', {
    headers: HEADERS,
    data: {
      signupCode: process.env['HP_SIGNUP_CODE'] ?? '',
      username,
      password: TEST_PASSWORD,
      birthYear: 1985,
      timeZone: 'America/Chicago',
    },
  });
  expect(res.status()).toBe(201);
}

test('an admin signs in with an authenticator code and resets a player', async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  const grownUp = uniqueName('boss');
  const kid = uniqueName('kid');
  const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  await signUpByApi(api, grownUp);
  await signUpByApi(api, kid);

  // The host scripts: grant the role, then set up and confirm the authenticator.
  expect(hostScript('grant-admin', grownUp)).toContain('is now an admin');
  const secret = /Secret \(type it in\): ([A-Z2-7]+)/.exec(hostScript('enrol-totp', grownUp))?.[1];
  expect(secret).toBeTruthy();
  const confirmStep = stepNow();
  expect(hostScript('enrol-totp', grownUp, '--confirm', totp(secret!, confirmStep))).toContain(
    'Done.',
  );

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Heartpatch' })).toBeVisible();
  // A wrong code is turned away.
  await page.getByLabel('Username').fill(grownUp);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByLabel('6-digit code from your authenticator app').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText("That didn't work");
  // The next code (the confirming one is spent) lets them in.
  await page
    .getByLabel('6-digit code from your authenticator app')
    .fill(totp(secret!, Math.max(confirmStep + 1, stepNow())));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Patches', level: 1 })).toBeVisible();
  await expect(page.locator('#adm-timer')).toHaveText(/^\d+:\d\d$/);

  // Find the player and reset their password.
  await page.getByRole('button', { name: 'Players' }).click();
  await page.getByRole('searchbox', { name: 'Search players' }).fill(kid);
  await expect(page.locator('.adm-panel h2')).toHaveText(kid);
  await page.getByRole('button', { name: 'Reset password' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('log them out');
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog).toContainText(`Give these to ${kid}`);
  const secrets = await dialog.locator('[data-secret]').allTextContents();
  expect(secrets).toHaveLength(2);
  await page.screenshot({ path: test.info().outputPath('admin-reset.png') });
  await dialog.getByRole('button', { name: "I've passed them on" }).click();
  await expect(dialog).toBeHidden();

  // The temporary password works.
  const login = await api.post('/api/v1/auth/login', {
    headers: HEADERS,
    data: { username: kid, password: secrets[0] },
  });
  expect(login.status()).toBe(200);

  // And it's on record.
  await page.getByRole('button', { name: 'Audit log' }).click();
  await page.getByRole('searchbox', { name: 'Filter audit log' }).fill(kid);
  await expect(page.locator('tbody tr').first()).toContainText('Reset password');
  await page.screenshot({ path: test.info().outputPath('admin-audit.png') });

  // Signing out ends the session: the console asks to sign in again.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await api.dispose();
});
