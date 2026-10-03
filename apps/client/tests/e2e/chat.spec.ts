import { expect, test, type Page } from '@playwright/test';
import { newPlayer, uniqueName } from './players.js';

/** The chat from the dev hook (src/chat/chat-screen.ts `ChatDebug`). */
interface ChatDebug {
  mapId: string;
  open: boolean;
  feed: { username: string; messageId: string }[];
  bubbles: string[];
  note: string;
}

function chatState(page: Page): Promise<ChatDebug | null> {
  return page.evaluate(
    () =>
      (window as unknown as { __heartpatch?: { chat(): ChatDebug | null } }).__heartpatch?.chat() ??
      null,
  );
}

function liveStatus(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __heartpatch?: { map(): { live: string | null } | null } }
      ).__heartpatch?.map()?.live ?? null,
  );
}

test('two players on one patch trade quick messages live', async ({ browser }) => {
  test.setTimeout(120_000); // two players, shader compiles; CI renders in software
  const ownerName = uniqueName('chat');
  const friendName = uniqueName('pal');

  // The owner makes a patch; a friend asks to join and is let in.
  const owner = await newPlayer(browser, ownerName);
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Chatter Patch');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';

  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();

  // The owner reopens the patch's card to see the request (as in map.spec.ts).
  await ownerLobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(ownerLobby).toBeHidden();
  await owner.getByTestId('lobby-open').tap();
  await ownerLobby.getByRole('button', { name: /Chatter Patch/ }).tap();
  await expect(ownerLobby.getByRole('heading', { name: 'Chatter Patch' })).toBeVisible();
  await ownerLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await ownerLobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(ownerLobby).toBeHidden();

  await friendLobby.getByRole('button', { name: 'Check again' }).tap();
  await friendLobby.getByRole('button', { name: /Chatter Patch/ }).tap();
  await friendLobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect(friendLobby).toBeHidden();

  // Both follow the patch live, with an empty feed.
  for (const page of [owner, friend]) {
    await expect.poll(() => liveStatus(page), { timeout: 30_000 }).toBe('live');
    await expect.poll(() => chatState(page)).toMatchObject({ open: false, feed: [] });
  }

  // The owner says something from the picker: the sheet steps aside for the bubble.
  await owner.getByTestId('chat-open').tap();
  const sheet = owner.getByTestId('chat');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('chat-feed')).toContainText('No messages yet');
  await sheet.getByRole('button', { name: 'Watch out, it’s getting dark!' }).tap();
  await expect(sheet).toBeHidden();
  await expect
    .poll(() => chatState(owner))
    .toMatchObject({ feed: [{ username: ownerName, messageId: 'getting-dark' }] });

  // The friend hears it live: a bubble over the map, and the line in their feed.
  await expect
    .poll(() => chatState(friend), { timeout: 15_000 })
    .toMatchObject({
      feed: [{ username: ownerName, messageId: 'getting-dark' }],
      bubbles: ['getting-dark'],
    });
  await expect(friend.getByTestId('chat-bubbles')).toContainText(ownerName);

  // The friend answers with a sticker; the owner sees it, once.
  await friend.getByTestId('chat-open').tap();
  await friend.getByTestId('chat').getByRole('button', { name: 'Glowboo' }).tap();
  await expect
    .poll(() => chatState(owner), { timeout: 15_000 })
    .toMatchObject({
      feed: [
        { username: ownerName, messageId: 'getting-dark' },
        { username: friendName, messageId: 'sticker-glowboo' },
      ],
    });

  // A reload brings the feed back from the server.
  await friend.reload();
  await friendLobby.getByRole('button', { name: /Chatter Patch/ }).tap();
  await friendLobby.getByRole('button', { name: 'Visit patch' }).tap();
  await expect
    .poll(() => chatState(friend), { timeout: 30_000 })
    .toMatchObject({
      feed: [
        { username: ownerName, messageId: 'getting-dark' },
        { username: friendName, messageId: 'sticker-glowboo' },
      ],
      bubbles: [],
    });
});
