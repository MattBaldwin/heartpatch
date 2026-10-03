import { describe, expect, it } from 'vitest';
import { newPages } from './lore-view.js';

const page = (id: string) => ({
  id,
  title: 'A page',
  text: 'Words.',
  foundAt: '2026-10-03T00:00:00.000Z',
});

describe('newPages', () => {
  it("keeps the found pages this device hasn't shown, in order", () => {
    const pages = [page('a'), page('b'), page('c')];
    expect(newPages(pages, new Set(['b'])).map((p) => p.id)).toEqual(['a', 'c']);
    expect(newPages(pages, new Set(['a', 'b', 'c']))).toEqual([]);
    expect(newPages([], new Set())).toEqual([]);
  });
});
