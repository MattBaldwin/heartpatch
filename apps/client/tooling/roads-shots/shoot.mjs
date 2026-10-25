/* global process, console, window, document, setTimeout, fetch, MutationObserver */
// Roads, bridges and ferry docks on a Wild Isle, from the real client (#621 W1-6).
// Dev tooling only: `node tooling/roads-shots/shoot.mjs` with the dev servers
// running (`pnpm dev`, a Wild Isle on: HP_WILD_ISLE=on). PNGs and
// `captions.json` go to `OUT` (default `tooling/roads-shots/out/`; add it to .gitignore).
//
// One shared state: the script signs up a player, makes a Wild Isle patch, then
// serves the SAME mocked `GET /maps/:id/view`, `/roads`, `/territory/tending`
// and bag from `fixture.ts` (`testWildIsle()` plus a 3-level road network, a
// bridge, a ferry dock and two cut-off tiles) to iPhone 15, iPhone SE and
// iPad, each pinned to `?tier=high` at the device's own DPR. Shots, per device:
// `build-sheet`, `network`, `bridge`, `cant-build`, `dock`, `stranded`, each as an "as it
// opens" frame and a whole-card frame. No dev badge, no "(dev)" buttons, no fake
// clock; the safe areas are emulated and the script checks nothing sits in the
// bottom one. Env: DEVICES, ONLY (shot names), REUSE=1 (the last player),
// PW_CHROMIUM_EXECUTABLE, PW_CHROMIUM_ARGS (GPU flags; default SwiftShader).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.join(HERE, 'out');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const SIGNUP_CODE = process.env.HP_SIGNUP_CODE ?? 'heartpatch-dev-family';
const TIER = 'high';
const DEVICES = {
  // iPhone 15 (393×852 @3), iPhone SE 3rd gen (375×667 @2), iPad 9th gen held sideways (1080×810 @2).
  'iphone-15': {
    label: 'iPhone 15',
    width: 393,
    height: 852,
    dpr: 3,
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  },
  'iphone-se': {
    label: 'iPhone SE',
    width: 375,
    height: 667,
    dpr: 2,
    insets: { top: 20, bottom: 0, left: 0, right: 0 },
  },
  ipad: {
    label: 'iPad',
    width: 1080,
    height: 810,
    dpr: 2,
    insets: { top: 24, bottom: 20, left: 0, right: 0 },
  },
};
const WANT = (process.env.DEVICES ?? Object.keys(DEVICES).join(',')).split(',');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const until = async (page, fn, arg, timeout = 180_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out: ${fn.toString().slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};
const hook = (page, name) => page.evaluate((n) => window.__heartpatch?.[n]?.() ?? null, name);

/** A name the server's text filter accepts: consonant+vowel syllables. */
function playerName() {
  const c = 'bdlmrvz';
  const v = 'aeiou';
  let t = Date.now();
  let s = 'rd_';
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
  await lobby.getByLabel('Patch name').fill('Road Cove');
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
  return page.evaluate(async () => {
    const get = async (p) =>
      (await fetch(`/api/v1${p}`, { headers: { 'x-requested-with': 'heartpatch' } })).json();
    const { maps } = await get('/maps');
    const map = maps.find((m) => m.name === 'Road Cove');
    const view = await get(`/maps/${map.id}/view`);
    return { mapId: map.id, member: view.members[0], seq: view.seq };
  });
}

function buildFixture(facts) {
  const out = execFileSync(
    path.resolve('node_modules/.bin/tsx'),
    ['--conditions=@heartpatch/source', path.join(HERE, 'fixture.ts'), JSON.stringify(facts)],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

/** The shared state, served for every device: view, roads, tending and a full bag. */
async function mock(context, fx) {
  await context.route('**/api/v1/maps/*/view', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: fx.view }) : r.fallback(),
  );
  await context.route('**/api/v1/maps/*/roads', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: fx.roads }) : r.fallback(),
  );
  await context.route('**/api/v1/maps/*/territory/tending', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: { tending: { ...fx.tending.tending, now: new Date().toISOString() } } })
      : r.fallback(),
  );
  await context.route('**/api/v1/maps/*/inventory', async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const res = await r.fetch();
    const body = await res.json();
    body.items = { ...body.items, timber: 40, stone: 30, glimmer: 3 };
    return r.fulfill({ response: res, json: body });
  });
}

/** Draws a couple of frames and waits for them. */
async function settle(page, frames = 2) {
  const before = await page.evaluate(() => window.__heartpatch?.draws?.() ?? 0);
  await page.evaluate(() => window.__heartpatch?.invalidate?.());
  await until(page, (n) => (window.__heartpatch?.draws?.() ?? 0) >= n, before + frames);
  await page.waitForTimeout(500);
}

/** Opens the map on the patch (the game lands on the last one after a reload). */
async function openMap(page) {
  await page.goto(`${BASE}/?tier=${TIER}`, { waitUntil: 'load' });
  const lobby = page.getByTestId('lobby');
  await until(page, () => window.__heartpatch?.map?.()?.tiles > 0).catch(async () => {
    await lobby.getByRole('button', { name: /Road Cove/ }).click();
    await lobby.getByRole('button', { name: 'Visit patch' }).click();
    await until(page, () => window.__heartpatch?.map?.()?.tiles > 0);
  });
  await until(page, () => document.querySelector('canvas[data-ready="true"]') !== null);
  await until(page, () => window.__heartpatch?.roads?.()?.loaded);
  // The first-visit tray hint is dismissed, as a returning player has.
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  // The night nudge ("Some of your land is dark tonight!") is another feature's card and,
  // near dusk, sits over the map: kept out of these frames.
  await page.addStyleTag({
    content: '[aria-labelledby="night-nudge-title"]{display:none!important}',
  });
  await page.waitForTimeout(1200);
}

/** A tile's panel open and the camera on it, as a tap on it would. */
async function showTile(page, tile, zoom = 0) {
  await page.evaluate(({ q, r }) => window.__heartpatch.mapDev().show(q, r), tile);
  for (let i = 0; i < zoom; i++) {
    const box = await page.locator('#game').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.35);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
  }
  // The camera glides; wait until it has stopped (software rendering makes it slow).
  let last = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(700);
    const now = JSON.stringify(await hook(page, 'camera'));
    if (now === last) break;
    last = now;
  }
  await settle(page);
}

/** The cut-off card hides in every shot but its own, so it doesn't cover the map; the cut-off tint stays. */
const cardHidden = (page, hidden) =>
  page.evaluate((h) => {
    let st = document.getElementById('shots-hide-card');
    if (!st) {
      st = document.createElement('style');
      st.id = 'shots-hide-card';
      document.head.append(st);
    }
    st.textContent = h ? '[data-testid="stranded-card"]{display:none!important}' : '';
  }, hidden);

/** Facts about the frame about to be shot, so a bad one is loud and the caption is true. */
async function frameFacts(page, device, roadTiles) {
  return page.evaluate(
    ({ insets, roadTiles }) => {
      const h = window.innerHeight;
      const w = window.innerWidth;
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
      const text = (sel) =>
        [...document.querySelectorAll(sel)]
          .filter(visible)
          .map((e) => e.textContent.trim().replace(/\s+/g, ' '));
      // Anything solid that reaches into the home-indicator zone (canvas excluded).
      const inZone = [...document.querySelectorAll('body *')]
        .filter(
          (e) =>
            e.id !== 'game' &&
            !/^trays( trays-hinting)?$/.test(e.className) &&
            visible(e) &&
            !/dark-moon/.test(e.className) && // a spot's marker on the map, not UI
            window.getComputedStyle(e).position === 'fixed',
        )
        .filter(
          (e) => e.getBoundingClientRect().bottom > h - insets.bottom + 0.5 && insets.bottom > 0,
        )
        .map((e) => e.className || e.tagName);
      const devs = [...document.querySelectorAll('button,.dev-status')]
        .filter(
          (e) =>
            visible(e) && (/\(dev\)/i.test(e.textContent) || e.classList.contains('dev-status')),
        )
        .map((e) => e.textContent.trim());
      const reconnecting = /Reconnecting/.test(document.body.innerText);
      // What the tile panel really shows: only rows fully inside its scroll box
      // and above the bottom of the screen; the rest is "scrolled out of sight".
      function panelFacts() {
        const panelEl = document.querySelector('.tile-panel');
        if (!panelEl || !visible(panelEl)) return { panel: [], panelCut: [] };
        const box = panelEl.getBoundingClientRect();
        const shown = [];
        const cut = [];
        const rows = [...panelEl.querySelectorAll('.tile-panel-title,.tile-panel-owner,p,button')];
        // Reading order as on screen (CSS can reorder or lay rows side by side).
        rows.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return Math.round(ra.top / 4) - Math.round(rb.top / 4) || ra.left - rb.left;
        });
        for (const e of rows) {
          if (!visible(e) || e.closest('.tile-panel-details[hidden]')) continue;
          if (e.tagName !== 'BUTTON' && e.querySelector('button')) continue;
          const b = e.getBoundingClientRect();
          const label =
            e.tagName === 'BUTTON'
              ? e.getAttribute('aria-label') === 'Close'
                ? '✕ close button'
                : `${e.textContent.trim().replace(/\s+/g, ' ') || e.getAttribute('aria-label')} button`
              : e.textContent.trim().replace(/\s+/g, ' ');
          if (!label) continue;
          const edge = Math.min(box.bottom, h) + 1;
          if (b.top >= box.top - 1 && b.bottom <= edge) shown.push(label);
          else if (b.top < edge - 1 && b.bottom > box.top + 1)
            shown.push(`${label} (partly cut off at the bottom of the panel)`);
          else cut.push(label);
        }
        return { panel: shown, panelCut: cut };
      }
      // One tile's centre and six corners (CSS px): how much of it can be seen, with nothing
      // (card, panel, HUD, button) over the map there. 'full', 'partly' or 'hidden'.
      // A tile whose centre is covered is 'hidden'; one with a covered corner is 'partly'.
      function classify(points) {
        const seen = points.map((p) => {
          if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return false;
          return document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS';
        });
        if (!seen[0]) return 'hidden';
        return seen.every(Boolean) ? 'full' : 'partly';
      }
      // Does the cut-off card sit under a side button?
      const card = document.querySelector('[data-testid="stranded-card"]');
      const overlaps = [];
      if (card && visible(card)) {
        const c = card.getBoundingClientRect();
        for (const e of document.querySelectorAll(
          '.trays *, .tray-handle, .top-bar *, .map-hud *, .post-flag',
        )) {
          if (!visible(e)) continue;
          const b = e.getBoundingClientRect();
          if (b.width < 20) continue;
          if (b.left < c.right && b.right > c.left && b.top < c.bottom && b.bottom > c.top)
            overlaps.push((e.textContent || e.className).trim().slice(0, 20));
        }
      }
      return {
        overlaps,
        viewport: [w, h],
        inZone,
        devs,
        reconnecting,
        ...panelFacts(),
        sheet: text('[data-testid="build-sheet"]'),
        stranded: [...document.querySelectorAll('[data-testid="stranded-card"]')]
          .filter(visible)
          .map((e) => e.innerText.trim().replace(/\s+/g, ' ')),
        roads: window.__heartpatch.roads?.() ?? null,
        strandedDebug: (() => {
          const d = window.__heartpatch.stranded?.();
          if (!d) return null;
          return { grace: d.grace, fading: d.fading, tiles: d.outlines.map(classify) };
        })(),
        roadView: (() => {
          if (!roadTiles.length) return null;
          const outlines = window.__heartpatch.outlines(roadTiles);
          const out = { 1: [], 2: [], 3: [] };
          roadTiles.forEach((t, i) => out[t.level].push(classify(outlines[i] ?? [])));
          return out;
        })(),
        ferryView: (() => {
          const r = window.__heartpatch.roads?.();
          if (!r?.ferryDock) return null;
          const [dock, ...far] = window.__heartpatch.outlines([r.ferryDock, ...r.ferryTiles]);
          return { dock: classify(dock), far: far.map(classify) };
        })(),
      };
    },
    { insets: DEVICES[device].insets, roadTiles },
  );
}

const captions = [];
/** Set once the fixture is built: the road tiles (q, r, level) the network frames check. */
let ROAD_TILES = [];
async function shot(page, device, name, frame, describe) {
  if (ONLY && !ONLY.includes(name)) return;
  const d = DEVICES[device];
  await settle(page);
  const facts = await frameFacts(page, device, ROAD_TILES);
  const file = `${device}-${name}-${frame}.png`;
  await page.screenshot({ path: path.join(OUT, file), type: 'png', timeout: 180_000 });
  const problems = [
    ...(facts.inZone.length ? [`in home-indicator zone: ${facts.inZone.join(', ')}`] : []),
    ...(facts.devs.length ? [`dev UI: ${facts.devs.join(', ')}`] : []),
    ...(facts.reconnecting ? ['Reconnecting… showing'] : []),
    ...(facts.overlaps.length ? [`cut-off card overlaps: ${facts.overlaps.join(', ')}`] : []),
  ];
  const caption = `${d.label} (${d.width}×${d.height} @${d.dpr}x), quality tier ${TIER}. ${describe(facts)}`;
  const onScreenCard = facts.stranded.length
    ? ` The cut-off card shows: "${facts.stranded.join(' / ')}".`
    : '';
  const cutRows = facts.panelCut.length
    ? ` Scrolled out of sight inside the panel (not visible): ${facts.panelCut.join(', ')}.`
    : '';
  captions.push({
    file,
    device: d.label,
    tier: TIER,
    shot: name,
    frame,
    caption: caption + onScreenCard + cutRows,
    problems,
  });
  console.log(file, problems.length ? `PROBLEMS ${problems.join('; ')}` : 'ok');
}

const count = (list, kind) => list.filter((k) => k === kind).length;

/** What of the cut-off land is really visible: per tile, all of it, some of it, or none. */
function strandedView(f) {
  const tiles = f.strandedDebug?.tiles ?? [];
  const all = tiles.length;
  const full = count(tiles, 'full');
  const partly = count(tiles, 'partly');
  const kind = `${f.strandedDebug?.fading ? 'fading' : 'grace'} tint`;
  if (!full && !partly)
    return `The map around home; the cut-off land (${all} tiles) is off-screen, so none of it shows and "Show me" pans to it.`;
  if (!full)
    return `The map around home; a little of the cut-off land (${partly} of ${all} tiles) shows at the edge, partly tucked behind the buttons or card, and "Show me" pans to it.`;
  return `The map with ${full} of ${all} cut-off tiles fully in view${partly ? ` and ${partly} partly` : ''}, in the ${kind}.`;
}

/** The ferry map's far shore: how much of it, and the dock, is not under the panel or buttons. */
function ferryView(f) {
  const v = f.ferryView;
  if (!v) return 'No ferry map is showing.';
  const total = v.far.length;
  const full = count(v.far, 'full');
  const partly = count(v.far, 'partly');
  const hiddenN = count(v.far, 'hidden');
  const dock =
    v.dock === 'hidden'
      ? 'the dock is covered'
      : `the dock shows${v.dock === 'partly' ? ' (partly)' : ''}`;
  if (!full && !partly)
    return `The ferry map is on (${total} far-shore tiles in the aqua tint), but the tile panel and buttons cover the far shore and ${v.dock === 'hidden' ? 'the dock' : 'most of the dock'}; see the next frame.`;
  const parts = [`${full} fully in view`];
  if (partly) parts.push(`${partly} partly tucked behind the panel or buttons`);
  if (hiddenN) parts.push(`${hiddenN} out of sight`);
  return `The ferry map is showing: of ${total} far-shore tiles in the aqua tint with a pale rim, ${parts.join(', ')}; ${dock}.`;
}

/** How much of each road level is really in view (not behind the panel or buttons). */
function roadsView(f) {
  const v = f.roadView;
  if (!v) return '';
  const say = (level, name) => {
    const list = v[level];
    return `${name} ${count(list, 'full')} of ${list.length} fully in view`;
  };
  return ` In view: ${say(1, 'dirt path')}, ${say(2, 'gravel road')}, ${say(3, 'paved stone road')}.`;
}

const nodeTexts = (list) => (list.length ? list.join(' / ') : 'nothing');

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
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  // The device's safe areas (the notch and home indicator), where Chromium supports it.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: d.insets }).catch(() => {
    console.warn(
      'safe-area emulation unavailable; the home-indicator check uses the device inset only',
    );
  });
  const s = fx.spots;
  const tapText = async (testId) => page.getByTestId(testId).click();

  // 1. Build sheet with the Path card, on a tile of mine with no road yet.
  await openMap(page);
  await cardHidden(page, true);
  await showTile(page, s.pathTile, 1);
  await shot(
    page,
    device,
    'build-sheet',
    'as-opened-panel',
    (f) =>
      `The tile panel for a land tile of mine, with a Build button. Panel rows in view: ${nodeTexts(f.panel)}.`,
  );
  if (!ONLY || ONLY.includes('build-sheet')) {
    await page.getByTestId('tile-build').click();
    await page.getByTestId('build-sheet').waitFor();
    // The Path card is picked first, so the frame (and its top line) is the road's.
    // Wait for the bag (the sheet redraws when it lands), then tap the card in the page.
    await until(page, () => window.__heartpatch?.tileBuild?.()?.bag);
    await page.evaluate(() => document.querySelector('[data-build="road-1"]')?.click());
    await until(page, () => window.__heartpatch?.tileBuild?.()?.selected === 'road-1');
    await settle(page);
    await shot(
      page,
      device,
      'build-sheet',
      'as-it-opens',
      (f) =>
        `The Build sheet just opened over the tile panel, with the Path card picked. Sheet: ${nodeTexts(f.sheet)}.`,
    );
    // Whole-card frame: show every card, then pick the Path card.
    const all = page.locator('.build-all');
    if (await all.isVisible().catch(() => false)) await all.click();
    await settle(page);
    await shot(
      page,
      device,
      'build-sheet',
      'whole-card',
      (f) =>
        `The Build sheet with the Path card chosen and its details and Build button showing. Sheet: ${nodeTexts(f.sheet)}.`,
    );
  }

  // 2. A 3-level road network (levels 1–3), the tile panel closed.
  await openMap(page);
  await cardHidden(page, true);
  await showTile(page, s.networkMid, 0);
  await shot(
    page,
    device,
    'network',
    'as-it-opens',
    (f) =>
      `Roads drawn on the map by level (level 1, 2, 3 counts): ${f.roads?.drawn?.join(', ')}.${roadsView(f)} Panel rows in view: ${nodeTexts(f.panel)}.`,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.tile-panel button')]
      .find((b) => b.getAttribute('aria-label') === 'Close')
      ?.click(),
  );
  await settle(page);
  await shot(
    page,
    device,
    'network',
    'whole-network',
    (f) =>
      `Roads drawn on the map by level (level 1, 2, 3 counts): ${f.roads?.drawn?.join(', ')}.${roadsView(f)}`,
  );

  // 3. The bridge on its river tile.
  await openMap(page);
  await cardHidden(page, true);
  await showTile(page, s.bridge, 2);
  await shot(
    page,
    device,
    'bridge',
    'as-it-opens',
    (f) =>
      `A bridge on a river tile, the tile selected. Panel rows in view: ${nodeTexts(f.panel)}.`,
  );

  // 3b. A spot that can't be built on, with the reason on the card (a bridge with no joined land near).
  if (!ONLY || ONLY.includes('cant-build')) {
    await openMap(page);
    await cardHidden(page, true);
    await showTile(page, s.cantBuild, 1);
    await page.evaluate(() => document.querySelector('[data-testid="tile-build"]')?.click());
    await page.getByTestId('build-sheet').waitFor();
    await page.getByTestId('build-detail').waitFor();
    await settle(page);
    await shot(
      page,
      device,
      'cant-build',
      'as-it-opens',
      (f) =>
        `A river tile where a bridge can't go yet (no land joined to home is next to it), with the Build sheet open and the card saying why. Sheet: ${nodeTexts(f.sheet)}.`,
    );
  }

  // 4. The dock card, "Ferry across" pressed, and the far shore tint.
  await openMap(page);
  await cardHidden(page, true);
  await showTile(page, s.dock, 1);
  await shot(
    page,
    device,
    'dock',
    'as-it-opens',
    (f) =>
      `The ferry dock's tile panel before the ferry is shown. Panel rows in view: ${nodeTexts(f.panel)}.`,
  );
  if (!ONLY || ONLY.includes('dock')) {
    await tapText('ferry-across');
    await page.waitForTimeout(1500);
    let prev = '';
    for (let i = 0; i < 60; i++) {
      const cur = JSON.stringify(await hook(page, 'camera'));
      if (cur === prev) break;
      prev = cur;
      await page.waitForTimeout(700);
    }
    await shot(
      page,
      device,
      'dock',
      'far-shore',
      (f) => `${ferryView(f)} Panel rows in view: ${nodeTexts(f.panel)}.`,
    );
    // The same moment with the panel out of the way (hidden, not closed: closing puts the map back).
    await page.addStyleTag({ content: '.tile-panel{visibility:hidden!important}' });
    await shot(
      page,
      device,
      'dock',
      'far-shore-map',
      (f) => `Same moment with the tile panel hidden. ${ferryView(f)}`,
    );
  }

  // 5. Stranded land: tint and the "Some land is cut off!" card.
  await openMap(page);
  await until(page, () => window.__heartpatch?.stranded?.()?.card);
  await shot(page, device, 'stranded', 'as-it-opens', strandedView);
  if (!ONLY || ONLY.includes('stranded')) {
    const before = JSON.stringify(await hook(page, 'camera'));
    await tapText('stranded-show');
    // The glide may start late on slow software rendering: wait for it to move, then to stop.
    let prev = before;
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(700);
      const cur = JSON.stringify(await hook(page, 'camera'));
      if (cur === prev && cur !== before) break;
      prev = cur;
    }
    await shot(
      page,
      device,
      'stranded',
      'whole-card',
      (f) => `Show me pressed: the camera panned to the cut-off land. ${strandedView(f)}`,
    );
  }
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
ROAD_TILES = fx.roads.roads.map((r) => ({ q: r.q, r: r.r, level: r.level }));
console.log('fixture', JSON.stringify(fx.counts));
for (const device of WANT) await runDevice(browser, device, statePath, fx);
await browser.close();
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
console.log(`wrote ${captions.length} shots to ${OUT}`);
