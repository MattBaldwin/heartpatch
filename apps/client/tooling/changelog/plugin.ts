import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { changelogJson, changelogReader, readChangelog } from './changelog.js';

// Serves `changelog.json` in dev and emits it at build (#220). The deploy
// writes it into public/ first (cli.ts, where git history exists); then the
// build leaves that copy alone, since a Docker build context has no .git.

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CHANGES = `${REPO}changes`;
const PREBUILT = fileURLToPath(new URL('../../public/changelog.json', import.meta.url));

export function changelogAsset(): Plugin {
  return {
    name: 'heartpatch:changelog',
    configureServer(server) {
      // Builds are cached until HEAD moves (#296); warm them before the first page asks.
      const read = changelogReader(CHANGES, REPO);
      try {
        read();
      } catch {
        // A bad entry fails its request instead, naming the file.
      }
      server.middlewares.use('/changelog.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(changelogJson(read()));
      });
    },
    generateBundle() {
      if (existsSync(PREBUILT)) return; // public/ copies the deploy's version
      this.emitFile({
        type: 'asset',
        fileName: 'changelog.json',
        source: changelogJson(readChangelog(CHANGES, REPO)),
      });
    },
  };
}
