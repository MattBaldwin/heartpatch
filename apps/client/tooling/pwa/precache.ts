import { createHash } from 'node:crypto';

// Builds the service worker's precache list and shell version from the build
// output, so neither can drift from what was actually built.

export interface OutputFile {
  /** Path in dist/, e.g. `assets/index-abc123.js` or `index.html`. */
  fileName: string;
  content: string | Uint8Array;
}

/**
 * Which built files belong in the offline shell: the page, its hashed bundles
 * and styles, and the given extra public paths (manifest, icons). Source maps,
 * the service worker itself and anything else (dev pages, splash screens)
 * stay out.
 */
export function isShellFile(fileName: string, extras: ReadonlySet<string>): boolean {
  if (fileName === 'index.html') return true;
  if (extras.has(`/${fileName}`)) return true;
  return fileName.startsWith('assets/') && !fileName.endsWith('.map');
}

export interface Precache {
  /** Cache-name suffix: changes whenever any precached byte or the SW code changes. */
  version: string;
  /** Absolute URL paths, sorted. */
  urls: string[];
}

export function buildPrecache(
  files: readonly OutputFile[],
  extras: ReadonlySet<string>,
  workerSource: string,
): Precache {
  const shell = files
    .filter((file) => isShellFile(file.fileName, extras))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  const hash = createHash('sha256');
  hash.update(workerSource);
  for (const file of shell) {
    hash.update(`\0${file.fileName}\0`);
    hash.update(file.content);
  }
  return {
    version: hash.digest('hex').slice(0, 12),
    urls: shell.map((file) => `/${file.fileName}`),
  };
}

/** Placeholders in src/pwa/sw.ts that the build fills in. */
export const VERSION_PLACEHOLDER = '__HP_SHELL_VERSION__';
export const PRECACHE_PLACEHOLDER = '__HP_PRECACHE__';

/**
 * Writes the version and precache list into the built worker. Fails if a
 * placeholder is missing, so a minifier change can't ship a worker that
 * caches nothing.
 */
export function injectPrecache(code: string, { version, urls }: Precache): string {
  const list = new RegExp(`\\[\\s*(["'\`])${PRECACHE_PLACEHOLDER}\\1\\s*\\]`);
  const one = new RegExp(`(["'\`])${VERSION_PLACEHOLDER}\\1`);
  if (!list.test(code) || !one.test(code)) {
    throw new Error('service worker placeholders not found; was src/pwa/sw.ts changed?');
  }
  return code.replace(list, () => JSON.stringify(urls)).replace(one, () => JSON.stringify(version));
}
