// MOCKUP ONLY: captures the evolution chain sheet from the dev server.
import { chromium } from '@playwright/test';
const OUT = process.argv[2];
const BASE = 'http://localhost:5199';
const LINE = ['flurrypup', 'gustypup', 'blusterpup', 'mittenpup', 'blizzhowl', 'reindoodle'];
const DEVICES = [
  { id: 'iphone', viewport: { width: 390, height: 844 }, dpr: 3 },
  { id: 'ipad', viewport: { width: 820, height: 1180 }, dpr: 2 },
];
const only = process.argv[3]; // battle | closeup | lineup | bg
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
async function shot(dev, url, file, hook) {
  const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE + url);
  await page.waitForFunction(`window.${hook}?.ready?.()`, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  const tier = await page.evaluate(`window.__evo?.tier?.() ?? window.__roster?.stats?.()?.tier ?? null`);
  await page.screenshot({ path: `${OUT}/${file}.png` });
  console.log(file, 'tier', tier, errs.length ? errs : '');
  await ctx.close();
}
for (const dev of DEVICES) {
  for (const time of ['day', 'night']) {
    if (!only || only === 'bg')
      await shot(dev, `/roster.html?species=flurrypup&reference=flurrypup&time=${time}&tier=high`, `bg-${dev.id}-${time}`, '__roster');
    for (const s of LINE) {
      if (!only || only === 'battle')
        await shot(dev, `/roster.html?species=${s}&time=${time}&tier=high`, `battle-${dev.id}-${time}-${s}`, '__roster');
      if (!only || only === 'closeup')
        await shot(dev, `/evo.html?mode=closeup&species=${s}&bg=/evo-bg/${dev.id}-${time}.png&tier=high`, `closeup-${dev.id}-${time}-${s}`, '__evo');
    }
  }
  if (!only || only === 'lineup') {
    await shot(dev, `/evo.html?mode=lineup&species=flurrypup,gustypup,blusterpup,blizzhowl&tier=high`, `lineup-${dev.id}-bluster`, '__evo');
    await shot(dev, `/evo.html?mode=lineup&species=flurrypup,gustypup,mittenpup,reindoodle&tier=high`, `lineup-${dev.id}-mitten`, '__evo');
  }
}
await browser.close();
