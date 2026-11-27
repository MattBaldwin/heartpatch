import type { AdventView, ClaimAdventResponse, PublicUser } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { hpButton, hpClose } from '../ui/button/button.js';
import { el, messageOf } from '../ui/dom.js';
import { adventApi, type AdventApi } from './advent-api.js';
import {
  ADVENT_TEXT,
  contentsLine,
  dayLook,
  dayNumber,
  foundLines,
  phaseOf,
  pickedCatchUp,
  presentWaiting,
  stuckNote,
  todayOf,
} from './advent-model.js';
import './advent.css';

// The advent calendar's sheet (#37 1d): "Presents under the tree". A 5×5 grid
// of December 1–25, opened / today / catch-up / missed / locked, what today's
// present might hold (item names, never odds), and the two ways to open one.
// The server decides everything (CLAUDE.md rules 1 and 6): a tap sends the day
// and the sheet draws what the server says, then a small reveal shows what
// came out. Its entry is a row in the My Home tray, there only while the
// Christmas season is on for the patch, with a badge while today's waits.

export interface AdventOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  /** Christmas is on for the patch on screen (`seasonsOn`, the game's clock). */
  inSeason: () => boolean;
  /** The Tutorial Glade has no calendar: nothing is read or shown there. */
  isGlade?: (mapId: string) => boolean;
  /** A present landed in this patch's bag: the bag reads again. */
  onOpened?: (mapId: string, opened: ClaimAdventResponse['opened']) => void;
  /** Sounds for the opening (the game's cue set). */
  cue?: (name: 'pop' | 'twinkle') => void;
  /** Reduce Motion is on (tests pass a fake). */
  reducedMotion?: () => boolean;
  /** The sheet opened or closed, so other cards wait their turn. */
  onChange?: () => void;
  api?: AdventApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface AdventDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly waiting: boolean;
  /** Each day's state, in order, or null before the calendar is read. */
  readonly days: readonly string[] | null;
  /** What the reveal shows (its lines), or null while it isn't up. */
  readonly reveal: readonly string[] | null;
  readonly note: string;
}

export interface Advent {
  /** The map on screen (null: none): reads its calendar and shows the entry in season. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** The sheet is open. */
  readonly isOpen: boolean;
  readonly debug: AdventDebug | null;
}

interface Reveal {
  title: string;
  lines: string[];
}

export function createAdvent(options: AdventOptions): Advent {
  const api = options.api ?? adventApi;
  const reduced = () =>
    options.reducedMotion?.() ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let view: AdventView | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let note = '';
  /** The missed day the button means, once the player taps one. */
  let picked: string | null = null;
  let reveal: Reveal | null = null;

  // ── Entry button and sheet ────────────────────────────────────────────
  const badge = el('span', {
    class: 'advent-open-badge',
    'aria-hidden': 'true',
    'data-tray-alert': ADVENT_TEXT.news,
  });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'advent-open',
      'data-testid': 'advent-open',
      'aria-label': ADVENT_TEXT.entry,
    },
    el('span', { class: 'advent-open-icon', 'aria-hidden': 'true' }, '🎄'),
    el('span', { class: 'advent-open-label' }, ADVENT_TEXT.entry),
    badge,
  );
  button.hidden = true;
  const close = hpClose(ADVENT_TEXT.close, 'advent-close');
  const body = el('div', { class: 'advent-body' });
  const sheet = el(
    'section',
    {
      class: 'bag advent-sheet',
      'data-testid': 'advent-sheet',
      role: 'dialog',
      'aria-labelledby': 'advent-title',
    },
    el(
      'div',
      { class: 'tile-panel-head' },
      el('h2', { id: 'advent-title' }, ADVENT_TEXT.title),
      close,
    ),
    body,
  );
  sheet.hidden = true;
  (options.entryRoot ?? options.root).append(button);
  options.root.append(sheet);

  const changed = () => options.onChange?.();
  button.addEventListener('click', () => {
    note = '';
    reveal = null;
    sheet.hidden = false;
    render();
    changed();
    // Read again on opening: the day may have turned over since the map came up.
    void refresh();
  });
  close.addEventListener('click', () => {
    sheet.hidden = true;
    reveal = null;
    render();
    changed();
  });

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const live = (): boolean =>
    mapId !== null && user !== null && !(options.isGlade?.(mapId) ?? false);

  /** Reads the calendar for the map on screen (only in season). */
  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id || !live() || !options.inSeason()) return;
    try {
      const fresh = await api.view(id);
      if (at !== generation) return;
      view = fresh;
    } catch (err) {
      // The entry stays as it was; the sheet says why if it's open.
      if (at === generation && !sheet.hidden) note = messageOf(err);
    }
    if (at === generation) render();
  }

  /** Opens `day`: the server says yes or no; the sheet shows what came out. */
  async function open(day: string, revealTitle: string): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      const reply = await sendCommand(sendDeps, (key) => api.claim(id, day, key), stillHere);
      if (!reply || !stillHere()) return;
      view = reply.advent;
      picked = null;
      reveal = { title: revealTitle, lines: foundLines(reply.opened.items) };
      options.cue?.('pop');
      options.cue?.('twinkle');
      options.onOpened?.(id, reply.opened);
    } catch (err) {
      if (stillHere()) {
        note = messageOf(err);
        // A "not yet" or "already opened" is the server's way of saying the sheet
        // is out of date: draw the calendar as it is now.
        void refresh();
      }
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  function render(): void {
    const inSeason = live() && options.inSeason();
    button.hidden = !inSeason || view === null || phaseOf(view) === 'before';
    const waiting = inSeason && presentWaiting(view);
    badge.hidden = !waiting;
    badge.textContent = waiting ? '1' : '';
    if (sheet.hidden || !view) {
      body.replaceChildren();
      return;
    }
    body.replaceChildren(...(reveal ? revealNodes(reveal) : calendarNodes(view)));
  }

  function revealNodes(found: Reveal): Node[] {
    const still = reduced();
    const gift = el(
      'div',
      { class: `advent-gift${still ? ' advent-still' : ''}`, 'aria-hidden': 'true' },
      '🎁',
    );
    const list = el(
      'ul',
      { class: `advent-found${still ? ' advent-still' : ''}`, 'data-testid': 'advent-found' },
      ...found.lines.map((line) => el('li', { class: 'advent-found-item' }, line)),
    );
    const yay = hpButton(ADVENT_TEXT.yay, { variant: 'primary', testId: 'advent-yay' });
    yay.addEventListener('click', () => {
      reveal = null;
      render();
    });
    return [
      el(
        'div',
        { class: 'advent-reveal', role: 'status', 'data-testid': 'advent-reveal' },
        gift,
        el('p', { class: 'advent-reveal-title' }, found.title),
        list,
        el('p', { class: 'advent-reveal-note' }, ADVENT_TEXT.bag),
      ),
      yay,
    ];
  }

  function calendarNodes(current: AdventView): Node[] {
    const phase = phaseOf(current);
    const today = todayOf(current);
    const missed = pickedCatchUp(current, picked);

    const grid = el(
      'div',
      { class: 'advent-grid', role: 'group', 'aria-label': ADVENT_TEXT.title },
      ...current.days.map((day) => {
        const look = dayLook(day, current);
        const chosen = day.state === 'catch-up' && missed?.day === day.day;
        const cell = el(
          'button',
          {
            type: 'button',
            class: `advent-day advent-day-${day.state}${chosen ? ' advent-day-picked' : ''}`,
            'aria-label': look.label,
            'data-testid': `advent-day-${String(look.number)}`,
            'data-state': day.state,
            ...(day.state === 'catch-up' ? { 'aria-pressed': chosen ? 'true' : 'false' } : {}),
          },
          el('span', { class: 'advent-day-num' }, String(look.number)),
          el(
            'span',
            { class: 'advent-day-tag' },
            el('span', { 'aria-hidden': 'true' }, `${look.icon} `),
            look.tag,
          ),
        );
        cell.disabled = working;
        cell.addEventListener('click', () => {
          note = '';
          if (day.state === 'today') {
            void open(day.day, ADVENT_TEXT.revealToday);
          } else if (day.state === 'catch-up') {
            picked = day.day;
            render();
          } else if (day.state === 'opened' && day.items) {
            reveal = {
              title: ADVENT_TEXT.revealAgain(dayNumber(day)),
              lines: foundLines(day.items),
            };
            render();
          } else {
            note = stuckNote(day, current) ?? '';
            render();
          }
        });
        return cell;
      }),
    );

    const legend = el(
      'ul',
      { class: 'advent-legend' },
      ...(['opened', 'today', 'catch-up', 'locked'] as const).map((state) =>
        el(
          'li',
          { class: `advent-legend-item advent-legend-${state}` },
          el('span', { class: 'advent-swatch', 'aria-hidden': 'true' }),
          ADVENT_TEXT.legend[state],
        ),
      ),
    );

    // What's in the box: today's day while it waits, else whatever's open to catch up.
    const holds =
      today?.state === 'today'
        ? { heading: ADVENT_TEXT.mightHold, ids: today.contents }
        : today === null && missed
          ? { heading: ADVENT_TEXT.mightHoldDay(dayNumber(missed)), ids: missed.contents }
          : null;
    const status =
      phase === 'over'
        ? ADVENT_TEXT.over
        : today?.state === 'opened'
          ? ADVENT_TEXT.todayDone
          : null;
    const box = holds
      ? el(
          'div',
          { class: 'advent-box', 'data-testid': 'advent-contents' },
          el('b', {}, holds.heading),
          ' ',
          contentsLine(holds.ids),
        )
      : status
        ? el('div', { class: 'advent-box', 'data-testid': 'advent-status' }, status)
        : null;

    const openToday = hpButton(working ? ADVENT_TEXT.opening : ADVENT_TEXT.openToday, {
      variant: 'primary',
      testId: 'advent-open-today',
    });
    openToday.disabled = working;
    openToday.addEventListener('click', () => {
      if (today) void open(today.day, ADVENT_TEXT.revealToday);
    });
    const openMissed = missed
      ? hpButton(ADVENT_TEXT.openMissed(dayNumber(missed)), {
          variant: today?.state === 'today' ? 'secondary' : 'primary',
          testId: 'advent-open-missed',
        })
      : null;
    if (openMissed && missed) {
      openMissed.disabled = working;
      openMissed.addEventListener('click', () => {
        void open(missed.day, ADVENT_TEXT.revealDay(dayNumber(missed)));
      });
    }
    // Catch-up is used for today: say so, kindly, instead of a button that can't work.
    const usedNote =
      phase === 'live' && !current.catchUpLeft && current.days.some((d) => d.state === 'missed')
        ? el('p', { class: 'advent-used', 'data-testid': 'advent-used' }, ADVENT_TEXT.catchUpUsed)
        : null;

    return [
      el('p', { class: 'advent-lead' }, ADVENT_TEXT.lead),
      grid,
      legend,
      ...(box ? [box] : []),
      el(
        'p',
        { class: 'bag-note advent-note', role: 'status', 'data-testid': 'advent-note' },
        note,
      ),
      ...(today?.state === 'today' ? [openToday] : []),
      ...(openMissed ? [openMissed] : []),
      ...(usedNote ? [usedNote] : []),
    ];
  }

  const reset = () => {
    generation += 1;
    view = null;
    note = '';
    picked = null;
    reveal = null;
    working = false;
    if (!sheet.hidden) {
      sheet.hidden = true;
      changed();
    }
  };

  return {
    setMap: async (next) => {
      // The same map again (back from a battle or the home base) only reads again.
      if (next !== mapId) reset();
      mapId = next;
      render();
      if (next) await refresh();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      mapId = null;
      reset();
      render();
    },
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        open: !sheet.hidden,
        waiting: presentWaiting(view),
        days: view ? view.days.map((d) => d.state) : null,
        reveal: reveal ? reveal.lines : null,
        note,
      };
    },
  };
}
