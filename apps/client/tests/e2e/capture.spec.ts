import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

/**
 * Wild squishies and the catalog on an iPhone (issue #14): find a wild
 * squishy with the real button, offer a Heart Charm, and see it in the
 * catalog. Checked through the dev hook's signals, never pixels.
 */

interface BattleDebug {
  id: string;
  status: 'active' | 'finished' | 'no-contest';
  turn: number;
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  reason: string | null;
}
interface CatalogDebug {
  loading: boolean;
  seen: number;
  caught: number;
  total: number;
  names: string[];
}
type Hook = {
  __heartpatch?: { battle?(): BattleDebug | null; catalog?(): CatalogDebug | null };
};

const battleState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.battle?.() ?? null);
const catalogState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.catalog?.() ?? null);

async function settled(page: Page): Promise<BattleDebug> {
  await expect
    .poll(() => battleState(page), { timeout: 30_000 })
    .toMatchObject({ pending: 0, waiting: false });
  return (await battleState(page))!;
}

test('finds a wild squishy, offers a Heart Charm, and fills in the catalog', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPlayer(browser, uniqueName('find'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Finder Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(page.getByTestId('map-hud')).toContainText('Finder Patch');

  // A hint, never a species: how many wild squishies are about.
  const note = page.locator('.battle-entry-note');
  await expect(note).toContainText(/nearby/);

  // The catalog starts empty: no secret squishy shows before it's met.
  await page.getByTestId('catalog-open').tap();
  await expect.poll(() => catalogState(page)).toMatchObject({ loading: false, seen: 0 });
  const names = (await catalogState(page))!.names;
  expect(names.every((n) => n === '???')).toBe(true);
  await expect(page.getByTestId('catalog-progress')).toContainText('Go find some');
  await page.getByTestId('catalog-close').tap();
  await expect(page.getByTestId('catalog')).toBeHidden();

  // A squishy of our own (dev), then the real button finds a wild one.
  await page.getByTestId('battle-dev-grant').tap();
  await expect(note).toContainText('joined you');
  await page.getByTestId('battle-entry').tap();
  const hud = page.getByTestId('battle-hud');
  await expect(hud).toBeVisible();
  const start = await settled(page);
  expect(start).toMatchObject({ status: 'active', turn: 0 });

  // "Use Heart Charm" is there for a wild squishy. Heart Charms come from the
  // inventory (#17); until then the server says so kindly and nothing changes.
  const charm = page.getByTestId('battle-capture');
  await expect(charm).toBeVisible();
  await charm.tap();
  await expect(hud.locator('.battle-problem')).toContainText('Heart Charm');
  expect(await settled(page)).toMatchObject({ id: start.id, status: 'active', turn: 0 });

  // Back to the patch: the squishy it met is in the catalog now.
  await hud.getByRole('button', { name: 'Back to patch' }).tap();
  await expect(hud).toBeHidden();
  await page.getByTestId('catalog-open').tap();
  await expect.poll(() => catalogState(page)).toMatchObject({ loading: false, seen: 1, caught: 0 });
  await expect(page.getByTestId('catalog-grid')).toContainText('Moonpuff');
  await expect(page.getByTestId('catalog-grid')).toContainText('Seen');
  // A battle can't open over the catalog: the resumed one waits for the button.
  await page.getByTestId('catalog-close').tap();
  await page.getByTestId('battle-entry').tap();
  await expect(hud).toBeVisible();
  expect((await settled(page)).id).toBe(start.id);

  expect(errors).toEqual([]);
});
