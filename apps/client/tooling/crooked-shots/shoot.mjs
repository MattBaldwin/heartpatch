/* global process, console, window, setTimeout */
// PROTOTYPE ONLY (#306 design lane): captures the Crooked House mockup page
// (`/crooked.html`, no server needed) at iPhone and iPad sizes with headless
// Chromium (SwiftShader). `node tooling/crooked-shots/shoot.mjs` with the
// client dev server running. SHOTS and DEVICES narrow the set; OUT is the folder.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = process.env.OUT ?? path.resolve('.crooked-shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
const DEVICES = { iphone: { width: 390, height: 844, dpr: 2 }, ipad: { width: 1180, height: 820, dpr: 2 } };
const shots = (process.env.SHOTS ?? 'dark,lit,echo,caught,door,key,bonus,attic,plan,plan-up').split(',');
const devices = (process.env.DEVICES ?? 'iphone').split(',');

async function until(page, fn, timeout = 240_000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 400));
  }
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(process.env.PW_CHROMIUM_ARGS ?? '').split(' ').filter(Boolean)],
});
for (const device of devices) {
  const d = DEVICES[device];
  const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr, isMobile: device !== 'ipad', hasTouch: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  for (const shot of shots) {
    const url = `${BASE}/crooked.html?shot=${shot}&tier=high`;
    await page.goto(url, { waitUntil: 'load' });
    await until(page, () => window.__heartpatch?.ready?.() && window.__heartpatch.draws() >= 4);
    await page.evaluate(() => window.__heartpatch.invalidate());
    await new Promise((r) => setTimeout(r, 1500));
    const file = path.join(OUT, `${shot}-${device}.png`);
    await page.screenshot({ path: file });
    console.log('wrote', file);
  }
  await ctx.close();
}
await browser.close();
