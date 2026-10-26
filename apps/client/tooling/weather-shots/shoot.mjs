/* global process, console, window, document, setTimeout, fetch, MutationObserver, structuredClone */
// Wild Isle weather screens, from the real client (#621 W1-9).
// Dev tooling only: `node apps/client/tooling/weather-shots/shoot.mjs` with the dev servers
// running (`pnpm dev`, a Wild Isle on: HP_WILD_ISLE=on). PNGs and `captions.json` go to `OUT`
// (default `tooling/weather-shots/out/`; add it to .gitignore).
//
// One account, one world: the script signs up a player, makes a Wild Isle patch named
// "Drizzle Cove", then serves the SAME mocked `GET /maps/:id/view`, `/weather`, `/home`,
// `/hollow` and bag from `fixture.ts` (`testWildIsle()`) to iPhone SE, iPhone 15 and iPad Pro 11.
// The game clock is pinned to noon in the map's time zone. Every phase is a FRESH page load
// (a reused page does not pick up a new plan), pinned to `?tier=high` (one frame to `?tier=low`).
// Phases, per device: `rain-map`, `storm-map`, `fog-map`, `clear-map`, `forecast-no-vane`,
// `forecast-vane`, `tile-knocked`, `low-storm-map` and `morning-card`. Ambient motion is off in
// software GL, so every frame is a still. Env: DEVICES, ONLY (phase names), REUSE=1 (last
// player), BASE, OUT, PW_CHROMIUM_EXECUTABLE, PW_CHROMIUM_ARGS.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.join(HERE, 'out');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const MAP_NAME = 'Drizzle Cove';
/** Noon on 25 Oct 2026 in New York (EDT), the test map's zone. */
const NOW = Date.parse('2026-10-25T16:00:00Z');
const DEVICES = {
  'iphone-se': {
    label: 'iPhone SE',
    width: 375,
    height: 667,
    dpr: 2,
    insets: { top: 20, bottom: 0, left: 0, right: 0 },
  },
  'iphone-15': {
    label: 'iPhone 15',
    width: 393,
    height: 852,
    dpr: 3,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  'ipad-pro-11': {
    label: 'iPad Pro 11',
    width: 834,
    height: 1194,
    dpr: 2,
    insets: { top: 24, bottom: 20, left: 0, right: 0 },
  },
};
const WANT = (process.env.DEVICES ?? Object.keys(DEVICES).join(',')).split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const TIMEOUT = Number(process.env.TIMEOUT ?? 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (page, fn, arg, timeout = TIMEOUT) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 90)}`);
    await sleep(250);
  }
};

/** A name the server's text filter accepts: consonant+vowel syllables. */
function playerName() {
  const c = 'bdlmrvz';
  const v = 'aeiou';
  let t = Date.now();
  let s = 'wx_';
  for (let i = 0; i < 3; i++) {
    s += c[t % c.length] + v[Math.floor(t / 7) % v.length];
    t = Math.floor(t / 35);
  }
  return s;
}

async function signUpAndMakeWildIsle(page) {
  const name = playerName();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const overlay = page.getByTestId('auth-overlay');
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByLabel('Family or invite code').fill(SIGNUP_CODE);
  await overlay.getByLabel('Pick a name').fill(name);
  await overlay.getByLabel('Pick a password').fill('squishy-secret');
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByLabel('A grown-up helped me and read the privacy page.').check();
  await overlay.getByRole('button', { name: 'Sign up' }).click();
  await overlay.getByText("I've saved it").click();
  await overlay.getByTestId('auth-code-done').click();
  await page.evaluate(() =>
    fetch('/api/v1/cinematic/seen', {
      method: 'POST',
      headers: { 'x-requested-with': 'heartpatch' },
    }),
  );
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
  await lobby.getByLabel('Patch name').fill(MAP_NAME);
  await lobby.getByRole('button', { name: 'Make it!' }).click();
  await lobby.getByRole('button', { name: 'Visit patch' }).click();
  const starter = page.getByTestId('starter-picker');
  await starter.getByRole('button', { name: /^Puddlepuff,/ }).click({ timeout: 90_000 });
  await starter.getByRole('button', { name: 'Choose Puddlepuff' }).click();
  await starter.getByRole('button', { name: 'Let’s go!' }).click({ timeout: 60_000 });
  await until(page, () => window.__heartpatch?.map?.()?.id);
  return name;
}

/** The real patch's id, my member row and the view's seq, read before any route is mocked. */
async function realFacts(page) {
  return page.evaluate(async (mapName) => {
    const get = async (p) =>
      (await fetch(`/api/v1${p}`, { headers: { 'x-requested-with': 'heartpatch' } })).json();
    const { maps } = await get('/maps');
    const map = maps.find((m) => m.name === mapName);
    const view = await get(`/maps/${map.id}/view`);
    return { mapId: map.id, member: view.members[0], seq: view.seq };
  }, MAP_NAME);
}

function buildFixture(facts) {
  const out = execFileSync(
    path.resolve(HERE, '../../node_modules/.bin/tsx'),
    [
      '--conditions=@heartpatch/source',
      path.join(HERE, 'fixture.ts'),
      JSON.stringify({ ...facts, nowMs: NOW }),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

/** What the next page load is served: set by each phase, read by the mocked routes. */
const state = { plan: 'clear', vane: false, knocked: false, notes: false };

function viewNow(fx) {
  const view = structuredClone(fx.view);
  const put = (spot, building) => {
    const tile = view.tiles.find((t) => t.q === spot.tile.q && t.r === spot.tile.r);
    tile.buildings.push(building);
  };
  put(fx.hut, state.knocked ? { ...fx.hut.building, knocked: true } : fx.hut.building);
  if (state.vane) put(fx.vane, fx.vane.building);
  return view;
}

function weatherNow(fx) {
  return {
    today: fx.plans[state.plan],
    tomorrow: state.vane ? fx.tomorrow : { summary: fx.tomorrowSummary },
    serverTime: new Date(NOW).toISOString(),
  };
}

/** The shared state, served for every device. */
async function mock(context, fx) {
  // Every other reply that carries the server's `now` (a settle, say) says the pinned noon too:
  // otherwise one of them moves the game clock to the machine's real time and the sky moves on.
  const pinned = (value) => {
    if (Array.isArray(value)) return value.map(pinned);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) =>
        (k === 'now' || k === 'serverTime') && typeof v === 'string'
          ? [k, new Date(NOW).toISOString()]
          : [k, pinned(v)],
      ),
    );
  };
  await context.route('**/api/v1/**', async (route) => {
    const res = await route.fetch();
    if (!(res.headers()['content-type'] ?? '').includes('json'))
      return route.fulfill({ response: res });
    const body = await res.json().catch(() => undefined);
    return body === undefined
      ? route.fulfill({ response: res })
      : route.fulfill({ response: res, json: pinned(body) });
  });
  const get = (pattern, body) =>
    context.route(pattern, (r) =>
      r.request().method() === 'GET' ? r.fulfill({ json: body() }) : r.fallback(),
    );
  await get('**/api/v1/maps/*/view', () => viewNow(fx));
  await get('**/api/v1/maps/*/weather', () => weatherNow(fx));
  await get('**/api/v1/maps/*/home', () => (state.knocked ? fx.home.knocked : fx.home.plain));
  await get('**/api/v1/maps/*/roads', () => ({ roads: [] }));
  await get('**/api/v1/maps/*/territory/tending', () => ({
    tending: {
      missing: [],
      wentWild: [],
      stranded: [],
      nextMissesYouAt: null,
      now: new Date(NOW).toISOString(),
    },
  }));
  // The real reply with the clock set to the pinned noon, so every device agrees on "now".
  const patched = async (route, patch) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    return route.fulfill({ response: res, json: patch(body) });
  };
  await context.route('**/api/v1/maps/*/inventory', (r) =>
    patched(r, (b) => ({
      ...b,
      now: new Date(NOW).toISOString(),
      items: { ...b.items, timber: 40, stone: 30, glimmer: 3 },
    })),
  );
  await context.route('**/api/v1/maps/*/hollow', (r) =>
    patched(r, (b) => ({
      ...b,
      hollow: {
        ...b.hollow,
        now: new Date(NOW).toISOString(),
        // Noon, whatever the machine's clock says: day, nightfall at 7:30 pm, no reports or hints.
        night: { isNight: false, changesInMinutes: 450 },
        tonight: {
          ...b.hollow.tonight,
          night: '2026-10-25',
          nightfallAt: new Date(NOW + 7.5 * 3_600_000).toISOString(),
          strikeAt: new Date(NOW + 8 * 3_600_000).toISOString(),
        },
        reports: [],
        fireHint: false,
        weatherNotes: state.notes
          ? [
              {
                buildingRowId: fx.hut.building.id,
                buildingId: fx.hut.building.buildingId,
                q: fx.hut.tile.q,
                r: fx.hut.tile.r,
                at: new Date(NOW - 9 * 3_600_000).toISOString(),
              },
            ]
          : undefined,
      },
    })),
  );
}

/** Draws a couple of frames and waits for them. */
async function settle(page, frames = 2) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + frames);
  await page.waitForTimeout(500);
}

const stats = (page) => page.evaluate(() => window.__heartpatch?.weather?.() ?? null);

/**
 * A fresh load of the map on the wanted tier, held until the weather layer shows `kind`:
 * the chip says it, and the clouds / rain / fog counts match it and have stopped changing.
 */
async function openMap(page, { tier, kind }) {
  await page.goto(`${BASE}/?tier=${tier}`, { waitUntil: 'load' });
  const lobby = page.getByTestId('lobby');
  await until(page, () => window.__heartpatch?.map?.()?.tiles > 0).catch(async () => {
    await lobby.getByRole('button', { name: new RegExp(MAP_NAME) }).click();
    await lobby.getByRole('button', { name: 'Visit patch' }).click();
    await until(page, () => window.__heartpatch?.map?.()?.tiles > 0);
  });
  await until(page, () => document.querySelector('canvas[data-ready="true"]') !== null);
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await page.addStyleTag({
    content: '[aria-labelledby="night-nudge-title"]{display:none!important}',
  });
  await until(
    page,
    (k) => document.querySelector('[data-testid="weather-chip"]')?.dataset.kind === k,
    kind,
  );
  // Counts: rain -> rain only, storm -> clouds + rain, fog -> fog only, clear -> nothing.
  const fits = (s) => {
    if (!s) return false;
    if (kind === 'clear') return s.clouds === 0 && s.rain === 0 && s.fog === 0;
    if (kind === 'fog') return s.fog > 0 && s.rain === 0;
    // The low tier has clouds and no rain.
    if (kind === 'storm') return s.clouds > 0 && (s.rain > 0 || tier === 'low') && s.fog === 0;
    return (s.rain > 0 || tier === 'low') && s.fog === 0;
  };
  let last = '';
  let steady = 0;
  const end = Date.now() + TIMEOUT;
  while (steady < 3) {
    if (Date.now() > end) throw new Error(`weather never showed ${kind}: ${last}`);
    const s = await stats(page);
    const now = JSON.stringify(s);
    if (process.env.DEBUG)
      console.log(
        'weather',
        now,
        await page
          .evaluate(() => [
            document.querySelector('[data-testid="weather-chip"]')?.dataset.kind,
            window.__heartpatch.map()?.builds,
            window.__heartpatch.map()?.viewSeq,
          ])
          .catch(() => null),
      );
    steady = fits(s) && now === last ? steady + 1 : 0;
    last = now;
    await sleep(500);
  }
  await settle(page);
  return JSON.parse(last);
}

/** A tile's panel open and the camera on it, as a tap on it would. */
async function showTile(page, tile) {
  await page.evaluate(({ q, r }) => window.__heartpatch.mapDev().show(q, r), tile);
  let last = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(700);
    const now = JSON.stringify(await page.evaluate(() => window.__heartpatch.camera()));
    if (now === last) break;
    last = now;
  }
  await settle(page);
}

/** Facts about the frame about to be shot: the words on screen and anything that should not be. */
function frameFacts(page, insets) {
  return page.evaluate((insets) => {
    const h = window.innerHeight;
    const visible = (e) => {
      const b = e.getBoundingClientRect();
      const s = window.getComputedStyle(e);
      return (
        b.width > 0 &&
        b.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none' &&
        !e.closest('[hidden]')
      );
    };
    // On screen, not only laid out: a line scrolled out of the sheet's own scroll area is not in the picture.
    const shown = (e) => {
      if (!visible(e)) return false;
      const port = e.closest('.weather-sheet-scroll');
      if (!port) return true;
      const b = e.getBoundingClientRect();
      const p = port.getBoundingClientRect();
      return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
    };
    const sheetLines = (want) =>
      [
        ...document.querySelectorAll(
          '.weather-sheet-scroll [data-testid="weather-front"], .weather-sheet-scroll .weather-sheet-note, .weather-sheet-scroll [data-testid="weather-tomorrow"]',
        ),
      ]
        .filter(visible)
        .filter((e) => {
          const b = e.getBoundingClientRect();
          const p = e.closest('.weather-sheet-scroll').getBoundingClientRect();
          const state =
            b.top >= p.bottom - 1
              ? 'below'
              : b.bottom > p.bottom + 1 || b.top < p.top - 1
                ? 'cut'
                : 'in';
          return state === want;
        })
        .map((e) => e.innerText.trim().replace(/\s*\n+\s*/g, ' · '));
    const text = (sel) =>
      [...document.querySelectorAll(sel)]
        .filter(shown)
        .map((e) => e.innerText.trim().replace(/\s*\n+\s*/g, ' · '));
    const listUnder = (head) => {
      const h3 = [...document.querySelectorAll('.weather-sheet h3')].find(
        (e) => e.textContent.trim() === head,
      );
      const next = h3?.nextElementSibling;
      if (!next || !visible(next)) return [];
      return [...next.querySelectorAll('[data-testid="weather-front"]')]
        .filter(shown)
        .map((e) => e.innerText.trim());
    };
    // Panel text that is really on screen, inside the panel's own scroll port
    // and the viewport: a line scrolled up out of the panel is `above`, one
    // cut by its edge or further down is `cut`; neither is quoted as on screen.
    const viewBottom = h - insets.bottom;
    const onScreen = [...document.querySelectorAll('.tile-panel')].filter(visible).flatMap((p) => {
      const port = p.getBoundingClientRect();
      const top = Math.max(0, port.top);
      const bottom = Math.min(viewBottom, port.bottom);
      return [...p.querySelectorAll('h1,h2,h3,p,li,button,span.tile-panel-line')]
        .filter((e) => visible(e) && e.children.length === 0 && e.innerText.trim())
        .map((e) => {
          const b = e.getBoundingClientRect();
          const t = e.innerText.trim().replace(/\s*\n+\s*/g, ' ');
          const above = b.bottom <= top + 0.5;
          return { t, above, cut: !above && (b.top < top - 0.5 || b.bottom > bottom + 0.5) };
        });
    });
    const hud = document.querySelector('[data-testid="map-hud"]');
    const sheet = document.querySelector('[data-testid="weather-sheet"]');
    const card = sheet && visible(sheet) ? sheet.querySelector('.weather-sheet-card') : null;
    const cardTop = card ? card.getBoundingClientRect().top : null;
    const cardBottom = card ? card.getBoundingClientRect().bottom : null;
    // HUD pieces whose bottom edge pokes below the top of the sheet's card.
    const peeking = card
      ? [...hud.querySelectorAll('*')]
          .filter((e) => visible(e) && e.getBoundingClientRect().height > 8)
          .filter((e) => e.getBoundingClientRect().bottom > cardTop + 1)
          .map((e) => (e.textContent || e.className).trim().slice(0, 24))
      : [];
    return {
      viewport: [window.innerWidth, h],
      tier: window.__heartpatch?.quality?.()?.tier ?? null,
      weather: window.__heartpatch?.weather?.() ?? null,
      chip: document.querySelector('[data-testid="weather-chip"]')?.dataset.kind ?? null,
      hud: hud && visible(hud) ? hud.innerText.trim().replace(/\s*\n+\s*/g, ' · ') : null,
      devs: [...document.querySelectorAll('button,.dev-status')]
        .filter(
          (e) =>
            visible(e) && (/\(dev\)/i.test(e.textContent) || e.classList.contains('dev-status')),
        )
        .map((e) => e.textContent.trim()),
      reconnecting: /Reconnecting/.test(document.body.innerText),
      inZone: [...document.querySelectorAll('body *')]
        .filter(
          (e) => e.id !== 'game' && visible(e) && window.getComputedStyle(e).position === 'fixed',
        )
        .filter(
          (e) => insets.bottom > 0 && e.getBoundingClientRect().bottom > h - insets.bottom + 0.5,
        )
        .map((e) => String(e.className || e.tagName))
        .filter((c) => !/^trays( trays-hinting)?$|dark-moon|weather-tint|^weather-sheet$/.test(c)),
      cardTop,
      cardBottom,
      peeking,
      now: text('[data-testid="weather-now"]'),
      // Today's lines and tomorrow's, told apart by the heading each list sits under.
      fronts: listUnder('Today'),
      tomorrowLines: listUnder('Tomorrow'),
      tomorrow: text('[data-testid="weather-tomorrow"], [data-testid="weather-no-vane"]'),
      sheetHeads: text('.weather-sheet h3'),
      sheetNotes: text('.weather-sheet-note:not([data-testid="weather-no-vane"])'),
      mapPicture:
        sheet && visible(sheet)
          ? (sheet.querySelector(
              '[data-testid="weather-island"], canvas, svg, img, .weather-island',
            )?.tagName ?? null)
          : null,
      panel: text('.tile-panel'),
      panelLines: onScreen,
      // Sheet lines not wholly in the sheet's scroll port: cut by its edge, or further down.
      sheetCut: sheetLines('cut'),
      sheetBelow: sheetLines('below'),
      morning: text('[data-testid="hollow-report"]'),
    };
  }, insets);
}

const captions = [];
const problemsAll = [];

async function shot(page, device, phase, { weather, tier, describe }) {
  if (ONLY && !ONLY.includes(phase)) return;
  const d = DEVICES[device];
  await settle(page);
  let facts = await frameFacts(page, d.insets);
  for (let i = 0; i < 6 && facts.reconnecting; i++) {
    await sleep(2000);
    facts = await frameFacts(page, d.insets);
  }
  const file = `${device}-${phase}.png`;
  await page.screenshot({ path: path.join(OUT, file), type: 'png', timeout: 180_000 });
  const problems = [
    ...(facts.tier !== tier ? [`tier ${facts.tier}, wanted ${tier}`] : []),
    ...(facts.devs.length ? [`dev UI: ${facts.devs.join(', ')}`] : []),
    ...(facts.reconnecting ? ['Reconnecting… showing'] : []),
    ...(facts.inZone.length ? [`in home-indicator zone: ${facts.inZone.join(', ')}`] : []),
    ...(facts.cardBottom !== null &&
    d.insets.bottom > 0 &&
    facts.cardBottom > facts.viewport[1] - d.insets.bottom + 0.5
      ? [
          `sheet card reaches the home-indicator zone (bottom ${Math.round(facts.cardBottom)} of ${facts.viewport[1]})`,
        ]
      : []),
    ...(facts.peeking.length ? [`HUD peeks above the sheet: ${facts.peeking.join(' / ')}`] : []),
  ];
  captions.push({
    file,
    device: d.label,
    phase,
    weather,
    tier,
    caption: `${d.label} (${d.width}×${d.height} @${d.dpr}x), tier ${tier}, ${weather}. ${describe(facts)}`,
    problems,
  });
  if (problems.length) problemsAll.push(`${file}: ${problems.join('; ')}`);
  console.log(
    file,
    problems.length ? `PROBLEMS ${problems.join('; ')}` : 'ok',
    JSON.stringify(facts.weather),
  );
}

const counts = (f) =>
  f.weather
    ? `clouds ${f.weather.clouds}, rain ${f.weather.rain}, fog ${f.weather.fog}`
    : 'no counts';
const list = (l) => (l.length ? l.join(' / ') : 'nothing');
const mapLine = (f) => `The map of Drizzle Cove; top bar: ${f.hud}. Weather layer: ${counts(f)}.`;

async function runDevice(browser, device, statePath, fx) {
  const d = DEVICES[device];
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Etc/UTC',
  });
  await mock(context, fx);
  // One clock for every frame: `Date.now` is pinned (timers and rAF still run).
  await context.addInitScript((t) => {
    Date.now = () => t;
  }, NOW);
  await context.addInitScript(() => {
    // No dev-only UI in a picture: the badge, and any "(dev)" button.
    const style = document.createElement('style');
    style.textContent = '.dev-status{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.append(style));
    new MutationObserver(() => {
      for (const b of document.querySelectorAll('button'))
        if (/\(dev\)/i.test(b.textContent)) b.hidden = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const page = await context.newPage();
  if (process.env.DEBUG) page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)));
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.insets }).catch(() => {
    console.warn('safe-area emulation unavailable');
  });
  const want = (phase) => !ONLY || ONLY.includes(phase);
  const phase = async (name, set, kind, tier, run) => {
    if (!want(name)) return;
    Object.assign(state, { plan: 'clear', vane: false, knocked: false, notes: false }, set);
    await openMap(page, { tier, kind });
    await run();
  };

  // 1. The four skies over the map; the hut is not knocked, so no morning card.
  for (const kind of ['rain', 'storm', 'fog', 'clear']) {
    await phase(`${kind}-map`, { plan: kind }, kind, 'high', () =>
      shot(page, device, `${kind}-map`, { weather: kind, tier: 'high', describe: mapLine }),
    );
  }

  // 2. The Forecast sheet while it rains over home: fog this morning, rain now, a storm tonight.
  const sheet = async (name, vane) =>
    phase(name, { plan: 'sheet', vane }, 'rain', 'high', async () => {
      await page.getByTestId('weather-chip').click();
      await page.getByTestId('weather-sheet').waitFor();
      await until(
        page,
        (v) => (document.querySelector('[data-testid="weather-no-vane"]') === null) === v,
        vane,
      );
      await settle(page);
      await shot(page, device, name, {
        weather: 'rain',
        tier: 'high',
        describe: (f) =>
          `The Weather sheet (the Forecast) open over the map${vane ? ', with a Weather Vane standing' : ', no Weather Vane'}. Right now: "${list(f.now)}". ${f.sheetHeads.includes('Today') ? `Today: ${list(f.fronts)}.` : 'There is no Today list.'} Tomorrow: ${list(vane ? f.tomorrowLines : f.tomorrow)}. Notes at the bottom: ${list(f.sheetNotes)}.${f.sheetCut.length ? ` Cut at the sheet's bottom edge: ${f.sheetCut.join(' / ')}.` : ''}${f.sheetBelow.length ? ` Further down the scrolling sheet, not on screen: ${f.sheetBelow.join(' / ')}.` : ''} A small island map shows the fronts, each labelled.`,
      });
    });
  await sheet('forecast-no-vane', false);
  await sheet('forecast-vane', true);

  // 3. A storm over home with the hut knocked about: its tile panel and the Fix it card.
  await phase('tile-knocked', { plan: 'storm', knocked: true }, 'storm', 'high', async () => {
    await showTile(page, fx.hut.tile);
    await until(page, () => document.querySelector('[data-testid$="-knocked"]') !== null);
    // The panel as the app leaves it: scrolled just far enough for the Fix it card to show whole.
    await settle(page);
    await shot(page, device, 'tile-knocked', {
      weather: 'storm',
      tier: 'high',
      describe: (f) =>
        `The tile panel of my Woodcutter's Hut a storm knocked about, scrolled to its Fix it card. On screen: ${list(f.panelLines.filter((l) => !l.cut && !l.above).map((l) => l.t))}.${
          f.panelLines.some((l) => l.above)
            ? ` Scrolled up out of the panel: ${f.panelLines
                .filter((l) => l.above)
                .map((l) => l.t)
                .join(' / ')}.`
            : ''
        }${
          f.panelLines.some((l) => l.cut)
            ? ` Cut by the panel's edge or further down: ${f.panelLines
                .filter((l) => l.cut)
                .map((l) => l.t)
                .join(' / ')}.`
            : ''
        }`,
    });
  });

  // 4. The same storm world on the low tier.
  await phase('low-storm-map', { plan: 'storm' }, 'storm', 'low', () =>
    shot(page, device, 'low-storm-map', { weather: 'storm', tier: 'low', describe: mapLine }),
  );

  // 5. The morning after: clear sky, the hut knocked about, the morning card (last: it stays until dismissed).
  await phase(
    'morning-card',
    { plan: 'clear', knocked: true, notes: true },
    'clear',
    'high',
    async () => {
      await until(
        page,
        () => document.querySelector('[data-testid="hollow-report"]:not([hidden])') !== null,
      );
      await settle(page);
      await shot(page, device, 'morning-card', {
        weather: 'clear',
        tier: 'high',
        describe: (f) => `The morning card over the map. Card: ${list(f.morning)}. ${mapLine(f)}`,
      });
    },
  );
  await context.close();
}

const args = process.env.PW_CHROMIUM_ARGS
  ? process.env.PW_CHROMIUM_ARGS.split(' ')
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args,
});
const statePath = path.join(OUT, '.state.json');
const factsPath = `${statePath}.facts`;
let facts;
if (process.env.REUSE === '1' && (await stat(statePath).catch(() => null))) {
  facts = JSON.parse(await readFile(factsPath, 'utf8'));
} else {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await signUpAndMakeWildIsle(page);
  facts = await realFacts(page);
  await context.storageState({ path: statePath });
  await writeFile(factsPath, JSON.stringify(facts));
  await context.close();
}
const fx = buildFixture(facts);
try {
  for (const device of WANT) await runDevice(browser, device, statePath, fx);
} finally {
  await browser.close();
}
const outCaptions = path.join(OUT, 'captions.json');
const keep =
  ONLY || process.env.DEVICES
    ? JSON.parse(await readFile(outCaptions, 'utf8').catch(() => '[]'))
    : [];
const fresh = new Set(captions.map((c) => c.file));
await writeFile(
  outCaptions,
  JSON.stringify([...keep.filter((c) => !fresh.has(c.file)), ...captions], null, 2),
);

// Every PNG must be distinct.
const seen = new Map();
for (const f of (await readdir(OUT)).filter((n) => n.endsWith('.png')).sort()) {
  const sum = createHash('sha256')
    .update(await readFile(path.join(OUT, f)))
    .digest('hex');
  seen.set(sum, [...(seen.get(sum) ?? []), f]);
}
const dupes = [...seen.values()].filter((l) => l.length > 1);
console.log(`wrote ${captions.length} shots to ${OUT}; duplicates: ${dupes.length}`);
for (const l of dupes) console.log('DUPLICATE', l.join(' = '));
if (problemsAll.length) console.log('PROBLEMS\n' + problemsAll.join('\n'));
process.exitCode = dupes.length || problemsAll.length ? 1 : 0;
