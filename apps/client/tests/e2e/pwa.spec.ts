import { expect, test, type Page } from '@playwright/test';

// The installable app (issue #26), against a production build (`vite preview`,
// playwright.config.ts): the dev server never registers the service worker.
// Assertions are on signals (manifest, worker state, cache contents), never pixels.
test.use({ baseURL: 'http://localhost:4173' });

interface ShellInfo {
  version: string;
  cache: string;
}

/** Waits for the worker to activate and asks it for its shell version. */
async function activeShell(page: Page): Promise<{ state: string; info: ShellInfo }> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) throw new Error('no active service worker');
    const info = await new Promise<ShellInfo>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent<ShellInfo>) => {
        resolve(event.data);
      };
      worker.postMessage({ type: 'version' }, [channel.port2]);
    });
    return { state: worker.state, info };
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

test('installs the offline shell in a versioned cache, without the API', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const { state, info } = await activeShell(page);
  expect(state).toBe('activated');
  expect(info.version).toMatch(/^[0-9a-f]{12}$/);
  expect(info.cache).toBe(`heartpatch-shell-${info.version}`);
  expect(await page.evaluate(() => caches.keys())).toEqual([info.cache]);

  // The page talks to the API while the worker controls it…
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(await page.evaluate(() => fetch('/api/v1/health').then((r) => r.status))).toBe(200);

  // …and none of it is cached: only the shell, no source maps or splash screens.
  const paths = await cachedPaths(page, info.cache);
  expect(paths).toEqual(expect.arrayContaining(['/index.html', '/manifest.webmanifest']));
  expect(paths.some((path) => path.startsWith('/assets/') && path.endsWith('.js'))).toBe(true);
  const unwanted = paths.filter((path) => /^\/(api|ws)|\.map$|splash|gallery/.test(path));
  expect(unwanted).toEqual([]);

  // Offline, the shell still opens, but API calls fail rather than come from a cache.
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
});

test('shows the Add to Home Screen guide once in Safari', async ({ page }) => {
  await page.goto('/');
  const guide = page.getByTestId('install-guide');
  await expect(guide.getByRole('heading', { name: 'Make Heartpatch an app!' })).toBeVisible();
  await expect(guide).toContainText('Add to Home Screen');

  await guide.getByRole('button', { name: 'Got it!' }).tap();
  await expect(guide).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('auth-overlay')).toBeVisible();
  await expect(page.getByTestId('install-guide')).toHaveCount(0);
});
