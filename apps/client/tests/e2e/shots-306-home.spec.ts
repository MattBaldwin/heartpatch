import { expect, test, type Page } from '@playwright/test';
import { draws, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/* PROTOTYPE (#306 plan v3): naming your home, locked and unlocked, three captures. Run with shots-306.config.ts. */

const OUT = process.env['HP_SHOTS_DIR'] ?? '/tmp/shots';
const slow = { timeout: 120_000 };
const mapState = (page: Page) => hook<{ id: string; tiles: number }>(page, 'map');
const call = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => {
      const h = (window as unknown as { __heartpatch?: { hollowed?: () => Record<string, (...x: unknown[]) => unknown> } }).__heartpatch?.hollowed?.();
      return h?.[f as string]?.(...(a as unknown[])) ?? null;
    },
    [fn, args] as const,
  );

async function shot(page: Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `${OUT}/${project}/${name}.png` });
  console.log(`SHOT ${project} ${name}`);
}

test('home naming captures', async ({ browser }) => {
  const page = await newPlayer(browser, uniqueName('homename'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Juniper Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden(slow);
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817);
  const open = async (show: string) => {
    await page.goto(`/?hollowed=grey&show=${show}&fps=0&tier=high`);
    await expect.poll(async () => (await mapState(page))?.tiles ?? 0, slow).toBe(817);
    await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', slow);
    // The hint can sit under the opening card on a short phone: a quick, forced tap, or skip it.
    const gotIt = page.getByRole('button', { name: 'Got it!' });
    if (await gotIt.isVisible()) await gotIt.tap({ timeout: 5_000, force: true }).catch(() => {});
    await expect(page.getByTestId('hollowed-sheet')).toBeVisible(slow);
    await page.waitForTimeout(2000);
  };
  // Owner decision 2026-10-19: naming is gated by progression. The locked card first.
  await open('homename-locked');
  await shot(page, 'home-name-locked');
  await page.getByTestId('hollowed-keep-going').tap();
  await open('homename');
  await shot(page, 'home-name-card');
  await page.getByTestId('hollowed-name-it').tap();
  const before = await draws(page);
  await call(page, 'look', 'home', 7);
  await expect.poll(() => draws(page), slow).toBeGreaterThan(before);
  await page.waitForTimeout(1500);
  await shot(page, 'home-flag');
});
