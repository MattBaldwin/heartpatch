import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as server from '../src/data/server/index.js';
import * as root from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const serverDir = resolve(srcDir, 'data/server');
const clientDir = resolve(here, '../../../apps/client');

/** The workspace package entries, as the client resolves them (`@heartpatch/source`). */
const packageEntries: Record<string, string> = {
  '@heartpatch/shared': resolve(srcDir, 'index.ts'),
  '@heartpatch/shared/server': resolve(serverDir, 'index.ts'),
};

/**
 * Every source file reachable from `entries` through relative imports,
 * re-exports and `@heartpatch/shared` package imports.
 */
function importGraph(...entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]!;
      const target = spec.startsWith('.')
        ? resolve(dirname(file), spec.replace(/\.js$/, '.ts'))
        : packageEntries[spec];
      if (target !== undefined && existsSync(target)) queue.push(target);
    }
  }
  return seen;
}

/** The client's entry modules: each page's `<script type="module" src>`. */
function clientEntries(): string[] {
  return ['index.html', 'gallery.html'].flatMap((page) => {
    const html = readFileSync(resolve(clientDir, page), 'utf8');
    return [...html.matchAll(/<script[^>]*\ssrc="\/([^"]+)"/g)].map((m) =>
      resolve(clientDir, m[1]!),
    );
  });
}

/** Ids that must never reach a client: secret species, their moves and evolution targets. */
const secretIds = [
  ...server.SERVER_GAME_DATA.secretSpecies.map((s) => s.id),
  ...server.SERVER_GAME_DATA.secretMoves.map((m) => m.id),
  ...server.SERVER_GAME_DATA.secretEvolutions.map((e) => e.into),
];

/** Secret ids mentioned anywhere in `files`, as `file: id`. */
function secretMentions(files: Iterable<string>): string[] {
  return [...files].flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return secretIds.filter((id) => source.includes(id)).map((id) => `${file}: ${id}`);
  });
}

describe('server-only data split (tech spec §2)', () => {
  // The client lint rule and Vite `forbidServerData` plugin block direct
  // imports; this catches a re-export from the root entry.
  it('never reaches data/server from the root entry', () => {
    const reachable = [...importGraph(resolve(srcDir, 'index.ts'))];
    expect(reachable.length).toBeGreaterThan(10);
    expect(reachable.filter((file) => file.startsWith(serverDir))).toEqual([]);
  });

  it('shares no exported values between the root and server entries', () => {
    const rootValues = new Set<unknown>(Object.values(root));
    const leaked = Object.entries(server)
      .filter(([, value]) => rootValues.has(value))
      .map(([name]) => name);
    expect(leaked).toEqual([]);
    expect(Object.keys(root)).not.toContain('SERVER_GAME_DATA');
    expect(Object.keys(root)).not.toContain('SPAWN_TABLES');
  });

  it('exposes data/server only through the @heartpatch/shared/server subpath', () => {
    const pkg = JSON.parse(readFileSync(resolve(srcDir, '../package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(pkg.exports['./server']).toEqual({
      '@heartpatch/source': './src/data/server/index.ts',
      types: './dist/data/server/index.d.ts',
      default: './dist/data/server/index.js',
    });
    expect(Object.keys(pkg.exports['./server']!)).toEqual(Object.keys(pkg.exports['.']!));
  });

  // The recipe book's hints are public flavour: they must never lean on
  // spawn tables, secret species or anything else under data/server.
  it('keeps the recipe book and its data off data/server', () => {
    const files = [
      resolve(srcDir, 'recipe-book/index.ts'),
      resolve(srcDir, 'data/recipe-book.ts'),
      resolve(srcDir, 'schemas/data/recipe-book.ts'),
    ];
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from\s+['"][^'"]*\/server[/'"]/);
    }
    const reachable = [...importGraph(...files)];
    expect(reachable.filter((file) => file.startsWith(serverDir))).toEqual([]);
    // Secret species, moves and forms never appear in the book or its hints.
    expect(secretMentions(reachable)).toEqual([]);
  });

  it('has secret rows to look for', () => {
    expect(server.SERVER_GAME_DATA.secretSpecies.length).toBeGreaterThan(0);
    expect(server.SERVER_GAME_DATA.secretMoves.length).toBeGreaterThan(0);
    expect(server.SERVER_GAME_DATA.secretEvolutions.length).toBeGreaterThan(0);
  });

  // CLAUDE.md rule 6: secret species and forms are server-only.
  it('never mentions a secret id in a module the root entry reaches', () => {
    expect(secretMentions(importGraph(resolve(srcDir, 'index.ts')))).toEqual([]);
  });

  it('never puts a secret species, move or evolution in the public data export', () => {
    const exported = JSON.stringify(root);
    expect(secretIds.filter((id) => exported.includes(id))).toEqual([]);
    expect(root.GAME_DATA.species.filter((s) => s.rarity === 'secret')).toEqual([]);
    const publicSpecies = new Set(root.GAME_DATA.species.map((s) => s.id));
    const reachableSecret = root.GAME_DATA.species.flatMap((s) =>
      s.evolutions.filter((e) => !publicSpecies.has(e.into)).map((e) => `${s.id} → ${e.into}`),
    );
    expect(reachableSecret).toEqual([]);
  });

  it('never reaches data/server or a secret id from a client entry point', () => {
    const entries = clientEntries();
    expect(entries.map((file) => file.slice(clientDir.length + 1)).sort()).toEqual([
      'src/main.ts',
      'src/procedural/gallery/gallery-main.ts',
    ]);
    const reachable = importGraph(...entries);
    expect(reachable.has(resolve(srcDir, 'index.ts'))).toBe(true);
    expect([...reachable].filter((file) => file.startsWith(serverDir))).toEqual([]);
    expect(secretMentions(reachable)).toEqual([]);
  });
});
