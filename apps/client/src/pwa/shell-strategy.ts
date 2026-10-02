// The service worker's caching rules (src/pwa/sw.ts), kept free of worker
// globals so Vitest can check them.

/** One precache entry, as Workbox's injectManifest writes it into the worker. */
export type PrecacheEntry = string | { url: string; revision: string | null };

/** Every shell cache starts with this; old versions are deleted on activate. */
export const CACHE_PREFIX = 'heartpatch-shell-';

/** The cache key for the app page. index.html is fetched as `/`: Caddy redirects `/index.html` there. */
export const SHELL_URL = '/';

/**
 * The server's routes: never cached and never answered from cache, so every
 * game request and live sync reaches the server (CLAUDE.md rule 1). Matches
 * Caddy's `/api/*` and `/ws*` routes.
 */
export function isServerPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/ws');
}

/** The URL path to fetch and cache each entry under. */
export function precachePath(entry: PrecacheEntry): string {
  const url = typeof entry === 'string' ? entry : entry.url;
  const path = `/${url.replace(/^\//, '')}`;
  return path === '/index.html' ? SHELL_URL : path;
}

/**
 * The shell version: a hash of every precached URL and revision. Workbox
 * revisions unhashed files by content and hashed bundles carry their hash in
 * the name, so any change to the shell gives a new version (and a new cache).
 * cyrb53: small, fast, and stable across engines.
 */
export function shellVersion(entries: readonly PrecacheEntry[]): string {
  const text = entries
    .map((entry) => (typeof entry === 'string' ? entry : `${entry.url}#${entry.revision ?? ''}`))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('\n');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h2)}${hex(h1)}`.slice(0, 12);
}

/**
 * A copy without the "redirected" flag. Browsers refuse a redirected response
 * for a page load, and Caddy redirects `/index.html` to `/`.
 */
export async function withoutRedirect(response: Response): Promise<Response> {
  if (!response.redirected) return response;
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Page loads go to the network first, so an online player always gets the
 * newest index.html (and through it the newest bundles). The cached shell is
 * used when the network fails, answers with an error, or is slower than
 * `timeoutMs`.
 */
export async function networkFirst(
  network: Promise<Response>,
  cached: () => Promise<Response | undefined>,
  timeoutMs: number,
): Promise<Response> {
  network.catch(() => undefined); // a failure is handled below, whichever wins the race
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, undefined);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first?.ok) return first;
    return (await cached()) ?? first ?? (await network);
  } catch {
    return (await cached()) ?? Response.error();
  } finally {
    clearTimeout(timer);
  }
}
