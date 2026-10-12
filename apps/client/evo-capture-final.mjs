// MOCKUP ONLY: re-shoots the grown-ups (iridescent finish) and the iPhone close-ups.
import { chromium } from '@playwright/test';
const OUT = process.argv[2];
const BASE = 'http://localhost:5199';
const IPHONE = { id: 'iphone', viewport: { width: 390, height: 844 }, dpr: 3 };
const IPAD = { id: 'ipad', viewport: { width: 820, height: 1180 }, dpr: 2 };
const LINE = ['flurrypup', 'gustypup', 'blusterpup', 'mittenpup', 'blizzhowl', 'reindoodle'];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function shot(dev, url, file, hook) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + url);
      await page.waitForFunction(`window.${hook}?.ready?.()`, null, { timeout: 180000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${file}.png` });
      console.log(file);
      return;
    } catch (e) { console.log('retry', file, String(e).slice(0, 80)); } finally { await ctx.close(); }
  }
}
const sheet = { id: 'sheet', viewport: { width: 1100, height: 460 }, dpr: 2 };
for (const [name, line] of [['bluster', 'flurrypup,gustypup,blusterpup,blizzhowl'], ['mitten', 'flurrypup,gustypup,mittenpup,reindoodle']])
  await shot(sheet, `/evo.html?mode=lineup&species=${line}&tier=high&distance=13&pitch=8`, `lineup-${name}`, '__evo');
for (const time of ['day', 'night']) {
  for (const s of LINE) await shot(IPHONE, `/evo.html?mode=closeup&species=${s}&bg=/evo-bg/iphone-${time}.png&tier=high`, `closeup-iphone-${time}-${s}`, '__evo');
  for (const dev of [IPHONE, IPAD]) for (const s of ['blizzhowl', 'reindoodle']) {
    await shot(dev, `/roster.html?species=${s}&time=${time}&tier=high`, `battle-${dev.id}-${time}-${s}`, '__roster');
    if (dev === IPAD) await shot(dev, `/evo.html?mode=closeup&species=${s}&bg=/evo-bg/ipad-${time}.png&tier=high`, `closeup-ipad-${time}-${s}`, '__evo');
  }
}
await browser.close();
