import { boxOf, SHEET_SELECTOR } from '../tutorial/sheets.js';
import { el } from '../ui/dom.js';
import {
  AWAY_TEXT,
  flightPath,
  spreadStarts,
  staggerMs,
  type ScreenPoint,
  type SummaryEntry,
} from './away-summary.js';
import './away-summary.css';

// The "what landed" banner and its card (#419, owner pick 2026-10-12). One
// slim banner under the patch's name: a tag, a row of chips, and "N more ›"
// for whatever doesn't fit; it hides itself after a few seconds, and a tap
// opens the card with everything. One thing alone is a small pill. Plain DOM
// over the map: it adds no draw calls.
//
// PR 2: each chip pops up where it landed (its tile on the map) and flies
// into its place in the banner, so the receipt fills chip by chip; the time
// left starts once the last one is in. Reduce Motion: no flight, the chips
// are just there. CSS transforms only (Web Animations), off the map's frames.

/** How long the banner stays once everything is in it (its time-left line runs for as long). */
const BANNER_MS = 4000; // TUNE: long enough to read 4 chips, short enough not to nag
/** Room above the banner for its tag, under whatever else is at the top. */
const TAG_ROOM_PX = 18;
/** While it shows, it checks this often that nothing new sits where it does. */
const PLACE_EVERY_MS = 250;
/** A chip's trip: a pop where it landed, then the flight (about a second over the patch). */
const POP_MS = 260; // TUNE
const FLY_MS = 640; // TUNE
/** The next chip leaves this long after the one before… */
const STAGGER_MS = 70; // TUNE
/** …but all of them leave within this, so a big landing is still about a second. */
const STAGGER_TOTAL_MS = 300; // TUNE
/** Chips that fly; any more just appear (they're behind "N more" anyway). */
const MAX_FLYERS = 10; // TUNE
/** Points along each flight path. */
const FLIGHT_STEPS = 12;
/** Space kept between chips popping up near each other. */
const POP_GAP_PX = 4; // TUNE

export interface AwaySummaryShow {
  readonly entries: readonly SummaryEntry[];
  /** The whole thing in one sentence (screen readers, the e2e). */
  readonly sentence: string;
  /** Back after a while away: "Welcome back!", else "In your Bag!". */
  readonly away: boolean;
  /** Where each chip flies in from (its tile on screen), or null to just appear. */
  readonly from?: (entry: SummaryEntry) => ScreenPoint | null;
}

/** Read-only state for the dev hook. */
export interface AwaySummaryDebug {
  /** What shows: the banner, the one-thing pill, or nothing. */
  readonly shown: 'banner' | 'pill' | null;
  /** Chips in the banner, and how many more are behind "N more". */
  readonly chips: number;
  readonly more: number;
  readonly card: boolean;
  /** Chips still flying in, and how many have flown since the app started. */
  readonly flying: number;
  readonly flown: number;
}

export interface AwaySummary {
  show: (what: AwaySummaryShow) => void;
  /** Hides the banner and the card (leaving the map). */
  hide: () => void;
  /** Puts every chip still flying in its place at once (a sheet opened over the map). */
  landNow: () => void;
  /** The sentence while the banner shows, else null. */
  readonly text: string | null;
  readonly debug: AwaySummaryDebug;
}

/**
 * A sheet is open over the map (the Bag, the job board, an open tray), as the
 * tutorial reads it (`tutorial/sheets.ts`): shut trays (inert) and notes don't
 * count, nor does this banner's own card.
 */
function sheetOpen(): boolean {
  return [...document.querySelectorAll(SHEET_SELECTOR)].some(
    (d) => !d.classList.contains('away-card') && boxOf(d) !== null,
  );
}

/** The player asked for less motion (iOS Settings → Accessibility → Motion). */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface AwaySummaryOptions {
  /**
   * Things at the top of the screen the banner keeps below while it shows
   * (the patch's name, a "You found …" note), so its tag never sits on them.
   */
  readonly clearOf?: () => Iterable<Element>;
}

export function createAwaySummary(
  root: HTMLElement,
  options: AwaySummaryOptions = {},
): AwaySummary {
  let timer: number | undefined;
  let placing: number | undefined;
  let current: AwaySummaryShow | null = null;
  let chipsShown = 0;
  /** The chips in the air, and a count bumped by every show, so a late landing is dropped. */
  let flights: { animation: Animation; flyer: HTMLElement }[] = [];
  let flightRun = 0;
  /** Chips sent flying so far (the dev hook: the e2e checks something flew). */
  let flown = 0;

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
    {
      class: 'away-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'away-card-title',
    },
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

  /** Lands every chip still flying at once (a new show, the card, leaving the map). */
  const stopFlights = () => {
    flightRun += 1;
    for (const { animation, flyer } of flights) {
      animation.cancel();
      flyer.remove();
    }
    flights = [];
    for (const waiting of banner.querySelectorAll('.away-waiting, .away-landed')) {
      waiting.classList.remove('away-waiting', 'away-landed');
    }
  };

  const hideBanner = () => {
    stopFlights();
    window.clearTimeout(timer);
    timer = undefined;
    window.clearInterval(placing);
    placing = undefined;
    banner.hidden = true;
  };

  /** Everything is in the banner: the time left starts. */
  const startHold = () => {
    // A fresh time-left line, so it runs down from full again.
    const fresh = el('span', { class: 'away-bar away-bar-run', 'aria-hidden': 'true' });
    fresh.style.animationDuration = `${String(BANNER_MS)}ms`;
    bar.replaceWith(fresh);
    bar = fresh;
    window.clearTimeout(timer);
    timer = window.setTimeout(hideBanner, BANNER_MS);
  };

  /** Below its usual spot (CSS), or below anything else up there now. */
  const place = () => {
    // Over an open sheet (the Bag, the job board) it's only something to
    // read: a tap there is meant for the sheet. Checked again as sheets come and go.
    banner.classList.toggle('away-quiet', sheetOpen());
    banner.style.top = '';
    const usual = banner.getBoundingClientRect().top;
    let lowest = -Infinity;
    for (const other of options.clearOf?.() ?? []) {
      if (other === banner || other.closest('[hidden]')) continue;
      const box = other.getBoundingClientRect();
      if (box.height > 0) lowest = Math.max(lowest, box.bottom);
    }
    if (lowest + TAG_ROOM_PX > usual) banner.style.top = `${String(lowest + TAG_ROOM_PX)}px`;
  };

  // A turned phone: the chips are measured again for the new width. Never
  // removed: the inventory screen, and so this banner, lasts the app's life.
  window.addEventListener('resize', () => {
    if (banner.hidden || !current || current.entries.length < 2) return;
    fitChips(current.entries);
    place();
  });

  /** Where focus was before the card, so closing it puts it back. */
  let focusBefore: HTMLElement | null = null;
  const openCard = () => {
    if (!current || current.entries.length < 2) return;
    focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    hideBanner();
    renderCard(current);
    layer.hidden = false;
    nice.focus();
  };
  const closeCard = () => {
    if (layer.hidden) return;
    layer.hidden = true;
    if (focusBefore?.isConnected && focusBefore !== banner) focusBefore.focus();
    focusBefore = null;
  };
  banner.addEventListener('click', openCard);
  nice.addEventListener('click', closeCard);
  // A tap outside the card, or Escape on a keyboard, closes it too.
  layer.addEventListener('click', (e) => {
    if (e.target === layer) closeCard();
  });
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCard();
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

  /** Every chip if they fit; else as many whole ones as fit beside "N more", which counts the rest. */
  function fitChips(entries: readonly SummaryEntry[]): void {
    chips.classList.remove('away-fit');
    chips.replaceChildren(...entries.map(chipFor));
    chipsShown = entries.length;
    more.hidden = true;
    if (!overflows()) {
      chips.classList.add('away-fit');
      return;
    }
    more.hidden = false;
    // Measured with the button at its widest, so the last chip is never cut.
    more.textContent = `${AWAY_TEXT.more(entries.length)} ›`;
    while (chipsShown > 1 && overflows()) {
      chips.lastElementChild?.remove();
      chipsShown -= 1;
    }
    const hiddenCount = entries.length - chipsShown;
    more.textContent = `${AWAY_TEXT.more(hiddenCount)} ›`;
    more.hidden = hiddenCount === 0;
    chips.classList.add('away-fit');
  }

  function overflows(): boolean {
    return chips.scrollWidth > chips.clientWidth + 1;
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

  /**
   * Sends each chip from where it landed to its place in the banner (the "N
   * more" button for one that didn't fit). False when nothing flies: Reduce
   * Motion, or nowhere to fly from.
   */
  function fly(what: AwaySummaryShow): boolean {
    const from = what.from;
    // Nothing flies across an open sheet (the Bag, chat, the job board…): the
    // banner is only to read there, and the chips are just in it.
    if (!from || reducedMotion() || sheetOpen()) return false;
    const run = flightRun;
    const trips = what.entries.slice(0, MAX_FLYERS).flatMap((entry, i) => {
      const spot = from(entry);
      const slot = i < chipsShown ? chips.children[i] : more;
      if (!spot || !(slot instanceof HTMLElement) || slot.hidden) return [];
      const flyer = chipFor(entry);
      flyer.classList.add('away-flyer');
      flyer.setAttribute('aria-hidden', 'true');
      return [{ spot, slot, flyer }];
    });
    if (trips.length === 0) return false;
    for (const { slot } of trips) if (slot !== more) slot.classList.add('away-waiting');
    // Measured first, so chips popping up near each other (one tile, or
    // neighbouring tiles on a small phone) are spread and never hide a number.
    root.append(...trips.map((t) => t.flyer));
    const sizes = trips.map((t) => t.flyer.getBoundingClientRect());
    const below = banner.getBoundingClientRect().bottom;
    const starts = spreadStarts(
      trips.map((t) => t.spot),
      sizes,
      POP_GAP_PX,
      { top: below + POP_GAP_PX, left: 0, right: innerWidth, bottom: innerHeight },
    );
    const stagger = staggerMs(trips.length, STAGGER_MS, STAGGER_TOTAL_MS);
    flown += trips.length;
    const landed = trips.map(({ slot, flyer, spot }, k) => {
      const size = sizes[k] ?? flyer.getBoundingClientRect();
      const start = starts[k] ?? spot;
      const box = slot.getBoundingClientRect();
      const end = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const at = (p: ScreenPoint, scale: number) =>
        `translate(${String(p.x - size.width / 2)}px, ${String(p.y - size.height / 2)}px) scale(${String(scale)})`;
      const pop = POP_MS / (POP_MS + FLY_MS);
      const path = flightPath(start, end, FLIGHT_STEPS);
      const animation = flyer.animate(
        [
          { transform: at(start, 0.4), opacity: 0, offset: 0, easing: 'ease-out' },
          { transform: at(start, 1.15), opacity: 1, offset: pop * 0.6 },
          { transform: at(start, 1), opacity: 1, offset: pop, easing: 'ease-in' },
          ...path.slice(1).map((p, j) => ({
            transform: at(p, 1 - (0.15 * (j + 1)) / FLIGHT_STEPS),
            opacity: 1,
            offset: pop + ((1 - pop) * (j + 1)) / FLIGHT_STEPS,
          })),
        ],
        { duration: POP_MS + FLY_MS, delay: k * stagger, fill: 'both' },
      );
      flights.push({ animation, flyer });
      return animation.finished.then(() => {
        if (run !== flightRun) return;
        flyer.remove();
        flights = flights.filter((f) => f.flyer !== flyer);
        slot.classList.remove('away-waiting');
        // The pop plays once per landing: the class goes when it ends ("N
        // more" stays for the app's life, and would pop again when next shown).
        slot.classList.add('away-landed');
        const done = () => {
          slot.classList.remove('away-landed');
          slot.removeEventListener('animationend', done);
          slot.removeEventListener('animationcancel', done);
        };
        slot.addEventListener('animationend', done);
        slot.addEventListener('animationcancel', done);
      });
    });
    // A cancelled flight rejects; whatever stopped it has taken over.
    void Promise.all(landed)
      .then(() => {
        if (run === flightRun) startHold();
      })
      .catch(() => undefined);
    return true;
  }

  return {
    show: (what) => {
      if (what.entries.length === 0) return;
      current = what;
      sentence.textContent = what.sentence;
      const one = what.entries.length === 1 ? what.entries[0] : undefined;
      banner.classList.toggle('away-one', one !== undefined);
      stopFlights();
      // The pill says it all and opens nothing: no stop for a screen reader either.
      if (one) {
        banner.setAttribute('aria-disabled', 'true');
        banner.tabIndex = -1;
      } else {
        banner.removeAttribute('aria-disabled');
        banner.removeAttribute('tabindex');
      }
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
      // The time-left line holds full until the last chip is in.
      bar.classList.remove('away-bar-run');
      window.clearTimeout(timer);
      timer = undefined;
      // Placed first, so the chips fly to where the banner really is.
      place();
      window.clearInterval(placing);
      placing = window.setInterval(place, PLACE_EVERY_MS);
      if (!fly(what)) startHold();
    },
    hide: () => {
      hideBanner();
      closeCard();
      current = null;
    },
    landNow: () => {
      if (flights.length === 0) return;
      stopFlights();
      if (!banner.hidden) startHold();
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
        flying: flights.length,
        flown,
      };
    },
  };
}
