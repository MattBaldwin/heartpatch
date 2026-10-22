import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Player-facing words follow Patch › Town › Hollow (STYLE_GUIDE §9 Glossary).
// "village" and "community" are code names only and never reach a kid.
const BANNED = /villag|communit/i;

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const CHANGES = fileURLToPath(new URL('../../../../changes', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Drops comments, which may name the code's `village` freely. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('player-facing words', () => {
  it('keeps "village" and "community" out of every client string table', () => {
    const tables = walk(SRC)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const blocks = source.match(/^export const \w+_TEXT\b[\s\S]*?^\}/gm) ?? [];
        // Past the `=`: the table's own name (`COMMUNITY_TEXT`) is code.
        return blocks.map((block) => ({
          file,
          block: stripComments(block.slice(block.indexOf('='))),
        }));
      });
    expect(tables.length).toBeGreaterThan(10); // the scan itself found the tables
    const offenders = tables.filter((t) => BANNED.test(t.block)).map((t) => t.file);
    expect(offenders).toEqual([]);
  });

  it('keeps "village" and "community" out of every changes/ entry', () => {
    const entries = readdirSync(CHANGES).filter((f) => f.endsWith('.md'));
    expect(entries.length).toBeGreaterThan(0);
    const offenders = entries.filter((f) => BANNED.test(readFileSync(join(CHANGES, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
