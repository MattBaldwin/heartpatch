import { hexDistance } from '@heartpatch/shared';
import { expect, test } from '@playwright/test';
import { api } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { trayButton } from './trays.js';
import { fairLines, mateId, OUT, rig, snap, uuid } from './zz-cap-lib.js';

const CLAIM = process.env['CAP_CLAIM'] ? process.env['CAP_CLAIM'].split(',').map(Number) : [];

test('captures a', async ({ browser }) => {
  test.setTimeout(280_000);
  const page = await newPlayer(browser, uniqueName('cap'));
  const rg = await rig(page);
  const lobby = page.getByTestId('lobby');
  const reopen = async () => {
    await page.reload();
    await expect(lobby).toBeVisible();
    const visit = lobby.getByRole('button', { name: 'Visit patch' });
    if (!(await visit.isVisible())) {
      await lobby.getByRole('button', { name: /Mia's Meadow/ }).tap();
    }
    await visitPatch(lobby);
  };
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill("Mia's Meadow");
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await lobby.getByTestId('lobby-invite-code').waitFor();
  await lobby.getByTestId('lobby-computer-toggle').tap();
  await expect(lobby.getByTestId('lobby-computer-note')).toContainText('3 Computer friends');
  await reopen();
  const mapId = rg.mapId;
  const hintOk = page.getByTestId('tray-hint-ok');
  await expect(hintOk).toBeVisible({ timeout: 20_000 });
  await hintOk.tap();
  const hello = page.getByTestId('computer-hello');
  await expect(hello).toBeVisible({ timeout: 15_000 });
  await snap(page, '01-hello');
  await hello.getByTestId('computer-hello-ok').tap();
  await expect(hello).toBeHidden();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await page.waitForTimeout(2500);
  await snap(page, '02-map-before');

  // The claim: a plain meadow tile a few hexes from my home.
  const view = await api<{ tiles: any[]; members: any[] }>(page, 'GET', `/maps/${mapId}/view`);
  const me = view.body.members[0].user.id as string;
  rg.me = me;
  const home = view.body.tiles.find((t) => t.ownerUserId === me && t.homeSlot === 0);
  let claim = { q: CLAIM[0] ?? 0, r: CLAIM[1] ?? 0 };
  if (!CLAIM.length) {
    const c = view.body.tiles
      .filter((t) => !t.ownerUserId && ['meadow', 'forest', 'pumpkin-fields'].includes(t.terrain) && !t.nodeResource && !t.guardianHint && !t.post && t.r < home.r)
      .map((t) => ({ q: t.q, r: t.r, terrain: t.terrain, d: hexDistance(home, t) }))
      .filter((t) => t.d >= 3)
      .sort((a, b) => a.d - b.d || (a.terrain === 'meadow' ? -1 : 1));
    console.log('CANDS', JSON.stringify(c.slice(0, 6)));
    claim = c[0]!;
  }
  console.log('CLAIM', JSON.stringify(claim), 'home', home.q, home.r);
  rg.claim = claim;
  rg.push('tile.claimed', { userId: mateId(0), q: claim.q, r: claim.r });
  await page.waitForTimeout(2500);
  await snap(page, '03-map-after');

  // Who's here -> card -> asking -> not now (Computer friend).
  await page.getByTestId('friendly-open').tap();
  const mates = page.getByTestId('friendly-computer-list');
  await expect(mates.getByRole('listitem')).toHaveCount(3);
  await snap(page, '04-whos-here');
  await mates.getByTestId('friendly-battle-mate').first().tap();
  const card = page.getByTestId('friendly');
  await expect(card.getByTestId('friendly-ask-send')).toBeVisible();
  await snap(page, '05-battle-me-card');
  rg.challenge = { hold: Promise.resolve(), release: () => undefined };
  await card.getByTestId('friendly-ask-send').tap();
  await expect(card.getByTestId('friendly-never-mind')).toBeVisible();
  await snap(page, '06-asking');
  await page.waitForTimeout(500);
  rg.push('challenge.answered', {
    challengeId: uuid(1), kind: 'friendly', fromUserId: me, toUserId: mateId(0), answer: 'not-now', battleId: null,
  });
  await expect(card.getByTestId('friendly-okay')).toBeVisible();
  await snap(page, '07-declined');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(500);
  await snap(page, '07-declined-320');
  await page.setViewportSize({ width: 393, height: 852 });
  await card.getByTestId('friendly-okay').tap();
  await expect(card).toBeHidden();
  rg.challenge = null;

  // Raid report: a held raid by Bramble with the #728 line.
  rg.raids = {
    stance: 'balanced', unseen: 1,
    raids: [{
      id: uuid(10), battleId: uuid(11), attackerUserId: mateId(0), attackerName: 'Bramble',
      q: claim.q, r: claim.r, outcome: 'held', reason: 'defeat', stance: 'balanced', live: false,
      resolvedAt: new Date().toISOString(), seenAt: null, replayable: false, lostFire: null,
      earned: { xp: 12, patch: 3, heart: 3 },
    }],
  };
  await reopen();
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await (await trayButton(page, 'raid-open')).tap();
  await expect(page.getByTestId('raid-report')).toContainText('Bramble (Computer friend)');
  await snap(page, '08-raid-report');
  await page.getByTestId('raid-report').getByRole('button', { name: /close/i }).first().tap().catch(() => undefined);

  // Defend now? from a mate.
  rg.push('defense.prompted', {
    challengeId: uuid(12), battleId: uuid(13), fromUserId: mateId(0), toUserId: me,
    expiresAt: new Date(Date.now() + 40_000).toISOString(),
  });
  await expect(page.getByTestId('defense-card')).toBeVisible({ timeout: 15_000 });
  await snap(page, '09-defend-now');
  void OUT; void fairLines;
});
