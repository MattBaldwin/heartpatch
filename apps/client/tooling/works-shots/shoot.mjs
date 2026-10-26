/* global process, console, window, document, setTimeout, fetch, crypto, MutationObserver */
// Wild Isle works (#621 W1-10), from the real client: the buildings gallery and
// the game. Dev tooling only: `node tooling/works-shots/shoot.mjs` with the dev
// servers running (`pnpm dev`, HP_WILD_ISLE=on, HP_DEV_SQUISHY_GRANTS=true).
// PNGs and `captions.json` go to `OUT` (default: the OS temp dir).
//
// One shared state: the script signs up one player, makes a Wild Isle, asks
// the dev route for homesteads next to home and builds a works on each one
// whose water suits it (the server judges), keeping the first inland one
// empty for the Build sheet. Every device (iPhone 15, iPhone SE, iPad) then
// signs in as that player at tier `high` and its own DPR. Shots, per device:
// `gallery-works`, `gallery-works-asleep`, `zoom-seawall` (the Seawall at map
// zoom), `gallery-wild`, `gallery-well` (the River Well at levels 1–4),
// `build-sheet` (a held-back card picked, its reason showing) and `homestead`
// (the pier standing on its homestead).
// No dev badge, no "(dev)" buttons. Env: DEVICES, PW_CHROMIUM_EXECUTABLE.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = process.env.OUT ?? path.join(os.tmpdir(), 'works-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const PASSWORD = 'squishy-secret';
const PATCH = 'Pier Cove';
const TIER = 'high';
const DEVICES = {
  'iphone-15': {
    label: 'iPhone 15',
    width: 393,
    height: 852,
    dpr: 3,
    dist: 34,
    wellDist: 28,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  'iphone-se': {
    label: 'iPhone SE',
    width: 375,
    height: 667,
    dpr: 2,
    dist: 32,
    wellDist: 27,
    insets: { top: 20, bottom: 0, left: 0, right: 0 },
  },
  ipad: {
    label: 'iPad',
    width: 1080,
    height: 810,
    dpr: 2,
    dist: 18,
    wellDist: 15,
    insets: { top: 24, bottom: 20, left: 0, right: 0 },
  },
};
/**
 * The patch keeps its maker's time zone (the lobby sends the device's): one
 * where it is about 1 pm now, so the map is in daylight whenever this runs.
 */
const ZONES = [
  'Pacific/Kiritimati',
  'Pacific/Auckland',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/Athens',
  'Europe/London',
  'Atlantic/Azores',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Pacific/Honolulu',
];
const hourIn = (zone) =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', timeZone: zone, hourCycle: 'h23' }).format(
      new Date(),
    ),
  );
const DAY_ZONE = ZONES.reduce((best, z) =>
  Math.abs(hourIn(z) - 13) < Math.abs(hourIn(best) - 13) ? z : best,
);
const WANT = (process.env.DEVICES ?? Object.keys(DEVICES).join(',')).split(',');
/** What each homestead gets, first fit wins (the server says which water suits). */
const TRY = ['fishing-pier', 'watermill', 'salt-pans', 'river-well', 'irrigated-field'];
/** Then the ones that need no water, on homesteads inland. */
const DRY = ['rain-barrel', 'weather-vane'];
/** The shelters, tried after the works on a homestead by the right water. */
const SHELTERS = ['seawall', 'levee'];
/** Close-ups on iPhone SE, one building each (`?show=solo:<id>`). */
const CLOSE = [
  'fishing-pier',
  'salt-pans',
  'watermill',
  'irrigated-field',
  'rain-barrel',
  'river-well',
  'greenhouse',
  'canal',
  'levee',
  'seawall',
  'weather-vane',
  'waystation',
];

const until = async (page, fn, arg, timeout = 180_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** A name the server's text filter accepts: consonant+vowel syllables. */
function playerName() {
  const c = 'bdlmrvz';
  const v = 'aeiou';
  let t = Date.now();
  let s = 'wk_';
  for (let i = 0; i < 3; i++) {
    s += c[t % c.length] + v[Math.floor(t / 7) % v.length];
    t = Math.floor(t / 35);
  }
  return s;
}

const call = (page, method, url, body) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(`/api/v1${url}`, {
        method,
        headers: {
          'x-requested-with': 'heartpatch',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { method, url, body },
  );

async function signUp(page, name) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP_CODE);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill(PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click();
  await overlay.getByTestId('auth-code-done').click();
  await call(page, 'POST', '/cinematic/seen');
  await page.reload({ waitUntil: 'load' });
  const picker = page.getByTestId('keeper-picker');
  await picker.waitFor({ timeout: 60_000 });
  await picker.getByRole('button', { name: 'Face: Apple', exact: true }).click();
  await picker.getByRole('tab', { name: 'Details' }).click();
  await picker.getByRole('button', { name: 'That’s me!' }).click();
  const lobby = page.getByTestId('lobby');
  await lobby.getByRole('heading', { name: 'Your patches' }).waitFor({ timeout: 60_000 });
  await lobby.getByRole('button', { name: 'Make a patch' }).click();
  await lobby.getByTestId('lobby-patch-type-wild-isle').click();
  await lobby.getByLabel('Patch name').fill(PATCH);
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).waitFor();
  const maps = await call(page, 'GET', '/maps');
  return maps.body.maps.find((m) => m.name === PATCH).id;
}

/** Homesteads with a works on each, and one left empty by the water for the Build sheet. */
async function buildUp(page, mapId) {
  await call(page, 'POST', `/maps/${mapId}/dev/items`, {
    items: { timber: 600, stone: 600, glimmer: 40 },
  });
  const built = [];
  let empty = null;
  const place = async (id, at, spot = 1) => {
    const res = await call(page, 'POST', `/maps/${mapId}/buildings`, {
      buildingId: id,
      q: at.q,
      r: at.r,
      spot,
    });
    const ok = res.status === 200 || res.status === 201;
    if (ok) built.push({ id, q: at.q, r: at.r, spot });
    else console.log('  no', id, res.status, res.body?.error?.message);
    return ok;
  };
  for (let i = 0; i < 8; i++) {
    const made = await call(page, 'POST', `/maps/${mapId}/dev/homestead`);
    if (made.status !== 201) break;
    const at = made.body;
    let placed = false;
    // One building per tile, so the shelters take a homestead of their own
    const order = [...TRY, ...SHELTERS];
    for (const id of order.filter((t) => !built.some((b) => b.id === t))) {
      if ((placed = await place(id, at))) break;
    }
    if (placed) continue;
    // The first homestead no water works fits stays empty: its Build sheet holds them back.
    if (!empty) empty = at;
    else
      for (const id of DRY.filter((t) => !built.some((b) => b.id === t))) {
        if (await place(id, at)) break;
      }
  }
  return { built, empty };
}

async function openMap(page) {
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  const lobby = page.getByTestId('lobby');
  await until(page, () => window.__heartpatch?.map?.()?.tiles > 0, undefined, 30_000).catch(
    async () => {
      await lobby.getByRole('button', { name: new RegExp(PATCH) }).click();
      await lobby.getByRole('button', { name: 'Visit patch' }).click();
      await until(page, () => window.__heartpatch?.map?.()?.tiles > 0);
    },
  );
  await until(page, () => document.querySelector('canvas[data-ready="true"]') !== null);
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.addStyleTag({
    content: '[aria-labelledby="night-nudge-title"]{display:none!important}',
  });
  await page.waitForTimeout(1200);
}

async function settle(page) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + 2);
  let last = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(600);
    const now = JSON.stringify(await page.evaluate(() => window.__heartpatch?.camera?.()));
    if (now === last) break;
    last = now;
  }
  await page.waitForTimeout(400);
}

/**
 * Controls that reach into the notch or home-indicator band: what a frame's
 * caption may say about the safe areas.
 */
const inBands = (page, insets) =>
  page.evaluate((insets) => {
    const h = window.innerHeight;
    return [...document.querySelectorAll('button,[role="button"],h1,h2,header,nav')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        const st = window.getComputedStyle(e);
        if (b.width === 0 || b.height === 0 || st.visibility === 'hidden') return false;
        return (
          (insets.top > 0 && b.top < insets.top) ||
          (insets.bottom > 0 && b.bottom > h - insets.bottom)
        );
      })
      .map((e) => {
        const b = e.getBoundingClientRect();
        const label = (e.getAttribute('aria-label') || e.textContent || e.tagName)
          .trim()
          .slice(0, 30);
        return `${label} [${Math.round(b.top)}–${Math.round(b.bottom)}]`;
      });
  }, insets);

/** What the frame shows, so a bad one is loud and the caption is true. */
const facts = (page) =>
  page.evaluate(() => {
    const text = document.body.innerText;
    return {
      dev:
        /\(dev\)|Reconnecting/.test(text) ||
        [...document.querySelectorAll('.dev-status,.dev-stats-stack')].some(
          (e) => e.getBoundingClientRect().width > 0,
        ),
      tier: window.__heartpatch?.quality?.()?.tier ?? null,
      detail: document.querySelector('[data-testid="build-detail"]')?.textContent ?? null,
      note: document.querySelector('[data-testid="tile-build-note"]')?.textContent ?? null,
    };
  });

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE }
    : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const setup = await browser.newContext({
  viewport: { width: 393, height: 852 },
  timezoneId: DAY_ZONE,
});
console.log('time zone', DAY_ZONE, hourIn(DAY_ZONE));
const first = await setup.newPage();
const name = playerName();
const mapId = await signUp(first, name);
const state = await buildUp(first, mapId);
console.log('built', JSON.stringify(state));
if (!state.built.some((b) => b.id === 'fishing-pier')) throw new Error('no pier went up');
// Visit the patch once and pick a starter, so every device lands on the map.
await first.goto(`${BASE}/`, { waitUntil: 'load' });
await first
  .getByTestId('lobby')
  .getByRole('button', { name: new RegExp(PATCH) })
  .click();
await first.getByTestId('lobby').getByRole('button', { name: 'Visit patch' }).click();
const starter = first.getByTestId('starter-picker');
await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 90_000 });
await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
await until(first, () => window.__heartpatch?.map?.()?.tiles > 0);
const storage = await setup.storageState();
await setup.close();

const captions = [];
for (const key of WANT) {
  const d = DEVICES[key];
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: key !== 'ipad',
    hasTouch: true,
    storageState: storage,
    timezoneId: DAY_ZONE,
  });
  await context.addInitScript(() => {
    // No dev-only UI in a picture: the server badge, the stats stack, any "(dev)" button.
    const style = document.createElement('style');
    style.textContent = '.dev-status,.dev-stats-stack{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    new MutationObserver(() => {
      for (const b of document.querySelectorAll('button'))
        if (/\(dev\)/i.test(b.textContent)) b.hidden = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const page = await context.newPage();
  // The device's safe areas (the notch and home indicator), as roads-shots does.
  const cdp = await context.newCDPSession(page);
  const insetsOn = await cdp
    .send('Emulation.setSafeAreaInsetsOverride', { insets: d.insets })
    .then(() => true)
    .catch(() => {
      console.warn('safe-area emulation unavailable on this Chromium');
      return false;
    });
  const shot = async (id, caption, extra = {}) => {
    const file = `${key}-${id}.png`;
    const seen = await facts(page);
    if (seen.dev) throw new Error(`${file}: dev UI or "Reconnecting…" on screen`);
    extra = { insetsOn, inBands: await inBands(page, d.insets), ...extra };
    await page.screenshot({ path: path.join(OUT, file) });
    captions.push({
      file,
      device: d.label,
      caption: `${d.label} · tier ${TIER} · ${caption}`,
      ...extra,
    });
    console.log('shot', file);
  };

  // The gallery: the real home-base scene with sample buildings.
  const gallery = async (query, id, caption) => {
    await page.goto(`${BASE}/buildings.html?quality=${TIER}&${query}`, { waitUntil: 'load' });
    await until(page, () => window.__buildingGallery?.ready());
    await page.waitForTimeout(1500);
    const tier = await page.evaluate(() => window.__buildingGallery?.quality()?.tier ?? null);
    await shot(id, caption, { tier });
  };
  // The Seawall at map zoom on the home-base scene: no homestead reliably
  // lands on the coast in a dev run, so this stands in for a map frame.
  await gallery(
    `show=solo:seawall&focus=0,-1&dist=${d.dist}`,
    'zoom-seawall',
    `Buildings gallery at map zoom (dist ${d.dist}): the Seawall, level 1`,
  );
  await gallery(
    `show=works&dist=${d.dist}`,
    'gallery-works',
    'Buildings gallery: Fishing Pier, Salt Pans, Watermill, Irrigated Field, Rain Barrel and Water Well (River Well) at level 1, lamps lit',
  );
  await gallery(
    `show=works&asleep=1&dist=${d.dist}`,
    'gallery-works-asleep',
    'Buildings gallery: the same six works napping, lamps dark',
  );
  await gallery(
    `show=wild&dist=${d.dist}`,
    'gallery-wild',
    'Buildings gallery: Canal, Levee, Seawall, Weather Vane and Waystation',
  );
  await gallery(
    `show=res:river-well&dist=${d.wellDist}`,
    'gallery-well',
    'Buildings gallery: the Water Well (River Well) at levels 1 to 4',
  );
  await gallery(
    `show=res:greenhouse&dist=${d.wellDist}`,
    'gallery-greenhouse',
    'Buildings gallery: the Greenhouse at levels 1 to 4',
  );
  if (key === 'iphone-se') {
    for (const id of CLOSE) {
      await gallery(
        `show=solo:${id}&focus=0,-1&dist=8`,
        `close-${id}`,
        `Buildings gallery close-up: ${id}, level 1`,
      );
    }
    await gallery(
      `show=solo:watermill&asleep=1&focus=0,-1&dist=8`,
      'close-watermill-asleep',
      'Buildings gallery close-up: watermill, level 1, napping',
    );
  }

  // The game: the pier standing on its homestead.
  await openMap(page);
  const pier = state.built.find((b) => b.id === 'fishing-pier');
  await page.evaluate(({ q, r }) => window.__heartpatch.mapDev().show(q, r), pier);
  await settle(page);
  // Its tile panel closed (a works has no card of its own yet) and the camera in close.
  await page.getByTestId('tile-panel').getByRole('button', { name: 'Close' }).click();
  const box = await page.locator('#game').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
  }
  await settle(page);
  await shot(
    'homestead',
    'Map, zoomed in: the Fishing Pier standing on a Wild Isle homestead by the water',
  );

  // Where the water-bound ones stand: each built on a real homestead, so the
  // server let it (the Watermill needs a river, the Salt Pans and Seawall
  // the sea, the Field any water next door).
  const WHERE = {
    watermill:
      'the Watermill on a homestead the server let it build on (it needs a river next door)',
    'salt-pans':
      'the Salt Pans on a homestead the server let them build on (they need the sea next door)',
    seawall: 'the Seawall on a homestead the server let it build on (it needs the sea next door)',
    'irrigated-field':
      'the Irrigated Field on a homestead the server let it build on (it needs water next door)',
  };
  for (const [id, words] of Object.entries(WHERE)) {
    const b = state.built.find((x) => x.id === id);
    if (!b) {
      console.log('  no map shot for', id, '(no homestead fit it this run)');
      continue;
    }
    await page.evaluate(({ q, r }) => window.__heartpatch.mapDev().show(q, r), b);
    await settle(page);
    const close = page.getByTestId('tile-panel').getByRole('button', { name: 'Close' });
    if (await close.isVisible().catch(() => false)) await close.click();
    await settle(page);
    await shot(`map-${id}`, `Map, zoomed in: ${words}`);
  }

  // The Build sheet on an empty homestead, a held-back card picked.
  const empty = state.empty;
  if (!empty) throw new Error('no empty homestead');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
  }
  await page.evaluate(({ q, r }) => window.__heartpatch.mapDev().show(q, r), empty);
  await settle(page);
  await page.getByTestId('tile-build').click();
  await page.waitForTimeout(800);
  const held = page.locator('[data-testid="build-card"][aria-disabled="true"]').first();
  if (await held.count()) await held.click({ force: true });
  await page.waitForTimeout(600);
  const f = await facts(page);
  await shot(
    'build-sheet',
    `Build sheet on a Wild Isle homestead: a held-back card picked, it says "${f.detail ?? ''}"`,
    f,
  );
  await context.close();
}
await writeFile(
  path.join(OUT, 'captions.json'),
  JSON.stringify({ name, mapId, state, captions }, null, 2),
);
await browser.close();
console.log('done', OUT);
