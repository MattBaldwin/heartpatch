import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/** The open map as drawn, from the dev hook (src/map/map-screen.ts `MapDebug`). */
interface MapDebug {
  id: string;
  viewSeq: number;
  tiles: number;
  tileMeshes: number;
  tinted: number;
  homes: number;
  claimedHomes: number;
  selected: string | null;
  live: string | null;
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
      homes: 4,
      claimedHomes: 1,
      selected: null,
    });
  const drawn = (await mapState(owner))!;
  expect(drawn.tileMeshes).toBeLessThanOrEqual(9);
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

  // The friend sees both home bases.
  await friendLobby.getByRole('button', { name: 'Check again' }).tap();
  await openPatch(friend, 'Moonlit Patch');
  await expect
    .poll(() => mapState(friend), { timeout: 30_000 })
    .toMatchObject({ tiles: 469, tinted: 14, claimedHomes: 2 });

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
