import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';

/**
 * The wardrobe (#43): trying clothes on, rarity filters, costumes, outfit
 * presets, and other players seeing the outfit live on the map. Checked
 * through the dev hook (`WardrobeDebug`, map stats), never pixels.
 */

interface WardrobeDebug {
  open: boolean;
  loaded: boolean;
  tab: string;
  rarity: string;
  shown: string[];
  trying: string[];
  wearing: string[];
  owned: string[];
  presets: { preset: number; name: string | null; wearing: string[] }[];
  preview: string | null;
  turned: boolean;
  sending: boolean;
}

const wardrobeState = (page: Page) => hook<WardrobeDebug>(page, 'wardrobe');

const mapState = (page: Page) => hook<{ keepers: number; keepersWearing: string[][] }>(page, 'map');

/** Waits until the outfit tried on has reached the server. */
async function settled(page: Page, wearing: string[]): Promise<void> {
  await expect
    .poll(async () => {
      const s = await wardrobeState(page);
      return s && !s.sending ? s.wearing : null;
    })
    .toEqual(wearing);
}

async function openWardrobe(page: Page): Promise<void> {
  await page.getByTestId('lobby').getByTestId('wardrobe-open').tap();
  await expect(page.getByTestId('wardrobe')).toBeVisible();
  await expect.poll(async () => (await wardrobeState(page))?.loaded).toBe(true);
  await expect.poll(async () => (await wardrobeState(page))?.preview ?? null).not.toBeNull();
}

const wardrobe = (page: Page) => page.getByTestId('wardrobe');
const item = (page: Page, name: string) =>
  wardrobe(page)
    .getByTestId('wardrobe-items')
    .getByRole('button', { name: new RegExp(name) });
const rarity = (page: Page, which: string) => wardrobe(page).locator(`[data-rarity="${which}"]`);
const tab = (page: Page, name: string) =>
  wardrobe(page).getByRole('tab', { name: new RegExp(name) });

test('tries clothes on, filters, layers a costume and saves an outfit', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await newPlayer(browser, uniqueName('dress'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await openWardrobe(page);
  const first = (await wardrobeState(page))!;
  // Never empty: the starter set, nothing worn yet.
  expect(first.owned).toEqual(
    expect.arrayContaining(['sunny-cap', 'cozy-sweater', 'puddle-boots', 'tiny-bow']),
  );
  expect(first).toMatchObject({ tab: 'hat', trying: [], wearing: [], shown: ['sunny-cap'] });
  // The tab row is longer than a phone or an iPad: it fades at the right edge
  // to show it scrolls (#152), and at the left once it has.
  const tabs = wardrobe(page).locator('.wardrobe-tabs');
  await expect(tabs).toHaveAttribute('data-scroll-more', 'right');
  await tab(page, 'Squishy').scrollIntoViewIfNeeded();
  await expect(tabs).toHaveAttribute('data-scroll-more', /left/);

  // A tap tries it on at once, and the server keeps it.
  await item(page, 'Sunny Cap').tap();
  expect((await wardrobeState(page))!.trying).toEqual(['sunny-cap']);
  await expect(item(page, 'Sunny Cap')).toHaveAttribute('aria-pressed', 'true');
  await settled(page, ['sunny-cap']);
  const capped = (await wardrobeState(page))!.preview;
  expect(capped).not.toBe(first.preview);

  // More taps: the server ends up with the whole outfit, in slot order.
  await tab(page, 'Shoes').tap();
  await item(page, 'Puddle Boots').tap();
  await tab(page, 'Tops').tap();
  await item(page, 'Cozy Sweater').tap();
  await settled(page, ['sunny-cap', 'cozy-sweater', 'puddle-boots']);

  // Found pieces (dev grant), then the rarity filter.
  await wardrobe(page).getByRole('button', { name: 'Get clothes (dev)' }).tap();
  await expect.poll(async () => (await wardrobeState(page))?.owned).toContain('witch-hat');
  await tab(page, 'Hats').tap();
  await rarity(page, 'uncommon').tap();
  expect((await wardrobeState(page))!.shown).toEqual(['witch-hat']);
  await item(page, 'Witch Hat').tap();
  await settled(page, ['witch-hat', 'cozy-sweater', 'puddle-boots']);
  await rarity(page, 'legendary').tap();
  await expect(wardrobe(page).getByTestId('wardrobe-items')).toContainText('None like that yet');
  await rarity(page, 'all').tap();

  // A costume goes over everything; the rest stays on underneath.
  await tab(page, 'Costumes').tap();
  await item(page, 'Ghost Sheet').tap();
  await settled(page, ['witch-hat', 'cozy-sweater', 'puddle-boots', 'ghost-sheet']);
  await tab(page, 'Hats').tap();
  await expect(item(page, 'Witch Hat')).toContainText('Under costume');

  // Save the look, change, then wear it again with one tap.
  await wardrobe(page).getByTestId('wardrobe-save-look').tap();
  await wardrobe(page).getByTestId('wardrobe-name').fill('Spooky');
  await wardrobe(page).getByRole('button', { name: 'Spot 1' }).tap();
  await expect(wardrobe(page).getByTestId('wardrobe-note')).toHaveText(
    'Saved! Tap it any time to wear it.',
  );
  expect((await wardrobeState(page))!.presets).toEqual([
    {
      preset: 1,
      name: 'Spooky',
      wearing: ['witch-hat', 'cozy-sweater', 'puddle-boots', 'ghost-sheet'],
    },
  ]);
  await tab(page, 'Costumes').tap();
  await item(page, 'Ghost Sheet').tap();
  await settled(page, ['witch-hat', 'cozy-sweater', 'puddle-boots']);
  await wardrobe(page)
    .getByRole('button', { name: /Spooky/ })
    .tap();
  await settled(page, ['witch-hat', 'cozy-sweater', 'puddle-boots', 'ghost-sheet']);

  // Turn round to see the back.
  const front = (await wardrobeState(page))!.preview;
  await wardrobe(page).getByTestId('wardrobe-turn').tap();
  expect((await wardrobeState(page))!.turned).toBe(true);
  // Same Keeper, same clothes: only where it faces changed.
  expect((await wardrobeState(page))!.preview).toBe(front);
  await expect(wardrobe(page).getByTestId('wardrobe-turn')).toHaveText('Face me');

  // Every word on the card is kid-safe (style guide §9).
  const words = await wardrobe(page).innerText();
  expect(findAvoidedWords(words)).toEqual([]);

  // Done, then back again after a reload: the server kept it all.
  await wardrobe(page).getByTestId('wardrobe-done').tap();
  await expect(page.getByTestId('lobby')).toBeVisible();
  await page.reload();
  await openWardrobe(page);
  expect(await wardrobeState(page)).toMatchObject({
    wearing: ['witch-hat', 'cozy-sweater', 'puddle-boots', 'ghost-sheet'],
    presets: [{ preset: 1, name: 'Spooky' }],
  });
  expect(errors).toEqual([]);
  await page.context().close();
});

test('other players see the outfit on the map, live', async ({ browser }) => {
  test.setTimeout(150_000); // two players and a map build; CI renders in software
  const owner = await newPlayer(browser, uniqueName('host'));
  const friend = await newPlayer(browser, uniqueName('pal'));
  const errors: string[] = [];
  friend.on('pageerror', (err) => errors.push(err.message));

  // The friend joins the owner's patch (the lobby flow is lobby.spec.ts's).
  const { map } = (
    await api<{ map: { id: string } }>(owner, 'POST', '/maps', {
      name: 'Fashion Patch',
      timeZone: 'America/Chicago',
    })
  ).body;
  const detail = async () =>
    (
      await api<{ map: { admin: { invite: { code: string }; requests: { id: string }[] } } }>(
        owner,
        'GET',
        `/maps/${map.id}`,
      )
    ).body;
  const code = (await detail()).map.admin.invite.code;
  await api(friend, 'POST', '/maps/join', { code });
  const requestId = (await detail()).map.admin.requests[0]!.id;
  await api(owner, 'POST', `/maps/${map.id}/requests/${requestId}/approve`);

  // The friend opens the patch: both Keepers stand at home, nothing worn.
  const friendLobby = friend.getByTestId('lobby');
  await friend.reload();
  await friendLobby.getByRole('button', { name: /Fashion Patch/ }).tap();
  await visitPatch(friendLobby);
  await expect
    .poll(() => mapState(friend), { timeout: 60_000 })
    .toMatchObject({ keepers: 2, keepersWearing: [[], []] });

  // The owner dresses up in the wardrobe...
  await owner.reload();
  await openWardrobe(owner);
  await item(owner, 'Sunny Cap').tap();
  await tab(owner, 'Shoes').tap();
  await item(owner, 'Puddle Boots').tap();
  await settled(owner, ['sunny-cap', 'puddle-boots']);

  // ...and the friend's map dresses their Keeper without a reload.
  await expect
    .poll(async () => (await mapState(friend))?.keepersWearing, { timeout: 15_000 })
    .toContainEqual(['sunny-cap', 'puddle-boots']);

  // The owner's Keeper wears it at home too (#18's home base).
  await wardrobe(owner).getByTestId('wardrobe-done').tap();
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: /Fashion Patch/ }).tap();
  await visitPatch(ownerLobby);
  await (await trayButton(owner, 'home-open')).tap();
  await expect
    .poll(
      async () =>
        (await hook<{ scene: { keeperWearing: string[] } | null }>(owner, 'home'))?.scene
          ?.keeperWearing ?? null,
      { timeout: 60_000 },
    )
    .toEqual(['sunny-cap', 'puddle-boots']);
  expect(errors).toEqual([]);
  await owner.context().close();
  await friend.context().close();
});

test('from a patch, Done goes back to that patch, via the Boutique and Milestones', async ({
  browser,
}) => {
  test.setTimeout(180_000); // a map build per screen; CI renders in software
  const page = await newPlayer(browser, uniqueName('exit'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Dress-up Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  const mapId = async () => (await hook<{ id: string }>(page, 'map'))?.id ?? null;
  await expect.poll(mapId, { timeout: 60_000 }).not.toBeNull();
  const patch = await mapId();
  const hint = page.getByTestId('tray-hint-ok');
  if (await hint.isVisible()) await hint.tap();

  // The owner's iPhone and an iPad on its side (the projects' own sizes are taller).
  for (const screen of [
    { width: 390, height: 844 },
    { width: 1180, height: 820 },
  ]) {
    await test.step(`${String(screen.width)}×${String(screen.height)}`, async () => {
      await page.setViewportSize(screen);
      // The Wardrobe from the Keeper menu, over the map.
      await page.getByTestId('keeper-menu').tap();
      await page
        .locator('.auth-chip-menu')
        .getByRole('button', { name: /Wardrobe/ })
        .tap();
      await expect(wardrobe(page)).toBeVisible();
      await expect.poll(async () => (await wardrobeState(page))?.loaded).toBe(true);
      expect(await mapId()).toBeNull();

      // "Done" is big, on screen, in the top row and on top of everything there.
      const done = wardrobe(page).getByTestId('wardrobe-done');
      const box = (await done.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(screen.width);
      expect(box.y + box.height).toBeLessThanOrEqual(screen.height);
      for (const chip of ['wardrobe-milestones', 'wardrobe-boutique', 'wardrobe-turn']) {
        const other = (await wardrobe(page).getByTestId(chip).boundingBox())!;
        expect(box.y + box.height, `${chip} sits below Done`).toBeLessThanOrEqual(other.y);
      }
      const onTop = await page.evaluate(
        ([x, y]) =>
          document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'),
        [box.x + box.width / 2, box.y + box.height / 2] as const,
      );
      expect(onTop).toBe('wardrobe-done');

      // Into the Boutique and Milestones and back: still the wardrobe.
      await wardrobe(page).getByTestId('wardrobe-boutique').tap();
      await expect(page.getByTestId('boutique')).toBeVisible();
      await page.getByTestId('boutique-back').tap();
      await expect(done).toBeVisible();
      await wardrobe(page).getByTestId('wardrobe-milestones').tap();
      await expect(page.getByTestId('milestones')).toBeVisible();
      await page.getByTestId('milestones-back').tap();
      await expect(done).toBeVisible();

      // Done: the same patch, not the patch list.
      await done.tap();
      await expect(wardrobe(page)).toBeHidden();
      await expect.poll(mapId, { timeout: 60_000 }).toBe(patch);
      await expect(lobby).toBeHidden();
      expect((await wardrobeState(page))?.open).toBe(false);
    });
  }
  expect(errors).toEqual([]);
  await page.context().close();
});
