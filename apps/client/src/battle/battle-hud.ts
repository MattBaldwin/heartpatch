import { ELEMENTS, FEELINGS, type BattleSideId, type PlayerBattleAction } from '@heartpatch/shared';
import { CARE_TEXT, evolvingBar } from '../care/care-view.js';
import { evolvingMeterEl } from '../care/evolving-meter.js';
import { el } from '../ui/dom.js';
import { dressResult, type BefriendCheer } from './befriend-cheer.js';
import { ELEMENT_GLYPH, FEELING_GLYPH } from '../ui/glyphs.js';
import type { SafeRegion } from './camera-director.js';
import { charmButton, noCharmsLine } from './heart-charm.js';
import { EDGE_WORDS, moveLabel, type MoveInfo } from './move-info.js';
import {
  CHIP_LOOKS,
  itemButtonLabel,
  itemButtonName,
  NO_CHIPS,
  pickLine,
  sippedLabel,
  sippedName,
  type PlateChips,
  type PotionTile,
} from './potions.js';
import './battle.css';

// The battle HUD (tech spec §6: a DOM overlay for sharp text and big
// targets; owner decision 2026-10-05: the Storybook Diorama's HUD): compact
// name and energy pills in the top corners, each over its own squishy, the
// caption and the moves in a bottom sheet of at most 35% of the screen, and
// nothing over the fighters. Comic callouts ("Super cozy!") pop under a pill.
// Words follow docs/STYLE_GUIDE.md: energy, tuckered out, never hurt.

export interface PlateInfo {
  name: string;
  level: number;
  element: string;
  feeling: string;
  /** 0–100. */
  percent: number;
  energyText: string;
  status: string | null;
  /** Potion chips (#214): ⚔️+ and 🛡️+ for the battle, ✨ while the shield is up. */
  chips?: PlateChips;
}

export type ControlMode =
  /** The player picks a move or swaps. */
  | {
      type: 'choose';
      /** Each move with what its button says about it (#565, `describeMove`). */
      moves: { id: string; name: string; info: MoveInfo }[];
      bench: { slot: number; name: string }[];
      /**
       * A wild squishy: the "Use Heart Charm" button (befriend, style guide §9),
       * always shown with the bag's count (null while it loads); null elsewhere.
       */
      capture: { charms: number | null } | null;
      /**
       * Potions (#214): "Use item" with every potion in the bag (null while
       * it loads), and the picker's tiles. Null in a replay.
       */
      items: { total: number | null; tiles: PotionTile[]; who: string } | null;
      /**
       * The potion sipped for this turn (a free sip, #403), not sent yet:
       * the moves carry it, its button reads "Sipped ✓" and puts it back,
       * and the Heart Charm and Swap wait (a sip rides with a move). Null or
       * missing: none.
       */
      sipped?: string | null;
      /** Breaking a fence (#203): the turn it is, and the most it lasts. Null elsewhere. */
      fence?: { turn: number; limit: number } | null;
      /**
       * The leave button's words, when not "Run away" (a friendly battle's
       * "Give up", #29); null for no leave button (a live defense's defender
       * stays to the end, #29-C).
       */
      runWords?: RunWords | null;
    }
  /** Their squishy is tuckered out: pick who comes out. */
  | { type: 'replace'; bench: { slot: number; name: string }[] }
  /** The log is playing, or the server is thinking. */
  | { type: 'waiting' }
  | { type: 'hidden' };

/** The leave button and its "are you sure?" (style guide §3: forgiving). */
export interface RunWords {
  readonly run: string;
  readonly ask: string;
  readonly yes: string;
  readonly stay: string;
}

const PLAIN_RUN = {
  run: 'Run away',
  ask: 'Scoot away from this one?',
  yes: 'Yes, scoot!',
  stay: 'Stay and play',
} as const;

/** At a fence (#203, the owner-approved mockup). */
export const FENCE_RUN = {
  run: 'Stop for now',
  ask: 'Stop for now? The fence keeps the energy it lost.',
  yes: 'Yes, stop',
  stay: 'Keep at it',
} as const;

/** "Turn 3 of 6 · it holds if it's still standing then." */
export function fenceTurnLine(turn: number, limit: number): string {
  return `Turn ${String(Math.min(turn, limit))} of ${String(limit)} · a fence still standing then holds.`;
}

export interface ResultInfo {
  title: string;
  subtitle: string;
  /** "Moonpuff earned 12 XP" lines. */
  xp: string[];
  /**
   * The evolving meter under each XP line (#205), by index: the percent
   * before and after this battle. Missing or null: no meter for that line.
   */
  evolving?: readonly ({ before: number; after: number } | null)[];
  /** One extra hint line ("Weaken a wild squishy, then…"), if any. */
  nudge?: string;
  done: string;
  /**
   * A broken fence's card (#527): a primary button that starts the guard
   * showdown, with `done` as the secondary "Not now".
   */
  keepGoing?: { label: string; onKeepGoing: () => void };
  /** A rare friend or a first of its kind: the card celebrates (#391). */
  cheer?: { readonly info: BefriendCheer; readonly reducedMotion: boolean };
}

export interface BattleHud {
  /** Where a live battle's bar goes (#29), at the top of the sheet; hidden otherwise. */
  readonly liveSlot: HTMLElement;
  show: () => void;
  hide: () => void;
  setPlate: (side: 'mine' | 'theirs', info: PlateInfo) => void;
  setCaption: (text: string | null) => void;
  /** A comic callout ("Super cozy!") under a side's pill. */
  callout: (side: 'mine' | 'theirs', text: string) => void;
  setControls: (mode: ControlMode) => void;
  /** A friendly problem line under the controls (empty to clear). */
  setProblem: (text: string) => void;
  showResult: (info: ResultInfo) => void;
  hideResult: () => void;
  /**
   * Keep going couldn't start (#527): the reason, in view above the buttons,
   * the button that can't work gone, and the other one a single `ok` that closes.
   */
  refuseKeepGoing: (text: string, ok: string) => void;
  /** Keep going is on its way: its button waits. */
  setKeepGoingBusy: (busy: boolean) => void;
  /** Where the fight may be drawn: under the pills, above the sheet (fractions of the height). */
  safe: () => SafeRegion;
  /** The bottom sheet's top edge on the page, CSS px (#391's banner sits above it). */
  sheetTop: () => number;
  readonly visible: boolean;
  dispose: () => void;
}

export interface BattleHudOptions {
  onAction: (action: PlayerBattleAction) => void;
  onDone: () => void;
  onLeave: () => void;
  /**
   * The Heart Charm button was tapped with none in the bag (as far as the
   * HUD knows): the screen checks the bag again and explains or goes ahead.
   */
  onNoCharms: () => void;
  /**
   * A dimmed potion was tapped (none in the bag, or already had one): the
   * screen checks the bag again and explains or goes ahead.
   */
  onNoItem: (tile: PotionTile) => void;
  /**
   * A potion was picked (#403): a free sip. The screen shows it ("Sipped ✓",
   * a sparkle, the shield) and keeps the moves open; the sip goes out with
   * the move.
   */
  onSip: (id: string) => void;
  /** The "Sipped ✓" button was tapped: the potion goes back in the bag. */
  onUnsip: () => void;
}

/** Which side a plate shows, for the dev hook and tests. */
export const plateSideOf = (mySide: BattleSideId, side: BattleSideId): 'mine' | 'theirs' =>
  side === mySide ? 'mine' : 'theirs';

const CALLOUT_MS = 1100; // TUNE: long enough to read "Super cozy!"

/**
 * The sheet's share of the screen is reserved even while only the caption
 * shows, so the fight never jumps. Keep it equal to `.battle-sheet`'s
 * `max-height` in battle.css (35vh): this is what the camera keeps clear.
 */
export const SHEET_SHARE = 0.35; // TUNE

const ELEMENT_NAMES = new Map<string, string>(ELEMENTS.map((e) => [e.id, e.name]));
const FEELING_NAMES = new Map<string, string>(FEELINGS.map((f) => [f.id, f.name]));

/** What `watchLayout` listens with: the window and the `ResizeObserver` class (tests pass fakes). */
export interface LayoutWatchEnv {
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly Observer: new (
    callback: ResizeObserverCallback,
  ) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
}

/**
 * Calls `onChange` when the window resizes or any of `nodes` changes size,
 * and returns the cleanup that stops both, so a disposed HUD leaves no
 * listener or observer behind.
 */
export function watchLayout(
  nodes: readonly Element[],
  onChange: () => void,
  env: LayoutWatchEnv = { win: window, Observer: ResizeObserver },
): () => void {
  env.win.addEventListener('resize', onChange);
  const boxes = new env.Observer(onChange);
  for (const node of nodes) boxes.observe(node);
  return () => {
    env.win.removeEventListener('resize', onChange);
    boxes.disconnect();
  };
}

export function mountBattleHud(root: HTMLElement, options: BattleHudOptions): BattleHud {
  const plate = (side: 'mine' | 'theirs') => {
    const name = el('span', { class: 'battle-plate-name' });
    const level = el('span', { class: 'battle-plate-level' });
    const bar = el('div', { class: 'battle-energy-fill' });
    const energy = el('span', {
      class: 'battle-plate-energy',
      'data-testid': `battle-energy-${side}`,
    });
    const element = el('span', { class: 'battle-badge', role: 'img' });
    const feeling = el('span', { class: 'battle-badge', role: 'img' });
    const status = el('span', { class: 'battle-plate-status' });
    const chip = (kind: keyof PlateChips) => {
      const look = CHIP_LOOKS[kind];
      const node = el(
        'span',
        {
          class: `battle-chip battle-chip-${kind}`,
          role: 'img',
          'aria-label': look.label,
          title: look.label,
          'data-testid': `battle-chip-${kind}-${side}`,
        },
        look.text,
      );
      node.hidden = true;
      return node;
    };
    const chips = { attack: chip('attack'), defense: chip('defense'), shield: chip('shield') };
    const callout = el('span', { class: 'battle-callout', role: 'status' });
    const node = el(
      'div',
      { class: `battle-plate battle-plate-${side}`, 'data-testid': `battle-plate-${side}` },
      el('div', { class: 'battle-plate-row' }, name),
      el(
        'div',
        { class: 'battle-plate-row' },
        el('div', { class: 'battle-energy', role: 'progressbar', 'aria-label': 'Energy' }, bar),
        el('span', { class: 'battle-badges' }, element, feeling),
      ),
      el(
        'div',
        { class: 'battle-plate-row battle-plate-foot' },
        level,
        energy,
        status,
        chips.attack,
        chips.defense,
        chips.shield,
      ),
      callout,
    );
    return { node, name, level, bar, energy, element, feeling, status, chips, callout, timer: 0 };
  };
  const plates = { mine: plate('mine'), theirs: plate('theirs') };

  const caption = el('p', {
    class: 'battle-caption',
    role: 'status',
    'data-testid': 'battle-caption',
  });
  const problem = el('p', { class: 'auth-error battle-problem', role: 'alert' });
  const controls = el('div', { class: 'battle-controls', 'data-testid': 'battle-controls' });
  const leave = el(
    'button',
    { type: 'button', class: 'battle-leave', 'aria-label': 'Back to patch' },
    '×',
  );
  leave.addEventListener('click', options.onLeave);

  const result = el('section', {
    class: 'battle-result auth-card',
    role: 'dialog',
    'aria-labelledby': 'battle-result-title',
    'data-testid': 'battle-result',
  });
  result.hidden = true;

  const top = el('div', { class: 'battle-top' }, plates.mine.node, leave, plates.theirs.node);
  // A live battle's bar (#29): the turn timer, the opponent and cheers.
  const liveSlot = el('div', { class: 'battle-live', 'data-testid': 'battle-live' });
  liveSlot.hidden = true;
  const sheet = el(
    'section',
    { class: 'battle-sheet', 'data-testid': 'battle-sheet' },
    liveSlot,
    caption,
    controls,
    problem,
  );
  // The shield takes every touch, drag, pinch and wheel on the fight itself,
  // so none reaches the canvas and the map camera's gestures underneath: the
  // director alone moves the battle camera. The controls sit on top of it.
  const shield = el('div', { class: 'battle-shield', 'data-testid': 'battle-shield' });
  // A rare friend's hearts (#391), under the card.
  const hearts = el('div', { class: 'battle-hearts', 'aria-hidden': 'true' });
  let undress: (() => void) | null = null;
  // The result card's own line and Keep going button (#527), made with each card.
  let resultNote = el('p', {});
  let keepGoingButton: HTMLButtonElement | null = null;
  let doneButton: HTMLButtonElement | null = null;
  const hud = el(
    'section',
    { class: 'battle-hud', 'data-testid': 'battle-hud', 'aria-label': 'Squishy showdown' },
    shield,
    top,
    sheet,
    hearts,
    result,
  );
  hud.hidden = true;
  root.append(hud);

  // The safe region is measured at most once per layout change, not per frame:
  // on a resize, and when the HUD's or a pill's box changes (iOS sends
  // `resize` before a turned layout settles and none after, #251, #263).
  let safe: SafeRegion | null = null;
  const forget = () => {
    safe = null;
  };
  const stopWatching = watchLayout([hud, plates.mine.node, plates.theirs.node], forget);

  const button = (
    label: string,
    onClick: () => void,
    extra: { soft?: boolean; testId?: string; small?: boolean } = {},
  ) => {
    const classes = ['battle-button'];
    if (extra.soft) classes.push('battle-button-soft');
    if (extra.small) classes.push('battle-button-small');
    const node = el(
      'button',
      {
        type: 'button',
        class: classes.join(' '),
        ...(extra.testId ? { 'data-testid': extra.testId } : {}),
      },
      label,
    );
    node.addEventListener('click', onClick);
    return node;
  };

  const act = (action: PlayerBattleAction) => {
    problem.textContent = '';
    options.onAction(action);
  };

  /**
   * The potion picker (#214), inside the sheet like Run away's check, so the
   * fight stays in view. A dimmed tile still answers a tap: the screen
   * explains why, or finds the bag has one after all.
   */
  const openPicker = (
    mode: Extract<ControlMode, { type: 'choose' }>,
    items: NonNullable<Extract<ControlMode, { type: 'choose' }>['items']>,
  ): void => {
    delete controls.dataset['view'];
    problem.textContent = '';
    // The picker asks its own question: the last caption steps aside so the
    // tiles and Back fit the sheet on a phone (style guide §3).
    caption.hidden = true;
    const tiles = el('div', { class: 'battle-items' });
    for (const tile of items.tiles) {
      const count = el(
        'span',
        { class: 'battle-item-count' },
        tile.count === null ? '' : String(tile.count),
      );
      count.hidden = tile.count === null;
      const node = el(
        'button',
        {
          type: 'button',
          class: `battle-button battle-item${tile.state === 'ready' ? '' : ' battle-button-empty'}`,
          'data-testid': 'battle-item-pick',
          'data-item': tile.id,
          'data-state': tile.state,
        },
        el('span', { class: 'battle-item-icon', 'aria-hidden': 'true' }, tile.icon),
        tile.name,
        el('span', { class: 'battle-item-tag' }, tile.tag),
        count,
      );
      node.addEventListener('click', () => {
        problem.textContent = '';
        if (tile.state === 'ready') options.onSip(tile.id);
        else options.onNoItem(tile);
      });
      tiles.append(node);
    }
    controls.replaceChildren(
      el('p', { class: 'battle-ask' }, pickLine(items.who)),
      tiles,
      el(
        'div',
        { class: 'battle-row' },
        button(
          'Back',
          () => {
            setControls(mode);
          },
          { soft: true, small: true, testId: 'battle-item-back' },
        ),
      ),
    );
  };

  /** "Who comes out?": the bench, in the sheet like the potion picker (#214). */
  const openSwap = (mode: Extract<ControlMode, { type: 'choose' }>): void => {
    problem.textContent = '';
    delete controls.dataset['view'];
    const pick = el('div', { class: 'battle-moves' });
    for (const { slot, name } of mode.bench) {
      pick.append(
        button(
          name,
          () => {
            act({ type: 'swap', slot });
          },
          { soft: true, testId: 'battle-swap-pick' },
        ),
      );
    }
    controls.replaceChildren(
      el('p', { class: 'battle-ask' }, 'Who comes out?'),
      pick,
      el(
        'div',
        { class: 'battle-row' },
        button(
          'Back',
          () => {
            setControls(mode);
          },
          { soft: true, small: true, testId: 'battle-swap-back' },
        ),
      ),
    );
  };

  /** The "ⓘ More" view of the move buttons (#565): each one adds its own words and chances. */
  let moreMoves = false;

  const setControls = (mode: ControlMode): void => {
    controls.replaceChildren();
    // Back from the potion picker: the caption returns.
    caption.hidden = caption.textContent === '';
    controls.hidden = mode.type === 'hidden';
    sheet.dataset['mode'] = mode.type;
    // The base pick (moves, Swap, Run): a live battle lays it out as one grid
    // (battle.css). "Who comes out?" and the run check clear it.
    if (mode.type === 'choose') controls.dataset['view'] = 'pick';
    else delete controls.dataset['view'];
    switch (mode.type) {
      case 'choose': {
        const sipped = mode.sipped ?? null;
        const moves = el('div', { class: 'battle-moves' });
        moves.classList.toggle('battle-moves-more', moreMoves);
        for (const move of mode.moves) {
          const { info } = move;
          const node = el(
            'button',
            {
              type: 'button',
              class: `battle-button battle-move battle-move-${info.kind}`,
              'data-testid': 'battle-move',
              'data-kind': info.kind,
              'aria-label': moveLabel(move.name, info),
            },
            el('span', { class: 'battle-move-name' }, move.name),
            el(
              'span',
              { class: 'battle-move-chips' },
              // Icon, word and colour together: the kind never rests on colour alone.
              el(
                'span',
                { class: 'battle-move-kind' },
                el('span', { 'aria-hidden': 'true' }, info.look.icon),
                info.look.label,
                ...(info.number ? [el('span', { class: 'battle-move-number' }, info.number)] : []),
              ),
              ...(info.edge
                ? [
                    el(
                      'span',
                      { class: `battle-move-edge battle-move-edge-${info.edge}` },
                      el('span', { 'aria-hidden': 'true' }, EDGE_WORDS[info.edge].icon),
                      // A live battle's narrow grid keeps the arrow and drops the word (battle.css).
                      el('span', { class: 'battle-move-edge-word' }, EDGE_WORDS[info.edge].label),
                    ),
                  ]
                : []),
            ),
            el('span', { class: 'battle-move-line' }, info.line),
            el('span', { class: 'battle-move-more' }, ...info.more.map((t) => el('span', {}, t))),
          );
          node.addEventListener('click', () => {
            // A sipped potion goes out with the move (a free sip, #403).
            act(
              sipped === null
                ? { type: 'move', move: move.id }
                : { type: 'move', move: move.id, item: sipped },
            );
          });
          moves.append(node);
        }
        const row = el('div', { class: 'battle-row' });
        const moreButton = button(
          'ⓘ',
          () => {
            moreMoves = !moreMoves;
            setControls(mode);
            // The controls were rebuilt: keep a keyboard or VoiceOver player's place.
            controls.querySelector<HTMLElement>('[data-testid="battle-moves-more"]')?.focus();
          },
          { soft: true, small: true, testId: 'battle-moves-more' },
        );
        moreButton.setAttribute('aria-label', 'More about these moves');
        moreButton.setAttribute('aria-pressed', String(moreMoves));
        row.append(moreButton);
        let hint: HTMLElement | null = null;
        if (mode.capture && sipped === null) {
          // Always there in a wild battle, so a player learns befriending
          // exists; with none in the bag it stays, dimmed, and explains.
          const charm = charmButton(mode.capture.charms);
          const node = button(
            charm.label,
            () => {
              if (charm.empty) options.onNoCharms();
              else act({ type: 'capture' });
            },
            { small: true, testId: 'battle-capture' },
          );
          if (charm.empty) {
            node.classList.add('battle-button-empty');
            // Still tappable (not `disabled`): a tap explains, and checks the bag again.
            hint = el(
              'p',
              { class: 'battle-hint', 'data-testid': 'battle-capture-hint' },
              noCharmsLine(),
            );
            node.setAttribute('aria-describedby', 'battle-capture-hint');
            hint.id = 'battle-capture-hint';
          }
          row.append(node);
        }
        // Line 1 (owner decision 2026-10-07, #214): the Heart Charm, the
        // compact potion button right beside it, and one Swap that asks who
        // comes out, so all three fit a 375 px phone with a full team. Run
        // away wraps to line 2, as before.
        if (mode.items && sipped !== null) {
          // Sipped, not sent yet: tap to put it back (style guide §3: forgiving).
          const done = button(sippedLabel(sipped), options.onUnsip, {
            small: true,
            testId: 'battle-item',
          });
          done.classList.add('battle-button-sipped');
          done.dataset['sipped'] = sipped;
          done.setAttribute('aria-label', sippedName(sipped));
          row.append(done);
        } else if (mode.items) {
          const items = mode.items;
          const potions = button(
            itemButtonLabel(items.total),
            () => {
              openPicker(mode, items);
            },
            { small: true, testId: 'battle-item' },
          );
          potions.setAttribute('aria-label', itemButtonName(items.total));
          // None in the bag: still there, dimmed, like the Heart Charm.
          if (items.total === 0) potions.classList.add('battle-button-empty');
          row.append(potions);
        }
        if (mode.bench.length > 0 && sipped === null) {
          row.append(
            button(
              'Swap',
              () => {
                openSwap(mode);
              },
              { soft: true, small: true, testId: 'battle-swap' },
            ),
          );
        }
        // Forgiving (style guide §3): running away asks first. At a fence
        // (#203) it's "Stop for now": the fence keeps what it lost.
        const words =
          mode.runWords === null ? null : (mode.runWords ?? (mode.fence ? FENCE_RUN : PLAIN_RUN));
        const run =
          words &&
          button(
            words.run,
            () => {
              delete controls.dataset['view'];
              controls.replaceChildren(
                el('p', { class: 'battle-ask' }, words.ask),
                el(
                  'div',
                  { class: 'battle-row' },
                  button(
                    words.yes,
                    () => {
                      act({ type: 'forfeit' });
                    },
                    { small: true, testId: 'battle-run-confirm' },
                  ),
                  button(
                    words.stay,
                    () => {
                      setControls(mode);
                    },
                    { soft: true, small: true },
                  ),
                ),
              );
            },
            { soft: true, small: true, testId: 'battle-run' },
          );
        if (run) row.append(run);
        controls.append(moves, row);
        if (hint) controls.append(hint);
        if (mode.fence) {
          controls.append(
            el(
              'p',
              { class: 'battle-hint', 'data-testid': 'battle-fence-turns' },
              fenceTurnLine(mode.fence.turn, mode.fence.limit),
            ),
          );
        }
        break;
      }
      case 'replace': {
        controls.append(el('p', { class: 'battle-ask' }, 'Who comes out next?'));
        const row = el('div', { class: 'battle-moves' });
        for (const { slot, name } of mode.bench) {
          row.append(
            button(
              name,
              () => {
                act({ type: 'replace', slot });
              },
              { testId: 'battle-replace' },
            ),
          );
        }
        controls.append(row);
        break;
      }
      case 'waiting':
        controls.append(el('p', { class: 'battle-ask battle-waiting' }, '…'));
        break;
      case 'hidden':
        break;
    }
  };

  return {
    liveSlot,
    show: () => {
      hud.hidden = false;
      forget();
    },
    hide: () => {
      undress?.();
      undress = null;
      hud.hidden = true;
      result.hidden = true;
    },
    setPlate: (side, info) => {
      const p = plates[side];
      p.name.textContent = info.name;
      p.level.textContent = `Lv ${String(info.level)}`;
      p.bar.style.width = `${String(info.percent)}%`;
      p.bar.classList.toggle('battle-energy-low', info.percent <= 25);
      p.energy.textContent = info.energyText;
      p.energy.setAttribute('aria-label', `${info.energyText} energy`);
      p.element.textContent = ELEMENT_GLYPH[info.element] ?? '✨';
      p.element.title = ELEMENT_NAMES.get(info.element) ?? info.element;
      p.element.setAttribute('aria-label', p.element.title);
      p.feeling.textContent = FEELING_GLYPH[info.feeling] ?? '☺️';
      p.feeling.title = FEELING_NAMES.get(info.feeling) ?? info.feeling;
      p.feeling.setAttribute('aria-label', p.feeling.title);
      p.status.textContent = info.status ?? '';
      p.status.hidden = info.status === null;
      const chips = info.chips ?? NO_CHIPS;
      p.chips.attack.hidden = !chips.attack;
      p.chips.defense.hidden = !chips.defense;
      p.chips.shield.hidden = !chips.shield;
      p.node.classList.toggle('battle-plate-tuckered', info.percent === 0);
      // A longer name or a status chip can grow the pill: measure again.
      forget();
    },
    setCaption: (text) => {
      caption.textContent = text ?? '';
      caption.hidden = text === null;
    },
    callout: (side, text) => {
      const p = plates[side];
      p.callout.textContent = text;
      // Restart the pop animation even if the same text shows twice in a row.
      p.callout.classList.remove('battle-callout-show');
      for (const animation of p.callout.getAnimations()) animation.cancel();
      requestAnimationFrame(() => {
        p.callout.classList.add('battle-callout-show');
      });
      window.clearTimeout(p.timer);
      p.timer = window.setTimeout(() => {
        p.callout.classList.remove('battle-callout-show');
      }, CALLOUT_MS);
    },
    setControls,
    setProblem: (text) => {
      problem.textContent = text;
    },
    showResult: (info) => {
      undress?.();
      undress = null;
      resultNote = el('p', {
        class: 'battle-hint',
        role: 'status',
        'data-testid': 'battle-result-note',
        hidden: '',
      });
      doneButton = button(info.done, options.onDone, {
        testId: 'battle-done',
        soft: info.keepGoing !== undefined,
      });
      keepGoingButton = info.keepGoing
        ? button(info.keepGoing.label, info.keepGoing.onKeepGoing, { testId: 'battle-keep-going' })
        : null;
      result.replaceChildren(
        el('h1', { class: 'auth-title', id: 'battle-result-title' }, info.title),
        el('p', { class: 'auth-subtitle' }, info.subtitle),
        el(
          'ul',
          { class: 'battle-xp', 'data-testid': 'battle-xp' },
          ...info.xp.map((line, i) => {
            const gain = info.evolving?.[i];
            if (!gain) return el('li', {}, line);
            const meter = evolvingMeterEl('battle-evolving');
            const bar = evolvingBar(gain.after);
            meter.update(bar, {
              gainedFrom: gain.before / 100,
              sub:
                gain.after > gain.before && !bar?.ready
                  ? CARE_TEXT.evolvingGain(gain.after - gain.before)
                  : undefined,
            });
            return el('li', {}, line, meter.root);
          }),
        ),
        ...(info.nudge
          ? [el('p', { class: 'battle-hint', 'data-testid': 'battle-nudge' }, info.nudge)]
          : []),
        resultNote,
        el(
          'div',
          { class: 'auth-actions' },
          ...(keepGoingButton ? [keepGoingButton, doneButton] : [doneButton]),
        ),
      );
      result.hidden = false;
      controls.hidden = true;
      if (info.cheer) {
        undress = dressResult(result, hearts, info.cheer.info, {
          reducedMotion: info.cheer.reducedMotion,
          pillsBottom: Math.max(
            plates.mine.node.getBoundingClientRect().bottom,
            plates.theirs.node.getBoundingClientRect().bottom,
          ),
          width: window.innerWidth || 1,
        });
      }
    },
    hideResult: () => {
      undress?.();
      undress = null;
      result.hidden = true;
    },
    refuseKeepGoing: (text, ok) => {
      resultNote.textContent = text;
      resultNote.hidden = false;
      keepGoingButton?.remove();
      keepGoingButton = null;
      if (doneButton) {
        doneButton.textContent = ok;
        doneButton.classList.remove('battle-button-soft');
      }
    },
    setKeepGoingBusy: (busy) => {
      if (keepGoingButton) keepGoingButton.disabled = busy;
    },
    safe: () => {
      if (safe) return safe;
      const h = window.innerHeight || 1;
      const pillBottom = Math.max(
        plates.mine.node.getBoundingClientRect().bottom,
        plates.theirs.node.getBoundingClientRect().bottom,
      );
      // The pills aren't laid out yet (hidden): a sensible guess until they are.
      const top = pillBottom > 0 ? (pillBottom + 10) / h : 0.14;
      safe = { top: Math.min(0.4, top), bottom: 1 - SHEET_SHARE };
      return safe;
    },
    sheetTop: () => {
      const top = sheet.getBoundingClientRect().top;
      return top > 0 ? top : (window.innerHeight || 1) * (1 - SHEET_SHARE);
    },
    get visible() {
      return !hud.hidden;
    },
    dispose: () => {
      stopWatching();
      for (const p of Object.values(plates)) window.clearTimeout(p.timer);
      hud.remove();
    },
  };
}
