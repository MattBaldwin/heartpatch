import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ResolvedConfig } from 'vite';
import { pwaFiles, splashLinks } from './assets.js';
import { buildPrecache, injectPrecache, type OutputFile } from './precache.js';

const WORKER_SOURCE = fileURLToPath(new URL('../../src/pwa/sw.ts', import.meta.url));
const WORKER_FILE = 'sw.js';
/** Public-folder files that are part of the offline shell. */
const PUBLIC_SHELL_FILES = ['/favicon.svg'];

/**
 * The installable app (issue #26): serves and builds the web app manifest,
 * icons and iOS launch screens, links the launch screens from index.html, and
 * builds the service worker at a fixed `/sw.js` with its precache list and
 * shell version written from the final build output.
 */
export function pwa(): Plugin {
  const files = pwaFiles();
  const byPath = new Map(files.map((file) => [file.path, file]));
  let config: ResolvedConfig | undefined;

  return {
    name: 'heartpatch:pwa',
    configResolved(resolved) {
      config = resolved;
    },

    // Dev serves the same files, drawn on first request. The dev server never
    // registers the service worker (src/pwa/pwa.ts), so modules stay live.
    configureServer(server) {
      const rendered = new Map<string, Buffer>();
      server.middlewares.use((req, res, next) => {
        const file = byPath.get((req.url ?? '').split('?')[0] ?? '');
        if (!file) {
          next();
          return;
        }
        const body = rendered.get(file.path) ?? file.render();
        rendered.set(file.path, body);
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },

    // Only the game page; dev pages (gallery.html) don't install.
    transformIndexHtml(_html, ctx) {
      return ctx.path === '/index.html' ? splashLinks() : undefined;
    },

    buildStart() {
      if (config?.command !== 'build') return;
      // A separate entry with no imports, so it builds to one self-contained
      // classic script that the page can't share chunks with.
      this.emitFile({ type: 'chunk', id: WORKER_SOURCE, fileName: WORKER_FILE });
    },

    generateBundle: {
      // After Vite has written index.html into the bundle.
      order: 'post',
      handler(_options, bundle) {
        // Files emitted here don't appear in `bundle` (Rolldown), so they're
        // added to the precache inputs by hand below.
        const emitted: OutputFile[] = files.map((file) => {
          const fileName = file.path.slice(1);
          const content = file.render();
          this.emitFile({ type: 'asset', fileName, source: content });
          return { fileName, content };
        });

        const worker = bundle[WORKER_FILE];
        if (worker?.type !== 'chunk') {
          this.error(`${WORKER_FILE} was not built`);
        }
        if (worker.imports.length > 0 || worker.dynamicImports.length > 0) {
          this.error(`${WORKER_FILE} must not import modules (a classic worker can't load them)`);
        }
        if (!('index.html' in bundle)) this.error('index.html is missing from the bundle');

        const outputs: OutputFile[] = Object.values(bundle)
          .filter((file) => file.fileName !== WORKER_FILE)
          .map((file) => ({
            fileName: file.fileName,
            content: file.type === 'chunk' ? file.code : file.source,
          }));
        outputs.push(...emitted.filter((file) => !(file.fileName in bundle)));
        const publicDir = config?.publicDir ?? '';
        for (const url of PUBLIC_SHELL_FILES) {
          outputs.push({
            fileName: url.slice(1),
            content: readFileSync(path.join(publicDir, url)),
          });
        }
        const shellPaths = new Set([
          ...files.filter((file) => file.precache).map((file) => file.path),
          ...PUBLIC_SHELL_FILES,
        ]);
        const precache = buildPrecache(outputs, shellPaths, worker.code);
        worker.code = injectPrecache(worker.code, precache);
        this.info(`shell ${precache.version}: ${String(precache.urls.length)} files precached`);
      },
    },
  };
}
