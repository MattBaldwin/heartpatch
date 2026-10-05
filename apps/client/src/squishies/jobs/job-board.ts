import type { JobSquishy, JobsView, SetJobRequest } from '@heartpatch/shared';
import { describeItems } from '../../inventory/bag-view.js';
import { GameClock } from '../../inventory/game-clock.js';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { ApiRequestError } from '../../net/api.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { el, messageOf } from '../../ui/dom.js';
import { jobsApi, type JobsApi } from './jobs-api.js';
import {
  anythingReady,
  colorOf,
  hintLines,
  jobLine,
  JOBS_TEXT,
  nameOf,
  readyTotal,
  spotLabel,
} from './jobs-view.js';
import './jobs.css';

// The job board (owner decisions 2026-10-04): every squishy with its job, a
// quick reassign (Team, Gather, Rest), what it's good at, and each gatherer's
// next ready time. A self-contained DOM sheet: anything can open it with a
// map id (the trays, a temporary button, the tile panel). The server decides
// everything; the sheet counts down on the server's clock.

export interface JobBoardOptions {
  root: HTMLElement;
  api?: JobsApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** A command changed the bag (collected work): the bag can refetch. */
  onChanged?: (mapId: string) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface JobBoardDebug {
  readonly open: boolean;
  readonly mapId: string | null;
  readonly jobs: Readonly<Record<string, string>>;
  readonly team: readonly string[];
  readonly ready: Readonly<Record<string, number>>;
  readonly note: string;
}

export interface JobBoard {
  /** Opens the board for my squishies on this map; `spot` opens its gatherer picker there. */
  open: (mapId: string, spot?: { q: number; r: number }) => Promise<void>;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: JobBoardDebug;
}

/** Its work tile's resource is out of season (Pumpkins after Halloween): it finds nothing. */
function outOfSeason(view: JobsView, work: NonNullable<JobSquishy['work']>): boolean {
  return view.spots.some((s) => s.q === work.q && s.r === work.r && !s.inSeason);
}

/** A little colour blob for a squishy (CSSOM, so the CSP needs no inline styles). */
export function blobFor(s: JobSquishy): HTMLElement {
  const blob = el('span', { class: 'jobs-blob', 'aria-hidden': 'true' });
  blob.style.background = colorOf(s);
  return blob;
}

export function createJobBoard(options: JobBoardOptions): JobBoard {
  const api = options.api ?? jobsApi;
  const clock = new GameClock(options.now);
  let mapId: string | null = null;
  let view: JobsView | null = null;
  /** The squishy picking a spot to gather, or null. */
  let picking: string | null = null;
  /** A spot to offer first (opened from the tile panel). */
  let wantSpot: { q: number; r: number } | null = null;
  let working = false;
  let ticker: number | undefined;
  /** Each gatherer's job line, so the countdown updates its text and nothing else. */
  let lines = new Map<string, { squishy: JobSquishy; node: HTMLElement }>();
  /** Bumped by every open and close, so a late reply is dropped. */
  let ticket = 0;
  /** A finished countdown already asked the server once (reset by every render). */
  let askedAgain = false;

  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': JOBS_TEXT.close },
    '×',
  );
  const note = el('p', { class: 'jobs-note', role: 'status', 'data-testid': 'jobs-note' });
  const collectButton = el('button', {
    type: 'button',
    class: 'auth-button jobs-collect',
    'data-testid': 'jobs-collect',
  });
  const list = el('ul', { class: 'jobs-list', 'data-testid': 'jobs-list' });
  const sheet = el(
    'section',
    { class: 'jobs-sheet', role: 'dialog', 'aria-labelledby': 'jobs-title', 'data-testid': 'jobs' },
    el(
      'div',
      { class: 'tile-panel-head' },
      el('h2', { id: 'jobs-title' }, JOBS_TEXT.boardTitle),
      close,
    ),
    note,
    collectButton,
    list,
  );
  sheet.hidden = true;
  options.root.append(sheet);

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };
  const say = (text: string) => {
    note.textContent = text;
  };
  const setView = (next: JobsView) => {
    view = next;
    clock.sync(next.now);
  };

  close.addEventListener('click', () => {
    closeBoard();
  });
  collectButton.addEventListener('click', () => {
    void act(async (id, send) => {
      const res = await send((key) => api.collect(id, key));
      if (!res) return;
      setView(res.jobs);
      say(describeItems(res.granted) || 'All collected!');
      options.onChanged?.(id);
    });
  });

  /** Runs one command for the board on screen, one at a time; a CONFLICT refetches. */
  async function act(
    run: (
      mapId: string,
      send: <T>(command: (key: string) => Promise<T>) => Promise<T | null>,
    ) => Promise<void>,
  ): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const mine = ticket;
    working = true;
    render();
    try {
      await run(id, (command) => sendCommand(sendDeps, command, () => mine === ticket));
    } catch (err) {
      if (mine !== ticket) return;
      say(messageOf(err));
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        const fresh = await api.view(id).catch(() => null);
        if (fresh && mine === ticket) setView(fresh);
      }
    } finally {
      working = false;
      if (mine === ticket) render();
    }
  }

  const assign = (squishy: JobSquishy, job: SetJobRequest, done: string) =>
    act(async (id, send) => {
      const res = await send((key) => api.setJob(id, squishy.squishy.id, job, key));
      if (!res) return;
      setView(res);
      picking = null;
      say(done);
    });

  const button = (label: string, onTap: () => void, attrs: Record<string, string> = {}) => {
    const b = el('button', { type: 'button', class: 'auth-button jobs-action', ...attrs }, label);
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  /** The spots this squishy could go and gather, with the firelight warning. */
  function spotPicker(squishy: JobSquishy, current: JobsView): HTMLElement {
    const name = nameOf(current, squishy);
    const spots = [...current.spots]
      .filter((s) => s.inSeason)
      .sort((a, b) => {
        const first = (s: { q: number; r: number }) =>
          wantSpot && s.q === wantSpot.q && s.r === wantSpot.r ? 0 : 1;
        return first(a) - first(b);
      });
    const rows = spots.map((spot) => {
      const worker = current.squishies.find((s) => s.squishy.id === spot.workerId);
      const go = button(
        spotLabel(spot),
        () => {
          void assign(
            squishy,
            { job: 'gatherer', q: spot.q, r: spot.r },
            `${name} is off to gather!`,
          );
        },
        { 'data-testid': 'jobs-spot', 'data-q': String(spot.q), 'data-r': String(spot.r) },
      );
      if (worker && worker.squishy.id !== squishy.squishy.id) go.disabled = true;
      return el(
        'li',
        { class: 'jobs-spot' },
        go,
        el(
          'p',
          { class: spot.firelit ? 'jobs-safe' : 'jobs-dark' },
          spot.firelit ? JOBS_TEXT.firelit : JOBS_TEXT.dark,
        ),
        ...(worker
          ? [el('p', { class: 'jobs-small' }, JOBS_TEXT.takenBy(nameOf(current, worker)))]
          : []),
      );
    });
    return el(
      'div',
      { class: 'jobs-picker', 'data-testid': 'jobs-picker' },
      el('p', { class: 'jobs-small' }, JOBS_TEXT.pickSpot),
      ...(rows.length > 0
        ? [el('ul', { class: 'jobs-spots' }, ...rows)]
        : [el('p', {}, JOBS_TEXT.noSpots)]),
      button(JOBS_TEXT.cancel, () => {
        picking = null;
        render();
      }),
    );
  }

  function render(): void {
    window.clearTimeout(ticker);
    ticker = undefined;
    askedAgain = false;
    const current = view;
    if (!current) {
      list.replaceChildren();
      collectButton.hidden = true;
      return;
    }
    const nowMs = clock.now();
    collectButton.hidden = !anythingReady(current);
    collectButton.textContent = JOBS_TEXT.collect(describeItems(readyTotal(current)) || '🧺');
    collectButton.disabled = working;
    if (current.squishies.length === 0) {
      list.replaceChildren(el('li', { class: 'jobs-empty' }, JOBS_TEXT.empty));
      return;
    }
    lines = new Map();
    list.replaceChildren(
      ...current.squishies.map((s) => {
        const name = nameOf(current, s);
        const away = s.squishy.state !== 'active';
        const actions = el(
          'div',
          { class: 'jobs-actions' },
          button(
            `⚔️ ${JOBS_TEXT.team}`,
            () => void assign(s, { job: 'team' }, `${name} joined the team!`),
            { 'data-job': 'team' },
          ),
          button(
            `🧺 ${JOBS_TEXT.gather}`,
            () => {
              picking = s.squishy.id;
              render();
            },
            { 'data-job': 'gatherer' },
          ),
          button(
            `💤 ${JOBS_TEXT.rest}`,
            () => void assign(s, { job: 'resting' }, `${name} is having a rest.`),
            { 'data-job': 'resting' },
          ),
        );
        for (const b of actions.querySelectorAll('button')) {
          const job = b.getAttribute('data-job');
          if (away || (job !== 'gatherer' && job === s.job)) b.disabled = true;
        }
        return el(
          'li',
          {
            class: 'jobs-row',
            'data-testid': 'jobs-row',
            'data-squishy': s.squishy.id,
            'data-job': s.job,
          },
          el('div', { class: 'jobs-head' }, blobFor(s), el('strong', { class: 'jobs-name' }, name)),
          lineFor(s, nowMs),
          el('ul', { class: 'jobs-hints' }, ...hintLines(s).map((h) => el('li', {}, h))),
          ...(s.work && !s.work.firelit ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.dark)] : []),
          ...(s.work && outOfSeason(current, s.work)
            ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.outOfSeason)]
            : []),
          picking === s.squishy.id ? spotPicker(s, current) : actions,
        );
      }),
    );
    tick();
  }

  /** A squishy's job line, remembered so the countdown can update it alone. */
  function lineFor(s: JobSquishy, nowMs: number): HTMLElement {
    const node = el('p', { class: 'jobs-line' }, jobLine(s, nowMs));
    if (s.work && !s.work.full) lines.set(s.squishy.id, { squishy: s, node });
    return node;
  }

  /**
   * The countdowns move on by themselves while the sheet is open, once a
   * second, changing only their text (no buttons rebuilt under a finger).
   * When one reaches zero the server has a cycle to hand out (what's ready
   * is its sum, not the client's), so the board asks for a fresh view once
   * and redraws: the row says "+5 Timber ready!" and Collect appears (#149).
   */
  function tick(): void {
    window.clearTimeout(ticker);
    ticker = undefined;
    if (lines.size === 0 || sheet.hidden) return;
    const nowMs = clock.now();
    let finished = false;
    for (const { squishy, node } of lines.values()) {
      const next = squishy.work?.nextReadyAt ?? null;
      if (next !== null && Date.parse(next) <= nowMs) finished = true;
      const text = jobLine(squishy, nowMs);
      if (node.textContent !== text) node.textContent = text;
    }
    if (finished && !askedAgain) {
      askedAgain = true;
      void refetch();
      return;
    }
    ticker = window.setTimeout(tick, 1000);
  }

  /** A fresh view from the server, redrawn if the board is still this one. */
  async function refetch(): Promise<void> {
    const id = mapId;
    const mine = ticket;
    if (!id) return;
    try {
      const fresh = await api.view(id);
      if (mine !== ticket || working) return;
      setView(fresh);
      render();
    } catch (err) {
      // Said once; the countdown keeps going and the next open asks again.
      if (mine !== ticket) return;
      say(messageOf(err));
      ticker = window.setTimeout(tick, 1000);
    }
  }

  function closeBoard(): void {
    ticket += 1;
    window.clearTimeout(ticker);
    sheet.hidden = true;
    mapId = null;
    view = null;
    picking = null;
    say('');
  }

  return {
    open: async (id, spot) => {
      ticket += 1;
      const mine = ticket;
      mapId = id;
      wantSpot = spot ?? null;
      picking = null;
      sheet.hidden = false;
      say('');
      render();
      try {
        const fresh = await api.view(id);
        if (mine !== ticket) return;
        setView(fresh);
        render();
      } catch (err) {
        if (mine === ticket) say(messageOf(err));
      }
    },
    close: closeBoard,
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      return {
        open: !sheet.hidden,
        mapId,
        jobs: Object.fromEntries(view?.squishies.map((s) => [s.squishy.id, s.job]) ?? []),
        team: view?.team ?? [],
        ready: view ? readyTotal(view) : {},
        note: note.textContent,
      };
    },
  };
}
