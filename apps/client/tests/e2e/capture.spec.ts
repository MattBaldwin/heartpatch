import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * Wild squishies and the catalog on an iPhone (issue #14): find a wild
 * squishy with the real button, offer a Heart Charm from the bag (#17), and
 * see it in the catalog. Checked through the dev hook's signals and the API,
 * never pixels. Whether one try befriends it is up to the battle's dice (the
 * server tests pin both outcomes), so this checks whichever happened.
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
const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');
const catalogState = (page: Page) => hook<CatalogDebug>(page, 'catalog');

/** Heart Charms in the player's bag on this patch (#17's inventory). */
async function charmsLeft(page: Page, mapId: string): Promise<number> {
  const { body } = await api<{ items: Record<string, number> }>(
    page,
    'GET',
    `/maps/${mapId}/inventory`,
  );
  return body.items['heart-charm'] ?? 0;
}

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
  await visitPatch(lobby);
  await expect(page.getByTestId('map-hud')).toContainText('Finder Patch');

  const mapIdOf = async () => (await hook<{ id: string }>(page, 'map'))?.id ?? '';
  await expect.poll(mapIdOf).not.toBe('');
  const mapId = await mapIdOf();

  // A hint, never a species: how many wild squishies are about.
  const note = page.locator('.battle-entry-note');
  await expect(note).toContainText(/nearby/);

  // The catalog starts with just their starter: no secret squishy shows before it's met.
  await page.getByTestId('catalog-open').tap();
  await expect.poll(() => catalogState(page)).toMatchObject({ loading: false, seen: 1, caught: 1 });
  const known = (names: string[]) => names.filter((n) => n !== '???');
  expect(known((await catalogState(page))!.names)).toEqual(['Puddlepuff']);
  await expect(page.getByTestId('catalog-progress')).toContainText('Friends 1');
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

  // "Use Heart Charm" is there for a wild squishy. With an empty bag the
  // server says so kindly (#17's line) and nothing changes.
  const charm = page.getByTestId('battle-capture');
  await expect(charm).toBeVisible();
  await charm.tap();
  await expect(hud.locator('.battle-problem')).toContainText('Heart Charm');
  expect(await settled(page)).toMatchObject({ id: start.id, status: 'active', turn: 0 });

  // Three charms in the bag (dev), then one try: the charm lands on the wild
  // squishy and is spent, whatever it decides.
  expect(
    (await api(page, 'POST', `/maps/${mapId}/dev/items`, { items: { 'heart-charm': 3 } })).status,
  ).toBe(201);
  await charm.tap();
  const tried = await settled(page);
  expect(tried.turn).toBe(1);
  await expect.poll(() => charmsLeft(page, mapId)).toBe(2);
  const caught = tried.reason === 'captured';

  if (caught) {
    // A new friend: the result card says so and the catalog marks it.
    await expect(page.getByTestId('battle-result')).toContainText('A new friend!');
    await page.getByTestId('battle-done').tap();
  } else if (tried.status === 'active') {
    await hud.getByRole('button', { name: 'Back to patch' }).tap();
  } else {
    // A miss costs the turn, and the wild squishy can tucker out our fresh
    // level-1 friend before the next one.
    expect(tried.reason).toBe('tuckered-out');
    await page.getByTestId('battle-done').tap();
  }
  await expect(hud).toBeHidden();

  // Back on the patch: the squishy it met is in the catalog now. (A wild
  // Puddlepuff is already there, as the starter.)
  await page.getByTestId('catalog-open').tap();
  await expect.poll(() => catalogState(page).then((c) => c?.loading)).toBe(false);
  const after = (await catalogState(page))!;
  // Whoever spawned (the roster's, or a secret one) now has a name; the rest stay "???".
  const met = known(after.names).filter((n) => n !== 'Puddlepuff');
  expect(after.seen).toBe(1 + met.length);
  expect(met.length).toBeLessThanOrEqual(1);
  if (met.length === 1) {
    expect(after.caught).toBe(caught ? 2 : 1);
    await expect(page.getByTestId('catalog-grid')).toContainText(met[0]!);
    if (!caught) await expect(page.getByTestId('catalog-grid')).toContainText('Seen');
  }
  await page.getByTestId('catalog-close').tap();
  if (tried.status === 'active') {
    // The battle waited behind the catalog; the button resumes it.
    await page.getByTestId('battle-entry').tap();
    await expect(hud).toBeVisible();
    expect((await settled(page)).id).toBe(start.id);
  }

  expect(errors).toEqual([]);
});
