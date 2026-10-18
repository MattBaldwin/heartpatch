import { expect, test, type Page } from '@playwright/test';
import { draws, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTapAt } from './touch.js';

/* PROTOTYPE (#306 plan v2): the restore sheet alone (costs from the plan's table A). */

const OUT = process.env['HP_SHOTS_DIR'] ?? '/tmp/shots';
const slow = { timeout: 120_000 };
type Cluster = { id: string; centre: { q: number; r: number }; tiles: { q: number; r: number }[] };
const mapState = (page: Page) => hook<{ id: string; tiles: number }>(page, 'map');
const call = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => {
      const h = (window as unknown as { __heartpatch?: { hollowed?: () => Record<string, (...x: unknown[]) => unknown> } }).__heartpatch?.hollowed?.();
      return (h?.[f as string]?.(...(a as unknown[])) ?? null) as T;
    },
    [fn, args] as const,
  );

test('restore sheet capture', async ({ browser }) => {
  const page = await newPlayer(browser, uniqueName('restore'));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Juniper Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden(slow);
  await expect.poll(async () => (await mapState(page))?.tiles, slow).toBe(817);
  await page.goto('/?hollowed=grey&fps=0&tier=high');
  await expect.poll(async () => (await mapState(page))?.tiles ?? 0, slow).toBe(817);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true', slow);
  await page.waitForTimeout(1500);
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  if (await gotIt.isVisible()) await gotIt.tap();
  const near = ((await call<Cluster[]>(page, 'clusters')) ?? []).find((c) => c.id === 'near')!;
  const before = await draws(page);
  await call(page, 'look', 'near', 5);
  await expect.poll(() => draws(page), slow).toBeGreaterThan(before);
  await page.waitForTimeout(1500);
  const panel = page.getByTestId('tile-panel');
  for (let attempt = 0; attempt < 4 && !(await panel.isVisible()); attempt++) {
    const at = await page.evaluate((list) => {
      const h = (window as unknown as { __heartpatch?: { hollowed?: () => { tileAt(q: number, r: number): { x: number; y: number; width: number; height: number } | null } } }).__heartpatch?.hollowed?.();
      for (const t of list) {
        const rect = h?.tileAt(t.q, t.r);
        if (!rect) continue;
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y };
      }
      return null;
    }, [near.centre, ...near.tiles]);
    expect(at).not.toBeNull();
    await realTapAt(page, at!.x, at!.y);
    await page.waitForTimeout(700);
  }
  await expect(panel).toBeVisible(slow);
  await page.getByTestId('hollowed-restore-open').tap();
  await expect(page.getByTestId('hollowed-sheet')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${test.info().project.name}/restore-sheet.png` });
  console.log(`SHOT ${test.info().project.name} restore-sheet`);
});
