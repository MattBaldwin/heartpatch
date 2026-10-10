import { expect, test, type Page } from '@playwright/test';
import { hook } from './dev-hook.js';
import { visitPatch } from './players.js';
import { grantSquishy, twoTraders } from './trading.js';

// Friendly battles (#29): two Keepers on one patch, each in their own
// browser. "Battle me?" → "Battle!", then a live battle played from both
// phones; a Keeper who steps away (iOS closes the socket) gets Sprout's help
// after the away-grace and comes back to the same battle; and a turn timer
// that runs out means Sprout picks, never a loss. The server runs with short
// live timings (playwright.config.ts: 20 s turns, 6 s grace).

interface LiveDebug {
  picked: boolean;
  theyPicked: boolean;
  secondsLeft: number | null;
  covered: number;
  note: string | null;
}

interface BattleDebug {
  id: string;
  status: 'active' | 'finished' | 'no-contest';
  turn: number;
  phase: 'turn' | 'replace' | 'over';
  pending: number;
  waiting: boolean;
  live: LiveDebug | null;
}

interface FriendlyDebug {
  mode: string;
  online: string[];
  incoming: string[];
  outgoing: string | null;
}

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');
const friendlyState = (page: Page) => hook<FriendlyDebug>(page, 'friendly');

/** Lee asks Sam "Battle me?" from the Friends sheet; Sam says "Battle!". Both end up in it. */
async function startFriendly(lee: Page, sam: Page, samName: string): Promise<string> {
  // The Friends button sits beside Chat, top right.
  await lee.getByTestId('friendly-open').tap();
  const row = lee.getByTestId('friendly-list').locator('li', { hasText: samName });
  // Sam's app is open on the patch: Sam shows as here.
  await expect(row.getByTestId('friendly-battle-me')).toBeVisible({ timeout: 20_000 });
  await row.getByTestId('friendly-battle-me').tap();
  await lee.getByTestId('friendly-ask-send').tap();
  await expect.poll(async () => (await friendlyState(lee))?.mode).toBe('waiting');

  const ask = sam.getByTestId('friendly-ask');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await expect(ask).toContainText('Battle me?');
  await ask.getByTestId('friendly-yes').tap();

  let id = '';
  for (const page of [lee, sam]) {
    await expect
      .poll(
        async () => (await battleState(page))?.live !== null && (await battleState(page)) !== null,
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    const state = (await battleState(page))!;
    if (id) expect(state.id).toBe(id);
    id = state.id;
  }
  await expect(lee.getByTestId('battle-live')).toBeVisible();
  return id;
}

/** A sturdy, evenly matched squishy for each Keeper: their strongest, so it fights. */
async function sturdyTeams(lee: Page, sam: Page, mapId: string): Promise<void> {
  for (const page of [lee, sam]) await grantSquishy(page, mapId, 'pebblesnooze', 30);
}

/** Picks a move this turn, trying again until the pick is in (the buttons show once playback settles). */
async function pickNow(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await playMyPart(page);
        return (await battleState(page))?.live?.picked;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
}

/** Plays my part of this turn if it's mine to play: a move, or sending someone out. */
async function playMyPart(page: Page): Promise<void> {
  const state = await battleState(page);
  if (!state || state.status !== 'active' || state.waiting || state.pending > 0) return;
  if (state.phase === 'replace') {
    const replace = page.getByTestId('battle-replace').first();
    if (await replace.isVisible()) await replace.tap();
    return;
  }
  if (state.live?.picked) return;
  const move = page.getByTestId('battle-move').first();
  if (await move.isVisible()) await move.tap();
}

test.describe('friendly battles (#29)', () => {
  // Each test brings its own two Keepers: side by side, so the file stays short.
  test.describe.configure({ mode: 'parallel' });
  test.setTimeout(300_000);

  test('Battle me? → Battle!, played live from two phones to the end', async ({ browser }) => {
    const { lee, sam, samName, mapId, errors } = await twoTraders(browser, 'Friendly Patch', {
      posts: false,
    });
    // Lee brings a much stronger friend, so the showdown is short.
    await grantSquishy(lee, mapId, 'emberbun', 40);
    await startFriendly(lee, sam, samName);

    // The turn timer counts down on both phones.
    for (const page of [lee, sam]) {
      await expect
        .poll(async () => (await battleState(page))?.live?.secondsLeft ?? 0)
        .toBeGreaterThan(0);
    }
    // A cheer while turn 0 is on: ids only, and the other phone shows it.
    await sam.getByTestId('battle-cheer').tap();
    await sam.getByTestId('battle-cheers').locator('[data-message="nice-move"]').tap();
    await expect(lee.locator('.battle-callout', { hasText: 'Nice move!' })).toBeVisible({
      timeout: 15_000,
    });

    // Lee picks first: Sam sees only that Lee picked.
    await pickNow(lee);
    await expect
      .poll(async () => (await battleState(sam))?.live?.theyPicked, { timeout: 15_000 })
      .toBe(true);
    await expect(sam.getByTestId('battle-live-chip')).toHaveText('Picked ✓');

    // Both play until it's over.
    await expect
      .poll(
        async () => {
          await playMyPart(lee);
          await playMyPart(sam);
          return (await battleState(sam))?.status;
        },
        { timeout: 120_000, intervals: [500] },
      )
      .toBe('finished');
    for (const page of [lee, sam]) {
      await expect(page.getByTestId('battle-result')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('battle-result')).toContainText('Friendly battles give no XP');
    }
    await expect(lee.getByTestId('battle-result')).toContainText(`You won against ${samName}`);
    expect(errors).toEqual([]);
  });

  test('stepping away: Sprout helps after the grace, and the battle is there on return', async ({
    browser,
  }) => {
    const { lee, sam, samName, mapId, errors } = await twoTraders(browser, 'Away Patch', {
      posts: false,
    });
    // Sturdy friends on both sides, so the showdown outlasts the time away.
    await sturdyTeams(lee, sam, mapId);
    await startFriendly(lee, sam, samName);

    // Sam's app goes to the background: the socket closes.
    const back = sam.url();
    await sam.goto('about:blank');
    await pickNow(lee);
    await expect(lee.getByTestId('battle-live-chip')).toContainText('Stepped away', {
      timeout: 15_000,
    });

    // The turn time (20 s) and the away-grace (6 s) run out: Sprout picks for Sam.
    await expect
      .poll(async () => (await battleState(lee))?.turn, { timeout: 45_000 })
      .toBeGreaterThan(0);
    expect((await battleState(lee))?.status).not.toBe('no-contest');

    // Sam comes back: the same battle, and Sprout says what it did.
    await sam.goto(back);
    // The app resumes the battle by itself, or opens on the lobby first.
    const lobby = sam.getByTestId('lobby');
    const patchButton = lobby.getByRole('button', { name: /Away Patch/ });
    await expect
      .poll(
        async () =>
          (await battleState(sam))?.live
            ? 'battle'
            : (await patchButton.isVisible())
              ? 'lobby'
              : null,
        { timeout: 60_000 },
      )
      .not.toBeNull();
    if (!(await battleState(sam))?.live) {
      await patchButton.tap();
      await visitPatch(lobby);
    }
    await expect
      .poll(async () => (await battleState(sam))?.live?.covered ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // "I picked once for you while you were away", or the latest "Time's up! I picked … for you".
    await expect(sam.getByTestId('battle-live-note')).toContainText('for you');
    // And Sam plays on: Sam's pick goes in, or a turn plays with it (Lee isn't
    // picking, so Lee's timer can play the turn the moment Sam's pick lands).
    const returned = (await battleState(sam))!;
    await expect
      .poll(
        async () => {
          await playMyPart(sam);
          const state = await battleState(sam);
          if (!state || state.status !== 'active' || state.live?.picked === true) return true;
          return state.turn > returned.turn && state.live?.covered === returned.live?.covered;
        },
        { timeout: 45_000, intervals: [500] },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("a turn timer that runs out: Sprout picks, and it's never a loss", async ({ browser }) => {
    const { lee, sam, samName, mapId, errors } = await twoTraders(browser, 'Timer Patch', {
      posts: false,
    });
    await sturdyTeams(lee, sam, mapId);
    await startFriendly(lee, sam, samName);

    // Sam picks; Lee, still here, doesn't.
    await pickNow(sam);
    await expect
      .poll(async () => (await battleState(lee))?.live?.covered ?? 0, { timeout: 45_000 })
      .toBeGreaterThan(0);
    await expect(lee.getByTestId('battle-live-note')).toContainText("Time's up! I picked");
    const state = await battleState(lee);
    // The turn played as a normal turn: no forfeit, still on (or over by the squishies).
    expect(state?.turn).toBeGreaterThan(0);
    expect(state?.status).not.toBe('no-contest');
    expect(errors).toEqual([]);
  });
});
