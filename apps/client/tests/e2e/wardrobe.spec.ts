import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName, visitPatch } from './players.js';

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

type Hook = {
  __heartpatch?: {
    wardrobe?(): WardrobeDebug | null;
    map?(): { keepers: number; keepersWearing: string[][] } | null;
    home?(): { scene: { keeperWearing: string[] } | null } | null;
  };
};

const wardrobeState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.wardrobe?.() ?? null);

const mapState = (page: Page) =>
  page.evaluate(() => (window as unknown as Hook).__heartpatch?.map?.() ?? null);

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

/** Calls the API from the page, as the player (cookie and CSRF header). */
async function api<T>(page: Page, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return (res.status === 204 ? null : await res.json()) as T;
    },
    { method, path, body },
  );
}

test('other players see the outfit on the map, live', async ({ browser }) => {
  test.setTimeout(150_000); // two players and a map build; CI renders in software
  const owner = await newPlayer(browser, uniqueName('host'));
  const friend = await newPlayer(browser, uniqueName('pal'));
  const errors: string[] = [];
  friend.on('pageerror', (err) => errors.push(err.message));

  // The friend joins the owner's patch (the lobby flow is lobby.spec.ts's).
  const { map } = await api<{ map: { id: string } }>(owner, 'POST', '/maps', {
    name: 'Fashion Patch',
    timeZone: 'America/Chicago',
  });
  const detail = () =>
    api<{ map: { admin: { invite: { code: string }; requests: { id: string }[] } } }>(
      owner,
      'GET',
      `/maps/${map.id}`,
    );
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
  await owner.getByTestId('home-open').tap();
  await expect
    .poll(
      () =>
        owner.evaluate(
          () => (window as unknown as Hook).__heartpatch?.home?.()?.scene?.keeperWearing ?? null,
        ),
      { timeout: 60_000 },
    )
    .toEqual(['sunny-cap', 'puddle-boots']);
  expect(errors).toEqual([]);
  await owner.context().close();
  await friend.context().close();
});
