import { expect, test, type Page } from '@playwright/test';
import { pickKeeper, savedCode, TEST_PASSWORD } from './players.js';

// The installable app (issue #26), against a production build (`vite preview`,
// playwright.config.ts): the dev server never registers the service worker.
// Assertions are on signals (manifest, worker state, cache contents), never pixels.
test.use({ baseURL: 'http://localhost:4173' });

// The family signup code the servers start with (playwright.config.ts).
const signupCode = process.env['HP_SIGNUP_CODE'] ?? '';

interface ShellInfo {
  version: string;
  cache: string;
}

/**
 * Waits for the worker to reach `activated` (`ready` resolves while it may
 * still be activating) and asks it for its shell version.
 */
async function activeShell(page: Page): Promise<ShellInfo> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) throw new Error('no active service worker');
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
        });
      });
    }
    return new Promise<ShellInfo>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent<ShellInfo>) => {
        resolve(event.data);
      };
      worker.postMessage({ type: 'describe', path: '/' }, [channel.port2]);
    });
  });
}

function cachedPaths(page: Page, cacheName: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, cacheName);
}

test('links a valid web app manifest and home-screen icon', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');

  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Heartpatch',
    display: 'standalone',
    start_url: '/',
    theme_color: '#fde8f0',
  });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  const iconUrls = [
    ...manifest.icons.map((icon) => icon.src),
    (await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))!,
  ];
  for (const url of iconUrls) {
    const icon = await request.get(url);
    expect(icon.ok(), url).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/png');
  }

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );
  const splashes = page.locator('link[rel="apple-touch-startup-image"]');
  expect(await splashes.count()).toBeGreaterThan(20);
  const splash = await request.get((await splashes.first().getAttribute('href'))!);
  expect(splash.ok()).toBe(true);
});

test('installs the shell in a versioned cache, without the API', async ({ page }) => {
  await page.goto('/');
  const info = await activeShell(page);
  expect(info.version).toMatch(/^[0-9a-f]{12}$/);
  expect(info.cache).toBe(`heartpatch-shell-${info.version}`);
  expect(await page.evaluate(() => caches.keys())).toEqual([info.cache]);

  // The page talks to the API while the worker controls it…
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => fetch('/api/v1/health').then((r) => r.status))).toBe(200);

  // …and none of it is cached: only the shell, no source maps or splash screens.
  const paths = await cachedPaths(page, info.cache);
  expect(paths).toEqual(expect.arrayContaining(['/', '/manifest.webmanifest']));
  expect(paths.some((path) => path.startsWith('/assets/') && path.endsWith('.js'))).toBe(true);
  const unwanted = paths.filter((path) => /^\/(api|ws)|\.map$|splash|gallery/.test(path));
  expect(unwanted).toEqual([]);
});

test('a new install deletes old shell caches', async ({ page }) => {
  await page.goto('/');
  const { cache } = await activeShell(page);
  await page.evaluate(async () => {
    await caches.open('heartpatch-shell-0123456789ab');
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
  });
  expect(await page.evaluate(() => caches.keys())).toContain('heartpatch-shell-0123456789ab');

  // Registering again installs and activates the shell, which clears the stale one.
  await page.reload();
  expect((await activeShell(page)).cache).toBe(cache);
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual([cache]);
});

// Playwright WebKit's setOffline also blocks service-worker-handled requests,
// so offline behaviour is verified end-to-end on Chromium and by cache
// contents on every browser (WebKit included); real-device check in the PR's
// "How to test on iPhone".
test('keeps the shell for offline use, but never the API', async ({
  page,
  context,
  browserName,
}) => {
  await page.goto('/');
  const info = await activeShell(page);
  await page.reload(); // now controlled by the worker
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(info.cache).toContain(info.version);

  // Cache Storage reads use no network: the shell page is cached…
  const shell = await page.evaluate(async () => {
    const response = await caches.match('/');
    return response ? await response.text() : null;
  });
  expect(shell).toContain('<canvas id="game"');
  // …and no cache holds anything from the server.
  const serverUrls = await page.evaluate(async () => {
    const found: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        if (request.url.includes('/api/') || request.url.includes('/ws')) found.push(request.url);
      }
    }
    return found;
  });
  expect(serverUrls).toEqual([]);

  // Chromium also proves it end-to-end: an offline reload opens the shell.
  if (browserName === 'chromium') {
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#game')).toBeAttached();
    const offlineApi = await page.evaluate(() =>
      fetch('/api/v1/health').then(
        () => 'answered',
        () => 'failed',
      ),
    );
    expect(offlineApi).toBe('failed');
    await context.setOffline(false);
  }
});

test('shows the Add to Home Screen guide in Safari, in the lobby, until dismissed', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  // Never under the sign-in card (#135): it waits for the lobby.
  const overlay = page.getByTestId('auth-overlay');
  await expect(overlay.getByRole('heading', { name: 'Welcome to Heartpatch!' })).toBeVisible();
  await expect(page.getByTestId('install-guide')).toHaveCount(0);

  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await overlay.getByLabel('Family or invite code').fill(signupCode);
  await overlay
    .getByLabel('Pick a name')
    .fill(`pwa_${Date.now().toString(36)}${String(testInfo.workerIndex)}`);
  await overlay.getByLabel('Pick a password').fill(TEST_PASSWORD);
  await overlay.getByLabel('Year you were born').selectOption('2014');
  await overlay.getByRole('button', { name: 'Sign up' }).tap();
  await savedCode(overlay);
  await expect(overlay).toBeHidden();
  await pickKeeper(page);

  // A card in the patch list: on top, so a finger on "Got it!" reaches it.
  const lobby = page.getByTestId('lobby');
  const guide = lobby.getByTestId('install-guide');
  await expect(guide).toContainText('Add to Home Screen');
  const close = guide.getByRole('button', { name: 'Got it!' });
  await close.scrollIntoViewIfNeeded();
  const reached = await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button;
  });
  expect(reached).toBe(true);
  await close.tap();
  await expect(page.getByTestId('install-guide')).toHaveCount(0);

  await page.reload();
  await expect(lobby.getByRole('heading', { name: 'Your patches' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId('install-guide')).toHaveCount(0);
});
