import type { JobSquishy, JobsView, SetJobRequest } from '@heartpatch/shared';
import { GameClock } from '../../inventory/game-clock.js';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { ApiRequestError } from '../../net/api.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { hpClose } from '../../ui/button/button.js';
import { el, messageOf } from '../../ui/dom.js';
import { jobsApi, type JobsApi } from './jobs-api.js';
import {
  canTrain,
  colorOf,
  hintLines,
  countsDown,
  jobLine,
  JOBS_TEXT,
  nameOf,
  readyTotal,
  workMood,
  trainHintText,
} from './jobs-view.js';
import { groundsPicker, jobActions, spotPicker, type JobActionsContext } from './job-actions.js';
import './jobs.css';

// The job board (owner decisions 2026-10-04): every squishy with its job, a
// quick reassign (Team, Gather, Rest), what it's good at, and each gatherer's
// next ready time. A self-contained DOM sheet: anything can open it with a
// map id (the trays, a temporary button, the tile panel). The server decides
// everything; the sheet counts down on the server's clock.

/** Hearts that float out of the pop-up for a job it loves (#376). */
const HEART_BURST = 5;
/** How long the pop-up shows before it fades. */
const TOAST_MS = 2600;

export interface JobBoardOptions {
  root: HTMLElement;
  api?: JobsApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /**
   * Banks finished work into the bag (the bag's settle, owner decision
   * 2026-10-06), asked before the board reads the server's view.
   */
  settle?: (mapId: string) => Promise<void>;
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
  /** Opens the board for my squishies on this map; `spot` puts that tile first in the pickers. */
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
  /** The squishy picking Training Grounds (#277: one a homestead), or null. */
  let pickingGrounds: string | null = null;
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

  const close = hpClose(JOBS_TEXT.close);
  const note = el('p', { class: 'jobs-note', role: 'status', 'data-testid': 'jobs-note' });
  /** Why Train is switched off, while there are no Training Grounds yet. */
  const trainHint = el('p', { class: 'jobs-hint', 'data-testid': 'jobs-train-hint' });
  trainHint.hidden = true;
  const list = el('ul', { class: 'jobs-list', 'data-testid': 'jobs-list' });
  // A pop-up in the row of the squishy just given a job (#376): a job it
  // loves gets hearts. Inside the row, so it never covers a button.
  const toast = el('div', { class: 'jobs-toast', role: 'status', 'data-testid': 'jobs-toast' });
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
    trainHint,
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
  let toastTimer: number | undefined;
  /** Whose row the pop-up sits in, while it shows. */
  let toastFor: string | null = null;
  /**
   * Puts the pop-up under its squishy's job line (rows are rebuilt on every
   * render). Put back into a rebuilt row, it doesn't pop or burst again.
   */
  const placeToast = () => {
    if (toastFor === null) return;
    if (!toast.isConnected) {
      toast.classList.remove('jobs-toast-show');
      for (const heart of toast.querySelectorAll('.jobs-burst')) heart.remove();
    }
    const row = list.querySelector(`[data-testid="jobs-row"][data-squishy="${toastFor}"]`);
    row?.querySelector('.jobs-line')?.after(toast);
  };
  const clearToast = () => {
    window.clearTimeout(toastTimer);
    toastFor = null;
    toast.remove();
  };
  const cheer = (squishyId: string, text: string, mood: 'loves' | 'meh') => {
    clearToast();
    toast.textContent = text;
    toast.dataset['mood'] = mood;
    toast.classList.remove('jobs-toast-done');
    toastFor = squishyId;
    placeToast();
    toast.classList.remove('jobs-toast-show');
    toast.getBoundingClientRect(); // a layout between, so the pop restarts
    toast.classList.add('jobs-toast-show');
    // A job it loves: a few hearts float up out of the pop-up.
    if (mood === 'loves') {
      for (let i = 0; i < HEART_BURST; i += 1) {
        const heart = el('span', { class: 'jobs-burst', 'aria-hidden': 'true' }, '💕');
        heart.style.setProperty('--burst-x', `${String((i - (HEART_BURST - 1) / 2) * 22)}px`);
        heart.style.setProperty('--burst-delay', `${String(i * 70)}ms`);
        toast.append(heart);
      }
    }
    // It fades but keeps its place, so nothing under a finger moves; the
    // next render (the player's next tap, or a refetch) lets the space go.
    toastTimer = window.setTimeout(() => {
      toast.classList.add('jobs-toast-done');
      toastFor = null;
    }, TOAST_MS);
  };
  /** Bumped by every view taken, so a slower refetch can't put an older one back. */
  let views = 0;
  const setView = (next: JobsView) => {
    views += 1;
    view = next;
    clock.sync(next.now);
  };

  close.addEventListener('click', () => {
    closeBoard();
  });
  /** Banks finished work first (it goes straight to the bag), then the server's view. */
  const freshView = async (id: string): Promise<JobsView> => {
    // The bag's settle says its own errors and never rejects.
    await options.settle?.(id);
    return api.view(id);
  };

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
      pickingGrounds = null;
      say(done);
    });

  /** The shared job buttons and pickers (`job-actions.ts`), wired to this board. */
  const actionContext = (current: JobsView): JobActionsContext => ({
    view: current,
    working,
    wantSpot,
    assign: (squishy, job, done) => {
      void assign(squishy, job, done);
    },
    gather: (squishy, spot, fits) => {
      const name = nameOf(current, squishy);
      const mine = ticket;
      void assign(squishy, { job: 'gatherer', q: spot.q, r: spot.r }, '').then(() => {
        // Still the same opening of this board, and the job went through.
        if (mine !== ticket || picking !== null || sheet.hidden) return;
        cheer(
          squishy.squishy.id,
          fits ? JOBS_TEXT.lovesIt(name) : JOBS_TEXT.notKeen(name),
          fits ? 'loves' : 'meh',
        );
      });
    },
    pickSpot: (squishy) => {
      picking = squishy.squishy.id;
      pickingGrounds = null;
      render();
    },
    pickGrounds: (squishy) => {
      pickingGrounds = squishy.squishy.id;
      picking = null;
      render();
    },
    cancel: () => {
      picking = null;
      pickingGrounds = null;
      render();
    },
  });

  function render(): void {
    window.clearTimeout(ticker);
    ticker = undefined;
    askedAgain = false;
    const current = view;
    if (!current) {
      list.replaceChildren();
      return;
    }
    const nowMs = clock.now();
    if (current.squishies.length === 0) {
      list.replaceChildren(el('li', { class: 'jobs-empty' }, JOBS_TEXT.empty));
      return;
    }
    lines = new Map();
    const trainable = canTrain(current);
    trainHint.textContent = trainHintText(current);
    trainHint.hidden = trainable || current.squishies.length === 0;
    list.replaceChildren(
      ...current.squishies.map((s) => {
        const name = nameOf(current, s);
        const ctx = actionContext(current);
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
          ...moodChip(s),
          el('ul', { class: 'jobs-hints' }, ...hintLines(s).map((h) => el('li', {}, h))),
          ...(s.work && !s.work.firelit ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.dark)] : []),
          ...(s.work && outOfSeason(current, s.work)
            ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.outOfSeason)]
            : []),
          // A trainee sleeps on its homestead (#277): in the dark, or napping.
          ...(s.training?.napping
            ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.trainingNapping)]
            : s.training && !s.training.firelit
              ? [el('p', { class: 'jobs-dark' }, JOBS_TEXT.dark)]
              : []),
          picking === s.squishy.id
            ? spotPicker(s, ctx)
            : pickingGrounds === s.squishy.id
              ? groundsPicker(s, ctx)
              : jobActions(s, ctx),
        );
      }),
    );
    placeToast();
    tick();
  }

  /** The row's mood chip (#376): hearts at a job it loves, a rain cloud at one it doesn't. */
  function moodChip(s: JobSquishy): HTMLElement[] {
    const mood = workMood(s);
    if (mood === null) return [];
    return [
      el(
        'p',
        { class: `jobs-mood jobs-mood-${mood}`, 'data-testid': 'jobs-mood' },
        el(
          'span',
          { class: 'jobs-mood-icon', 'aria-hidden': 'true' },
          mood === 'loves' ? '💕' : '🌧️',
        ),
        mood === 'loves' ? JOBS_TEXT.moodLoves : JOBS_TEXT.moodMeh,
      ),
    ];
  }

  /** A squishy's job line, remembered so the countdown can update it alone. */
  function lineFor(s: JobSquishy, nowMs: number): HTMLElement {
    const node = el('p', { class: 'jobs-line' }, jobLine(s, nowMs));
    if (countsDown(s)) lines.set(s.squishy.id, { squishy: s, node });
    return node;
  }

  /**
   * The countdowns move on by themselves while the sheet is open, once a
   * second, changing only their text (no buttons rebuilt under a finger).
   * When one reaches zero the server has a cycle to bank (what's ready is its
   * sum, not the client's), so the board settles and asks for a fresh view
   * once, and redraws: the cycle is in the bag and the next one counts down.
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
      // Full XP came back at the patch's midnight (#201): ask for the fresh view.
      if (squishy.fullXpResetAt !== null && Date.parse(squishy.fullXpResetAt) <= nowMs) {
        finished = true;
      }
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
    const had = views;
    if (!id) return;
    try {
      const fresh = await freshView(id);
      if (mine !== ticket || working || views !== had) return;
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
    pickingGrounds = null;
    clearToast();
    say('');
  }

  return {
    open: async (id, spot) => {
      ticket += 1;
      const mine = ticket;
      mapId = id;
      wantSpot = spot ?? null;
      picking = null;
      pickingGrounds = null;
      sheet.hidden = false;
      say('');
      render();
      try {
        const fresh = await freshView(id);
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
