import { expect, test, type Page } from '@playwright/test';
import { STUB_BASE_NAME, stubBossFight, type BossStubOptions } from './boss-stub.js';
import { hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { realTap } from './touch.js';
import { trayButton } from './trays.js';

/**
 * A mini-boss fight on the battle screen (#190, 190e; owner-approved arena A,
 * picker A1 and the befriend moment), on iPhone and iPad sizes: three
 * squishies against one big boss, a move picked for each in turn, the round
 * played out, the win's bundle, two asks ("Not yet!", then a new friend), and
 * a duplicate that never joins. The boss fight itself is stood in for by
 * boss-stub.ts (no boss visits yet, #234); the app around it is real.
 */

interface BattleDebug {
  status: string;
  pending: number;
  waiting: boolean;
  scene: {
    squishies: number;
    framing: {
      distance: number;
      fogEnd: number;
      band: { top: number; bottom: number };
      face: { top: number; bottom: number } | null;
      team: { top: number; bottom: number }[];
      bossFacing: number | null;
    } | null;
  } | null;
  boss: {
    picking: number | null;
    picks: Record<string, string>;
    asks: number;
    warmth: number;
    recounts: number;
  } | null;
}

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

async function bossFight(page: Page, options: BossStubOptions = {}) {
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Stomp Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  // A team of three: the starter and two friends from the dev grant.
  for (let i = 0; i < 2; i++) {
    await realTap(await trayButton(page, 'battle-dev-grant'));
    await expect(page.locator('.battle-entry-note')).toContainText('joined you');
  }
  const stub = await stubBossFight(page, options);
  await realTap(await trayButton(page, 'battle-dev-fight'));
  await expect(page.getByTestId('boss-plate')).toBeVisible({ timeout: 30_000 });
  return stub;
}

async function playRound(page: Page): Promise<void> {
  const picker = page.getByTestId('boss-picker');
  await expect(picker).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('boss-pick-header')).toBeVisible();
    await realTap(picker.getByTestId('boss-move').first());
  }
  await expect(picker).toContainText("Everyone's ready!");
  await realTap(page.getByTestId('boss-go'));
}

test.describe('a mini-boss fight (#190)', () => {
  test.describe.configure({ timeout: 180_000 });
  test('won and befriended: three squishies, the picker, the bundle, two asks', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { befriend: ['not-yet', 'joined'] });

    // Arena A: one boss plate, three slim plates, four squishies drawn.
    await expect(page.getByTestId('boss-friends').locator('.boss-friend')).toHaveCount(3);
    await expect(page.getByTestId('boss-plate')).toContainText('Lv');
    await expect(page.getByTestId('boss-tries')).toHaveText('🍀 2 tries left today');
    await expect(page.getByTestId('boss-until')).toContainText('here until');
    await expect(page.getByTestId('boss-round')).toHaveText('Round 1');
    await expect.poll(async () => (await battleState(page))?.scene?.squishies).toBe(4);
    // The 1-v-1 pills step aside.
    await expect(page.getByTestId('battle-plate-mine')).toBeHidden();

    // Picker A1: the first squishy picks first; a tap on its chip goes back.
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(0);
    await realTap(page.getByTestId('boss-move').first());
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(1);
    await realTap(page.getByTestId('boss-step-0'));
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(0);
    await playRound(page);

    // One `team` round went out: a pick per squishy, no aiming.
    await expect.poll(() => stub.rounds.length).toBe(1);
    expect(stub.rounds[0]).toMatchObject({ type: 'team' });
    expect(
      (stub.rounds[0]!['picks'] as unknown[]).map((p) => (p as { slot: number }).slot),
    ).toEqual([0, 1, 2]);

    // The win: the bundle, then the ask.
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('You did it! 🎉');
    await expect(card).toContainText('You won 3 Heart Charms');
    // Each friend's evolving meter (#205), in a row under the team's XP line.
    await expect(card.getByTestId('battle-evolving')).toHaveCount(3);
    await expect(card.getByTestId('battle-evolving').first()).toContainText('35%');
    // Each meter is named for its squishy ("Pip 35%"), in the XP line's order.
    const meters = await card.getByTestId('battle-evolving').allInnerTexts();
    const named = meters.map((text) => text.replace(/\s*\d+%[\s\S]*$/, '').trim());
    expect(named.every((name) => name.length > 0 && !name.includes('Evolving'))).toBe(true);
    const xpLine = (await card.getByTestId('battle-xp').locator('li').first().innerText()).trim();
    const at = named.map((name) => xpLine.indexOf(name));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    await expect(card.getByTestId('boss-befriend-ask')).toContainText('to be your friend? 💗💗💗');
    // Counted again once the bundle landed: the 3 from before and the bundle's 3.
    await expect(card.getByTestId('boss-befriend-ask')).toContainText('You have 6 Heart Charms');
    const ask = card.getByTestId('boss-ask');
    await expect(ask).toHaveText('Give 3 Heart Charms 💗');
    await expect(ask).toBeEnabled();

    // "Not yet!": one warmth heart, then ask again.
    await realTap(ask);
    await expect(card.getByTestId('boss-not-yet')).toContainText('likes you a little more now.');
    await expect(card.getByTestId('boss-warmth')).toHaveAttribute('data-lit', '1');
    await expect(card.getByTestId('boss-ask')).toHaveText('Ask again (3 💗)');
    await expect(card.getByTestId('boss-befriend-ask')).toContainText('You have 3 Heart Charms');
    await realTap(card.getByTestId('boss-ask'));
    // The base form joins, by its own name (#820).
    await expect(card.getByTestId('boss-befriend-joined')).toContainText(
      `${STUB_BASE_NAME} joined your patch! 💗`,
    );

    // Asks 1 then 2, each with its own key.
    expect(stub.asks.map((a) => a.body['ask'])).toEqual([1, 2]);
    expect(stub.asks.every((a) => a.key && a.key.length > 8)).toBe(true);
    expect(stub.asks[0]!.key).not.toBe(stub.asks[1]!.key);

    await realTap(page.getByTestId('battle-done'));
    await expect(page.getByTestId('battle-result')).toBeHidden();
  });

  test('the boss winds up, lands it and calls for backup (#234)', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, {
      openRounds: 3,
      tricks: ['windup', 'land', 'assist'],
    });
    // Captions and callouts come and go with each step: keep every one the screen shows.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { hpCaptions: string[] }).hpCaptions = seen;
      const note = (selector: string) => {
        const text = document.querySelector(selector)?.textContent ?? '';
        if (text && !seen.includes(text)) seen.push(text);
      };
      new MutationObserver(() => {
        note('[data-testid="battle-caption"]');
        note('[data-testid="boss-callout"]');
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
    });
    const captions = () =>
      page.evaluate(() => (window as unknown as { hpCaptions: string[] }).hpCaptions);
    const winding = page.getByTestId('boss-windup');
    await expect(winding).toBeHidden();
    // Round 1: the charge. Nothing lands; the boss plate says it's winding up.
    await playRound(page);
    await expect(winding).toHaveText('⏳ Winding up…');
    await expect(page.getByTestId('boss-round')).toHaveText('Round 2', { timeout: 30_000 });
    // Round 2: it lands, and the chip goes.
    await playRound(page);
    await expect(page.getByTestId('boss-round')).toHaveText('Round 3', { timeout: 30_000 });
    await expect(winding).toBeHidden();
    // Round 3: an assist. Its called-in stomp is backup, not a second stomp.
    await playRound(page);
    await expect(page.getByTestId('boss-round')).toHaveText('Round 4', { timeout: 30_000 });
    await expect.poll(captions).toContain('Backup! Big Stomp!');
    expect(await captions()).not.toContain('Stomp again!');
    await expect.poll(() => stub.rounds.length).toBe(3);
  });

  test('on a notched iPhone the fight stays inside the sky and shows the boss face (#234, #868)', async ({
    browser,
    browserName,
  }) => {
    // An iPhone 15's full screen as an installed app (393×852). Chromium also
    // gets the notch's safe-area insets (only it can emulate them, over CDP):
    // with them the boss's stage band was 15% of the screen and the camera
    // backed out past the sky dome (radius 95), so the fight drew as empty
    // sky (#234). Even without them the camera sat at 85, all but lost in the fog.
    const page = await newPlayer(browser, uniqueName('notch'));
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send(
        'Emulation.setSafeAreaInsetsOverride' as never,
        {
          insets: {
            top: 59,
            topMax: 59,
            bottom: 34,
            bottomMax: 34,
            left: 0,
            leftMax: 0,
            right: 0,
            rightMax: 0,
          },
        } as never,
      );
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await bossFight(page);
    await expect(page.getByTestId('boss-picker')).toBeVisible();
    await expect
      .poll(async () => (await battleState(page))?.scene?.framing?.distance ?? Infinity, {
        timeout: 15_000,
      })
      .toBeLessThanOrEqual(70); // BATTLE_CAMERA.maxFitDistance (e2e specs don't import src)
    const framing = (await battleState(page))?.scene?.framing;
    // The boss stands about 10 past the aim: it and its ground stay inside the
    // dome and short of the fog's end.
    expect(framing!.distance + 10).toBeLessThan(95); // ARENA_STAGE.skyRadius
    expect(framing!.distance + 10).toBeLessThan(framing!.fogEnd);
    // The boss's face comes first (#868): its eyes and mouth sit inside the
    // stage band, between the boss plate (with its Order strip) and the team
    // cards, while the team may tuck its feet under the cards.
    const band = framing!.band;
    const face = framing!.face;
    expect(face).not.toBeNull();
    expect(face!.top).toBeGreaterThanOrEqual(band.top);
    expect(face!.bottom).toBeLessThanOrEqual(band.bottom);
    // The team's eyes stay above the team cards (only their feet tuck under),
    // and the framed boss looks at the camera.
    expect(framing!.team.length).toBeGreaterThan(0);
    for (const friend of framing!.team) expect(friend.bottom).toBeLessThanOrEqual(band.bottom);
    expect(framing!.bossFacing).toBeGreaterThan(0.5);
    // The band is the HUD's own: it starts under the boss head (plate + Order strip).
    const headBottom = await page
      .locator('.boss-head')
      .evaluate((e) => e.getBoundingClientRect().bottom / window.innerHeight);
    expect(band.top).toBeGreaterThanOrEqual(headBottom - 0.005);
    // And the stage between the plate and the team cards draws a scene, not one
    // flat colour. Chromium only: headless WebKit screenshots of the WebGL
    // canvas come out flat (one colour) whatever it draws.
    if (browserName !== 'chromium') return;
    const top = await page
      .getByTestId('boss-plate')
      .evaluate((e) => e.getBoundingClientRect().bottom);
    // The lower part of the stage band (it ends ~140 px under the plate, at the
    // team cards), so no HUD is counted: the ground and the fighters' feet.
    const shot = await page.screenshot({
      clip: { x: 0, y: top + 60, width: 393, height: 60 },
      animations: 'disabled',
    });
    const colours = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4)
        seen.add(((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4));
      return seen.size;
    }, shot.toString('base64'));
    expect(colours).toBeGreaterThan(20);
  });

  test('a duplicate never joins: no ask, no charms', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { winState: 'have-one' });
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByTestId('boss-befriend-have-one')).toContainText(
      `You already have a ${STUB_BASE_NAME}! 💗`,
    );
    await expect(card.getByTestId('boss-ask')).toHaveCount(0);
    expect(stub.asks).toHaveLength(0);
  });

  test('from no charms: the bundle is counted, then the ask spends it', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { charms: 0, befriend: ['not-yet'] });
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    // Not the 0 counted when the fight opened: the win's 3 are in the bag now.
    const ask = card.getByTestId('boss-befriend-ask');
    await expect(ask).toContainText('You have 3 Heart Charms');
    await expect(card.getByTestId('boss-ask')).toBeEnabled();
    await realTap(card.getByTestId('boss-ask'));
    // Spent: none left, so the ask again points home for more.
    await expect(card.getByTestId('boss-warmth')).toHaveAttribute('data-lit', '1');
    await expect(ask).toContainText('You have 0 Heart Charms');
    await expect(card.getByTestId('boss-ask')).toHaveText('You need 3 💗');
    await expect(card.getByTestId('boss-ask')).toBeDisabled();
    await expect(card.getByTestId('boss-make-charms')).toBeVisible();
    expect(stub.charms()).toBe(0);
  });

  test('a refused ask shows why, looks again, and retries with the same key', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { conflictOn: [1], befriend: ['joined'] });
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await realTap(card.getByTestId('boss-ask'));
    await expect(card.getByRole('alert')).toContainText('mixed up');
    // The battle was fetched again, so the card shows the server's state.
    await expect.poll(() => stub.fetches()).toBeGreaterThan(0);
    await realTap(card.getByTestId('boss-ask'));
    await expect(card.getByTestId('boss-befriend-joined')).toBeVisible();
    expect(stub.asks.map((a) => a.body['ask'])).toEqual([1, 1]);
    expect(stub.asks[0]!.key).toBe(stub.asks[1]!.key);
  });
});
