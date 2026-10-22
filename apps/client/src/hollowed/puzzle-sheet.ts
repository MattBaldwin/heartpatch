import {
  RELIGHT_E,
  RELIGHT_N,
  RELIGHT_S,
  RELIGHT_W,
  type HollowedPuzzle,
  type PuzzleSkin,
  type RelightCell,
  type RelightMove,
  type SolvePuzzleResponse,
  type StartPuzzleResponse,
} from '@heartpatch/shared';
import { EXPLORE_TEXT } from '../explore/explore-view.js';
import { el, messageOf } from '../ui/dom.js';
import { HOLLOWED_TEXT, puzzleLines, skinOf } from './hollowed-explore-view.js';
import {
  giveUpRelight,
  movesLeft,
  relightLight,
  startRelight,
  tapRelight,
  type RelightOutcome,
  type RelightPlay,
} from './relight-play.js';
import './puzzle-sheet.css';

/*
 * A grey village tile's broken thing, as a card (#306 PR 2b, "Relight the
 * path", the owner's approved mockup): each opening asks the server for a
 * fresh try, the kid turns and slides pieces until every lantern glows, and
 * the moves go back to the server, which replays them and says what fixing
 * it gave (CLAUDE.md rule 1). Out of moves, or Give up, and the light fades:
 * the next try is a new path. DOM only, over the explore view: the 3D scene
 * draws nothing while it's up (rule 8). Touch-first: every cell is a big
 * button, built once a try and updated in place (a tap never lands on a
 * replaced button).
 */

export interface PuzzleSheetOptions {
  /** Where the card goes (the explore overlay). */
  parent: HTMLElement;
  /** A new try; null if the visit moved on. Throws a kid-readable error. */
  start: () => Promise<StartPuzzleResponse | null>;
  /** Sends a try's moves; null if the visit moved on. Throws a kid-readable error. */
  solve: (attempt: number, moves: readonly RelightMove[]) => Promise<SolvePuzzleResponse | null>;
  /** "Open Lorebook" on the reward card. */
  onLorebook?: (pageId: string) => void;
  /** The card closed: fixed (the reply) or not now (null). */
  onClosed: (fixed: SolvePuzzleResponse | null) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it). */
export interface PuzzleDebug {
  readonly card: 'loading' | 'board' | 'reward';
  readonly outcome: RelightOutcome | null;
  readonly attempt: number | null;
  readonly size: number | null;
  readonly moves: number;
  readonly limit: number | null;
  readonly lit: number;
  readonly lanterns: number;
  /** The echo shadow the light touched (the flare), or null. */
  readonly spooked: number | null;
  readonly picked: number | null;
}

export interface PuzzleSheet {
  /** Opens the card for a puzzle and asks for a fresh try. */
  open: (puzzle: HollowedPuzzle) => void;
  /** Closes it at once (leaving the tile, nightfall). */
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: PuzzleDebug | null;
}

/** A path piece's arms, from the middle to each opening (a 100×100 cell). */
const ARMS: readonly [number, string][] = [
  [RELIGHT_N, 'M50 50 V0'],
  [RELIGHT_E, 'M50 50 H100'],
  [RELIGHT_S, 'M50 50 V100'],
  [RELIGHT_W, 'M50 50 H0'],
];

/** One cell's picture: arms glowing gold when lit, a lantern, the heart or an echo. */
export function cellSvg(cell: RelightCell, lit: boolean): string {
  if (cell.kind === 'empty') return '';
  if (cell.kind === 'shadow') {
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><ellipse class="hollowed-echo-body" cx="50" cy="56" rx="34" ry="30"/><ellipse cx="40" cy="52" rx="5" ry="7" fill="#f4eefc"/><ellipse cx="60" cy="52" rx="5" ry="7" fill="#f4eefc"/></svg>';
  }
  const arms = ARMS.filter(([bit]) => cell.open & bit)
    .map(([, d]) => d)
    .join(' ');
  const colour = lit ? 'var(--relight-light)' : 'var(--relight-pipe)';
  const centre =
    cell.kind === 'heart'
      ? '<circle cx="50" cy="50" r="24" fill="var(--relight-light)" class="hollowed-relight-glow"/><path d="M50 62 L38 50 a7 7 0 0 1 12-9 a7 7 0 0 1 12 9 Z" fill="#fff"/>'
      : cell.kind === 'lantern'
        ? `<rect x="33" y="30" width="34" height="42" rx="10" fill="${lit ? 'var(--relight-light)' : 'var(--relight-lamp-off)'}"${lit ? ' class="hollowed-relight-glow"' : ''}/><rect x="40" y="22" width="20" height="8" rx="3" fill="var(--relight-pipe-dark)"/><circle cx="50" cy="51" r="7" fill="${lit ? '#fff7d6' : 'var(--relight-pipe-dark)'}"/>`
        : `<circle cx="50" cy="50" r="9" fill="${colour}"/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${arms}" stroke="${colour}" stroke-width="18" stroke-linecap="round" fill="none"/>${centre}</svg>`;
}

function cellLabel(cell: RelightCell, lit: boolean): string {
  const t = HOLLOWED_TEXT.cell;
  switch (cell.kind) {
    case 'heart':
      return t.heart;
    case 'lantern':
      return lit ? t.litLantern : t.darkLantern;
    case 'shadow':
      return t.shadow;
    case 'empty':
      return t.empty;
    case 'pipe':
      return cell.loose ? t.loose : t.pipe;
  }
}

export function createPuzzleSheet(options: PuzzleSheetOptions): PuzzleSheet {
  let skin: PuzzleSkin | null = null;
  let play: RelightPlay | null = null;
  let fixed: SolvePuzzleResponse | null = null;
  let loading = false;
  let sending = false;
  let problem: string | null = null;
  /** Bumped on every open, try and close, so a late reply can't land on another card. */
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

  /** The card's parts, built once a visit and updated in place. */
  const progress = el('p', { class: 'explore-card-progress' });
  const title = el('h3', { class: 'explore-sheet-title', id: 'hollowed-puzzle-title' });
  const counters = el('p', { class: 'hollowed-relight-counters' });
  const movesLine = el('span', { 'data-testid': 'hollowed-relight-moves' });
  const litLine = el('span', { 'data-testid': 'hollowed-relight-lit' });
  counters.append(movesLine, litLine);
  const grid = el('div', {
    class: 'hollowed-relight-board',
    'data-testid': 'hollowed-relight-board',
  });
  const line = el('p', {
    class: 'explore-card-line',
    role: 'status',
    'data-testid': 'hollowed-puzzle-line',
  });
  const faded = el('div', {
    class: 'hollowed-relight-end',
    'data-testid': 'hollowed-relight-faded',
  });
  const newPath = button(HOLLOWED_TEXT.newPath, 'auth-button', 'hollowed-relight-new-path', () => {
    void begin();
  });
  faded.append(
    el('strong', { class: 'hollowed-relight-end-title' }, HOLLOWED_TEXT.faded),
    el('span', {}, HOLLOWED_TEXT.fadedText),
    newPath,
  );
  const giveUp = button(HOLLOWED_TEXT.giveUp, 'explore-not-now', 'hollowed-relight-give-up', () => {
    if (play) play = giveUpRelight(play);
    render();
  });
  const retry = button(HOLLOWED_TEXT.tryAgain, 'explore-easy', 'hollowed-puzzle-retry', () => {
    if (play?.outcome === 'won') void send();
    else void begin();
  });
  const notNow = button(EXPLORE_TEXT.notNow, 'explore-not-now', 'hollowed-puzzle-not-now', () => {
    close(null);
  });
  const board = [progress, title, counters, grid, line, faded];
  const row = el('div', { class: 'explore-play-row' }, giveUp, retry, notNow);
  let cells: HTMLButtonElement[] = [];

  /** The cells' buttons, made once a try (a tap never lands on a replaced button). */
  function buildCells(p: RelightPlay): void {
    grid.style.setProperty('--relight-n', String(p.board.size));
    cells = p.board.cells.map((_, i) => {
      const b = el('button', { type: 'button', class: 'hollowed-relight-cell' });
      b.addEventListener('click', () => {
        if (!play || sending) return;
        play = tapRelight(play, i);
        render();
        if (play.outcome === 'won') void send();
      });
      return b;
    });
    grid.replaceChildren(...cells);
  }

  /** A new try: a fresh path of the same size from the server. */
  async function begin(): Promise<void> {
    const at = ++visit;
    loading = true;
    problem = null;
    play = null;
    render();
    try {
      const reply = await options.start();
      if (at !== visit) return;
      if (!reply) {
        close(null);
        return;
      }
      play = startRelight(reply.attempt, reply.board);
      buildCells(play);
    } catch (err) {
      if (at !== visit) return;
      problem = messageOf(err);
    } finally {
      if (at === visit) {
        loading = false;
        render();
      }
    }
  }

  async function send(): Promise<void> {
    const p = play;
    if (!p || p.outcome !== 'won' || sending) return;
    const at = visit;
    sending = true;
    problem = null;
    render();
    try {
      const reply = await options.solve(p.attempt, p.moves);
      if (at !== visit) return;
      if (!reply) {
        // The visit or the tile moved on: nothing left to send from here.
        close(null);
        return;
      }
      fixed = reply;
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
    const was = !sheet.hidden;
    sheet.hidden = true;
    sheet.replaceChildren();
    grid.replaceChildren();
    cells = [];
    skin = null;
    play = null;
    fixed = null;
    loading = false;
    sending = false;
    problem = null;
    if (was) options.onClosed(reply);
  }

  function render(): void {
    const k = skin;
    if (!k || sheet.hidden) return;
    if (fixed) {
      renderReward(k, fixed);
      return;
    }
    if (sheet.firstChild !== progress) sheet.replaceChildren(...board, row);
    progress.textContent = HOLLOWED_TEXT.broken(k);
    title.textContent = HOLLOWED_TEXT.relight;
    const p = play;
    const light = p ? relightLight(p) : null;
    counters.hidden = !p;
    grid.hidden = !p;
    if (p && light) {
      movesLine.textContent = HOLLOWED_TEXT.moves(p.moves.length, p.board.limit);
      movesLine.classList.toggle('hollowed-relight-low', movesLeft(p) <= 3);
      litLine.textContent = HOLLOWED_TEXT.lit(light.litLanterns, light.lanterns);
      grid.classList.toggle('hollowed-relight-done', p.outcome !== 'playing');
      p.board.cells.forEach((cell, i) => {
        const b = cells[i];
        if (!b) return;
        const lit = light.lit.has(i);
        b.className = [
          'hollowed-relight-cell',
          `hollowed-relight-${cell.kind}`,
          cell.loose ? 'hollowed-relight-loose' : '',
          p.picked === i ? 'hollowed-relight-picked' : '',
          light.spooked === i ? 'hollowed-relight-flare' : '',
        ]
          .filter((c) => c)
          .join(' ');
        b.innerHTML = cellSvg(cell, lit);
        b.setAttribute('aria-label', cellLabel(cell, lit));
        b.disabled =
          cell.kind === 'heart' || cell.kind === 'shadow' || p.outcome !== 'playing' || sending;
      });
    }
    faded.hidden = p?.outcome !== 'faded';
    line.textContent = problem
      ? problem
      : loading
        ? HOLLOWED_TEXT.shuffling
        : !p
          ? ''
          : p.outcome === 'won'
            ? sending
              ? HOLLOWED_TEXT.relighting
              : HOLLOWED_TEXT.won
            : p.outcome === 'faded'
              ? ''
              : light?.spooked != null
                ? HOLLOWED_TEXT.echo
                : p.bump === 'stuck'
                  ? HOLLOWED_TEXT.stuck
                  : p.bump === 'one-step'
                    ? HOLLOWED_TEXT.oneStep
                    : p.picked !== null
                      ? HOLLOWED_TEXT.pickSlot
                      : HOLLOWED_TEXT.play;
    line.hidden = line.textContent === '';
    giveUp.hidden = problem !== null || p?.outcome !== 'playing';
    retry.hidden = problem === null;
    retry.disabled = sending || loading;
    newPath.disabled = loading;
  }

  function renderReward(k: PuzzleSkin, reply: SolvePuzzleResponse): void {
    const nodes: Node[] = [
      el('p', { class: 'explore-card-progress' }, HOLLOWED_TEXT.pathLit),
      el('h3', { class: 'explore-sheet-title', id: 'hollowed-puzzle-title' }, k.fixed),
      el(
        'ul',
        { class: 'explore-finds', 'data-testid': 'hollowed-puzzle-finds' },
        ...puzzleLines(reply).map((l) =>
          el(
            'li',
            { class: 'explore-find' },
            l.text,
            ...(l.note ? [el('span', { class: 'explore-find-note' }, l.note)] : []),
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
    sheet.replaceChildren(...nodes);
  }

  return {
    open: (puzzle) => {
      close(null);
      skin = skinOf(puzzle);
      sheet.hidden = false;
      void begin();
    },
    close: () => {
      close(null);
    },
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      if (sheet.hidden) return null;
      const p = play;
      const light = p ? relightLight(p) : null;
      return {
        card: fixed ? ('reward' as const) : p ? ('board' as const) : ('loading' as const),
        outcome: p?.outcome ?? null,
        attempt: p?.attempt ?? null,
        size: p?.board.size ?? null,
        moves: p?.moves.length ?? 0,
        limit: p?.board.limit ?? null,
        lit: light?.litLanterns ?? 0,
        lanterns: light?.lanterns ?? 0,
        spooked: light?.spooked ?? null,
        picked: p?.picked ?? null,
      };
    },
  };
}
