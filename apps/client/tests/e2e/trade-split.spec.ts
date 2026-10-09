import {
  findAvoidedWords,
  heartsOf,
  tradeBalance,
  tradeValuer,
  type ValuedLine,
} from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  grantItems,
  grantSquishy,
  namesClipped,
  postState,
  tilesSpill,
  twoTraders,
  visitPost,
  wordsSplit,
} from './trading.js';

/**
 * The split-view trade screen (#305, the owner-approved mockup, option A):
 * my shelf (mint) beside the patch-mate's (lilac), each with its own filter
 * and sort, the offer pinned at the bottom with the fairness meter, and the
 * same meter on the offer the patch-mate gets. The meter's expected reading
 * comes from the shared value functions, so tuning the values never breaks
 * this. Checked through the dev hook's signals and the DOM, never pixels.
 */

const emberbun: ValuedLine = { kind: 'squishy', speciesId: 'emberbun', level: 9 };
const pebblesnooze: ValuedLine = { kind: 'squishy', speciesId: 'pebblesnooze', level: 7 };
const stone = (quantity: number): ValuedLine => ({ kind: 'item', itemId: 'stone', quantity });
const charm = (quantity: number): ValuedLine => ({ kind: 'item', itemId: 'heart-charm', quantity });

/** What the meter should read for these picks, from my side. */
function expected(give: ValuedLine[], get: ValuedLine[]) {
  const giveValue = tradeValuer.sideValue(give);
  const getValue = tradeValuer.sideValue(get);
  return {
    ...tradeBalance(giveValue, getValue),
    give: heartsOf(giveValue),
    get: heartsOf(getValue),
  };
}

/** Buttons on the post screen smaller than 44 × 44 (style guide §3). */
function smallButtons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="post"] button')]
      .filter((b) => b.offsetParent !== null)
      .filter((b) => {
        const box = b.getBoundingClientRect();
        return box.height < 43.5 || box.width < 43.5;
      })
      .map((b) => b.getAttribute('data-testid') ?? b.textContent),
  );
}

test('trades in the split view: whose is whose, sort and filter per side, and the meter (#305)', async ({
  browser,
}) => {
  test.setTimeout(300_000); // two players, two map builds; CI renders in software
  const { lee, sam, leeName, samName, mapId, errors } = await twoTraders(browser, 'Split Patch');
  await grantSquishy(lee, mapId, 'emberbun', 9);
  await grantItems(lee, mapId, { timber: 3, greens: 2 });
  await grantSquishy(sam, mapId, 'pebblesnooze', 7);
  await grantItems(sam, mapId, { stone: 4, 'heart-charm': 2 });

  await visitPost(lee);
  const post = lee.getByTestId('post');
  const mine = post.locator('[data-side="mine"]');
  const theirs = post.locator('[data-side="theirs"]');
  const give = post.getByTestId('post-give');
  const want = post.getByTestId('post-want');
  // Each owner has a header with their name, so whose is whose is plain.
  await expect(mine).toContainText(leeName);
  await expect(mine).toContainText('Your things');
  await expect(theirs).toContainText(samName);
  await expect(theirs).toContainText('Their things');
  await expect(want).toContainText('Pebblesnooze');
  // The strip is always there, both directions, even before a pick.
  await expect(post.getByTestId('post-strip')).toBeVisible();
  await expect(post.getByTestId('post-half-mine')).toContainText('Tap your things');
  await expect(post.getByTestId('post-half-theirs')).toContainText(`Tap ${samName}’s things`);
  await expect(post.getByTestId('post-meter-label')).toHaveText('Pick something on each side!');

  // My side shows only items; theirs still shows everything.
  await post.getByTestId('shelf-mine-filter').tap();
  await post.getByTestId('shelf-mine-filter-items').tap();
  await expect(give).toContainText('Timber');
  await expect(give).not.toContainText('Emberbun');
  await expect(want).toContainText('Pebblesnooze');
  // Their side sorted rarest first: by what one of each is worth.
  await post.getByTestId('shelf-theirs-sort').tap();
  await post.getByTestId('shelf-theirs-sort-rarity').tap();
  const rarest = [
    { name: 'Pebblesnooze', worth: tradeValuer.lineValue(pebblesnooze) },
    { name: 'Heart Charm', worth: tradeValuer.lineValue(charm(1)) },
    { name: 'Stone', worth: tradeValuer.lineValue(stone(1)) },
  ].sort((a, b) => b.worth - a.worth);
  const order = (await want.locator('button').allTextContents()).map(
    (t) => rarest.find((r) => t.includes(r.name))?.name,
  );
  expect(order.filter(Boolean)).toEqual(rarest.map((r) => r.name));
  expect(await postState(lee)).toMatchObject({
    filters: { mine: 'items', theirs: 'all' },
    sorts: { mine: 'name', theirs: 'rarity' },
  });

  // Emberbun for one Stone: lopsided toward Sam, so a friendly nudge shows.
  await post.getByTestId('shelf-mine-filter').tap();
  await post.getByTestId('shelf-mine-filter-all').tap();
  await give.getByRole('button', { name: /Emberbun/ }).tap();
  await want.getByRole('button', { name: /Stone/ }).tap();
  const lopsided = expected([emberbun], [stone(1)]);
  expect(lopsided, 'these picks should be lopsided').toMatchObject({ tip: 'them', lopsided: true });
  const meter = post.getByTestId('post-meter');
  await expect(meter).toHaveAttribute('data-tip', 'them');
  await expect(meter).toHaveAttribute('data-lopsided', 'true');
  await expect(post.getByTestId('post-hearts-give')).toHaveAttribute(
    'data-hearts',
    String(lopsided.give),
  );
  await expect(post.getByTestId('post-hearts-get')).toHaveAttribute(
    'data-hearts',
    String(lopsided.get),
  );
  await expect(post.getByTestId('post-meter-label')).toHaveText(`Way more for ${samName}`);
  await expect(post.getByTestId('post-meter-say')).toContainText('Want to ask for more?');
  // The nudge never blocks: "Send offer" still works. Its shortcut shows their shelf.
  await expect(post.getByTestId('post-send')).toBeEnabled();
  await post.getByTestId('post-nudge').tap();
  await expect(theirs).toHaveClass(/post-flash/);
  // The offer strip and "Send offer" stay on screen while picking.
  await expect(post.getByTestId('post-strip')).toBeInViewport();
  await expect(post.getByTestId('post-send')).toBeInViewport();

  // Ask for Pebblesnooze too: the meter moves live.
  await want.getByRole('button', { name: /Pebblesnooze/ }).tap();
  const now = expected([emberbun], [stone(1), pebblesnooze]);
  await expect(meter).toHaveAttribute('data-tip', now.tip);
  await expect(meter).toHaveAttribute('data-lopsided', String(now.lopsided));
  const label = {
    none: 'Pick something on each side!',
    even: 'Fair trade! 💛',
    me: now.lopsided ? 'Way more for you' : 'Tips toward you',
    them: now.lopsided ? `Way more for ${samName}` : `Tips toward ${samName}`,
  }[now.tip];
  await expect(post.getByTestId('post-meter-label')).toHaveText(label);
  expect((await postState(lee))!.meter).toEqual(now);

  // Scrolled, each owner's header stays pinned flush with the sheet's top: nothing peeks above it.
  await post.evaluate((sheet) => {
    sheet.scrollTop = sheet.scrollHeight;
  });
  const pinned = await post.evaluate((sheet) => {
    const top = sheet.getBoundingClientRect().top;
    const heads = [...sheet.querySelectorAll<HTMLElement>('.post-col-head')];
    return {
      scrolled: sheet.scrollTop > 0,
      gaps: heads.map((h) => Math.round(h.getBoundingClientRect().top - top)),
    };
  });
  if (pinned.scrolled) expect(pinned.gaps.every((g) => g >= 0 && g <= 1)).toBe(true);
  // The filter's word fits whole beside the sort, even on a phone's half-width column.
  const tools = await post.evaluate((sheet) =>
    [...sheet.querySelectorAll<HTMLElement>('.post-tool')].map((b) => {
      const text = b.querySelector<HTMLElement>('.post-tool-text');
      const shown = text !== null && getComputedStyle(text).display !== 'none';
      return { clipped: shown && text.scrollWidth > text.clientWidth + 1, width: b.offsetWidth };
    }),
  );
  expect(tools.filter((t) => t.clipped || t.width < 44)).toEqual([]);

  // Kid-sized and tidy: 44pt buttons, whole names, nothing spilling out.
  expect(await smallButtons(lee)).toEqual([]);
  expect(await wordsSplit(lee)).toEqual([]);
  expect(await namesClipped(lee)).toEqual([]);
  expect(await tilesSpill(lee)).toEqual([]);
  expect(findAvoidedWords((await post.textContent()) ?? '')).toEqual([]);
  // Hearts only: the meter never shows a number (an item's "×2" is how many, not a value).
  const strip = (await post.getByTestId('post-strip').textContent()) ?? '';
  expect(strip.replace(/×\d+/g, '')).not.toMatch(/\d/);

  await post.getByTestId('post-send').tap();
  await expect(post.getByTestId('post-note')).toHaveText(
    `Sent! ${samName} will see it at a trading post. 💌`,
  );
  // Each side's filter and sort stay while the screen is open.
  expect((await postState(lee))!.sorts.theirs).toBe('rarity');

  // Sam sees the same meter on the offer, from Sam's side.
  await visitPost(sam);
  const offer = sam.getByTestId('post').getByTestId('post-offer-in');
  await expect(offer).toContainText(`${leeName} wants to trade!`);
  await expect(offer).toContainText('Emberbun');
  const mirror = { none: 'none', even: 'even', me: 'them', them: 'me' }[now.tip];
  const samMeter = offer.getByTestId('post-meter');
  await expect(samMeter).toHaveAttribute('data-tip', mirror);
  await expect(samMeter).toHaveAttribute('data-lopsided', String(now.lopsided));
  await expect(offer.getByTestId('post-nudge')).toHaveCount(0);
  // While an offer waits, my own compose area folds behind a button so nothing covers it.
  const samPost = sam.getByTestId('post');
  await expect(samPost.getByTestId('post-give')).toHaveCount(0);
  await samPost.getByTestId('post-compose').tap();
  await expect(samPost.getByTestId('post-give')).toBeVisible();
  await expect(offer).toBeVisible();
  await expect(offer.getByTestId('post-hearts-get')).toHaveAttribute(
    'data-hearts',
    String(now.give),
  );

  expect(errors).toEqual([]);
  await lee.context().close();
  await sam.context().close();
});
