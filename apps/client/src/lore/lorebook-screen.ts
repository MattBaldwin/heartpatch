import type { FoundLoreSlot, LorebookResponse, LoreSlot } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import {
  bookChapters,
  bookCounts,
  bookOrder,
  chapterEmblem,
  chapterStart,
  foundDate,
  isUnread,
  LORE_TEXT,
  stepPage,
  type BookChapter,
} from './lore-view.js';

// The Lorebook screen (#307, owner-approved mockup 2026-10-09): a book over
// everything. The contents page shows every chapter and the count; a chapter
// opens one page at a time, found pages in full and pages still to find as
// faded blanks with their hint. A tablet held sideways shows a spread: the
// chapter's contents on the left, the page on the right. Page turns animate
// transform and opacity only, and crossfade with reduced motion.

export interface LorebookScreenOptions {
  root: HTMLElement;
  /** Two pages side by side (a tablet held sideways); tests pass their own. */
  twoUp?: () => boolean;
  /** A new page is on screen: it's been read. */
  onRead: (id: string) => void;
  /** The book shut. */
  onClose?: () => void;
}

export interface LorebookScreen {
  /** Opens the book at a page (its id), or at the contents (null). */
  open: (book: LorebookResponse, at: string | null) => void;
  /** Fresh words from the server: shows them where the reader is. */
  update: (book: LorebookResponse) => void;
  close: () => void;
  readonly isOpen: boolean;
  /** The page on screen, or null on the contents (or shut). */
  readonly at: string | null;
}

type Motion = 'none' | 'next' | 'prev';

const TWO_UP_QUERY = '(min-width: 900px) and (orientation: landscape)';

export function createLorebookScreen(options: LorebookScreenOptions): LorebookScreen {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(TWO_UP_QUERY) : null;
  const twoUp = options.twoUp ?? (() => media?.matches ?? false);
  let book: LorebookResponse | null = null;
  let chapters: BookChapter[] = [];
  /** The page on screen, or null for the contents. */
  let at: string | null = null;
  /** Pages that were new when the book opened: they keep their ribbon while it's open. */
  let newThisOpen = new Set<string>();

  const contentsButton = el(
    'button',
    { type: 'button', class: 'lbook-btn', 'data-testid': 'lorebook-contents' },
    `‹ ${LORE_TEXT.contents}`,
  );
  const title = el('h2', { class: 'lbook-title', id: 'lbook-title' }, LORE_TEXT.title);
  const closeButton = el(
    'button',
    {
      type: 'button',
      class: 'lbook-close',
      'aria-label': LORE_TEXT.closeBook,
      'data-testid': 'lorebook-close',
    },
    '✕',
  );
  const tabs = el('div', { class: 'lbook-tabs', role: 'group', 'aria-label': LORE_TEXT.contents });
  const stage = el('div', { class: 'lbook-stage', 'data-testid': 'lorebook-stage' });
  const nav = el('div', { class: 'lbook-nav' });
  const screen = el(
    'section',
    {
      class: 'lbook',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'lbook-title',
      'data-testid': 'lorebook',
    },
    el('div', { class: 'lbook-bar' }, contentsButton, title, closeButton),
    tabs,
    stage,
    nav,
  );
  screen.hidden = true;
  options.root.append(screen);

  contentsButton.addEventListener('click', () => {
    at = null;
    render('none');
  });
  closeButton.addEventListener('click', () => {
    close();
  });

  // Swipe to turn a page (only a real sideways drag; scrolling never turns).
  let swipeFrom: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    swipeFrom = { x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointerup', (e) => {
    if (swipeFrom === null) return;
    const dx = e.clientX - swipeFrom.x;
    const dy = e.clientY - swipeFrom.y;
    swipeFrom = null;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < -50) turn(1);
    else if (dx > 50) turn(-1);
  });
  stage.addEventListener('pointercancel', () => {
    swipeFrom = null;
  });

  document.addEventListener('keydown', (e) => {
    if (screen.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  });
  media?.addEventListener('change', () => {
    if (!screen.hidden) render('none');
  });

  // ── Moving around ──────────────────────────────────────────────────────

  function goTo(id: string | null, motion: Motion): void {
    at = id;
    render(motion);
  }

  function turn(dir: 1 | -1): void {
    if (at === null) return;
    const next = stepPage(chapters, at, dir);
    if (next) goTo(next, dir === 1 ? 'next' : 'prev');
  }

  const slotOf = (id: string | null): LoreSlot | null =>
    id === null ? null : (bookOrder(chapters).find((s) => s.id === id) ?? null);
  const chapterOf = (slot: LoreSlot): BookChapter | null =>
    chapters.find((c) => c.chapter.id === slot.chapter) ?? null;

  // ── Pages ──────────────────────────────────────────────────────────────

  function kicker(chapter: BookChapter, slot: LoreSlot): HTMLElement {
    return el(
      'p',
      { class: 'lbook-kicker' },
      el('span', { 'aria-hidden': 'true' }, chapterEmblem(chapter.chapter.id)),
      LORE_TEXT.kicker(chapter.chapter.title, slot.order),
    );
  }

  function foundPage(chapter: BookChapter, slot: FoundLoreSlot): HTMLElement {
    const page = el(
      'article',
      {
        class: 'lbook-page lbook-found',
        'data-testid': 'lorebook-page',
        'data-page': slot.id,
        'data-found': 'true',
      },
      kicker(chapter, slot),
      el('h3', { class: 'lbook-page-title', 'data-testid': 'lorebook-page-title' }, slot.title),
      el('div', { class: 'lbook-stamp', 'aria-hidden': 'true' }, chapterEmblem(chapter.chapter.id)),
      el('p', { class: 'lbook-text', 'data-testid': 'lorebook-page-text' }, slot.text),
      el('p', { class: 'lbook-foot' }, LORE_TEXT.foundOn(foundDate(slot.foundAt))),
    );
    if (slot.readAt === null || newThisOpen.has(slot.id)) {
      page.prepend(
        el('span', { class: 'lbook-ribbon', 'data-testid': 'lorebook-new' }, LORE_TEXT.newRibbon),
      );
    }
    return page;
  }

  function blankPage(chapter: BookChapter, slot: LoreSlot): HTMLElement {
    return el(
      'article',
      {
        class: 'lbook-page lbook-blank',
        'data-testid': 'lorebook-page',
        'data-page': slot.id,
        'data-found': 'false',
      },
      kicker(chapter, slot),
      el('div', { class: 'lbook-ghost', 'aria-hidden': 'true' }, chapterEmblem(chapter.chapter.id)),
      el('p', { class: 'lbook-blank-label' }, LORE_TEXT.stillToFind),
      el(
        'p',
        { class: 'lbook-hint', 'data-testid': 'lorebook-hint' },
        el('span', { class: 'lbook-hint-label' }, LORE_TEXT.hint),
        `“${slot.hint}”`,
      ),
    );
  }

  function pageFor(chapter: BookChapter, slot: LoreSlot): HTMLElement {
    return slot.found ? foundPage(chapter, slot) : blankPage(chapter, slot);
  }

  /** The little page-shaped marks: one per page, filled once found. */
  function pips(slots: readonly LoreSlot[], className: string): HTMLElement {
    return el(
      'span',
      { class: className, 'aria-hidden': 'true' },
      ...slots.map((s) => el('i', { class: isUnread(s) ? 'on new' : s.found ? 'on' : '' })),
    );
  }

  function contentsHead(current: LorebookResponse): HTMLElement {
    const counts = bookCounts(current);
    return el(
      'div',
      { class: 'lbook-toc-head' },
      el('h3', { class: 'lbook-toc-title' }, `📖 ${LORE_TEXT.title}`),
      el(
        'p',
        { class: 'lbook-count', 'data-testid': 'lorebook-count' },
        LORE_TEXT.pagesFound(counts.found, counts.total),
      ),
      pips(bookOrder(chapters), 'lbook-pips'),
    );
  }

  function chapterList(): HTMLElement {
    return el(
      'div',
      { class: 'lbook-chapters' },
      ...chapters.map((c) => {
        const row = el(
          'button',
          {
            type: 'button',
            class: 'lbook-chapter',
            'data-testid': 'lorebook-chapter',
            'data-chapter': c.chapter.id,
          },
          el('span', { class: 'lbook-emblem', 'aria-hidden': 'true' }, chapterEmblem(c.chapter.id)),
          el(
            'span',
            { class: 'lbook-chapter-words' },
            el('span', { class: 'lbook-chapter-title' }, c.chapter.title),
            el(
              'span',
              { class: 'lbook-chapter-count' },
              LORE_TEXT.chapterFound(c.found, c.slots.length),
              ...(c.unread > 0
                ? [' · ', el('span', { class: 'lbook-chapter-new' }, LORE_TEXT.newPage)]
                : []),
            ),
          ),
          pips(c.slots, 'lbook-minis'),
        );
        row.addEventListener('click', () => {
          goTo(chapterStart(c), 'next');
        });
        return row;
      }),
    );
  }

  /** A tablet's left page: the chapter's own contents. */
  function chapterIndex(chapter: BookChapter, current: string): HTMLElement {
    return el(
      'div',
      { class: 'lbook-page lbook-page-left lbook-index' },
      el('div', { class: 'lbook-stamp', 'aria-hidden': 'true' }, chapterEmblem(chapter.chapter.id)),
      el('h3', { class: 'lbook-index-title' }, chapter.chapter.title),
      el(
        'p',
        { class: 'lbook-count' },
        LORE_TEXT.chapterPages(chapter.found, chapter.slots.length),
      ),
      el(
        'ol',
        { class: 'lbook-slots' },
        ...chapter.slots.map((s) => {
          const button = el(
            'button',
            {
              type: 'button',
              class: 'lbook-slot',
              'aria-current': String(s.id === current),
              'data-testid': 'lorebook-slot',
            },
            el('span', { class: 'lbook-slot-n', 'aria-hidden': 'true' }, String(s.order)),
            s.found
              ? `${s.title}${isUnread(s) ? ' ✨' : ''}`
              : el('span', { class: 'lbook-slot-blank' }, LORE_TEXT.stillToFind),
          );
          button.addEventListener('click', () => {
            const from = chapter.slots.findIndex((x) => x.id === current);
            const to = chapter.slots.indexOf(s);
            if (to !== from) goTo(s.id, to > from ? 'next' : 'prev');
          });
          return el('li', {}, button);
        }),
      ),
    );
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  /** The control with focus inside the book, as a selector to find its redrawn twin. */
  function focusedControl(): string | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !screen.contains(active)) return null;
    const id = active.dataset['testid'];
    if (!id) return null;
    const chapter = active.dataset['chapter'];
    return `[data-testid="${id}"]${chapter ? `[data-chapter="${chapter}"]` : ''}`;
  }

  function render(motion: Motion): void {
    const refocus = focusedControl();
    draw(motion);
    // A redraw replaces the buttons: focus goes back to the same one (VoiceOver,
    // keyboards), or to ✕ if it's gone (the last page's Next turns off).
    if (refocus) {
      const twin = screen.querySelector<HTMLElement>(refocus);
      (twin && !(twin as HTMLButtonElement).disabled ? twin : closeButton).focus();
    }
  }

  function draw(motion: Motion): void {
    const current = book;
    if (!current) return;
    const two = twoUp();
    screen.classList.toggle('lbook-two-up', two);
    const slot = slotOf(at);
    if (at !== null && !slot) at = null;
    const chapter = slot ? chapterOf(slot) : null;
    contentsButton.hidden = slot === null;
    title.textContent = chapter && !two ? chapter.chapter.title : LORE_TEXT.title;

    tabs.replaceChildren(
      ...chapters.map((c) => {
        const tab = el(
          'button',
          {
            type: 'button',
            class: 'lbook-tab',
            'aria-pressed': String(chapter?.chapter.id === c.chapter.id),
            'data-testid': 'lorebook-tab',
            'data-chapter': c.chapter.id,
          },
          el('span', { 'aria-hidden': 'true' }, chapterEmblem(c.chapter.id)),
          c.chapter.title,
        );
        if (c.unread > 0) tab.append(el('span', { class: 'lbook-tab-dot', 'aria-hidden': 'true' }));
        tab.addEventListener('click', () => {
          goTo(chapterStart(c), 'next');
        });
        return tab;
      }),
    );

    let pages: HTMLElement[];
    if (!slot) {
      pages = two
        ? [
            el(
              'div',
              { class: 'lbook-page lbook-page-left lbook-cover' },
              contentsHead(current),
              el('p', { class: 'lbook-blurb' }, LORE_TEXT.blurb),
            ),
            el('div', { class: 'lbook-page lbook-toc' }, chapterList()),
          ]
        : [el('div', { class: 'lbook-page lbook-toc' }, contentsHead(current), chapterList())];
    } else if (chapter) {
      const page = pageFor(chapter, slot);
      pages = two ? [chapterIndex(chapter, slot.id), page] : [page];
    } else {
      pages = [];
    }
    const turning = pages.at(-1);
    if (turning && motion !== 'none') {
      turning.classList.add(`lbook-turn-${motion}`);
      turning.addEventListener(
        'animationend',
        () => {
          turning.classList.remove('lbook-turn-next', 'lbook-turn-prev');
        },
        { once: true },
      );
    }
    stage.replaceChildren(...pages);

    if (slot && chapter) {
      const index = chapter.slots.indexOf(slot);
      const prev = el(
        'button',
        {
          type: 'button',
          class: 'lbook-turn',
          'aria-label': LORE_TEXT.previous,
          'data-testid': 'lorebook-prev',
        },
        '‹',
      );
      const next = el(
        'button',
        {
          type: 'button',
          class: 'lbook-turn',
          'aria-label': LORE_TEXT.next,
          'data-testid': 'lorebook-next',
        },
        '›',
      );
      prev.disabled = stepPage(chapters, slot.id, -1) === null;
      next.disabled = stepPage(chapters, slot.id, 1) === null;
      prev.addEventListener('click', () => {
        turn(-1);
      });
      next.addEventListener('click', () => {
        turn(1);
      });
      nav.replaceChildren(
        prev,
        el(
          'div',
          { class: 'lbook-nav-mid', 'data-testid': 'lorebook-where' },
          el(
            'span',
            {},
            two
              ? `${chapter.chapter.title} · ${LORE_TEXT.pageOf(index + 1, chapter.slots.length)}`
              : LORE_TEXT.pageOf(index + 1, chapter.slots.length),
          ),
          el(
            'span',
            { class: 'lbook-dots', 'aria-hidden': 'true' },
            ...chapter.slots.map((_, i) => el('i', { class: i === index ? 'on' : '' })),
          ),
        ),
        next,
      );
      // A new page on screen has been read (the server keeps it, #307).
      if (isUnread(slot)) options.onRead(slot.id);
    } else {
      nav.replaceChildren(el('p', { class: 'lbook-nav-mid' }, LORE_TEXT.tapChapter));
    }
  }

  /** Where focus goes back to when the book shuts (VoiceOver, keyboards). */
  let returnFocus: HTMLElement | null = null;

  function close(): void {
    if (screen.hidden) return;
    screen.hidden = true;
    at = null;
    if (returnFocus?.isConnected && !returnFocus.closest('[inert], [hidden]')) returnFocus.focus();
    returnFocus = null;
    options.onClose?.();
  }

  return {
    open: (next, page) => {
      book = next;
      chapters = bookChapters(next);
      if (screen.hidden) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        newThisOpen = new Set(next.slots.filter(isUnread).map((s) => s.id));
      }
      screen.hidden = false;
      goTo(page, page === null ? 'none' : 'next');
      closeButton.focus();
    },
    update: (next) => {
      book = next;
      chapters = bookChapters(next);
      if (!screen.hidden) render('none');
    },
    close,
    get isOpen() {
      return !screen.hidden;
    },
    get at() {
      return screen.hidden ? null : at;
    },
  };
}
