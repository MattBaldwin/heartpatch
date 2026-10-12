import { el } from '../ui/dom.js';
import { AWAY_TEXT, type SummaryEntry } from './away-summary.js';
import './away-summary.css';

// The "what landed" banner and its card (#419, owner pick 2026-10-12). One
// slim banner under the patch's name: a tag, a row of chips, and "N more ›"
// for whatever doesn't fit; it hides itself after a few seconds, and a tap
// opens the card with everything. One thing alone is a small pill. Plain DOM
// over the map: it adds no draw calls.

/** How long the banner stays. */
const BANNER_MS = 4000; // TUNE: long enough to read 4 chips, short enough not to nag

export interface AwaySummaryShow {
  readonly entries: readonly SummaryEntry[];
  /** The whole thing in one sentence (screen readers, the e2e). */
  readonly sentence: string;
  /** Back after a while away: "Welcome back!", else "In your Bag!". */
  readonly away: boolean;
}

/** Read-only state for the dev hook. */
export interface AwaySummaryDebug {
  /** What shows: the banner, the one-thing pill, or nothing. */
  readonly shown: 'banner' | 'pill' | null;
  /** Chips in the banner, and how many more are behind "N more". */
  readonly chips: number;
  readonly more: number;
  readonly card: boolean;
}

export interface AwaySummary {
  show: (what: AwaySummaryShow) => void;
  /** Hides the banner and the card (leaving the map). */
  hide: () => void;
  /** The sentence while the banner shows, else null. */
  readonly text: string | null;
  readonly debug: AwaySummaryDebug;
}

export function createAwaySummary(root: HTMLElement): AwaySummary {
  let timer: number | undefined;
  let current: AwaySummaryShow | null = null;
  let chipsShown = 0;

  const tag = el('span', { class: 'away-tag' });
  const chips = el('span', { class: 'away-chips', 'aria-hidden': 'true' });
  const more = el('span', { class: 'away-more', 'aria-hidden': 'true' });
  let bar = el('span', { class: 'away-bar', 'aria-hidden': 'true' });
  // The words a screen reader says, and what the e2e reads ("+5 Timber").
  const sentence = el('span', { class: 'away-sr' });
  // Kept: the e2e watch this node's words (`landed-toast`, as the pop-up was).
  const banner = el(
    'button',
    { type: 'button', class: 'away-banner', 'data-testid': 'landed-toast', 'aria-live': 'polite' },
    tag,
    chips,
    more,
    bar,
    sentence,
  );
  banner.hidden = true;

  const cardTag = el('span', { class: 'away-card-tag' });
  const grid = el('ul', { class: 'away-grid' });
  const trainingTitle = el('h3', { class: 'away-card-section' }, `🎯 ${AWAY_TEXT.training}`);
  const trainingList = el('ul', { class: 'away-training' });
  const nice = el('button', { type: 'button', class: 'auth-button away-nice' }, AWAY_TEXT.nice);
  const card = el(
    'section',
    { class: 'away-card', role: 'dialog', 'aria-labelledby': 'away-card-title' },
    cardTag,
    el('h2', { id: 'away-card-title' }, AWAY_TEXT.cardTitle),
    grid,
    trainingTitle,
    trainingList,
    nice,
  );
  const layer = el('div', { class: 'away-card-layer', 'data-testid': 'away-card' }, card);
  layer.hidden = true;
  root.append(banner, layer);

  const hideBanner = () => {
    window.clearTimeout(timer);
    timer = undefined;
    banner.hidden = true;
  };

  const openCard = () => {
    if (!current || current.entries.length < 2) return;
    hideBanner();
    renderCard(current);
    layer.hidden = false;
    nice.focus();
  };
  banner.addEventListener('click', openCard);
  nice.addEventListener('click', () => {
    layer.hidden = true;
  });
  // A tap outside the card closes it too.
  layer.addEventListener('click', (e) => {
    if (e.target === layer) layer.hidden = true;
  });

  function chipFor(entry: SummaryEntry): HTMLElement {
    if (entry.kind === 'trained') {
      return el(
        'span',
        { class: 'away-chip away-chip-xp' },
        el('span', { class: 'away-chip-icon' }, '🎯'),
        AWAY_TEXT.xp(entry.xp),
      );
    }
    return el(
      'span',
      { class: 'away-chip', 'data-item': entry.id },
      el('span', { class: 'away-chip-icon' }, entry.icon),
      entry.chip,
    );
  }

  /** As many whole chips as fit beside the tag and "N more"; the rest go in the count. */
  function fitChips(entries: readonly SummaryEntry[]): void {
    chips.replaceChildren(...entries.map(chipFor));
    more.hidden = false;
    // Measured with the button at its real width, so the last chip is never cut.
    more.textContent = `${AWAY_TEXT.more(entries.length)} ›`;
    chipsShown = entries.length;
    while (chipsShown > 1 && chips.scrollWidth > chips.clientWidth + 1) {
      chips.lastElementChild?.remove();
      chipsShown -= 1;
    }
    const hiddenCount = entries.length - chipsShown;
    more.textContent = `${AWAY_TEXT.more(hiddenCount)} ›`;
    more.hidden = hiddenCount === 0;
  }

  function renderCard(what: AwaySummaryShow): void {
    cardTag.textContent = what.away ? AWAY_TEXT.cardTagAway : AWAY_TEXT.cardTagNow;
    const items = what.entries.filter((e) => e.kind === 'item');
    grid.replaceChildren(
      ...items.map((e) =>
        el(
          'li',
          { class: 'away-tile', 'data-item': e.id },
          el(
            'span',
            { class: 'away-tile-top' },
            el('span', { class: 'away-tile-icon', 'aria-hidden': 'true' }, e.icon),
            el('span', { class: 'away-tile-n' }, e.chip),
          ),
          el('span', { class: 'away-tile-name' }, e.name),
        ),
      ),
    );
    grid.hidden = items.length === 0;
    const trained = what.entries.find((e) => e.kind === 'trained');
    trainingTitle.hidden = !trained;
    trainingList.hidden = !trained;
    trainingList.replaceChildren(
      ...(trained?.squishies ?? []).map((s) =>
        el(
          'li',
          { class: 'away-trained' },
          el('span', { class: 'away-trained-name' }, s.name),
          el('span', { class: 'away-xp' }, AWAY_TEXT.xp(s.xp)),
        ),
      ),
    );
  }

  return {
    show: (what) => {
      if (what.entries.length === 0) return;
      current = what;
      sentence.textContent = what.sentence;
      const one = what.entries.length === 1 ? what.entries[0] : undefined;
      banner.classList.toggle('away-one', one !== undefined);
      banner.hidden = false;
      if (one) {
        // One thing: a small pill that says it all ("🪵 +5 Timber"), nothing to open.
        tag.textContent = '';
        chips.replaceChildren(
          one.kind === 'item'
            ? el('span', { class: 'away-chip', 'data-item': one.id }, one.line)
            : chipFor(one),
        );
        chipsShown = 1;
        more.hidden = true;
      } else {
        tag.textContent = what.away ? AWAY_TEXT.tagAway : AWAY_TEXT.tagNow;
        fitChips(what.entries);
      }
      // A fresh time-left line, so it runs down from full again.
      const fresh = el('span', { class: 'away-bar away-bar-run', 'aria-hidden': 'true' });
      bar.replaceWith(fresh);
      bar = fresh;
      window.clearTimeout(timer);
      timer = window.setTimeout(hideBanner, BANNER_MS);
    },
    hide: () => {
      hideBanner();
      layer.hidden = true;
      current = null;
    },
    get text() {
      return banner.hidden ? null : sentence.textContent;
    },
    get debug(): AwaySummaryDebug {
      const total = current?.entries.length ?? 0;
      return {
        shown: banner.hidden ? null : banner.classList.contains('away-one') ? 'pill' : 'banner',
        chips: banner.hidden ? 0 : chipsShown,
        more: banner.hidden ? 0 : total - chipsShown,
        card: !layer.hidden,
      };
    },
  };
}
