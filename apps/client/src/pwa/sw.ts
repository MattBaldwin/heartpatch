import { isWorkerRequest, type WorkerDescription } from './messages.js';
import {
  CACHE_PREFIX,
  SHELL_URL,
  isServerPath,
  networkFirst,
  precachePath,
  shellVersion,
  withoutRedirect,
  type PrecacheEntry,
} from './shell-strategy.js';

// The service worker (issue #26, tech spec §6 "Offline"). It caches the app
// shell so Heartpatch opens like an app, even on a flaky connection; gameplay
// always talks to the server. vite-plugin-pwa (injectManifest) builds it to
// /sw.js and writes the build's precache list into `self.__WB_MANIFEST`.
// Typed by tsconfig.sw.json (WebWorker lib).

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: PrecacheEntry[] };

const MANIFEST = self.__WB_MANIFEST;
const VERSION = shellVersion(MANIFEST);
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const PRECACHE = new Set(MANIFEST.map(precachePath));
// TUNE: how long a page load waits for the network before using the cached
// shell (a slow connection shouldn't mean a blank screen).
const NAVIGATION_TIMEOUT_MS = 4000;

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  await Promise.all(
    [...PRECACHE].map(async (path) => {
      // Hashed files never change, so reuse the copy from the previous shell
      // rather than downloading it again.
      const kept = path.startsWith('/assets/') ? await caches.match(path) : undefined;
      // `reload` skips the HTTP cache, so the shell is never a stale copy.
      const response = kept ?? (await fetch(new Request(path, { cache: 'reload' })));
      if (!response.ok) throw new Error(`precache ${path}: ${String(response.status)}`);
      await cache.put(path, await withoutRedirect(response));
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

self.addEventListener('install', (event) => {
  // No skipWaiting here: a new version waits for src/pwa/update-flow.ts to
  // switch at a safe moment, so a running game never swaps code mid-play.
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(removeOldShells().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isServerPath(url.pathname)) return;

  if (request.mode === 'navigate' || url.pathname === SHELL_URL || url.pathname === '/index.html') {
    // Fresh pages are not written back: the cache stays exactly the shell
    // this worker installed.
    event.respondWith(
      networkFirst(fetch(request), () => fromShellCache(SHELL_URL), NAVIGATION_TIMEOUT_MS),
    );
  } else if (PRECACHE.has(url.pathname) || url.pathname.startsWith('/assets/')) {
    // Hashed bundles and icons: the cached copy, else the network.
    event.respondWith(fromShellCache(request).then((hit) => hit ?? fetch(request)));
  }
  // Anything else (e.g. splash screens) goes to the network as normal.
});

self.addEventListener('message', (event) => {
  const message: unknown = event.data;
  if (!isWorkerRequest(message)) return;
  if (message.type === 'skip-waiting') {
    void self.skipWaiting();
    return;
  }
  const description: WorkerDescription = {
    version: VERSION,
    cache: CACHE,
    hasPath: PRECACHE.has(message.path),
  };
  event.ports[0]?.postMessage(description);
});
