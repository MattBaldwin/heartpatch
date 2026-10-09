import type { LoreBookChapter, LorebookResponse, LorePage, LoreSlot } from '@heartpatch/shared';

// What the Lorebook shows (design doc §16, #307). Pure, so it's tested
// without a DOM. The server sends every page's place and hint, and the words
// only of pages the player has found.

export const LORE_TEXT = {
  found: 'You found a lore page!',
  title: 'Lorebook',
  open: 'Lorebook',
  openBook: 'Open Lorebook 📖',
  close: 'Close',
  closeBook: 'Close Lorebook',
  next: 'Next page',
  previous: 'Previous page',
  contents: 'Contents',
  tapChapter: 'Tap a chapter to open it',
  blurb: 'Every page is a little piece of the story. Keep exploring, and listen for tiny paws…',
  pagesFound: (found: number, total: number) => `Pages found: ${String(found)} of ${String(total)}`,
  chapterFound: (found: number, of: number) => `${String(found)} of ${String(of)} found`,
  chapterPages: (found: number, of: number) => `${String(found)} of ${String(of)} pages found`,
  newPage: '✨ new page',
  newRibbon: 'New ✨',
  stillToFind: 'A page still to find',
  hint: 'Hint',
  pageOf: (n: number, of: number) => `Page ${String(n)} of ${String(of)}`,
  kicker: (chapter: string, n: number) => `${chapter} · Page ${String(n)}`,
  foundOn: (date: string) => `Found ${date}`,
  bagTile: 'Lorebook',
  bagCount: (found: number, total: number) => `${String(found)} of ${String(total)} pages found`,
  bagNew: (n: number) => `${String(n)} new`,
  news: 'A new page in your Lorebook!',
} as const;

/** A little emblem per chapter (the server names chapters; how they look is ours). */
const EMBLEMS: Readonly<Record<string, string>> = {
  'junipers-gap': '🌱',
  'wild-lands': '🍂',
  'hollow-man': '🌙',
  'little-guardians': '🐾',
};

export function chapterEmblem(chapterId: string): string {
  return EMBLEMS[chapterId] ?? '📜';
}

/** A chapter with its pages in order. */
export interface BookChapter {
  readonly chapter: LoreBookChapter;
  readonly slots: readonly LoreSlot[];
  readonly found: number;
  readonly unread: number;
}

/** The book's chapters in order, each with its pages in order (chapters with no pages left out). */
export function bookChapters(book: Pick<LorebookResponse, 'chapters' | 'slots'>): BookChapter[] {
  return [...book.chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => {
      const slots = book.slots
        .filter((s) => s.chapter === chapter.id)
        .sort((a, b) => a.order - b.order);
      return {
        chapter,
        slots,
        found: slots.filter((s) => s.found).length,
        unread: slots.filter(isUnread).length,
      };
    })
    .filter((c) => c.slots.length > 0);
}

/** A found page not yet read in the book. */
export function isUnread(slot: LoreSlot): boolean {
  return slot.found && slot.readAt === null;
}

/** How many pages are found, how many there are, and how many are new. */
export function bookCounts(book: Pick<LorebookResponse, 'slots' | 'total'>): {
  readonly found: number;
  readonly total: number;
  readonly unread: number;
} {
  return {
    found: book.slots.filter((s) => s.found).length,
    total: book.total,
    unread: book.slots.filter(isUnread).length,
  };
}

/** Every page in book order (chapter, then place). */
export function bookOrder(chapters: readonly BookChapter[]): LoreSlot[] {
  return chapters.flatMap((c) => c.slots);
}

/** The page `dir` pages from `id` in book order, across chapters; null past either end. */
export function stepPage(chapters: readonly BookChapter[], id: string, dir: 1 | -1): string | null {
  const order = bookOrder(chapters);
  const at = order.findIndex((s) => s.id === id);
  if (at < 0) return null;
  return order[at + dir]?.id ?? null;
}

/** Where a page opens a chapter: its first new page, else its first page. */
export function chapterStart(chapter: BookChapter): string | null {
  return (chapter.slots.find(isUnread) ?? chapter.slots[0])?.id ?? null;
}

/** "Oct 2", in the player's own calendar. */
export function foundDate(iso: string, locale?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Found pages this device hasn't shown yet, oldest first. */
export function newPages(pages: readonly LorePage[], shown: ReadonlySet<string>): LorePage[] {
  return pages.filter((p) => !shown.has(p.id));
}
