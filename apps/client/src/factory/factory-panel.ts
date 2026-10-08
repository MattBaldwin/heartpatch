import type { FactoryView, ItemCounts } from '@heartpatch/shared';
import { GAME_DATA } from '@heartpatch/shared';
import { formatTimeLeft } from '../inventory/game-clock.js';
import { el } from '../ui/dom.js';
import {
  batchPlanLine,
  batchRows,
  batchTimeLine,
  FACTORY_TEXT,
  hasRoom,
  nextLevelRoom,
  pickRows,
  recipeIcon,
  soonestFreeMs,
  stopPreview,
  type BatchRow,
} from './factory-view.js';
import './factory.css';

// The Crafting Factory's panel (#294): the batches going, "Start a batch"
// (pick a recipe, choose how many with − / + / Max) and "Stop" with a
// friendly summary first (style guide §3.6). Home's Factory card, the Bag
// and the Recipe Book all use it; whoever owns the state sends the commands
// (the server caps the count and works out the timers, CLAUDE.md rule 1).

/** How many a fresh pick starts at (never more than the bag allows). */
const PICK_DEFAULT = 10; // TUNE: the mockup's

export interface FactoryState {
  readonly view: FactoryView;
  readonly items: ItemCounts;
  readonly seasons: readonly string[];
}

export interface FactoryPanelDeps {
  /** The game clock now, in ms (the server's). */
  now: () => number;
  /** Starts a batch: resolves to null once started, or a kid-readable line saying why not. */
  start: (recipeId: string, count: number) => Promise<string | null>;
  /** Stops a batch: resolves to null once stopped, or a line saying why not. */
  stop: (batchId: string) => Promise<string | null>;
  /** Is this recipe book page open (only open pages can be queued)? */
  isOpen: (pageKey: string) => boolean;
  /** The panel switched between its list, picker and stop card (the owner redraws around it). */
  onMode?: (mode: FactoryPanelMode) => void;
}

export type FactoryPanelMode = 'list' | 'pick' | 'stop';

export interface FactoryPanel {
  readonly element: HTMLElement;
  /** Draws for this state (null: no Factory). */
  update: (state: FactoryState | null) => void;
  /**
   * Opens "What shall we make?"; with a recipe, it's picked already. `only`:
   * just "How many?" for that recipe (the book's Queue in Factory, on its page).
   */
  pick: (recipeId?: string, only?: boolean) => void;
  /** Back to the list of batches. */
  showList: () => void;
  readonly mode: FactoryPanelMode;
  /** Stops its ticking (the panel left the screen). */
  pause: () => void;
}

const RECIPES = new Map(GAME_DATA.recipes.map((r) => [r.id, r]));

export function createFactoryPanel(deps: FactoryPanelDeps): FactoryPanel {
  let state: FactoryState | null = null;
  let mode: FactoryPanelMode = 'list';
  let picked: string | null = null;
  /** The picker shows only the picked recipe (its recipe book page). */
  let only = false;
  let count = 1;
  let stopping: string | null = null;
  let working = false;
  let line = '';
  let ticker: number | undefined;
  /** The countdown texts on screen: one Text node each, rewritten in place (DECISIONS, Fix PR #173). */
  let ticking: {
    text: Text;
    count: Text;
    bar: HTMLElement;
    row: BatchRow;
  }[] = [];
  /** "Factory's full! One finishes in …": its countdown, rewritten in place too. */
  let fullText: Text | null = null;

  const element = el('div', { class: 'factory', 'data-testid': 'factory-panel' });
  const say = el('p', { class: 'factory-say', role: 'status', 'data-testid': 'factory-say' });

  const setMode = (next: FactoryPanelMode) => {
    mode = next;
    render();
    deps.onMode?.(next);
  };

  const button = (
    label: string,
    onTap: () => void,
    attrs: Record<string, string> = {},
    soft = false,
  ) => {
    const { class: more = '', ...rest } = attrs;
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button factory-button${soft ? ' auth-button-soft' : ''} ${more}`.trim(),
        ...rest,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  async function run(command: () => Promise<string | null>, after: () => void): Promise<void> {
    if (working) return;
    working = true;
    render();
    try {
      const failure = await command();
      if (failure === null) after();
      else line = failure;
    } finally {
      working = false;
      render();
    }
  }

  function renderList(current: FactoryState): Node[] {
    const now = deps.now();
    const rows = batchRows(current.view, now);
    ticking = [];
    const batches = rows.map((row) => {
      const text = document.createTextNode(batchTimeLine(row, now));
      const count = document.createTextNode(`${String(row.done)}/${String(row.total)}`);
      const bar = el('i', { style: `width:${String(row.percent)}%` });
      ticking.push({ text, count, bar, row });
      return el(
        'li',
        {
          class: row.finished ? 'factory-batch factory-batch-done' : 'factory-batch',
          'data-testid': 'factory-batch',
          'data-batch': row.batch.id,
          'data-recipe': row.batch.recipeId,
        },
        el('span', { class: 'factory-batch-icon', 'aria-hidden': 'true' }, row.icon),
        el(
          'span',
          { class: 'factory-batch-name' },
          row.name,
          ' ',
          el('em', { class: 'factory-count', 'data-testid': 'factory-count' }, count),
        ),
        row.finished
          ? el('span', { class: 'factory-batch-stop' })
          : button(
              FACTORY_TEXT.stop,
              () => {
                stopping = row.batch.id;
                line = '';
                setMode('stop');
              },
              { 'data-testid': 'factory-stop', class: 'factory-batch-stop auth-button-small' },
              true,
            ),
        el('span', { class: 'factory-bar', 'aria-hidden': 'true' }, bar),
        el('span', { class: 'factory-time' }, ...(row.each ? [`${row.each} · `] : []), text),
      );
    });
    const room = hasRoom(current.view, now);
    const empty = Math.max(0, current.view.slots - rows.filter((r) => !r.finished).length);
    const next = nextLevelRoom(current.view);
    return [
      el('p', { class: 'factory-about' }, FACTORY_TEXT.about(current.view.slots)),
      el('ul', { class: 'factory-batches', 'data-testid': 'factory-batches' }, ...batches),
      ...(room && empty > 0
        ? [
            button(
              FACTORY_TEXT.startBatch,
              () => {
                picked = null;
                line = '';
                setMode('pick');
              },
              { 'data-testid': 'factory-start-batch', class: 'factory-empty' },
              true,
            ),
          ]
        : [el('p', { class: 'factory-full' }, fullCountdown(current.view, now))]),
      ...(next
        ? [el('p', { class: 'factory-locked' }, FACTORY_TEXT.locked(next.level, next.slots))]
        : []),
    ];
  }

  function renderPick(current: FactoryState): Node[] {
    const rows = pickRows(current.items, current.seasons, deps.isOpen);
    const chosen = rows.find((r) => r.recipe.id === picked && r.note === null) ?? null;
    if (!chosen) picked = null;
    const list = rows.map((row) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: `factory-pick${row.recipe.id === picked ? ' factory-pick-on' : ''}`,
          'data-testid': 'factory-pick',
          'data-recipe': row.recipe.id,
          'aria-pressed': String(row.recipe.id === picked),
        },
        el('span', { class: 'factory-pick-icon', 'aria-hidden': 'true' }, row.icon),
        el(
          'span',
          { class: 'factory-pick-name' },
          el('b', {}, row.recipe.name),
          el('span', {}, row.line),
        ),
        el('span', { class: 'factory-pick-can' }, row.note ?? FACTORY_TEXT.canMake(row.canMake)),
      );
      b.disabled = working || row.note !== null;
      b.addEventListener('click', () => {
        picked = row.recipe.id;
        count = Math.max(1, Math.min(PICK_DEFAULT, row.canMake));
        render();
      });
      return el('li', {}, b);
    });
    const parts: Node[] =
      only && chosen
        ? []
        : [
            el('h3', { class: 'factory-title' }, FACTORY_TEXT.pickTitle),
            rows.length === 0
              ? el('p', { class: 'factory-about' }, FACTORY_TEXT.noRecipes)
              : el('ul', { class: 'factory-picks', 'data-testid': 'factory-picks' }, ...list),
          ];
    if (chosen) parts.push(...countBlock(chosen.recipe.id, chosen.canMake));
    parts.push(
      el(
        'div',
        { class: 'factory-row' },
        ...(chosen
          ? [
              button(
                FACTORY_TEXT.start,
                () => {
                  const id = chosen.recipe.id;
                  const n = count;
                  void run(
                    () => deps.start(id, n),
                    () => {
                      line = FACTORY_TEXT.started(n, recipeIcon(id));
                      mode = 'list';
                      deps.onMode?.('list');
                    },
                  );
                },
                { 'data-testid': 'factory-start' },
              ),
            ]
          : []),
        button(
          FACTORY_TEXT.back,
          () => {
            line = '';
            setMode('list');
          },
          { 'data-testid': 'factory-back' },
          true,
        ),
      ),
    );
    return parts;
  }

  function countBlock(recipeId: string, canMake: number): Node[] {
    const recipe = RECIPES.get(recipeId);
    if (!recipe) return [];
    count = Math.max(1, Math.min(count, canMake));
    const step = (delta: number) => () => {
      count = Math.max(1, Math.min(canMake, count + delta));
      render();
    };
    const minus = button(
      '−',
      step(-1),
      { 'data-testid': 'factory-minus', 'aria-label': FACTORY_TEXT.fewer, class: 'factory-round' },
      true,
    );
    const plus = button(
      '＋',
      step(1),
      { 'data-testid': 'factory-plus', 'aria-label': FACTORY_TEXT.more, class: 'factory-round' },
      true,
    );
    minus.disabled = working || count <= 1;
    plus.disabled = working || count >= canMake;
    const max = button(
      FACTORY_TEXT.max(canMake),
      () => {
        count = canMake;
        render();
      },
      { 'data-testid': 'factory-max', class: 'factory-max' },
    );
    return [
      el('p', { class: 'factory-title' }, FACTORY_TEXT.howMany),
      el(
        'div',
        { class: 'factory-counter' },
        minus,
        el(
          'output',
          { class: 'factory-n', 'data-testid': 'factory-n', 'aria-live': 'polite' },
          String(count),
        ),
        plus,
        max,
      ),
      el(
        'p',
        { class: 'factory-plan', 'data-testid': 'factory-plan' },
        batchPlanLine(recipe, count),
      ),
    ];
  }

  function fullCountdown(view: FactoryView, now: number): Text {
    fullText = document.createTextNode(FACTORY_TEXT.full(formatTimeLeft(soonestFreeMs(view, now))));
    return fullText;
  }

  function renderStop(current: FactoryState): Node[] {
    const batch = current.view.batches.find((b) => b.id === stopping);
    if (!batch) {
      mode = 'list';
      return renderList(current);
    }
    const preview = stopPreview(batch, deps.now());
    return [
      el('h3', { class: 'factory-title' }, FACTORY_TEXT.stopTitle),
      el(
        'ul',
        { class: 'factory-stop-lines', 'data-testid': 'factory-stop-lines' },
        ...preview.lines.map((l) => el('li', {}, l)),
      ),
      el(
        'div',
        { class: 'factory-row' },
        button(
          FACTORY_TEXT.stopYes,
          () => {
            const id = batch.id;
            void run(
              () => deps.stop(id),
              () => {
                stopping = null;
                mode = 'list';
                deps.onMode?.('list');
              },
            );
          },
          { 'data-testid': 'factory-stop-confirm' },
        ),
        button(
          FACTORY_TEXT.keepGoing,
          () => {
            stopping = null;
            setMode('list');
          },
          { 'data-testid': 'factory-keep-going' },
          true,
        ),
      ),
    ];
  }

  function render(): void {
    ticking = [];
    fullText = null;
    if (!state) {
      element.replaceChildren();
      syncTicker();
      return;
    }
    const parts =
      mode === 'pick' ? renderPick(state) : mode === 'stop' ? renderStop(state) : renderList(state);
    say.textContent = line;
    element.replaceChildren(...parts, say);
    syncTicker();
  }

  /**
   * Once a second: rewrite the times, counts and bars in place (one Text node
   * each, never replaced, so a finger resting on Stop keeps its button:
   * DECISIONS, Fix PR #173). Redraw only when a batch finishes (its Stop goes)
   * or a spot frees up.
   */
  function tick(): void {
    if (!element.isConnected || !state) {
      pause();
      return;
    }
    const now = deps.now();
    const rows = batchRows(state.view, now);
    let redraw = false;
    for (const t of ticking) {
      const row = rows.find((r) => r.batch.id === t.row.batch.id);
      if (!row) continue;
      if (row.finished !== t.row.finished) redraw = true;
      t.count.data = `${String(row.done)}/${String(row.total)}`;
      t.bar.style.width = `${String(row.percent)}%`;
      t.text.data = batchTimeLine(row, now);
    }
    if (fullText) {
      if (hasRoom(state.view, now)) redraw = true;
      else fullText.data = FACTORY_TEXT.full(formatTimeLeft(soonestFreeMs(state.view, now)));
    }
    if (redraw) render();
  }

  function syncTicker(): void {
    const counting = mode === 'list' && (fullText !== null || ticking.some((t) => !t.row.finished));
    if (counting && ticker === undefined) ticker = window.setInterval(tick, 1000);
    else if (!counting) pause();
  }

  function pause(): void {
    if (ticker !== undefined) window.clearInterval(ticker);
    ticker = undefined;
  }

  return {
    element,
    update: (next) => {
      state = next;
      render();
    },
    pick: (recipeId, justThis = false) => {
      line = '';
      picked = recipeId ?? null;
      only = justThis && recipeId !== undefined;
      const row =
        state && recipeId
          ? pickRows(state.items, state.seasons, deps.isOpen).find((r) => r.recipe.id === recipeId)
          : undefined;
      count = Math.max(1, Math.min(PICK_DEFAULT, row?.canMake ?? 1));
      setMode('pick');
    },
    showList: () => {
      line = '';
      only = false;
      setMode('list');
    },
    get mode() {
      return mode;
    },
    pause,
  };
}
