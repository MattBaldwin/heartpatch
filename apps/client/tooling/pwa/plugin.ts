import type { Plugin } from 'vite';
import { pwaFiles, splashLinks } from './assets.js';

/**
 * The installed app's look (issue #26): serves and builds the web app
 * manifest, icons and iOS launch screens, and links the launch screens from
 * index.html. The service worker and its precache list are vite-plugin-pwa's
 * job (vite.config.ts).
 */
export function pwaAssets(): Plugin {
  const files = pwaFiles();
  const byPath = new Map(files.map((file) => [file.path, file]));

  return {
    name: 'heartpatch:pwa-assets',

    // Dev serves the same files, drawn on first request.
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

    generateBundle() {
      for (const file of files) {
        this.emitFile({ type: 'asset', fileName: file.path.slice(1), source: file.render() });
      }
    },
  };
}
