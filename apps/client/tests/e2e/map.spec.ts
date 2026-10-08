import { expect, test, type Page } from '@playwright/test';
import { draws, hook, idle } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/** The open map as drawn, from the dev hook (src/map/map-screen.ts `MapDebug`). */
interface MapDebug {
  id: string;
  viewSeq: number;
  tiles: number;
  tileMeshes: number;
  tinted: number;
  borderMeshes: number;
  homes: number;
  claimedHomes: number;
  selected: string | null;
  live: string | null;
  props: number;
  propKinds: number;
  mutedTiles: number;
  ambient: 'live' | 'still' | 'off';
}

function mapState(page: Page): Promise<MapDebug | null> {
  return hook<MapDebug>(page, 'map');
}

/** A touch tap on the canvas as pointer events (the same in WebKit and Chromium; see smoke.spec.ts). */
async function tapCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('#game')!;
      for (const type of ['pointerdown', 'pointerup']) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { x, y },
  );
}

async function openPatch(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: new RegExp(name) }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect(page.getByTestId('map-hud')).toContainText(name);
}

test('draws a patch, shows tile info on tap, and follows land changes live', async ({
  browser,
}) => {
  test.setTimeout(120_000); // two players, shader compiles; CI renders in software
  const ownerName = uniqueName('own');
  const friendName = uniqueName('pal');

  // The owner makes a patch and visits it.
  const owner = await newPlayer(browser, ownerName);
  const errors: string[] = [];
  owner.on('pageerror', (err) => errors.push(err.message));
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Moonlit Patch');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';
  await visitPatch(ownerLobby);
  await expect(ownerLobby).toBeHidden();

  // The full 4-player map: 469 tiles in a handful of instanced meshes, the
  // owner's home ring tinted, one claimed home base of four.
  await expect
    .poll(() => mapState(owner), { timeout: 30_000 })
    .toMatchObject({
      tiles: 469,
      tinted: 7,
      borderMeshes: 1,
      homes: 4,
      claimedHomes: 1,
      selected: null,
    });
  const drawn = (await mapState(owner))!;
  // 9 terrain looks (trading posts too, #269) plus home tiles, however many tiles.
  expect(drawn.tileMeshes).toBeLessThanOrEqual(10);
  await expect(owner.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await mapState(owner))?.live).toBe('live');

  // The camera starts on the owner's Heart Seed: tapping the middle shows it.
  const box = (await owner.locator('#game').boundingBox())!;
  await tapCanvas(owner, box.width / 2, box.height / 2);
  const panel = owner.getByTestId('tile-panel');
  await expect(panel).toBeVisible();
  await expect(owner.getByTestId('tile-panel-owner')).toHaveText(
    'Your home base. Nobody can ever take it!',
  );
  await expect(panel).not.toContainText(/claim|challenge/i);
  expect((await mapState(owner))?.selected).not.toBeNull();
  await panel.getByRole('button', { name: 'Close' }).tap();
  await expect(panel).toBeHidden();
  expect((await mapState(owner))?.selected).toBeNull();

  // A friend asks to join; the owner approves from the lobby while the map
  // stays open behind it. The new home base is tinted without a reload.
  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();

  await owner.getByTestId('lobby-open').tap();
  await openPatchDetail(owner, 'Moonlit Patch');
  await ownerLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await expect
    .poll(() => mapState(owner), { timeout: 15_000 })
    .toMatchObject({ tinted: 14, claimedHomes: 2 });

  // The friend's waiting row turns into the patch by itself (#145); they see both home bases.
  await openPatch(friend, 'Moonlit Patch');
  await expect
    .poll(() => mapState(friend), { timeout: 30_000 })
    .toMatchObject({ tiles: 469, tinted: 14, borderMeshes: 2, claimedHomes: 2 });

  // The legend (#278): the name pill opens a card saying whose land is
  // whose, by colour, icon and line; a tap on the map closes it.
  await friend.getByTestId('map-legend-button').tap();
  const legend = friend.getByTestId('map-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText(`${ownerName}'s land`);
  await expect(legend).toContainText('Your land');
  const friendBox = (await friend.locator('#game').boundingBox())!;
  await tapCanvas(friend, friendBox.width / 2, friendBox.height * 0.7);
  await expect(legend).toBeHidden();

  // The owner removes the friend: the friend's map closes with a kind note,
  // and the owner's map un-tints their land live.
  const friendRow = ownerLobby
    .getByTestId('lobby-members')
    .getByRole('listitem')
    .filter({ hasText: friendName });
  await friendRow.getByRole('button', { name: 'Remove' }).tap();
  await ownerLobby.getByRole('button', { name: 'Remove', exact: true }).tap();
  await expect
    .poll(() => mapState(owner), { timeout: 15_000 })
    .toMatchObject({ tinted: 7, claimedHomes: 1 });
  await expect.poll(() => mapState(friend), { timeout: 15_000 }).toBeNull();
  await expect(friendLobby).toBeVisible();
  await expect(friend.getByTestId('map-hud')).toBeHidden();

  expect(errors).toEqual([]);
  await owner.context().close();
  await friend.context().close();
});

/** Opens a patch's lobby card (not the map) from the patch list. */
async function openPatchDetail(page: Page, name: string): Promise<void> {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: new RegExp(name) }).tap();
  await expect(lobby.getByRole('heading', { name })).toBeVisible();
}

test('dresses the land, mutes wild land, and keeps ambient life calm', async ({ browser }) => {
  test.setTimeout(120_000); // shader compiles; CI renders in software
  const page = await newPlayer(browser, uniqueName('dress'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // A shader that doesn't compile only logs: catch it here.
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|effect|compile/i.test(msg.text()))
      errors.push(msg.text());
  });
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Leafy Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');

  // Every terrain is dressed (one mesh per prop kind), and only the player's
  // home ring and Juniper's Gap are in full colour: the rest is wild.
  const drawn = (await mapState(page))!;
  expect(drawn.props).toBeGreaterThan(1000);
  expect(drawn.propKinds).toBeGreaterThanOrEqual(18);
  expect(drawn.mutedTiles).toBeGreaterThan(400);
  expect(drawn.mutedTiles).toBeLessThan(469 - 7);

  // Ambient life runs (or switched itself off on a renderer too slow for it,
  // as CI's software one can be)...
  expect(['live', 'off']).toContain(drawn.ambient);
  // ...and with reduced motion nothing moves, so the map draws nothing at all.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(async () => (await mapState(page))?.ambient, { timeout: 15_000 })
    .toMatch(/^(still|off)$/);
  await expect.poll(() => idle(page), { timeout: 30_000 }).toBe(true);
  const before = await draws(page);
  await page.waitForTimeout(1500);
  expect(await draws(page)).toBe(before);
  await page.emulateMedia({ reducedMotion: null });

  expect(errors).toEqual([]);
  await page.context().close();
});
