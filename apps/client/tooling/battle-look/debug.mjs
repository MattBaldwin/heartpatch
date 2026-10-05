import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_EXECUTABLE, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(process.argv[2] ?? 'http://localhost:5173/battle-look.html?dir=A&shot=idle', { waitUntil: 'load' });
await page.waitForSelector('canvas[data-ready="true"]', { timeout: 120000 });
await page.waitForFunction(() => window.__heartpatchLook?.settled() === true, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => window.__heartpatchLook.debug()), null, 1));
await browser.close();
