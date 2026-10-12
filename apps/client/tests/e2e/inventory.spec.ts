import { findAvoidedWords } from '@heartpatch/shared';
import { expect, test, type Page } from '@playwright/test';
import { api, hook } from './dev-hook.js';
import { newPlayer, uniqueName, visitPatch } from './players.js';
import { closeRoster, openRoster } from './roster.js';
import { trayButton, traysState } from './trays.js';

/** The bag and the tile panel's gather action, from the dev hook (`InventoryDebug`). */
interface InventoryDebug {
  mapId: string;
  items: Record<string, number>;
  gathers: number;
  crafts: number;
  seasons: string[];
  bagOpen: boolean;
  tileAction: string | null;
  summary: {
    shown: 'banner' | 'pill' | null;
    chips: number;
    more: number;
    card: boolean;
    flying: number;
    flown: number;
  };
  bagNew: number;
  landings: number;
  fromTiles: number;
}

function bagState(page: Page): Promise<InventoryDebug | null> {
  return hook<InventoryDebug>(page, 'inventory');
}

/** A touch tap on the canvas as pointer events (as map.spec.ts does). */
async function tapCanvas(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('#game')!;
      for (const type of ['pointerdown', 'pointerup']) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    },
    { x, y },
  );
}

/**
 * Taps around the Heart Seed (where the camera starts) until the tile panel
 * offers "Gather": every home ring has Timber, Stone, Emberwood and a farm
 * plot (design doc §11), so one of the six neighbours is a node of ours.
 */
async function findOwnNode(page: Page): Promise<void> {
  const box = (await page.locator('#game').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (const radius of [40, 60, 80, 100, 130]) {
    for (let step = 0; step < 12; step++) {
      const angle = (step * Math.PI) / 6;
      await tapCanvas(page, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
      if ((await bagState(page))?.tileAction === 'gather') return;
    }
  }
  throw new Error('no node of ours near the Heart Seed');
}

test('gathers on an owned node and crafts a Heart Charm from the bag', async ({ browser }) => {
  // A full map build; CI renders in software. It took up to 108 s on iPad CI (and ran out of 120 s
  // twice in 8 runs), so the limit is twice that (#429).
  test.setTimeout(240_000);
  const page = await newPlayer(browser, uniqueName('bag'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('button', { name: 'Make a patch' }).tap();
  await lobby.getByLabel('Patch name').fill('Gathering Patch');
  await lobby.getByRole('button', { name: 'Make it!' }).tap();
  await visitPatch(lobby);
  await expect(lobby).toBeHidden();
  await expect
    .poll(
      async () => (await hook<{ tiles: number; selected: string | null }>(page, 'map'))?.tiles,
      {
        timeout: 30_000,
      },
    )
    .toBe(817); // a new 6-seat patch (#318)

  // The bag starts with just Sprout's Heart Charms from the first starter pick
  // (owner decision 2026-10-04), on the server's season (the dev server runs
  // on today's date).
  const state = await bagState(page);
  expect(state).toMatchObject({
    items: { 'heart-charm': 3 },
    gathers: 0,
    crafts: 0,
    bagOpen: false,
  });

  // Gather on one of our home nodes: the panel counts down on the server clock.
  await findOwnNode(page);
  const panel = page.getByTestId('tile-panel');
  await expect(panel.getByTestId('tile-panel-actions')).toContainText('Gives +');
  await panel.getByTestId('tile-gather').tap();
  await expect.poll(async () => (await bagState(page))?.gathers).toBe(1);
  expect((await bagState(page))?.tileAction).toBe('waiting');
  await expect(panel.getByTestId('tile-panel-actions')).toContainText('Gathering… ready in');
  await panel.getByRole('button', { name: 'Close' }).tap();

  // The bag shows the gather, and crafting uses items up front.
  await (await trayButton(page, 'bag-open')).tap();
  const bag = page.getByTestId('bag');
  await expect(bag).toBeVisible();
  // No Crafting Factory yet: no Factory strip, not even an empty bar.
  await expect(bag.getByTestId('factory-strip')).toBeHidden();
  // Nothing gathered yet: only Sprout's Heart Charms.
  await expect.poll(async () => (await bagState(page))?.items).toEqual({ 'heart-charm': 3 });
  await expect(bag.locator('[data-item="heart-charm"]')).toContainText('3');
  // Tapping an item says what it's for (#241); tapping it again closes the card.
  await bag.locator('[data-item="heart-charm"]').tap();
  await expect(bag.getByTestId('bag-detail')).toContainText('Helps befriend a wild squishy');
  await bag.locator('[data-item="heart-charm"]').tap();
  await expect(bag.getByTestId('bag-detail')).toBeHidden();
  await expect(bag.getByTestId('bag-gathers')).toContainText(/\d/);
  await bag.getByRole('button', { name: 'Get stuff (dev)' }).tap();
  await expect.poll(async () => (await bagState(page))?.items['timber']).toBe(10);
  await expect(bag.locator('[data-item="timber"]')).toContainText('10');

  await bag.locator('[data-recipe="heart-charm"]').tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  expect((await bagState(page))?.items['timber']).toBe(8);
  await expect(bag.getByTestId('bag-crafts')).toContainText('Making Heart Charm');
  await expect(bag.locator('[data-recipe-row="heart-charm"]')).toContainText(
    'Your pot is busy cooking!',
  );

  // Kid-friendly words only (style guide §9).
  const text = (await bag.textContent()) ?? '';
  expect(findAvoidedWords(text)).toEqual([]);
  await bag.getByRole('button', { name: 'Close' }).tap();
  await expect(bag).toBeHidden();

  // Both finish while the Bag is shut: what landed shows as a banner of chips
  // (#419), and as news on the My Home tab until the Bag is opened.
  const mapId = (await bagState(page))!.mapId;
  expect((await api(page, 'POST', `/maps/${mapId}/dev/gathers/ready`)).status).toBe(200);
  expect((await api(page, 'POST', `/maps/${mapId}/dev/crafts/ready`)).status).toBe(200);
  // Back the way a kid often is after hours away: iOS has closed the app, so
  // it starts afresh and lands back on the patch (#160).
  await page.reload();
  await expect(page.getByTestId('map-hud')).toBeVisible({ timeout: 60_000 });
  const banner = page.getByTestId('landed-toast');
  // Roomy: a fresh start's first settle is two round trips (the bag, then the
  // settle), each slow under a full run (up to 10 s apiece on a busy runner).
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText('Heart Charm');
  // With motion on, they flew in from the map: the gather's from its node
  // (even on a fresh start), the craft from home base.
  expect((await bagState(page))?.summary.flown).toBeGreaterThan(0);
  expect((await bagState(page))?.fromTiles).toBeGreaterThan(0);
  // Two kinds: the banner (not the one-thing pill), and a real tap opens the
  // card with everything: on a plain map it takes taps (shut trays don't count
  // as open sheets). The banner hides itself after a few seconds, so the tap
  // comes straight after the look.
  await expect(banner).not.toHaveClass(/away-one|away-quiet/);
  expect(await banner.evaluate((n) => getComputedStyle(n).pointerEvents)).not.toBe('none');
  await banner.tap();
  const card = page.getByTestId('away-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Heart Charm');
  expect(findAvoidedWords((await card.textContent()) ?? '')).toEqual([]);
  await card.getByRole('button', { name: 'Nice!' }).tap();
  await expect(card).toBeHidden();
  expect((await bagState(page))?.bagNew).toBeGreaterThan(0);
  await expect.poll(async () => (await traysState(page))?.badges.heartpatch).not.toBeNull();
  // A detour off the map (home base) and back keeps the news: it's this
  // patch's until the Bag is opened.
  await (await trayButton(page, 'home-open')).tap();
  await expect(page.getByTestId('map-hud')).toBeHidden({ timeout: 30_000 });
  await page.getByTestId('home').getByTestId('home-back').tap();
  await expect(page.getByTestId('map-hud')).toBeVisible({ timeout: 30_000 });
  // Roomy: the bag reads itself again once the map is back.
  await expect
    .poll(async () => (await bagState(page))?.bagNew, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('bag-new')).toHaveText(/^\+\d+$/);
  // Roomy: the trays read their news again once the map is back (a busy CI runner).
  await expect
    .poll(async () => (await traysState(page))?.badges.heartpatch, { timeout: 15_000 })
    .not.toBeNull();
  await (await trayButton(page, 'bag-open')).tap();
  await expect.poll(async () => (await bagState(page))?.bagNew).toBe(0);

  // Reduce Motion (#419): nothing flies in from the map; the one thing that
  // landed is just there, as a small pill.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bag.locator('[data-recipe="heart-charm"]').tap();
  await expect.poll(async () => (await bagState(page))?.crafts).toBe(1);
  await bag.getByRole('button', { name: 'Close' }).tap();
  await expect(bag).toBeHidden();
  const landed = (await bagState(page))!.landings;
  expect((await api(page, 'POST', `/maps/${mapId}/dev/crafts/ready`)).status).toBe(200);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Checked once it has landed, whether or not the pill has hidden itself again
  // (with no flight its few seconds start at once): it was the one-thing pill,
  // and nothing flew.
  await expect
    .poll(async () => (await bagState(page))?.landings, { timeout: 15_000 })
    .toBe(landed + 1);
  await expect(banner).toContainText('Heart Charm');
  await expect(banner).toHaveClass(/away-one/);
  expect((await bagState(page))?.summary.flying).toBe(0);
  await expect(page.locator('.away-flyer')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: null });

  // Leaving the map (here: Settings → Change Keeper, #42) takes the bag with it.
  await page.getByRole('button', { name: 'My patches' }).tap();
  await lobby.getByTestId('lobby-settings').tap();
  await lobby.getByTestId('keeper-settings').tap();
  await expect(page.getByTestId('keeper-picker')).toBeVisible();
  await expect.poll(() => bagState(page)).toBeNull();
  await expect(page.getByTestId('bag-open')).toBeHidden();
  expect(errors).toEqual([]);
});

/** The banner's modules as the dev server serves them, for the fit check below. */
interface BannerModules {
  summary: {
    summaryEntries: (
      landed: { items: Record<string, number> }[],
      trained: { name: string; xp: number; portrait?: string }[],
    ) => unknown[];
  };
  view: {
    createAwaySummary: (root: HTMLElement) => {
      show: (what: {
        entries: unknown[];
        sentence: string;
        away: boolean;
        from?: () => { x: number; y: number };
      }) => void;
      debug: { shown: string | null; chips: number; more: number; flown: number };
    };
  };
}

test('the "what landed" banner shows whole chips at the smallest width (#419)', async ({
  browser,
}) => {
  // Its own 320-point phone (an iPhone SE): resizing the iPad's page would keep
  // its 820-point screen, and `width=device-width` would lay out at 820.
  const { baseURL } = test.info().project.use;
  const phone = { width: 320, height: 568 };
  const context = await browser.newContext({
    viewport: phone,
    screen: phone,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    ...(baseURL ? { baseURL } : {}),
  });
  const page = await context.newPage();
  await page.goto('/');
  const { fits: results, cardFaces } = await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url) as Promise<unknown>;
    const m = {
      summary: await load('/src/inventory/away-summary.ts'),
      view: await load('/src/inventory/away-summary-view.ts'),
    } as BannerModules;
    const banner = m.view.createAwaySummary(document.body);
    const xp = [{ name: 'Glimmerock', xp: 2 }];
    const cases = {
      // Three things: XP, Timber and Stone fit on a 320-point iPhone, so no "N more".
      three: m.summary.summaryEntries([{ items: { timber: 5, stone: 3 } }], xp),
      // Ten kinds and four squishies: whole chips, the rest counted in "N more".
      ten: m.summary.summaryEntries(
        [
          {
            items: {
              timber: 6,
              stone: 3,
              emberwood: 4,
              glimmer: 1,
              water: 2,
              greens: 3,
              treats: 3,
              pumpkins: 5,
              'witch-dust': 2,
              ice: 1,
            },
          },
        ],
        [
          ...xp,
          { name: 'Emberbun', xp: 4 },
          { name: 'Puddlepuff', xp: 3 },
          { name: 'Pebblesnooze', xp: 1 },
        ],
      ),
    };
    // With their faces (#465): the training chip is wider, and chips stay whole.
    const face = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 52;
      const g = c.getContext('2d')!;
      g.fillStyle = '#9fd3f5';
      g.beginPath();
      g.arc(26, 28, 22, 0, Math.PI * 2);
      g.fill();
      return c.toDataURL();
    })();
    const faces = (list: { name: string; xp: number }[]) =>
      list.map((t) => ({ ...t, portrait: face }));
    Object.assign(cases, {
      threeFaces: m.summary.summaryEntries([{ items: { timber: 5, stone: 3 } }], faces(xp)),
      tenFaces: m.summary.summaryEntries(
        [{ items: { timber: 6, stone: 3, emberwood: 4, glimmer: 1, water: 2, greens: 3 } }],
        faces([
          ...xp,
          { name: 'Emberbun', xp: 4 },
          { name: 'Puddlepuff', xp: 3 },
          { name: 'Pebblesnooze', xp: 1 },
        ]),
      ),
    });
    const out: Record<
      string,
      {
        shown: string | null;
        chips: number;
        more: number;
        entries: number;
        cut: boolean;
        inside: boolean;
      }
    > = {};
    for (const [name, entries] of Object.entries(cases)) {
      banner.show({ entries, sentence: name, away: true });
      const row = [...document.querySelectorAll<HTMLElement>('.away-chips')].at(-1)!;
      const box = [...document.querySelectorAll<HTMLElement>('.away-banner')]
        .at(-1)!
        .getBoundingClientRect();
      out[name] = {
        ...banner.debug,
        entries: entries.length,
        cut: row.scrollWidth > row.clientWidth + 1,
        inside: box.left >= 0 && box.right <= innerWidth,
      };
    }
    // The card behind the last one (opened in code: this bare page's sign-up
    // sheet makes the banner only to read).
    [...document.querySelectorAll<HTMLElement>('.away-banner')].at(-1)!.click();
    const card = [...document.querySelectorAll<HTMLElement>('[data-testid="away-card"]')].at(-1)!;
    return {
      fits: out,
      cardFaces: card.querySelectorAll('.away-trained img.away-trained-face').length,
    };
  });
  expect(results['three']).toMatchObject({
    shown: 'banner',
    chips: 3,
    more: 0,
    entries: 3,
    cut: false,
    inside: true,
  });
  const ten = results['ten']!;
  expect(ten).toMatchObject({ shown: 'banner', entries: 11, cut: false, inside: true });
  expect(ten.more).toBeGreaterThan(0);
  expect(ten.chips + ten.more).toBe(ten.entries);
  for (const name of ['threeFaces', 'tenFaces']) {
    const r = results[name]!;
    expect(r, name).toMatchObject({ shown: 'banner', cut: false, inside: true });
    expect(r.chips + r.more, name).toBe(r.entries);
  }
  // Four trained with faces: three overlap in the chip, then how many ("🎯4").
  const chip = page.locator('.away-banner').last().locator('.away-chip-faces');
  await expect(chip.locator('img.away-face')).toHaveCount(3);
  await expect(chip).toContainText('🎯4');
  // The card: each trained squishy's row has its face.
  expect(cardFaces).toBe(4);

  // Sprout's first-visit tray hint is a dialog but no sheet: with it up, the
  // chips still fly and the banner takes taps. A real sheet open: nothing
  // flies across it, and the banner is only to read.
  const gate = await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url) as Promise<unknown>;
    const m = {
      summary: await load('/src/inventory/away-summary.ts'),
      view: await load('/src/inventory/away-summary-view.ts'),
    } as BannerModules;
    // From a bare map-less page: the sign-up sheet this page opens on is a real sheet.
    for (const d of document.querySelectorAll('[role="dialog"]')) d.remove();
    const banner = m.view.createAwaySummary(document.body);
    const entries = m.summary.summaryEntries([{ items: { timber: 5, stone: 3 } }], []);
    const node = () => [...document.querySelectorAll<HTMLElement>('.away-banner')].at(-1)!;
    const dialog = (className: string) => {
      const d = document.createElement('div');
      d.className = className;
      d.setAttribute('role', 'dialog');
      d.textContent = className;
      d.style.cssText = 'position:fixed;left:8px;bottom:8px;width:120px;height:60px';
      document.body.append(d);
      return d;
    };
    const land = () => {
      const before = banner.debug.flown;
      banner.show({ entries, sentence: 'x', away: false, from: () => ({ x: 160, y: 420 }) });
      return { flew: banner.debug.flown > before, quiet: node().classList.contains('away-quiet') };
    };
    const hint = dialog('tray-hint');
    const withHint = land();
    // The first chip lands right on its slot, though the banner was still
    // sliding up into place when the flight was set (CSS `away-in`).
    const flyer = document.querySelector<HTMLElement>('.away-flyer');
    const effect = flyer?.getAnimations()[0]?.effect;
    const last =
      effect instanceof KeyframeEffect ? effect.getKeyframes().at(-1)?.['transform'] : null;
    const flyerY = Number(/translate\([^,]+, ([-\d.]+)px\)/.exec(String(last))?.[1]);
    const flyerMid = flyerY + (flyer?.offsetHeight ?? 0) / 2;
    await new Promise((done) => window.setTimeout(done, 1500));
    const slot = node().querySelector('.away-chip')!.getBoundingClientRect();
    const landsOff = Math.abs(flyerMid - (slot.top + slot.height / 2));
    hint.remove();
    const sheet = dialog('chat-sheet');
    const withSheet = land();
    sheet.remove();
    return { withHint, withSheet, landsOff };
  });
  expect(gate.withHint).toEqual({ flew: true, quiet: false });
  expect(gate.withSheet).toEqual({ flew: false, quiet: true });
  expect(gate.landsOff).toBeLessThan(1.5);
  await context.close();
});

/**
 * Trained squishies land with their own faces (#465): the picture the roster
 * drew (#375) shows in the banner's XP chip, and beside its row in the card.
 */
test('a trained squishy lands with its own face (#465)', async ({ browser }) => {
  test.setTimeout(240_000); // a patch, a scene build and a portrait; CI renders in software
  const page = await newPlayer(browser, uniqueName('trained'));
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const lobby = page.getByTestId('lobby');
  // A Training Grounds on a ready homestead (dev route, as factory.spec.ts;
  // owner decision 4 on #277), made before the first visit. The dev route
  // needs free land two steps from home, which a few patches don't have:
  // then another patch.
  let made: { mapId: string; name: string; q: number; r: number } | null = null;
  for (let tries = 1; tries <= 4 && !made; tries++) {
    const name = `Training Patch ${String(tries)}`;
    const patch = await api<{ map: { id: string } }>(page, 'POST', '/maps', {
      name,
      timeZone: 'America/Chicago',
    });
    expect(patch.status).toBeLessThan(300);
    const mapId = patch.body.map.id;
    const plot = await api<{ q: number; r: number }>(page, 'POST', `/maps/${mapId}/dev/homestead`);
    if (plot.status === 201) made = { mapId, name, ...plot.body };
  }
  expect(made).not.toBeNull();
  const { mapId, name: patchName, q, r } = made!;
  const granted = await api(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 8, stone: 8 },
  });
  expect(granted.status).toBe(201);
  const built = await api(page, 'POST', `/maps/${mapId}/buildings`, {
    buildingId: 'training-grounds',
    q,
    r,
    spot: 1,
  });
  expect(built.status, JSON.stringify(built.body)).toBe(201);
  // The lobby reads its patches again, and this one is visited.
  await page.reload();
  await lobby.getByText(patchName).tap({ timeout: 30_000 });
  await visitPatch(lobby);
  await expect(lobby).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await bagState(page))?.mapId, { timeout: 30_000 }).toBe(mapId);
  // The starter trains there.
  const care = await api<{ squishies: { id: string }[] }>(page, 'GET', `/maps/${mapId}/care`);
  const pet = care.body.squishies[0]!.id;
  const job = await api(page, 'POST', `/maps/${mapId}/squishies/${pet}/job`, { job: 'training' });
  expect(job.status, JSON.stringify(job.body)).toBe(200);

  // The kid has seen it in the roster, so its picture is drawn and kept.
  await openRoster(page);
  await expect(page.locator('[data-testid="roster-portrait"][data-ready="true"]')).toHaveCount(1, {
    timeout: 60_000,
  });
  await closeRoster(page);

  // An hour of training while away, then back in the app.
  expect((await api(page, 'POST', `/maps/${mapId}/dev/mood/age`, { minutes: 60 })).status).toBe(
    200,
  );
  const landed = (await bagState(page))!.landings;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(async () => (await bagState(page))?.landings, { timeout: 15_000 })
    .toBe(landed + 1);
  const banner = page.getByTestId('landed-toast');
  await expect(banner).toContainText('trained');
  // One squishy, one thing: the pill, its face and its XP.
  await expect(banner).toHaveClass(/away-one/);
  await expect(banner.locator('img.away-face')).toHaveCount(1);
  await expect(banner.locator('.away-chip')).toContainText(/\+\d+ XP/);
  expect(errors).toEqual([]);
});
