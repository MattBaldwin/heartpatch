import type { Page } from '@playwright/test';
import { expect, test } from './test.js';
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
      team: { top: number; bottom: number; head: number | null }[];
      rise: number;
      teamFeet: number | null;
      bossFacing: number | null;
    } | null;
    playing: { kind: string; at: number } | null;
  } | null;
  entrance: { at: number; skippable: boolean } | null;
  boss: {
    picking: number | null;
    picks: Record<string, string>;
    asks: number;
    warmth: number;
    recounts: number;
  } | null;
}

/** `BOSS_ENTRANCE.clickGraceMs`: how long the click after a skipping tap's lift is swallowed. */
const CLICK_GRACE_MS = 350;

const battleState = (page: Page) => hook<BattleDebug>(page, 'battle');

/** Moves the held battle clock on (`BattleScreen.dev`, `?battle-clock=manual`), as rare-reveal.spec.ts. */
async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((step) => {
    const hook = (window as { __heartpatch?: { battleDev?: () => unknown } }).__heartpatch;
    const dev = hook?.battleDev?.() as { advance: (ms: number) => void } | null | undefined;
    if (!dev) throw new Error('no held battle clock: open the page with ?battle-clock=manual');
    dev.advance(step);
  }, ms);
}

async function bossFight(
  page: Page,
  options: BossStubOptions & { entrance?: 'keep'; clock?: 'manual' } = {},
) {
  if (options.clock === 'manual') await page.goto('/?battle-clock=manual');
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
  await expect(page.getByTestId('boss-strip')).toBeVisible({ timeout: 30_000 });
  if (options.entrance !== 'keep') await entranceOver(page);
  return stub;
}

/** The BIG squishy's entrance (#190 PR 3) comes up, plays its 2.6 s and goes. */
async function entranceOver(page: Page): Promise<void> {
  await expect.poll(async () => (await battleState(page))?.entrance != null).toBe(true);
  await expect
    .poll(async () => (await battleState(page))?.entrance ?? null, { timeout: 10_000 })
    .toBeNull();
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

/** A HUD box: tops and bottoms as fractions of the height, the rest in px. */
type Box = { top: number; bottom: number; left: number; right: number; width: number };

test.describe('a mini-boss fight (#190)', () => {
  test.describe.configure({ timeout: 180_000 });
  test('won and befriended: three squishies, the picker, the bundle, two asks', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { befriend: ['not-yet', 'joined'] });

    // The phone-first boss HUD (#190 PR 1): the boss on the strip, three team
    // chips on the handle, four squishies drawn. The tries and "here until"
    // stay off the fight (the result card has the tries).
    await expect(page.getByTestId('boss-friends').locator('.boss-friend')).toHaveCount(3);
    await expect(page.getByTestId('boss-name')).not.toBeEmpty();
    await expect(page.getByTestId('boss-tries')).toHaveCount(0);
    await expect(page.getByTestId('boss-until')).toHaveCount(0);
    await expect(page.getByTestId('boss-round')).toHaveText('Round 1');
    await expect.poll(async () => (await battleState(page))?.scene?.squishies).toBe(4);
    // The 1-v-1 pills step aside.
    await expect(page.getByTestId('battle-plate-mine')).toBeHidden();

    // Picker A1: the first squishy picks first (its chip raised); a tap on
    // its chip once picked goes back. The picker has no team row of its own.
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(0);
    await expect(page.getByTestId('boss-friend-0')).toHaveAttribute('data-status', 'picking');
    await expect(page.getByTestId('boss-picker').locator('.boss-step')).toHaveCount(0);
    await realTap(page.getByTestId('boss-move').first());
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(1);
    await expect(page.getByTestId('boss-friend-0')).toHaveAttribute('data-status', 'picked');
    await realTap(page.getByTestId('boss-friend-0'));
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
    // Round 1: the charge. Nothing lands; the strip's chip slot shows ⏳.
    await playRound(page);
    await expect(winding).toBeVisible();
    await expect(winding).toHaveAttribute('aria-label', '⏳ Winding up…');
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

  test('each BIG squishy signature plays its moment: counts, a shout and backup (#190 PR 5)', async ({
    browser,
  }) => {
    test.setTimeout(240_000); // four rounds of software-GL playback
    const page = await newPlayer(browser, uniqueName('stomp'));
    await bossFight(page, {
      // The drift's skid has no sticker: signature-fx.test.ts and the captures cover it.
      openRounds: 4,
      tricks: ['windup', 'land', 'shout', 'assist'],
      signatures: true,
    });
    // Every sticker and caption the screen shows, and the most particles alive at once.
    await page.evaluate(() => {
      const w = window as unknown as {
        hpSeen: string[];
        hpPeak: number;
        __heartpatch?: {
          battle?: () => { scene?: { effects?: { live: number } } | null } | null;
        };
      };
      w.hpSeen = [];
      w.hpPeak = 0;
      const note = (selector: string) => {
        const text = document.querySelector(selector)?.textContent ?? '';
        if (text && !w.hpSeen.includes(text)) w.hpSeen.push(text);
      };
      new MutationObserver(() => {
        note('[data-testid="battle-caption"]');
        note('[data-testid="boss-callout"]');
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
      const peak = () => {
        w.hpPeak = Math.max(w.hpPeak, w.__heartpatch?.battle?.()?.scene?.effects?.live ?? 0);
        requestAnimationFrame(peak);
      };
      requestAnimationFrame(peak);
    });
    const seen = () => page.evaluate(() => (window as unknown as { hpSeen: string[] }).hpSeen);
    for (let round = 2; round <= 5; round++) {
      await playRound(page);
      await expect(page.getByTestId('boss-round')).toHaveText(`Round ${String(round)}`, {
        timeout: 30_000,
      });
    }
    // Count to Three counts out loud, then lands on "3!" (in place of "Here it comes!").
    await expect.poll(seen).toEqual(expect.arrayContaining(['1…', '2…', '3!']));
    expect(await seen()).not.toContain('Here it comes!');
    // Ask Your Mother calls for backup, and the friend comes in.
    expect(await seen()).toEqual(expect.arrayContaining(['Backup!', 'Backup! Mama Bear Charge!']));
    // The shout's flinch.
    expect((await seen()).some((t) => t.includes('flinched'))).toBe(true);
    // The leaf pile really drew (the pools' caps are unit-tested: a full pool reuses its oldest).
    const peak = await page.evaluate(() => (window as unknown as { hpPeak: number }).hpPeak);
    expect(peak).toBeGreaterThanOrEqual(60);
  });

  test('on a notched iPhone the stage gets the screen: a tall band, the boss face in it (#190, #868)', async ({
    browser,
    browserName,
  }) => {
    // An iPhone 15's full screen as an installed app (393×852). Chromium also
    // gets the notch's safe-area insets (only it can emulate them, over CDP);
    // the WebKit projects run the same size with no insets. Every assert
    // below holds in both: the band is measured from the HUD's own boxes, and
    // its floor (0.70) is met with the insets (~0.73) and without (~0.87).
    const page = await newPlayer(browser, uniqueName('notch'));
    const insets = browserName === 'chromium';
    if (insets) {
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
    // A windup round, a round where it lands, then the win: the boss's beats (#868).
    // Its stomp lands "Super cozy!" on the middle friend and "Just a little
    // boop." on the right one: their callouts pop while the caption shows.
    await bossFight(page, {
      openRounds: 2,
      tricks: ['windup', 'land'],
      stompTiers: ['normal', 'super', 'weak'],
    });
    await expect(page.getByTestId('boss-picker')).toBeVisible();
    // Copies of battle-config's tunables (the e2e tsconfig can't import src);
    // the asserts below are unconditional, so a TUNE change fails here, loudly.
    const MAX_FIT = 70; // BATTLE_CAMERA.maxFitDistance
    const MIN_BAND = 0.7; // the plan's floor for BOSS_HUD's rest band
    const LOW_TEAM = 0.55; // TUNE mirror: BATTLE_CAMERA.boss puts the team's mouths ≈ 0.78 down the band
    const BOSS_FIT = 50; // BATTLE_CAMERA.boss at rest on 393×852: 45–48 (camera-director.test.ts)
    const MIN_BAR = 120; // BOSS_HUD.minBar
    const FACING_MIN = 0.3; // BATTLE_CAMERA.faceFacingMin
    const EPS = 0.005;
    await expect
      .poll(async () => (await battleState(page))?.scene?.framing?.distance ?? Infinity, {
        timeout: 15_000,
      })
      .toBeLessThanOrEqual(MAX_FIT);

    /**
     * The first frame of a round with the sheet down and no rise or drop (a
     * 220 ms slide) running: the HUD's boxes as fractions of the height (px
     * for widths), and the hook's framing, read together. Boxes read
     * mid-slide would sit between the two places; looping animations don't
     * count. One in-page wait at frame speed, from Go: the polls' backoff
     * plus a separate read let round 1 end first on WebKit CI, and the
     * handle was read rising with the next picker.
     */
    type Framing = NonNullable<NonNullable<BattleDebug['scene']>['framing']>;
    interface CollapsedFrame {
      framing: Framing;
      boxes: {
        strip: Box | null;
        bar: Box | null;
        slot: Box | null;
        order: Box | null;
        handle: Box | null;
        close: Box | null;
        chips: (Box | null)[];
        width: number;
      };
    }
    const collapsedFrame = () =>
      page.evaluate(
        (minBand) =>
          new Promise<CollapsedFrame>((resolve) => {
            type Hook = { __heartpatch?: { battle?: () => BattleDebug | null } };
            const read = () => {
              const scene = (window as unknown as Hook).__heartpatch?.battle?.()?.scene;
              const picker = document.querySelector('[data-testid="boss-picker"]');
              const busy = document
                .getAnimations()
                .some(
                  (a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity,
                );
              const f = scene?.framing;
              if (
                busy ||
                !scene?.playing ||
                !f ||
                f.band.bottom - f.band.top < minBand ||
                !(picker instanceof HTMLElement && picker.hidden)
              ) {
                requestAnimationFrame(read);
                return;
              }
              const h = window.innerHeight;
              const box = (selector: string) => {
                const node = document.querySelector(selector);
                if (!(node instanceof HTMLElement) || node.offsetParent === null) return null;
                const r = node.getBoundingClientRect();
                return {
                  top: r.top / h,
                  bottom: r.bottom / h,
                  left: r.left,
                  right: r.right,
                  width: r.width,
                };
              };
              resolve({
                framing: f,
                boxes: {
                  strip: box('[data-testid="boss-strip"]'),
                  bar: box('[data-testid="boss-energy"]'),
                  slot: box('[data-testid="boss-windup"]'),
                  order: box('[data-testid="boss-order"]'),
                  handle: box('[data-testid="boss-handle"]'),
                  close: box('.battle-top > .hp-close'),
                  chips: [0, 1, 2].map((i) => box(`[data-testid="boss-friend-${String(i)}"]`)),
                  width: window.innerWidth,
                },
              });
            };
            requestAnimationFrame(read);
          }),
        MIN_BAND,
      );

    // Collapsed (a round playing), the band runs from under the strip to the
    // handle: the plan's rest band. Go, then measure while the round plays.
    const frame = collapsedFrame();
    await playRound(page);
    const { framing, boxes } = await frame;
    const band = framing.band;
    const where = `band ${JSON.stringify(band)} hud ${JSON.stringify(boxes)}`;
    // The boss stands about 10 past the aim: it and its ground stay inside the
    // dome and short of the fog's end.
    expect(framing.distance + 10, where).toBeLessThan(95); // ARENA_STAGE.skyRadius
    expect(framing.distance + 10, where).toBeLessThan(framing.fogEnd);
    // The band is the HUD's own: under the strip, above the handle.
    expect(boxes.strip, where).not.toBeNull();
    expect(boxes.handle, where).not.toBeNull();
    expect(band.top, where).toBeGreaterThanOrEqual(boxes.strip!.bottom - EPS);
    expect(band.bottom, where).toBeLessThanOrEqual(boxes.handle!.top + EPS);
    // No piece of the HUD overlaps the band (the ✕ moved up into the strip's
    // row; the callouts and caption are stickers, which come and go).
    for (const [name, b] of [
      ['strip', boxes.strip],
      ['close', boxes.close],
    ] as const) {
      expect(b, `${name} ${where}`).not.toBeNull();
      expect(b!.bottom, `${name} ${where}`).toBeLessThanOrEqual(band.top + EPS);
    }
    // The three team chips are on screen, on the handle, under the band.
    for (const chip of boxes.chips) {
      expect(chip, where).not.toBeNull();
      expect(chip!.top, where).toBeGreaterThanOrEqual(band.bottom - EPS);
      expect(chip!.bottom, where).toBeLessThanOrEqual(1 + EPS);
      expect(chip!.width, where).toBeGreaterThanOrEqual(44);
    }
    // The strip fits at 393 px (the M0 finding): the bar keeps its width,
    // the ✕ sits beside the strip, nothing runs off the screen.
    expect(boxes.bar!.width, where).toBeGreaterThanOrEqual(MIN_BAR);
    expect(boxes.close!.left, where).toBeGreaterThanOrEqual(boxes.strip!.right);
    expect(boxes.close!.right, where).toBeLessThanOrEqual(boxes.width);
    expect(boxes.order!.right, where).toBeLessThanOrEqual(boxes.strip!.right);

    // Through the boss's windup and its blows (#868): every frame the hook
    // reports, the boss's face is in the band whenever it faces the camera,
    // and the team is reported. Nothing fades any more.
    await page.evaluate(() => {
      type Hook = { __heartpatch?: { battle?: () => BattleDebug | null } };
      const samples: unknown[] = [];
      (window as unknown as { hpFraming: unknown[] }).hpFraming = samples;
      const result = document.querySelector('[data-testid="battle-result"]');
      const slot = document.querySelector('[data-testid="boss-windup"]');
      const bar = document.querySelector('[data-testid="boss-energy"]');
      const picker = document.querySelector('[data-testid="boss-picker"]');
      const sheet = document.querySelector('[data-testid="battle-sheet"]');
      const handle = document.querySelector('[data-testid="boss-handle"]');
      const caption = document.querySelector('[data-testid="battle-caption"]');
      // Frames that show a caption pill and a friend's callout at once (#190
      // render-check): their rects, and whether they meet.
      const stacked: { overlap: boolean; at: string }[] = [];
      (window as unknown as { hpStacked: typeof stacked }).hpStacked = stacked;
      // Frames since the picker went (Go!): Go! drops the sheet and clears
      // the HUD's safe-region cache at once (`forgetLayout`, #190).
      let hiddenFor = 0;
      const sample = () => {
        const scene = (window as unknown as Hook).__heartpatch?.battle?.()?.scene;
        const shown = result instanceof HTMLElement && result.offsetParent !== null;
        // A round playing with the sheet collapsed: the step clock can still
        // name the last step for a moment after the next picker has risen.
        const collapsed = picker instanceof HTMLElement && picker.hidden;
        hiddenFor = collapsed ? hiddenFor + 1 : 0;
        if (scene?.framing && scene.playing && !shown && collapsed) {
          const h = window.innerHeight;
          // The collapsed handle's top from layout, less BOSS_HUD.handleClear (8):
          // where the band ends once the HUD has measured the dropped sheet.
          const expected =
            sheet instanceof HTMLElement && handle instanceof HTMLElement
              ? (h - sheet.offsetHeight + handle.offsetTop - 8) / h
              : NaN;
          samples.push({
            kind: scene.playing.kind,
            framing: scene.framing,
            windup: slot instanceof HTMLElement && !slot.hidden,
            slotRight: slot?.getBoundingClientRect().right ?? 0,
            barWidth: bar?.getBoundingClientRect().width ?? 0,
            hiddenFor,
            expected,
          });
        }
        const pill = caption instanceof HTMLElement ? caption.getBoundingClientRect() : null;
        if (pill && pill.height > 0) {
          for (const node of document.querySelectorAll('.boss-callout-small')) {
            if (!(node instanceof HTMLElement) || node.hidden) continue;
            const r = node.getBoundingClientRect();
            if (r.height === 0) continue;
            const overlap =
              r.left < pill.right &&
              pill.left < r.right &&
              r.top < pill.bottom &&
              pill.top < r.bottom;
            stacked.push({
              overlap,
              at: `${node.textContent} ${JSON.stringify(r)} over "${caption?.textContent ?? ''}" ${JSON.stringify(pill)}`,
            });
          }
        }
        if (samples.length < 20_000) requestAnimationFrame(afterDraw);
      };
      // Read after the frame's draw: a task posted from rAF runs once every
      // rAF callback of that frame (the stage's render among them) has run,
      // so the hook's framing is this frame's, whatever order rAF calls in.
      function afterDraw() {
        setTimeout(sample, 0);
      }
      requestAnimationFrame(afterDraw);
    });
    await expect(page.getByTestId('boss-round')).toHaveText('Round 2', { timeout: 30_000 });
    // Round 1 was the windup: the ⏳ shows in the strip's slot, whole.
    await expect(page.getByTestId('boss-windup')).toBeVisible();
    await playRound(page);
    await expect(page.getByTestId('boss-round')).toHaveText('Round 3', { timeout: 30_000 });
    type Sample = {
      kind: string;
      framing: NonNullable<NonNullable<BattleDebug['scene']>['framing']>;
      windup: boolean;
      slotRight: number;
      barWidth: number;
      hiddenFor: number;
      expected: number;
    };
    const samples = await page.evaluate(
      () => (window as unknown as { hpFraming: Sample[] }).hpFraming,
    );
    expect(samples.length).toBeGreaterThan(20);
    const stripRight = boxes.strip!.right;
    // No grace after Go!: the very first frame drawn with the picker gone
    // frames the dropped sheet. Before `forgetLayout` that frame still had
    // the Ready step's risen band (~0.65) until the ResizeObserver, after
    // rAF, cleared it (round 2's CI failure on 22a0782).
    const GRACE = 0;
    const settled = samples.filter((x) => x.hiddenFor > GRACE);
    expect(settled.length).toBeGreaterThan(20);
    for (const { framing: f, kind, windup, slotRight, barWidth, hiddenFor, expected } of settled) {
      const at = `${kind} +${String(hiddenFor)}f expected ${String(expected)} ${JSON.stringify(f)}`;
      // The band ends at the collapsed handle: the HUD measured the dropped
      // sheet, not the Ready step's risen one. Holds with and without the
      // insets (WebKit CI: no insets, ~0.85; Chromium here: notched, ~0.73).
      expect(Math.abs(f.band.bottom - expected), at).toBeLessThanOrEqual(EPS);
      // The #868 fade's fields are gone from the hook.
      expect(Object.keys(f).sort(), at).toEqual([
        'band',
        'bossFacing',
        'distance',
        'face',
        'fogEnd',
        'rise',
        'team',
        'teamFeet',
      ]);
      // The team's bodies stand over the band's bottom (#190 PR 2), not under the sheet.
      if (f.teamFeet !== null) expect(f.teamFeet, at).toBeLessThanOrEqual(f.band.bottom + 0.005);
      // Collapsed, the band holds its height through the round (#855): nothing in the HUD moves.
      expect(f.band.bottom - f.band.top, at).toBeGreaterThanOrEqual(MIN_BAND);
      // (A little slack: the hook reads the facing a frame after the camera did.)
      if (f.face && (f.bossFacing ?? 1) >= FACING_MIN + 0.05) {
        expect(f.face.top, at).toBeGreaterThanOrEqual(f.band.top - EPS);
        expect(f.face.bottom, at).toBeLessThanOrEqual(f.band.bottom + EPS);
      }
      // A boss turned away is never reported as a framed face.
      if ((f.bossFacing ?? 1) < FACING_MIN - 0.05) expect(f.face, at).toBeNull();
      expect(f.team.length, at).toBeGreaterThan(0);
      // The low hero shot (#190 PR 2): the team stands low in the band, no
      // empty floor under it (M0), and a push-in only lowers it further.
      // Holds with and without the insets: a share of the band, not a row.
      const lowest = Math.max(...f.team.map((t) => t.bottom));
      expect(lowest, at).toBeGreaterThanOrEqual(
        f.band.top + LOW_TEAM * (f.band.bottom - f.band.top),
      );
      // The row's width sets the distance: never back at the old team camera's 52+.
      expect(f.distance, at).toBeLessThanOrEqual(BOSS_FIT);
      // The ⏳ never clips and never squeezes the bar.
      expect(barWidth, at).toBeGreaterThanOrEqual(MIN_BAR);
      if (windup) expect(slotRight, at).toBeLessThanOrEqual(stripRight + 0.5);
    }
    // A friend's callout never covers the caption pill (it stacks above it).
    const stacked = await page.evaluate(
      () => (window as unknown as { hpStacked: { overlap: boolean; at: string }[] }).hpStacked,
    );
    expect(
      stacked.length,
      'a caption and a friend callout were on screen together',
    ).toBeGreaterThan(0);
    for (const { overlap, at } of stacked) expect(overlap, at).toBe(false);
    // Both the windup's power-up and the blows were seen, the ⏳ up for some of them.
    const seen = (k: string) => samples.filter((x) => x.kind === k);
    expect(seen('effect').length).toBeGreaterThan(0);
    expect(seen('hit').length).toBeGreaterThan(0);
    expect(samples.some((x) => x.windup)).toBe(true);

    // And the stage band draws a scene, not one flat colour. Chromium only:
    // headless WebKit screenshots of the WebGL canvas come out flat (one
    // colour) whatever it draws.
    if (browserName !== 'chromium') return;
    await expect(page.getByTestId('boss-picker')).toBeVisible();
    const top = await page
      .getByTestId('boss-strip')
      .evaluate((e) => e.getBoundingClientRect().bottom);
    // Under the strip, clear of the stickers' slot: the boss and its ground.
    const shot = await page.screenshot({
      clip: { x: 0, y: top + 120, width: 393, height: 60 },
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

  test('with the picker up the sheet rises and the stage band sits above it (#190)', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('rise'));
    await page.setViewportSize({ width: 393, height: 852 });
    await bossFight(page, { openRounds: 1 });
    await expect(page.getByTestId('boss-picker')).toBeVisible();
    // Risen: the band ends above the sheet's handle (the chips ride its top),
    // and the picker shows under the chips with no team row of its own.
    await expect
      .poll(
        async () => {
          const f = (await battleState(page))?.scene?.framing;
          const handle = await page
            .getByTestId('boss-handle')
            .evaluate((e) => e.getBoundingClientRect().top / window.innerHeight);
          return f ? Math.abs(f.band.bottom - (handle - 8 / 852)) : 1;
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(0.01);
    const f = (await battleState(page))!.scene!.framing!;
    expect(f.band.bottom, JSON.stringify(f.band)).toBeLessThan(0.75);
    expect(f.band.bottom - f.band.top, JSON.stringify(f.band)).toBeGreaterThan(0.4);
    const fits = () =>
      page
        .getByTestId('boss-picker')
        .evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
    const sheetHeight = () =>
      page.getByTestId('battle-sheet').evaluate((e) => (e as HTMLElement).offsetHeight);
    // The picker fits the risen sheet without scrolling on this phone.
    let picker = await fits();
    expect(picker.scroll).toBeLessThanOrEqual(picker.client + 1);
    // One height for every step: a move step and Ready are the same, so the
    // band holds still while picking.
    const first = await sheetHeight();
    for (let i = 0; i < 3; i++) await realTap(page.getByTestId('boss-move').first());
    await expect(page.getByTestId('boss-go')).toBeVisible();
    expect(await sheetHeight()).toBe(first);
    // A short phone (an iPhone SE) gives the picker more of its height: the
    // moves still fit without scrolling.
    await page.setViewportSize({ width: 375, height: 667 });
    await realTap(page.getByTestId('boss-change'));
    await expect(page.getByTestId('boss-pick-header')).toBeVisible();
    await expect.poll(async () => (await sheetHeight()) / 667).toBeGreaterThan(0.45);
    picker = await fits();
    expect(picker.scroll, JSON.stringify(picker)).toBeLessThanOrEqual(picker.client + 1);
    // A long fight's label still clears the centred chips at 375 px: "Round 10"
    // and up (two digits, the widest a visit's fight reaches) sits left of the first chip.
    const room = await page.evaluate(() => {
      const round = document.querySelector('[data-testid="boss-round"]');
      const chip = document.querySelector('[data-testid="boss-friend-0"]');
      if (!(round instanceof HTMLElement) || !(chip instanceof HTMLElement)) return null;
      round.textContent = 'Round 10';
      const r = round.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      return { roundRight: r.right, chipLeft: c.left, gap: c.left - r.right };
    });
    expect(room, 'round label and chips').not.toBeNull();
    expect(room!.gap, JSON.stringify(room)).toBeGreaterThanOrEqual(4);
  });

  test('the BIG squishy arrives: a tap waits for the stomp, then skips without picking (#190 PR 3)', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    // The battle clock held (`?battle-clock=manual`), so the 2.6 s entrance waits for each step.
    await bossFight(page, { entrance: 'keep', clock: 'manual' });
    const layer = page.locator('.boss-entrance');
    await expect(layer).toBeVisible();
    await expect.poll(async () => (await battleState(page))?.entrance?.at ?? null).toBe(0);
    // The picker is drawn under the layer (the band never moves); a real tap on a
    // move before the stomp lands does nothing at all.
    const move = page.getByTestId('boss-picker').getByRole('button').first();
    await realTap(move);
    expect((await battleState(page))?.entrance?.skippable).toBe(false);
    await expect(layer).toBeVisible();
    expect((await battleState(page))?.boss?.picks).toEqual({});
    // Past the stomp: the skip pill is up, the card in, clear of the boss face and the team.
    await advance(page, 1200);
    expect((await battleState(page))?.entrance?.skippable).toBe(true);
    await expect(page.locator('.boss-entrance-skip')).toHaveText('Tap to skip');
    const card = page.locator('.boss-entrance-card');
    await expect(card).toContainText('A BIG squishy!');
    await expect(card).toHaveCSS('opacity', '1');
    const box = await card.boundingBox();
    const framing = (await battleState(page))?.scene?.framing;
    const h = page.viewportSize()?.height ?? 1;
    expect(box && framing).toBeTruthy();
    if (box && framing) {
      const off = (f: { top: number; bottom: number }) =>
        box.y + box.height <= f.top * h || box.y >= f.bottom * h;
      expect(framing.face ? off(framing.face) : true).toBe(true);
      expect(framing.team.every(off)).toBe(true);
      expect(box.y).toBeGreaterThanOrEqual(framing.band.top * h);
      expect(box.y + box.height).toBeLessThanOrEqual(framing.band.bottom * h);
    }
    // A finger tap on the same move skips: the entrance goes, and the click the
    // browser sends after the touch (at the move, now uncovered) is swallowed
    // rather than picking it. A touch, not a mouse: that click is what iOS sends.
    const at = await move.boundingBox();
    expect(at).toBeTruthy();
    if (at) await page.touchscreen.tap(at.x + at.width / 2, at.y + at.height / 2);
    await expect.poll(async () => (await battleState(page))?.entrance ?? null).toBeNull();
    await expect(layer).toHaveCount(0);
    const after = await battleState(page);
    expect(after?.boss?.picking).toBe(0);
    expect(after?.boss?.picks).toEqual({});
    // Past the click's grace window, the picker is the player's again (#890: it was
    // only covered before; now it is inert while the entrance plays and free after).
    await page.waitForTimeout(CLICK_GRACE_MS + 150);
    await expect(page.locator('.boss-dock')).toHaveJSProperty('inert', false);
    await realTap(move);
    await expect.poll(async () => (await battleState(page))?.boss?.picking).toBe(1);
  });

  test('the picker is inert while the entrance plays (#190 PR 6)', async ({ browser }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    await bossFight(page, { entrance: 'keep', clock: 'manual' });
    await expect(page.locator('.boss-entrance')).toBeVisible();
    const dock = page.locator('.boss-dock');
    await expect(dock).toHaveJSProperty('inert', true);
    await advance(page, 3000);
    await expect.poll(async () => (await battleState(page))?.entrance ?? null).toBeNull();
    await expect(dock).toHaveJSProperty('inert', false);
  });

  /** Records every caption the fight shows (each step's words are up for under a second). */
  async function recordCaptions(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __captions: string[] }).__captions = seen;
      const watch = () => {
        const node = document.querySelector('.battle-caption');
        if (!node) return;
        const text = node.textContent;
        if (text && seen[seen.length - 1] !== text) seen.push(text);
      };
      new MutationObserver(watch).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    return () =>
      page.evaluate(() => (window as unknown as { __captions: string[] }).__captions.slice());
  }

  test('the BIG squishy tuckers out, and an ask is answered with hearts and a sparkle (#190 PR 6)', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    const stub = await bossFight(page, { befriend: ['not-yet', 'joined'], warmth: 4 });
    const captions = await recordCaptions(page);
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    expect((await captions()).some((c) => /is all tuckered out! 💤$/.test(c))).toBe(true);
    // A "not yet": a blush and no sparkle, and no number or odds anywhere on the card.
    await realTap(card.getByTestId('boss-ask'));
    await expect(page.locator('.befriend-blush')).toHaveCount(1);
    await expect(page.locator('.befriend-dim')).toHaveCount(0);
    await expect(card.getByTestId('boss-befriend-ask')).toContainText('A little warmer');
    expect(await card.getByTestId('boss-befriend-ask').innerText()).not.toMatch(
      /\d+\s*%|odds|chance/i,
    );
    // A yes: the dim and sparkles where the BIG squishy shrinks, then it joins.
    await realTap(card.getByTestId('boss-ask'));
    await expect(page.locator('.befriend-dim')).toHaveCount(1);
    await expect(card.getByTestId('boss-befriend-joined')).toContainText(
      `${STUB_BASE_NAME} joined your patch! 💗`,
    );
    expect(stub.asks).toHaveLength(2);
    await expect(page.locator('.befriend-beat')).toHaveCount(0, { timeout: 5000 });
  });

  test('the team tuckers out: the BIG squishy twirls, and the caption names the day (#190 PR 6)', async ({
    browser,
  }) => {
    const page = await newPlayer(browser, uniqueName('stomp'));
    await bossFight(page, { outcome: 'lost', triesLeftToday: 1 });
    const captions = await recordCaptions(page);
    await playRound(page);
    const card = page.getByTestId('battle-result');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const all = await captions();
    expect(all).toContainEqual(
      expect.stringMatching(
        /^Your team is all tuckered out! .+ is here until [A-Z][a-z]+day\. Come back stronger!$/,
      ),
    );
    const line = all.find((c) => /Come back stronger!$/.test(c)) ?? '';
    // Nothing is taken: the usual loss card follows (its tries line is the stub's).
    await expect(card.locator('#battle-result-title')).toBeVisible();
    expect(line).not.toMatch(/lost|took|failed/i);
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
