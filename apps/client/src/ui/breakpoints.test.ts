import { describe, expect, it } from 'vitest';
import {
  LANDSCAPE_PHONE_MAX_HEIGHT,
  LANDSCAPE_PHONE_QUERY,
  MAX_HEIGHT_STEPS,
  MIN_HEIGHT_STEPS,
  ORIENTATIONS,
} from './breakpoints.js';

const sheets = import.meta.glob<string>('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every `@media` prelude in the sheet, comments stripped. */
function queries(css: string): string[] {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media\s+([^{]+)\{/g)].map((m) =>
    (m[1] ?? '').trim(),
  );
}

describe('breakpoint tokens', () => {
  it('has stylesheets to check', () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(20);
  });

  it('keeps the landscape-phone query in step with its height constant', () => {
    expect(LANDSCAPE_PHONE_QUERY).toContain(`max-height: ${String(LANDSCAPE_PHONE_MAX_HEIGHT)}px`);
    expect(MAX_HEIGHT_STEPS).toContain(LANDSCAPE_PHONE_MAX_HEIGHT);
  });

  it('lets stylesheets use only listed height and orientation steps', () => {
    const problems: string[] = [];
    for (const [file, css] of Object.entries(sheets)) {
      for (const query of queries(css)) {
        for (const m of query.matchAll(/\(\s*max-height:\s*(\d+)px\s*\)/g)) {
          if (!(MAX_HEIGHT_STEPS as readonly number[]).includes(Number(m[1]))) {
            problems.push(`${file}: max-height ${m[1] ?? ''}px in "${query}"`);
          }
        }
        for (const m of query.matchAll(/\(\s*min-height:\s*(\d+)px\s*\)/g)) {
          if (!(MIN_HEIGHT_STEPS as readonly number[]).includes(Number(m[1]))) {
            problems.push(`${file}: min-height ${m[1] ?? ''}px in "${query}"`);
          }
        }
        for (const m of query.matchAll(/\(\s*orientation:\s*(\w+)\s*\)/g)) {
          if (!(ORIENTATIONS as readonly string[]).includes(m[1] ?? '')) {
            problems.push(`${file}: orientation ${m[1] ?? ''} in "${query}"`);
          }
        }
        // A phone on its side is always the one shared query, never a variant.
        if (
          /max-height:\s*520px\)\s*and\s*\(\s*min-width/.test(query) &&
          query !== LANDSCAPE_PHONE_QUERY
        ) {
          problems.push(`${file}: "${query}" should be the landscape-phone query`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
