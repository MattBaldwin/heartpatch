// The service worker (issue #26, tech spec §6 "Offline"). It caches the app
// shell so Heartpatch opens like an app, even on a flaky connection; gameplay
// always talks to the server. Built by tooling/pwa/plugin.ts to /sw.js, which
// fills in the version and precache list. No imports: it ships as one
// classic script. Typed by tsconfig.sw.json (WebWorker lib).

const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = '__HP_SHELL_VERSION__';
const PRECACHE: readonly string[] = ['__HP_PRECACHE__'];

/** Every shell cache starts with this; old versions are deleted on activate. */
const CACHE_PREFIX = 'heartpatch-shell-';
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const SHELL = '/index.html';
// TUNE: how long a page load waits for the network before using the cached
// shell (a slow connection shouldn't mean a blank screen).
const NAVIGATION_TIMEOUT_MS = 4000;

/** Messages from src/pwa/register.ts (kept in sync by hand: this file can't import). */
type Message = { type: 'skip-waiting' } | { type: 'version' };

/**
 * The server's routes: never cached and never answered from cache, so every
 * game request and live sync reaches the server (CLAUDE.md rule 1). Matches
 * Caddy's `/api/*` and `/ws*` routes.
 */
function isServerPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/ws');
}

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  await Promise.all(
    PRECACHE.map(async (url) => {
      // Hashed files never change, so reuse the copy from the previous shell
      // rather than downloading it again.
      const kept = url.startsWith('/assets/') ? await caches.match(url) : undefined;
      // `reload` skips the HTTP cache, so the shell is never a stale copy.
      const response = kept ?? (await fetch(new Request(url, { cache: 'reload' })));
      if (!response.ok) throw new Error(`precache ${url}: ${String(response.status)}`);
      await cache.put(url, response);
    }),
  );
}

async function removeOldShells(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)),
  );
}

async function fromShellCache(request: Request | string): Promise<Response | undefined> {
  const cache = await caches.open(CACHE);
  return cache.match(request);
}

/**
 * Page loads go to the network first, so an online player always gets the
 * newest index.html (and through it the newest bundles). The cached shell is
 * only for offline or very slow loads. Fresh pages are not written back: the
 * cache stays exactly the shell this worker installed.
 */
async function networkFirstPage(request: Request): Promise<Response> {
  const network = fetch(request);
  network.catch(() => undefined); // a failure is handled below, whichever wins the race
  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(resolve, NAVIGATION_TIMEOUT_MS, undefined);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    return (await fromShellCache(SHELL)) ?? (await network);
  } catch {
    return (await fromShellCache(SHELL)) ?? Response.error();
  }
}

/** Hashed bundles and icons: the cached copy, else the network (never written back). */
async function cacheFirst(request: Request): Promise<Response> {
  return (await fromShellCache(request)) ?? fetch(request);
}

sw.addEventListener('install', (event) => {
  // No skipWaiting here: a new version waits until the player taps "Update"
  // (or every Heartpatch tab closes), so a running game never swaps code.
  event.waitUntil(precache());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(removeOldShells().then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || isServerPath(url.pathname)) return;

  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === SHELL) {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else (e.g. splash screens) goes to the network as normal.
});

sw.addEventListener('message', (event) => {
  const message = event.data as Message | null;
  if (message?.type === 'skip-waiting') {
    void sw.skipWaiting();
  } else if (message?.type === 'version') {
    event.ports[0]?.postMessage({ version: VERSION, cache: CACHE });
  }
});
