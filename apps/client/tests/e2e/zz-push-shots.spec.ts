import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { setPushStub, stubPush } from './push-stub.js';

const OUT = process.env['SHOTS_DIR'] ?? '/tmp/shots';
const VPS = {
  iphone15: { width: 393, height: 852, insets: { top: 59, bottom: 34, left: 0, right: 0 }, label: 'iPhone 15' },
  se: { width: 375, height: 667, insets: { top: 20, bottom: 0, left: 0, right: 0 }, label: 'iPhone SE' },
  seSide: { width: 667, height: 375, insets: { top: 0, bottom: 0, left: 0, right: 0 }, label: 'iPhone SE sideways' },
} as const;
type Vp = keyof typeof VPS;
const manifest: Record<string, unknown>[] = [];

async function frame(page: Page, vp: Vp) {
  const v = VPS[vp];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: v.insets } as never);
  await page.setViewportSize({ width: v.width, height: v.height });
}
async function shot(page: Page, vp: Vp, name: string, note: string) {
  await page.addStyleTag({ content: '.dev-status{display:none !important}' });
  await page.waitForTimeout(700);
  const tier = (await hook<{ tier: string }>(page, 'quality'))?.tier;
  await page.screenshot({ path: `${OUT}/${name}.png` });
  manifest.push({ name, device: VPS[vp].label, vp, tier, note });
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
}
async function makePatch(page: Page) {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Nudge Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('tray-hint-ok').tap();
}
async function settings(page: Page) {
  await page.getByTestId('keeper-menu').tap();
  await page.getByRole('button', { name: 'Settings' }).tap();
  const s = page.getByTestId('lobby').getByTestId('push-settings');
  await expect(s).toBeVisible({ timeout: 20_000 });
  await s.scrollIntoViewIfNeeded();
  return s;
}
async function reopen(page: Page) {
  await page.reload();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
}

for (const vp of ['iphone15', 'se', 'seSide'] as Vp[]) {
  test(`shots ${vp}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await newPlayer(browser, uniqueName(`ns${vp.slice(0, 4)}`));
    await stubPush(page);
    await page.reload();
    await frame(page, vp);
    await makePatch(page);
    const card = page.getByTestId('push-offer');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await shot(page, vp, `offer-${vp}`, 'Offer card on a fresh patch after tray-hint-ok');
    if (vp === 'seSide') return;
    await card.getByRole('button', { name: 'Yes please' }).tap();
    await expect(page.getByTestId('patch-line')).toHaveText('Nudges on! 🔔');
    if (vp === 'iphone15') await shot(page, vp, `line-${vp}`, 'Patch line after Yes please');
    await page.waitForTimeout(5000);
    let s = await settings(page);
    await expect(s).toHaveAttribute('data-state', 'on');
    await shot(page, vp, `settings-on-${vp}`, 'Settings Nudges, on');
    if (vp === 'iphone15') {
      await s.getByRole('button', { name: 'Turn nudges off' }).tap();
      await expect(s).toHaveAttribute('data-state', 'off');
      await shot(page, vp, `settings-off-${vp}`, 'Settings Nudges, off');
      await setPushStub(page, { permission: 'denied' });
      await reopen(page);
      s = await settings(page);
      await expect(s).toHaveAttribute('data-state', 'blocked');
      await shot(page, vp, `settings-blocked-${vp}`, 'Settings Nudges, permission denied');
      await setPushStub(page, { permission: 'default' });
    }
    await setPushStub(page, { standalone: false });
    await reopen(page);
    s = await settings(page);
    await expect(s).toHaveAttribute('data-state', 'install');
    await shot(page, vp, `settings-install-${vp}`, 'Settings Nudges, install (plain tab)');
    await s.getByRole('button', { name: 'Show me how' }).tap();
    await s.scrollIntoViewIfNeeded();
    await shot(page, vp, `settings-steps-${vp}`, 'Settings Nudges, after Show me how');
    await page.context().close();
  });
}

test('settings right after Yes please', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('nsquick'));
  await stubPush(page);
  await page.reload();
  await frame(page, 'iphone15');
  await makePatch(page);
  const card = page.getByTestId('push-offer');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Yes please' }).tap();
  const t0 = Date.now();
  await page.getByTestId('keeper-menu').tap();
  await page.getByRole('button', { name: 'Settings' }).tap();
  const s = page.getByTestId('lobby').getByTestId('push-settings');
  await expect(s).toBeVisible({ timeout: 20_000 });
  await s.scrollIntoViewIfNeeded();
  const ms = Date.now() - t0;
  await page.addStyleTag({ content: '.dev-status{display:none !important}' });
  const tier = (await hook<{ tier: string }>(page, 'quality'))?.tier;
  await page.screenshot({ path: `${OUT}/settings-quick-iphone15.png` });
  manifest.push({ name: 'settings-quick-iphone15', device: 'iPhone 15', vp: 'iphone15', tier, note: `Settings open ${ms} ms after Yes please` });
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
});
