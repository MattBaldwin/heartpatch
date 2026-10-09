import type { LorebookResponse, LoreSlot } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  bookChapters,
  bookCounts,
  chapterEmblem,
  chapterStart,
  foundDate,
  LORE_TEXT,
  newPages,
  stepPage,
} from './lore-view.js';

const page = (id: string) => ({
  id,
  title: 'A page',
  text: 'Words.',
  foundAt: '2026-10-03T00:00:00.000Z',
});

const blank = (id: string, chapter: string, order: number): LoreSlot => ({
  id,
  chapter,
  order,
  hint: 'A hint.',
  found: false,
});
const found = (id: string, chapter: string, order: number, readAt: string | null): LoreSlot => ({
  id,
  chapter,
  order,
  hint: 'A hint.',
  found: true,
  title: 'A page',
  text: 'Words.',
  foundAt: '2026-10-02T12:00:00.000Z',
  readAt,
});

/** Two chapters, sent out of order (the client sorts). */
const book: LorebookResponse = {
  pages: [],
  chapters: [
    { id: 'little-guardians', title: 'Little Guardians', order: 2 },
    { id: 'junipers-gap', title: "Juniper's Gap", order: 1 },
  ],
  slots: [
    found('c', 'little-guardians', 1, '2026-10-03T00:00:00.000Z'),
    blank('b', 'junipers-gap', 2),
    found('a', 'junipers-gap', 1, null),
    found('d', 'little-guardians', 2, null),
  ],
  total: 4,
};

describe('newPages', () => {
  it("keeps the found pages this device hasn't shown, in order", () => {
    const pages = [page('a'), page('b'), page('c')];
    expect(newPages(pages, new Set(['b'])).map((p) => p.id)).toEqual(['a', 'c']);
    expect(newPages(pages, new Set(['a', 'b', 'c']))).toEqual([]);
    expect(newPages([], new Set())).toEqual([]);
  });
});

describe('the book (#307)', () => {
  it('puts chapters and their pages in order, counting found and new pages', () => {
    const chapters = bookChapters(book);
    expect(chapters.map((c) => c.chapter.id)).toEqual(['junipers-gap', 'little-guardians']);
    expect(chapters.map((c) => c.slots.map((s) => s.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(chapters.map((c) => [c.found, c.unread])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(bookCounts(book)).toEqual({ found: 3, total: 4, unread: 2 });
    expect(LORE_TEXT.pagesFound(3, 4)).toBe('Pages found: 3 of 4');
  });

  it('leaves out a chapter with no pages, and copes with an older server (no book)', () => {
    const empty = { ...book, chapters: [...book.chapters, { id: 'x', title: 'X', order: 3 }] };
    expect(bookChapters(empty)).toHaveLength(2);
    expect(bookChapters({ chapters: [], slots: [] })).toEqual([]);
    expect(bookCounts({ slots: [], total: 0 })).toEqual({ found: 0, total: 0, unread: 0 });
  });

  it('turns pages across chapters, and stops at either end', () => {
    const chapters = bookChapters(book);
    expect(stepPage(chapters, 'b', 1)).toBe('c');
    expect(stepPage(chapters, 'c', -1)).toBe('b');
    expect(stepPage(chapters, 'a', -1)).toBeNull();
    expect(stepPage(chapters, 'd', 1)).toBeNull();
    expect(stepPage(chapters, 'nope', 1)).toBeNull();
  });

  it('opens a chapter at its first new page, else its first page', () => {
    const [gap, guardians] = bookChapters(book);
    expect(chapterStart(gap!)).toBe('a');
    expect(chapterStart(guardians!)).toBe('d');
    const read = bookChapters({
      ...book,
      slots: book.slots.map((s) => (s.found ? { ...s, readAt: '2026-10-04T00:00:00.000Z' } : s)),
    });
    expect(chapterStart(read[1]!)).toBe('c');
  });

  it('has an emblem for every chapter, and a plain one for a new chapter', () => {
    expect(chapterEmblem('little-guardians')).toBe('🐾');
    expect(chapterEmblem('a-chapter-from-later')).toBe('📜');
  });

  it('says the day a page was found, and nothing for a bad date', () => {
    expect(foundDate('2026-10-02T12:00:00.000Z', 'en-US')).toBe('Oct 2');
    expect(foundDate('not a date')).toBe('');
  });
});
