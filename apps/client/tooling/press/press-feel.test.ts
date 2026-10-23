import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The press feel (Controls A, apps/client/src/ui/button/press.css), checked
// against every sheet in the client.
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const HERE = fileURLToPath(new URL('../../src/ui/button', import.meta.url));
const buttonCss = readFileSync(join(HERE, 'button.css'), 'utf8');
const pressCss = readFileSync(join(HERE, 'press.css'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Splits on the commas outside any parentheses, tidied. */
function splitTop(list: string): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else part += ch;
  }
  parts.push(part);
  return parts.map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Each rule's selectors (comma-split) and its body. */
function rules(css: string): { selectors: string[]; body: string }[] {
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: splitTop(m[1] ?? ''),
    body: m[2] ?? '',
  }));
}

/** The buttons press.css leaves out of the global squish. */
const optedOut = (() => {
  const list = /:active:not\(([\s\S]*?)\)\s*\)\s*\{/.exec(stripComments(pressCss))?.[1] ?? '';
  return new Set(splitTop(list));
})();

describe('the press feel (Controls A)', () => {
  it('leaves out every button that already squishes with its own :active transform', () => {
    const own = walk(SRC)
      .filter((f) => f.endsWith('.css') && f !== join(HERE, 'press.css'))
      .flatMap((f) => rules(readFileSync(f, 'utf8')))
      .filter((r) => /(^|[\s;])(transform|scale)\s*:/.test(r.body))
      .flatMap((r) => r.selectors)
      .filter((s) => s.endsWith(':active'))
      .map((s) => s.slice(0, -':active'.length));
    expect(own.length).toBeGreaterThan(10); // the scan itself found them
    // A modifier of an opted-out button (.house-pick-dim) is that button too.
    const missing = own.filter(
      (s) => !optedOut.has(s) && ![...optedOut].some((o) => s.startsWith(`${o}-`)),
    );
    expect(missing).toEqual([]);
  });

  it('keeps every selector at zero specificity, so feature rules win', () => {
    const selectors = rules(pressCss).flatMap((r) => r.selectors);
    expect(selectors.length).toBeGreaterThan(2);
    for (const s of selectors) expect(s.replace(/^@media[^{]*\{/, '').trim()).toMatch(/^:where\(/);
  });

  it('squishes with scale, not transform, and calms down under reduced motion', () => {
    const css = stripComments(pressCss);
    expect(css).not.toMatch(/(^|[\s;])transform\s*:/);
    const calm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(calm).toMatch(/scale:\s*none/);
    expect(calm).toMatch(/transition:\s*none/);
  });
});

describe('the shared button (Controls A)', () => {
  it('never drops under a 44 pt tap target (style guide §3.2)', () => {
    const sizes = [...buttonCss.matchAll(/--hp-(?:tap|button-h[\w-]*):\s*(\d+)px/g)].map((m) =>
      Number(m[1]),
    );
    expect(sizes).toHaveLength(3);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(44);
  });
});
