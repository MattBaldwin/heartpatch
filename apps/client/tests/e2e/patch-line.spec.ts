import { expect, test, type Page } from '@playwright/test';
import { api, hook, waitForLiveMap } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';

/**
 * The patch line (#391): a patch-mate befriends a Legendary squishy and the
 * others on the map hear of it, by name only if they've met that kind (rule 6).
 * The befriending is done through the API (a Heart Charm is a dice roll, so it
 * charms until one works); the line is checked on the other player's map.
 */

interface BattleBody {
  battle: {
    id: string;
    status: string;
    view: { turn: number; phase: { type: string; result?: { reason: string } } };
  };
}

/** Starts wild battles against `speciesId` and offers charms until one says yes. */
async function befriend(page: Page, mapId: string, speciesId: string): Promise<void> {
  for (let round = 0; round < 12; round++) {
    const started = await api<BattleBody>(page, 'POST', `/maps/${mapId}/dev/battles`, {
      opponent: { speciesId, level: 1 },
    });
    expect(started.status).toBe(201);
    let battle = started.body.battle;
    for (let i = 0; i < 40 && battle.status === 'active'; i++) {
      const res = await api<BattleBody>(page, 'POST', `/battles/${battle.id}/actions`, {
        action: { type: 'capture' },
        turn: battle.view.turn,
      });
      expect(res.status).toBe(200);
      battle = res.body.battle;
    }
    if (battle.view.phase.result?.reason === 'captured') return;
    if (battle.status === 'active') {
      await api(page, 'POST', `/battles/${battle.id}/actions`, {
        action: { type: 'forfeit' },
        turn: battle.view.turn,
      });
    }
  }
  throw new Error(`never befriended ${speciesId}`);
}

/** Meets `speciesId` (fills in its catalog page) and runs home at once. */
async function meet(page: Page, mapId: string, speciesId: string): Promise<void> {
  const started = await api<BattleBody>(page, 'POST', `/maps/${mapId}/dev/battles`, {
    opponent: { speciesId, level: 1 },
  });
  expect(started.status).toBe(201);
  const ran = await api(page, 'POST', `/battles/${started.body.battle.id}/actions`, {
    action: { type: 'forfeit' },
    turn: 0,
  });
  expect(ran.status).toBe(200);
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('a patch-mate’s Legendary friend tells the patch, by name only to who has met it (#391)', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const ownerName = uniqueName('legend');
  const friendName = uniqueName('pal');

  const owner = await newPlayer(browser, ownerName);
  const ownerLobby = owner.getByTestId('lobby');
  await ownerLobby.getByRole('button', { name: 'Make a patch' }).tap();
  await ownerLobby.getByLabel('Patch name').fill('Legend Patch');
  await ownerLobby.getByRole('button', { name: 'Make it!' }).tap();
  const code = (await ownerLobby.getByTestId('lobby-invite-code').textContent()) ?? '';

  const friend = await newPlayer(browser, friendName);
  const friendLobby = friend.getByTestId('lobby');
  await friendLobby.getByRole('button', { name: 'Join with a code' }).tap();
  await friendLobby.getByLabel('Invite code').fill(code);
  await friendLobby.getByRole('button', { name: 'Ask to join' }).tap();
  await expect(friendLobby.getByTestId('lobby-waiting')).toBeVisible();

  await visitPatch(ownerLobby);
  await expect(ownerLobby).toBeHidden();
  await owner.getByTestId('lobby-open').tap();
  await ownerLobby.getByRole('button', { name: /Legend Patch/ }).tap();
  await ownerLobby.getByTestId('lobby-requests').getByRole('button', { name: 'Yes!' }).tap();
  await expect(ownerLobby.getByTestId('lobby-notice')).toContainText(`${friendName} joined`);
  await visitPatch(ownerLobby);
  await expect(ownerLobby).toBeHidden();

  await friendLobby.getByRole('button', { name: /Legend Patch/ }).tap({ timeout: 30_000 });
  await visitPatch(friendLobby);
  await expect(friendLobby).toBeHidden();
  await waitForLiveMap(friend);
  // Sprout's first-visit hint (a new player's) would hold the line back: say OK to it.
  const hintOk = friend.getByTestId('tray-hint-ok');
  await hintOk.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  if (await hintOk.isVisible()) await hintOk.tap();

  const mapId = (await hook<{ id: string }>(owner, 'map'))!.id;
  await api(owner, 'POST', `/maps/${mapId}/dev/squishies`, { level: 40 });
  await api(owner, 'POST', `/maps/${mapId}/dev/items`, { items: { 'heart-charm': 400 } });

  const line = friend.getByTestId('patch-line');
  const ownersLine = owner.getByTestId('patch-line');

  // The friend has never met a Thunderplume: they hear only its tier.
  await befriend(owner, mapId, 'thunderplume');
  await expect(line).toHaveText(`🌟 ${ownerName} befriended a Legendary squishy!`, {
    timeout: 30_000,
  });
  await expect(line).toBeHidden({ timeout: 15_000 });

  // An Epic friend never tells the patch.
  await befriend(owner, mapId, 'dawndrop');
  await friend.waitForTimeout(3000);
  await expect(line).toBeHidden();
  expect((await hook<{ waiting: number }>(friend, 'patchLine'))?.waiting).toBe(0);

  // Once the friend has met one, they hear its name. (A fresh page: their own
  // battle may have taken the screen.)
  await meet(friend, mapId, 'thunderplume');
  await friend.goto('/');
  await waitForLiveMap(friend);
  await expect(friend.getByTestId('battle-hud')).toBeHidden();
  await befriend(owner, mapId, 'thunderplume');
  await expect(line).toHaveText(`🌟 ${ownerName} befriended a Legendary Thunderplume!`, {
    timeout: 30_000,
  });
  await expect(line).toBeHidden({ timeout: 15_000 });

  // The player who befriended it hears nothing; their own card cheered.
  await expect(ownersLine).toBeHidden();
});
