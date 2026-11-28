import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
import { hexKey, hexNeighbors, isWaterTerrain } from '@heartpatch/shared';
import { selectTile } from './claim-land.js';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * A Clockwork Isle's map (#874 C4): the 💨 chip shows and hides the wind;
 * a tile of mine offers a Wire and a Rail in the Build sheet; laying them
 * draws them (the wire dark, with no Windmill to power it); and the tile
 * panel takes the wire up again. The server decides costs, reach and power
 * (CLAUDE.md rule 1). The patch is made through the lobby.
 */

interface ViewTile {
  q: number;
  r: number;
  terrain: string;
  ownerUserId: string | null;
  homeSlot: number | null;
  buildings: unknown[];
}
interface LinesView {
  lines: { q: number; r: number; kind: 'wire' | 'rail'; level: number; powered?: boolean }[];
}
interface LinesDebug {
  lines: number;
  loaded: boolean;
  drawn: { wires: number; litWires: number; rails: number } | null;
}
interface WindDebug {
  shown: boolean;
  tiles: number[];
}

const linesDebug = (page: Page) => hook<LinesDebug>(page, 'lines');
const windDebug = (page: Page) => hook<WindDebug>(page, 'wind');

test('lays a wire and a rail on a Clockwork Isle from the Build sheet, and shows the wind (#874)', async ({
  browser,
}) => {
  // One signup through the Keeper picker; CI renders in software.
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('wire'));
  const lobby = page.getByTestId('lobby');

  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByTestId('lobby-patch-type-clockwork-isle').tap();
  await lobby.getByLabel('Patch name').fill('Wire Cove');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await expect(lobby.getByTestId('lobby-clockwork-chip')).toHaveText('⚙️ Clockwork Isle');
  const maps = await api<{ maps: { id: string; name: string }[] }>(page, 'GET', '/maps');
  const mapId = maps.body.maps.find((m) => m.name === 'Wire Cove')!.id;
  expect(
    (
      await api(page, 'POST', `/maps/${mapId}/dev/items`, {
        items: { parts: 20, timber: 20, stone: 20 },
      })
    ).status,
  ).toBe(201);
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await waitForLiveMap(page, mapId);
  await expect.poll(() => linesDebug(page)).toMatchObject({ loaded: true, lines: 0 });

  // The wind: hidden at first (the day frames), shown with the chip, all on land.
  const chip = page.getByTestId('wind-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.tap();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await windDebug(page))?.shown).toBe(true);
  const windy = (await windDebug(page))?.tiles ?? [];
  expect(windy.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
  await chip.tap();
  await expect.poll(async () => (await windDebug(page))?.shown).toBe(false);

  // A tile of my home with no building, on dry land, next to more of my land
  // (I'm the patch's only Keeper, so all owned land is mine).
  const view = (await api<{ tiles: ViewTile[] }>(page, 'GET', `/maps/${mapId}/view`)).body.tiles;
  const mineKeys = new Set(view.filter((t) => t.ownerUserId !== null).map(hexKey));
  const spot = view.find(
    (t) =>
      t.ownerUserId !== null &&
      t.homeSlot !== null &&
      t.buildings.length === 0 &&
      !isWaterTerrain(t.terrain) &&
      hexNeighbors(t).some((n) => mineKeys.has(hexKey(n))),
  );
  expect(spot, 'a tile of mine to wire').toBeDefined();
  const lay = async (card: string) => {
    await selectTile(page, spot!);
    await page.getByTestId('tile-build').tap();
    await page.locator(`[data-build="${card}"]`).tap();
    await page.getByTestId('build-go').tap();
    await expect(page.getByTestId('tile-build-note')).toBeVisible();
  };
  await lay('line-wire');
  await expect.poll(async () => (await linesDebug(page))?.drawn?.wires).toBe(1);
  await lay('line-rail-1');
  await expect.poll(async () => (await linesDebug(page))?.drawn?.rails).toBe(1);
  const lines = (await api<LinesView>(page, 'GET', `/maps/${mapId}/lines`)).body.lines;
  expect(lines.map((l) => l.kind).sort()).toEqual(['rail', 'wire']);
  // No Windmill on the patch: the wire is dark, and the map draws it so.
  expect(lines.find((l) => l.kind === 'wire')?.powered).toBe(false);
  expect((await linesDebug(page))?.drawn?.litWires).toBe(0);

  // The tile panel says what runs here, and takes the wire up.
  await selectTile(page, spot!);
  await expect(page.getByTestId('wire-line')).toHaveText('⚡ A quiet wire. Join it to a Windmill!');
  await expect(page.getByTestId('rail-line')).toHaveText('🛤️ A rail runs through here.');
  await page.getByTestId('wire-take-up').tap();
  await page.getByTestId('wire-take-up-yes').tap();
  await expect(page.getByTestId('line-note')).toContainText('Wire taken up.');
  await expect.poll(async () => (await linesDebug(page))?.drawn?.wires).toBe(0);
  expect((await api<LinesView>(page, 'GET', `/maps/${mapId}/lines`)).body.lines).toMatchObject([
    { kind: 'rail', level: 1 },
  ]);
  await page.context().close();
});
