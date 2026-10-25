/* global process, console, window */
// Captures the Keeper in the real editor (#657) for the owner to judge: the
// body step, at iPhone 15 and iPhone SE sizes, a few bodies, outfits and skins,
// and the Keeper in the world (the map's Heart Seed Keeper through the dev gallery).
// Dev tooling only: needs the server (`pnpm dev`) running; BASE is the client
// (default http://localhost:5173), SIGNUP the family code (default from .env).
// Writes PNGs and captures.json to OUT (default .keeper-shots).
//
// Honest captures (#335): every shot pins its tier (`?tier=`, governor off) and
// the file name and record say which. Headless Chromium draws with SwiftShader.
// Safe-area insets are emulated (Chromium `Emulation.setSafeAreaInsetsOverride`).
// Same state for both phones: the script is one fixed list of picks.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.keeper-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const TIER = process.env.TIER ?? 'high';
const LABEL = process.env.LABEL ?? 'after';
const SIGNUP = process.env.SIGNUP ?? process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const DEVICES = {
  iphone15: { width: 393, height: 852, dpr: 3, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  se: { width: 375, height: 667, dpr: 2, insets: { top: 20, bottom: 0, left: 0, right: 0 } },
};
const only = (key, all) => (process.env[key] ? process.env[key].split(',') : all);
const devices = only('DEVICES', Object.keys(DEVICES));
/** VIEWS: editor (the body step states) and world (the Keeper in the house, kid height). */
const views = only('VIEWS', ['editor', 'world']);

/** Fixed states: [file slug, caption, taps in order]. The same list runs on every phone. */
const STATES = [
  [
    'little-pumpkin',
    'Little body, Pumpkin outfit, light skin',
    ['Body: Little', 'Outfit: Pumpkin', 'Skin tone 2'],
  ],
  [
    'lanky-blueberry',
    'Lanky body, Blueberry outfit, tan skin',
    ['Body: Lanky', 'Outfit: Blueberry', 'Skin tone 6'],
  ],
  [
    'cuddly-strawberry',
    'Cuddly body, Strawberry outfit, deep skin',
    ['Body: Cuddly', 'Outfit: Strawberry', 'Skin tone 10'],
  ],
  [
    'sturdy-meadow',
    'Sturdy body, Meadow outfit, warm skin',
    ['Body: Sturdy', 'Outfit: Meadow', 'Skin tone 4'],
  ],
];

const captures = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
for (const name of devices) {
  const d = DEVICES[name];
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.insets });
  if (views.includes('world')) {
    // The Keeper in the world: the dev house gallery (no server), walked in to kid height.
    await page.goto(`${BASE}/house.html?level=1&tier=${TIER}&still=1&minute=720`);
    const ready = () => window.__heartpatch?.house?.()?.scene && window.__heartpatch.draws() > 0;
    await page.waitForFunction(ready, null, { timeout: 120_000 });
    await page.getByTestId('house-walk').click();
    await page.waitForFunction(() => window.__heartpatch.house()?.pose === 'kid', null, {
      timeout: 120_000,
    });
    await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
    await page.waitForTimeout(4000);
    const file = `${LABEL}-${name}-house-kid-${TIER}.png`;
    await page.screenshot({ path: path.join(OUT, file), timeout: 240_000 });
    captures.push({
      file,
      device: name,
      tier: TIER,
      label: LABEL,
      caption: 'The Keeper in the house, at kid height',
      view: 'world',
    });
    console.log('shot', file);
  }
  if (!views.includes('editor')) {
    await context.close();
    continue;
  }
  await page.goto(`${BASE}/?tier=${TIER}`);
  await page.addStyleTag({ content: '.dev-status { display: none !important; }' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP);
  await overlay.getByLabel('Pick a name').fill(`shot${Date.now().toString(36)}`.slice(0, 14));
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  const done = overlay.getByTestId('auth-code-done');
  await done.waitFor();
  await overlay.getByText("I've saved it").tap();
  await done.tap();
  const picker = page.getByTestId('keeper-picker');
  await picker.waitFor({ timeout: 30_000 });
  const tabs = picker.getByRole('tab');
  const tap = (n) => picker.getByRole('button', { name: n, exact: true }).tap();
  const wanted = only(
    'STATES',
    STATES.map(([slug]) => slug),
  );
  for (const [slug, caption, taps] of STATES.filter(([slug]) => wanted.includes(slug))) {
    await tabs.nth(1).tap(); // body and outfit
    await page.waitForTimeout(300);
    await tap(taps[0]);
    await tap(taps[1]);
    await tabs.nth(2).tap(); // skin
    await tap(taps[2]);
    await tabs.nth(5).tap(); // face details: the step in the owner's screenshot
    await page.waitForTimeout(2500); // the preview redraws on demand
    const file = `${LABEL}-${name}-${slug}-${TIER}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    captures.push({ file, device: name, tier: TIER, label: LABEL, caption, view: 'editor' });
    console.log('shot', file);
  }
  await context.close();
}
await browser.close();
await writeFile(path.join(OUT, `captures-${LABEL}.json`), JSON.stringify(captures, null, 2));
