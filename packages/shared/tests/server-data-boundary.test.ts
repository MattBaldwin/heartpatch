import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as server from '../src/data/server/index.js';
import * as root from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const serverDir = resolve(srcDir, 'data/server');

/** Every source file reachable from `entry` through relative imports and re-exports. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts'));
      if (existsSync(target)) queue.push(target);
    }
  }
  return seen;
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
});
