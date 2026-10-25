import { expect, test } from '@playwright/test';
import { grantItems, grantSquishy, postState, twoTraders, visitPost } from './trading.js';

/**
 * Gift, Trade and Swap from the bar (#655 part D, the owner-approved mockup
 * v4): the Gift recipient is a "To: Sam ▾" chip in the sticky bar that opens a
 * picker sheet; picks sit in a strip you can tap to change them; Send gift asks
 * first, Send offer doesn't; Swap does its thing from a sticky bar; Escape
 * closes any sheet. Checked through the dev hook and the DOM, never pixels.
 */

test('gift, trade and swap work from the sticky bars', async ({ browser }) => {
  test.setTimeout(300_000); // two players, two map builds; CI renders in software
  const { lee, sam, samName, mapId, errors } = await twoTraders(browser, 'Bar Patch');
  await grantItems(lee, mapId, { timber: 9, stone: 14 });
  await grantSquishy(sam, mapId, 'pebblesnooze', 7);
  await grantItems(sam, mapId, { stone: 4 });

  await visitPost(lee);
  const post = lee.getByTestId('post');

  // ---- Trade: a grown stack, the strip, the popover, no confirm ---------------
  await post.getByTestId('post-tab-trade').tap();
  await post.getByTestId('post-give').getByRole('button', { name: /Stone/ }).tap();
  await expect(post.getByTestId('step-n-stone')).toContainText('of 14');
  await post.getByTestId('post-want').getByRole('button', { name: /Stone/ }).tap();
  await post.getByTestId('post-half-mine').getByTestId('post-pick').tap();
  await expect(post.getByTestId('post-strip-pop')).toBeVisible();
  await post.getByTestId('pop-up').tap();
  await expect(post.getByTestId('pop-count')).toContainText('2');
  // A tap anywhere else shuts the popover.
  await post.locator('#post-title').tap();
  await expect(post.getByTestId('post-strip-pop')).toHaveCount(0);
  await post.getByTestId('post-send').tap();
  // No confirm sheet: the other player's yes is the confirm.
  await expect(post.getByTestId('post-note')).toContainText('Sent!');
  await expect(post.locator('.post-confirm-layer')).toHaveCount(0);
  await expect.poll(async () => (await postState(lee))?.offersFromMe).toBe(1);
  // One offer at a time with the same mate: call it off to make room for the gift.
  await post.getByTestId('post-cancel').tap();
  await expect.poll(async () => (await postState(lee))?.offersFromMe).toBe(0);

  // ---- Gift: the chip, the strip, the picker, the confirm ---------------------
  await post.getByTestId('post-tab-gift').tap();
  // The recipient is in the bar, not a row at the top.
  await expect(post.getByTestId('post-to-chip')).toContainText(`To: ${samName}`);
  await expect(post.getByTestId('post-mate')).toHaveCount(0);
  await expect(post.getByTestId('post-send-gift')).toBeDisabled();
  await post
    .getByTestId('post-gift-pick')
    .getByRole('button', { name: /Timber/ })
    .tap();
  // A picked stack grows to a − N + of its own.
  await post.getByTestId('step-up-timber').tap();
  await post.getByTestId('step-up-timber').tap();
  await expect(post.getByTestId('step-n-timber')).toContainText('3');
  await expect(post.getByTestId('post-gift-sum')).toHaveText(`3 things for ${samName} 🎁`);
  await expect(post.getByTestId('post-gift-picks').getByTestId('post-pick')).toHaveCount(1);
  // Tap the pick in the strip: a popover with − N + and Remove.
  await post.getByTestId('post-pick').tap();
  await expect(post.getByTestId('post-strip-pop')).toBeVisible();
  await post.getByTestId('pop-up').tap();
  await expect(post.getByTestId('pop-count')).toContainText('4');
  await expect(post.getByTestId('post-gift-sum')).toHaveText(`4 things for ${samName} 🎁`);
  await post.getByTestId('pop-remove').tap();
  await expect(post.getByTestId('post-strip-pop')).toHaveCount(0);
  await expect.poll(async () => (await postState(lee))?.give).toBe(0);
  await expect(post.getByTestId('post-send-gift')).toBeDisabled();
  await post
    .getByTestId('post-gift-pick')
    .getByRole('button', { name: /Timber/ })
    .tap();
  await post.getByTestId('step-up-timber').tap();

  // "Who's it for?": a small sheet; Escape closes it, a tap on a name picks and closes.
  await post.getByTestId('post-to-chip').tap();
  const picker = post.getByTestId('post-mate-picker');
  await expect(picker).toContainText('Who’s it for? 🎁');
  await lee.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await post.getByTestId('post-to-chip').tap();
  await post.getByTestId('post-mate').filter({ hasText: samName }).tap();
  await expect(picker).toHaveCount(0);

  // Send gift asks first: Escape and "Not now" keep it; Send! sends it.
  await post.getByTestId('post-send-gift').tap();
  const confirm = post.getByTestId('post-gift-confirm');
  await expect(confirm).toContainText('Send this gift? 🎁');
  await expect(confirm).toContainText(`To ${samName}`);
  await expect(confirm).toContainText('Timber ×2');
  await expect(confirm).toContainText('You can take it back until then.');
  await expect(post.getByTestId('post-gift-confirm-yes')).toBeFocused();
  // Tab stays on the sheet.
  await lee.keyboard.press('Tab');
  await lee.keyboard.press('Tab');
  await lee.keyboard.press('Tab');
  await expect(confirm.locator(':focus')).toHaveCount(1);
  await lee.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect((await postState(lee))?.give).toBe(1);
  await post.getByTestId('post-send-gift').tap();
  await post.getByTestId('post-gift-confirm-no').tap();
  await expect(confirm).toHaveCount(0);
  await post.getByTestId('post-send-gift').tap();
  await post.getByTestId('post-gift-confirm-yes').tap();
  await expect(post.getByTestId('post-note')).toHaveText(
    `Gift sent! ${samName} can pick it up at any post. 🎁`,
  );

  // ---- Swap: the sticky bar ----------------------------------------------------
  await post.getByTestId('post-tab-swap').tap();
  await expect(post.getByTestId('post-swap-yes')).toBeDisabled();
  await post.getByTestId('post-swap-stone').tap();
  await expect(post.getByTestId('post-swap-sum')).toHaveText('10 Stone → 1 💎');
  await expect(post.getByTestId('post-swap-bar')).toContainText('3 swaps left today');
  await post.getByTestId('post-swap-yes').tap();
  await expect(post.getByTestId('post-swap-note')).toHaveText('Yay! 1 💎 Glimmer is in your bag!');
  await expect(post.getByTestId('post-swap-bar')).toContainText('2 swaps left today');

  // The bars' buttons clear the home-indicator inset (an iPhone 15's, which
  // Chromium can simulate; WebKit has no such switch).
  if (lee.context().browser()?.browserType().name() === 'chromium') {
    await grantItems(lee, mapId, { stone: 10 }); // the first swap used 10 of them
    // The swap tab reads the bag when it opens: leave it and come back.
    await post.getByTestId('post-tab-gift').tap();
    await post.getByTestId('post-tab-swap').tap();
    const cdp = await lee.context().newCDPSession(lee);
    const bottom = 34;
    await cdp.send(
      'Emulation.setSafeAreaInsetsOverride' as never,
      { insets: { top: 59, bottom, left: 0, right: 0 } } as never,
    );
    await lee.setViewportSize({ width: 393, height: 852 });
    const clears = async (testId: string) => {
      const box = await post.getByTestId(testId).boundingBox();
      expect(box, testId).not.toBeNull();
      expect(box!.y + box!.height, `${testId} clears the inset`).toBeLessThanOrEqual(852 - bottom);
    };
    await post.getByTestId('post-swap-stone').tap();
    await clears('post-swap-yes');
    await post.getByTestId('post-tab-gift').tap();
    await post
      .getByTestId('post-gift-pick')
      .getByRole('button', { name: /Timber/ })
      .tap();
    await clears('post-send-gift');
    await post.getByTestId('post-send-gift').tap();
    await clears('post-gift-confirm-yes');
    await clears('post-gift-confirm-no');
  }

  expect(errors).toEqual([]);
  await lee.context().close();
  await sam.context().close();
});
