import type { HollowedPuzzle, PuzzleSkin, SolvePuzzleResponse } from '@heartpatch/shared';
import { EXPLORE_TEXT } from '../explore/explore-view.js';
import { el, messageOf } from '../ui/dom.js';
import { HOLLOWED_TEXT, pieceOf, puzzleLines, skinOf } from './hollowed-explore-view.js';
import {
  glowing,
  showing,
  startPuzzle,
  stepPuzzle,
  wobbling,
  type PuzzleInput,
  type PuzzleState,
} from './memory-puzzle.js';
import './puzzle-sheet.css';

/*
 * The memory puzzle's card on a grey village tile (#306 PR 2b): the broken
 * thing shows its pieces in order, the kid taps them back, and the server
 * says what fixing it gave. DOM only, over the explore view: the 3D scene
 * draws nothing while it's up (CLAUDE.md rule 8). Touch-first: every piece
 * is a big button, and the easy way is always there.
 */

export interface PuzzleSheetOptions {
  /** Where the card goes (the explore overlay). */
  parent: HTMLElement;
  /** Sends the order; null if the visit moved on. Throws a kid-readable error. */
  solve: (order: readonly string[]) => Promise<SolvePuzzleResponse | null>;
  /** "Open Lorebook" on the reward card. */
  onLorebook?: (pageId: string) => void;
  /** The card closed: fixed (the reply) or not now (null). */
  onClosed: (fixed: SolvePuzzleResponse | null) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it). */
export interface PuzzleDebug {
  readonly card: 'puzzle' | 'reward';
  readonly phase: PuzzleState['phase'];
  readonly order: readonly string[];
  readonly tray: readonly string[];
  readonly placed: readonly string[];
  readonly showing: string | null;
}

export interface PuzzleSheet {
  /** Opens the card for a puzzle; `seed01` lays out its tray the same way each time. */
  open: (puzzle: HollowedPuzzle, seed01: number) => void;
  /** Closes it at once (leaving the tile, nightfall). */
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: PuzzleDebug | null;
}

export function createPuzzleSheet(options: PuzzleSheetOptions): PuzzleSheet {
  let skin: PuzzleSkin | null = null;
  let state: PuzzleState | null = null;
  let fixed: SolvePuzzleResponse | null = null;
  let sending = false;
  let problem: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every open and close, so a late reply can't land on another card. */
  let visit = 0;

  const sheet = el('section', {
    class: 'explore-sheet hollowed-puzzle',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'hollowed-puzzle-title',
    'data-testid': 'hollowed-puzzle',
  });
  sheet.hidden = true;
  options.parent.append(sheet);

  const now = () => performance.now();

  function feed(input: PuzzleInput): void {
    if (!state) return;
    const next = stepPuzzle(state, input);
    if (next === state && input.type === 'tick') {
      schedule();
      return;
    }
    state = next;
    if (state.phase === 'done' && !fixed && !sending) void send();
    render();
    schedule();
  }

  /** Ticks while the order shows or a piece wobbles; still otherwise. */
  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const s = state;
    if (!s || sheet.hidden) return;
    const t = now();
    const busy = s.phase === 'watch' || (s.wobble !== null && wobbling(s, s.wobble.id, t));
    if (busy) {
      timer = setTimeout(() => {
        timer = null;
        feed({ type: 'tick', t: now() });
      }, 100);
    }
  }

  async function send(): Promise<void> {
    const s = state;
    if (!s) return;
    const at = visit;
    sending = true;
    problem = null;
    render();
    try {
      const reply = await options.solve(s.order.slice(0, s.placed.length));
      if (at !== visit) return;
      if (reply) fixed = reply;
    } catch (err) {
      if (at !== visit) return;
      problem = messageOf(err);
    } finally {
      if (at === visit) {
        sending = false;
        render();
      }
    }
  }

  function close(reply: SolvePuzzleResponse | null): void {
    visit += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const was = !sheet.hidden;
    sheet.hidden = true;
    sheet.replaceChildren();
    state = null;
    skin = null;
    parts = null;
    fixed = null;
    sending = false;
    problem = null;
    if (was) options.onClosed(reply);
  }

  function button(
    text: string,
    className: string,
    testId: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = el('button', { type: 'button', class: className, 'data-testid': testId }, text);
    b.addEventListener('click', onClick);
    return b;
  }

  /** The puzzle card's parts, built once a visit and updated in place (a tap never lands on a replaced button). */
  let parts: {
    progress: HTMLElement;
    line: HTMLElement;
    slots: HTMLElement[];
    pieces: Map<string, HTMLButtonElement>;
    easy: HTMLButtonElement;
    ready: HTMLButtonElement;
    again: HTMLButtonElement;
    retry: HTMLButtonElement;
  } | null = null;

  function build(s: PuzzleState, k: PuzzleSkin): void {
    const progress = el('p', { class: 'explore-card-progress' });
    const line = el('p', {
      class: 'explore-card-line',
      role: 'status',
      'data-testid': 'hollowed-puzzle-line',
    });
    const slots = s.order.map(() => el('li', { class: 'hollowed-puzzle-slot' }));
    const pieces = new Map<string, HTMLButtonElement>();
    for (const id of s.tray) {
      const piece = pieceOf(k, id);
      const b = el(
        'button',
        {
          type: 'button',
          class: 'hollowed-piece',
          'aria-label': piece.name,
          'data-testid': `hollowed-piece-${id}`,
        },
        piece.emoji,
      );
      b.addEventListener('click', () => {
        feed({ type: 'tap', id, t: now() });
      });
      pieces.set(id, b);
    }
    const easy = button(
      `${EXPLORE_TEXT.easy}: ${k.easy}`,
      'explore-easy',
      'hollowed-puzzle-easy',
      () => {
        feed({ type: 'easy', t: now() });
      },
    );
    const ready = button(HOLLOWED_TEXT.ready, 'explore-not-now', 'hollowed-puzzle-ready', () => {
      feed({ type: 'ready', t: now() });
    });
    const again = button(HOLLOWED_TEXT.again, 'explore-not-now', 'hollowed-puzzle-again', () => {
      feed({ type: 'again', t: now() });
    });
    const retry = button(HOLLOWED_TEXT.tryAgain, 'explore-easy', 'hollowed-puzzle-retry', () => {
      void send();
    });
    const notNow = button(EXPLORE_TEXT.notNow, 'explore-not-now', 'hollowed-puzzle-not-now', () => {
      close(null);
    });
    parts = { progress, line, slots, pieces, easy, ready, again, retry };
    sheet.replaceChildren(
      progress,
      el(
        'h3',
        { class: 'explore-sheet-title', id: 'hollowed-puzzle-title' },
        HOLLOWED_TEXT.broken(k),
      ),
      line,
      el('ol', { class: 'hollowed-puzzle-slots' }, ...slots),
      el('div', { class: 'hollowed-puzzle-tray' }, ...pieces.values()),
      el('div', { class: 'explore-play-row' }, easy, ready, again, retry, notNow),
    );
  }

  function render(): void {
    const s = state;
    const k = skin;
    if (!s || !k) return;
    if (fixed) {
      renderReward(k, fixed);
      return;
    }
    if (!parts) build(s, k);
    const p = parts;
    if (!p) return;
    const t = now();
    const lit = showing(s, t);
    const glow = glowing(s);
    const wobble = s.wobble && wobbling(s, s.wobble.id, t) ? s.wobble.id : null;
    const busy = sending || s.phase === 'done';
    const placed = HOLLOWED_TEXT.placed(s.placed.length, s.order.length);
    p.progress.textContent = placed;
    p.line.textContent = problem
      ? problem
      : sending
        ? HOLLOWED_TEXT.fixing
        : s.phase === 'watch'
          ? k.watch
          : glow
            ? HOLLOWED_TEXT.glow
            : wobble
              ? HOLLOWED_TEXT.wrong
              : k.play;
    p.slots.forEach((slot, i) => {
      const id = s.placed[i];
      const piece = id ? pieceOf(k, id) : null;
      slot.textContent = piece ? piece.emoji : '';
      slot.classList.toggle('hollowed-puzzle-slot-on', piece !== null);
      if (piece) slot.setAttribute('aria-label', piece.name);
      else slot.removeAttribute('aria-label');
    });
    p.slots[0]?.parentElement?.setAttribute('aria-label', placed);
    for (const [id, b] of p.pieces) {
      b.classList.toggle('hollowed-piece-lit', id === lit);
      b.classList.toggle('hollowed-piece-glow', id === glow);
      b.classList.toggle('hollowed-piece-wobble', id === wobble);
      b.disabled = s.placed.includes(id) || busy;
    }
    p.easy.hidden = problem !== null;
    p.easy.disabled = busy;
    p.ready.hidden = problem !== null || s.phase !== 'watch';
    p.again.hidden = problem !== null || s.phase === 'watch';
    p.again.disabled = busy;
    p.retry.hidden = problem === null;
    p.retry.disabled = sending;
  }

  function renderReward(k: PuzzleSkin, reply: SolvePuzzleResponse): void {
    const nodes: Node[] = [
      el(
        'p',
        { class: 'explore-card-progress' },
        HOLLOWED_TEXT.placed(reply.puzzle.order.length, reply.puzzle.order.length),
      ),
      el('h3', { class: 'explore-sheet-title', id: 'hollowed-puzzle-title' }, k.fixed),
      el(
        'ul',
        { class: 'explore-finds', 'data-testid': 'hollowed-puzzle-finds' },
        ...puzzleLines(reply).map((line) =>
          el(
            'li',
            { class: 'explore-find' },
            line.text,
            ...(line.note ? [el('span', { class: 'explore-find-note' }, line.note)] : []),
          ),
        ),
      ),
    ];
    const lore = reply.lore;
    if (lore && options.onLorebook) {
      nodes.push(
        button(
          EXPLORE_TEXT.openLorebook,
          'auth-button auth-button-soft explore-lorebook',
          'hollowed-puzzle-lorebook',
          () => {
            close(reply);
            options.onLorebook?.(lore.id);
          },
        ),
      );
    }
    nodes.push(
      button(EXPLORE_TEXT.yay, 'auth-button explore-yay', 'hollowed-puzzle-yay', () => {
        close(reply);
      }),
    );
    parts = null;
    sheet.replaceChildren(...nodes);
  }

  return {
    open: (puzzle, seed01) => {
      close(null);
      visit += 1;
      skin = skinOf(puzzle);
      state = startPuzzle(puzzle.order, now(), seed01);
      sheet.hidden = false;
      render();
      schedule();
    },
    close: () => {
      close(null);
    },
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      const s = state;
      if (!s || sheet.hidden) return null;
      return {
        card: fixed ? ('reward' as const) : ('puzzle' as const),
        phase: s.phase,
        order: s.order,
        tray: s.tray,
        placed: s.placed,
        showing: showing(s, now()),
      };
    },
  };
}
