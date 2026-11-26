import { buttonClass } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import {
  BOSS_TEXT,
  WARMTH_HEARTS,
  bossHudVars,
  chipStatus,
  type BefriendView,
  type BossPlates,
  type ChipStatus,
  type FriendPlate,
  type PickerState,
} from './boss-view.js';

// The mini-boss fight's own HUD pieces (#190 PR 1, the phone-first boss HUD,
// owner option 1): a slim strip at the top (the boss's name, energy, the
// order dots and one chip slot), a bottom sheet whose collapsed handle holds
// the team as three chips and rises with the picker on the player's turn,
// stage stickers for the callouts, and the befriend panel on the result
// card. battle.css styles them (`.boss-*`); `BOSS_HUD` holds the numbers.

/** A move button's look in the picker: name, its tag pills, and the area tag. */
export interface PickerMove {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly area: boolean;
  /** Takes a round to wind up (#234): the "⏳ Winds up" tag. */
  readonly windup?: boolean;
}

export interface PickerHandlers {
  readonly onPick: (move: string) => void;
  /** A tap on a team chip whose pick is made: back to that squishy's step. */
  readonly onChip: (slot: number) => void;
  readonly onGo: () => void;
  readonly onChange: () => void;
  /** Null hides "Same again" (nothing to repeat yet). */
  readonly onSameAgain: (() => void) | null;
}

export interface BossHud {
  /** Over the fight (the strip and the stage stickers): goes in the HUD's root. */
  readonly top: HTMLElement;
  /** The strip: the stage starts under it (`safe()`). */
  readonly strip: HTMLElement;
  /** In the sheet: the chip handle on top, the picker under it. */
  readonly dock: HTMLElement;
  /** The chip handle: the stage ends above it (`safe()`). */
  readonly handle: HTMLElement;
  /** `BOSS_HUD` as battle.css's custom properties, for the HUD's root. */
  readonly vars: Readonly<Record<string, string>>;
  setPlates: (plates: BossPlates) => void;
  /** "Round N" on the handle, or null to hide it. */
  setRound: (round: number | null) => void;
  /**
   * The order dots while a round plays: who moves, in the order the server's
   * log has them, the one moving now lit. Null empties them (their room stays).
   */
  setOrder: (order: { movers: readonly OrderMover[]; current: number } | null) => void;
  /** A sticker by the boss ("Here it comes!"), or over a friend's chip. */
  callout: (who: 'boss' | number, text: string) => void;
  showPicker: (
    state: PickerState,
    moves: (slot: number) => readonly PickerMove[],
    handlers: PickerHandlers,
  ) => void;
  hidePicker: () => void;
  /** The fight closed: the picker goes and the sheet rests, so the next fight opens without a slide. */
  reset: () => void;
  dispose: () => void;
}

const CALLOUT_MS = 1100; // TUNE: the HUD's own callout length

/** One mover on the order strip: the boss, or a friend by slot. */
export interface OrderMover {
  readonly who: 'boss' | number;
  readonly name: string;
}

/** The status dot's mark: a colour says most, these say the rest. */
const STATUS_MARK: Readonly<Record<ChipStatus, string>> = {
  ok: '',
  picking: '',
  picked: '✓',
  windup: '⏳',
  down: '💤',
};

const setBar = (b: { track: HTMLElement; fill: HTMLElement }, percent: number, text: string) => {
  b.fill.style.width = `${String(percent)}%`;
  b.fill.classList.toggle('battle-energy-low', percent <= 30);
  b.track.setAttribute('aria-valuenow', String(percent));
  b.track.setAttribute('aria-valuetext', text);
};

/** "Same again", or null when there's nothing to repeat. */
function sameAgainButton(handlers: PickerHandlers): HTMLElement | null {
  const onSameAgain = handlers.onSameAgain;
  if (!onSameAgain) return null;
  const again = el(
    'button',
    {
      type: 'button',
      class: `${buttonClass({ small: true })} battle-cream`,
      'data-testid': 'boss-same-again',
    },
    BOSS_TEXT.sameAgain,
  );
  again.addEventListener('click', onSameAgain);
  return again;
}

/** One team chip: the tinted disc with the initial in its energy ring, and a status dot. */
interface TeamChip {
  readonly node: HTMLButtonElement;
  readonly face: HTMLElement;
  readonly dot: HTMLElement;
  readonly callout: HTMLElement;
  friend: FriendPlate;
  /** What the chip shows now, so a pass that changes nothing writes nothing. */
  shown: string;
}

export function mountBossHud(): BossHud {
  // ── The strip ──
  const bossName = el('span', { class: 'boss-name', 'data-testid': 'boss-name' });
  const fill = el('div', { class: 'battle-energy-fill' });
  const bossBar = {
    track: el(
      'div',
      {
        class: 'battle-energy boss-bar',
        role: 'progressbar',
        'aria-label': 'Energy',
        'data-testid': 'boss-energy',
      },
      fill,
    ),
    fill,
  };
  // The one chip slot: ⏳ while the boss winds up, its words as the label.
  const winding = el(
    'span',
    {
      class: 'boss-slot',
      role: 'img',
      'aria-label': BOSS_TEXT.windingUp,
      title: BOSS_TEXT.windingUp,
      'data-testid': 'boss-windup',
    },
    '⏳',
  );
  winding.hidden = true;
  const orderDots = el('span', {
    class: 'boss-order',
    role: 'img',
    'data-testid': 'boss-order',
  });
  const strip = el(
    'div',
    { class: 'boss-strip', 'data-testid': 'boss-strip' },
    el('div', { class: 'boss-strip-line' }, bossName, orderDots),
    el('div', { class: 'boss-strip-line' }, bossBar.track, winding),
  );
  const bossCallout = el('span', {
    class: 'boss-callout',
    role: 'status',
    'data-testid': 'boss-callout',
  });
  bossCallout.hidden = true;
  const top = el('div', { class: 'boss-top' }, strip, bossCallout);

  // ── The chip handle and the picker, in the sheet ──
  const round = el('span', { class: 'boss-round', 'data-testid': 'boss-round' });
  round.hidden = true;
  const chipRow = el('div', { class: 'boss-friends', 'data-testid': 'boss-friends' });
  const handle = el('div', { class: 'boss-handle', 'data-testid': 'boss-handle' }, round, chipRow);
  const picker = el('div', { class: 'boss-picker', 'data-testid': 'boss-picker' });
  picker.hidden = true;
  const dock = el('div', { class: 'boss-dock', 'data-sheet': 'rest' }, handle, picker);

  const chips = new Map<number, TeamChip>();
  /** The picker on screen (its chips' statuses), and its handlers. */
  let picking: PickerState | null = null;
  let chipTap: ((slot: number) => void) | null = null;
  const timers = new Set<number>();

  const flash = (node: HTMLElement, text: string) => {
    node.textContent = text;
    node.hidden = false;
    node.classList.remove('boss-callout-show');
    node.getBoundingClientRect(); // a style flush, so the pop restarts
    node.classList.add('boss-callout-show');
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      node.hidden = true;
      node.classList.remove('boss-callout-show');
    }, CALLOUT_MS);
    timers.add(timer);
  };

  /** Draws a chip's ring, dot and label from its friend and the picker; writes only what changed. */
  const drawChip = (chip: TeamChip) => {
    const f = chip.friend;
    const status = chipStatus(f, picking);
    // A finished pick goes back to that squishy's step; nothing else takes a tap.
    const tappable = status === 'picked' && chipTap !== null;
    const key = `${f.name}|${String(f.percent)}|${status}|${String(tappable)}`;
    if (key === chip.shown) return;
    chip.shown = key;
    chip.face.textContent = Array.from(f.name)[0] ?? '';
    chip.node.style.setProperty('--pct', String(f.percent));
    chip.node.classList.toggle('boss-friend-low', f.percent <= 30);
    chip.node.dataset['status'] = status;
    chip.dot.textContent = STATUS_MARK[status];
    chip.node.disabled = !tappable;
    chip.node.dataset['energy'] = f.energyText;
    chip.node.setAttribute(
      'aria-label',
      BOSS_TEXT.chipLabel(f.name, f.percent, BOSS_TEXT.chipDoing[status]),
    );
    if (status === 'picking') chip.node.setAttribute('aria-current', 'step');
    else chip.node.removeAttribute('aria-current');
  };
  const drawChips = () => {
    for (const chip of chips.values()) drawChip(chip);
  };

  /** A tap on the strip shows the boss's whole name when it's cut short. */
  strip.addEventListener('click', () => {
    if (bossName.scrollWidth > bossName.clientWidth + 1) flash(bossCallout, bossName.textContent);
  });

  const hud: BossHud = {
    top,
    strip,
    dock,
    handle,
    vars: bossHudVars(),
    setPlates: (plates) => {
      bossName.textContent = plates.boss.name;
      winding.hidden = !plates.boss.windup;
      setBar(bossBar, plates.boss.percent, plates.boss.energyText);
      const seen = new Set<number>();
      for (const friend of plates.friends) {
        seen.add(friend.slot);
        let chip = chips.get(friend.slot);
        if (!chip) {
          const face = el('span', { class: 'boss-friend-face', 'aria-hidden': 'true' });
          const dot = el('span', { class: 'boss-friend-dot', 'aria-hidden': 'true' });
          const callout = el('span', { class: 'boss-callout boss-callout-small', role: 'status' });
          callout.hidden = true;
          const slot = friend.slot;
          const node = el(
            'button',
            {
              type: 'button',
              // The same tint as its order dot (`m.who % 3`), so the dots point at the right chip.
              class: `boss-friend boss-friend-tint-${String(slot % 3)}`,
              'data-testid': `boss-friend-${String(slot)}`,
            },
            face,
            dot,
            callout,
          );
          node.addEventListener('click', () => {
            chipTap?.(slot);
          });
          chip = { node, face, dot, callout, friend, shown: '' };
          chips.set(slot, chip);
          // Slot order, left to right, whatever order they arrive in.
          const after = [...chips.keys()].filter((s) => s > slot).sort((a, b) => a - b)[0];
          const next = after === undefined ? null : (chips.get(after)?.node ?? null);
          chipRow.insertBefore(node, next);
        }
        chip.friend = friend;
        drawChip(chip);
      }
      for (const [slot, chip] of chips) {
        if (!seen.has(slot)) {
          chip.node.remove();
          chips.delete(slot);
        }
      }
    },
    setRound: (n) => {
      round.hidden = n === null;
      round.textContent = n === null ? '' : BOSS_TEXT.round(n);
    },
    setOrder: (o) => {
      if (!o || o.movers.length === 0) {
        orderDots.replaceChildren();
        orderDots.removeAttribute('aria-label');
        return;
      }
      orderDots.replaceChildren(
        ...o.movers.map((m, i) =>
          el(
            'span',
            {
              class: `boss-order-dot ${
                m.who === 'boss' ? 'boss-order-boss' : `boss-order-friend-${String(m.who % 3)}`
              }${i === o.current ? ' boss-order-now' : ''}`,
            },
            m.who === 'boss' ? '👣' : (Array.from(m.name)[0] ?? ''),
          ),
        ),
      );
      orderDots.setAttribute(
        'aria-label',
        BOSS_TEXT.orderLabel(o.movers.map((m) => m.name).join(', ')),
      );
    },
    callout: (who, text) => {
      const node = who === 'boss' ? bossCallout : chips.get(who)?.callout;
      if (node) flash(node, text);
    },
    showPicker: (state, moves, handlers) => {
      picker.hidden = false;
      dock.dataset['sheet'] = 'raised';
      picking = state;
      chipTap = handlers.onChip;
      drawChips();
      // The team row lives on the chips above (M0: the picker's own row repeated them).
      const body: HTMLElement[] = [];
      const ready = state.at >= state.steps.length;
      if (ready) {
        body.push(el('p', { class: 'battle-ask' }, BOSS_TEXT.ready));
        const go = el(
          'button',
          {
            type: 'button',
            class: `${buttonClass({ variant: 'primary' })} boss-go`,
            'data-testid': 'boss-go',
          },
          BOSS_TEXT.go,
        );
        go.addEventListener('click', handlers.onGo);
        const change = el(
          'button',
          {
            type: 'button',
            class: `${buttonClass({ small: true })} battle-cream`,
            'data-testid': 'boss-change',
          },
          BOSS_TEXT.changePick,
        );
        change.addEventListener('click', handlers.onChange);
        // "Change a pick" and "Same again" side by side (mockup A2).
        const same = sameAgainButton(handlers);
        body.push(go, el('div', { class: 'boss-picker-row' }, change, ...(same ? [same] : [])));
      } else {
        const step = state.steps[state.at];
        if (step) {
          const header = el('p', { class: 'battle-ask', 'data-testid': 'boss-pick-header' });
          // Winding up (#234): ⏳ by its name, and its one move to pick again.
          header.append(
            'What should ',
            el('b', {}, step.windingUp === true ? `⏳ ${step.name}` : step.name),
            ' do?',
          );
          header.setAttribute('aria-label', BOSS_TEXT.pickHeader(step.name));
          const grid = el('div', { class: 'battle-moves boss-moves' });
          for (const move of moves(step.slot)) {
            const picked = state.picks[step.slot] === move.id;
            const button = el(
              'button',
              {
                type: 'button',
                class: `${buttonClass()} battle-move boss-move${picked ? ' boss-move-picked' : ''}`,
                'data-testid': 'boss-move',
                'data-move': move.id,
              },
              el('span', { class: 'boss-move-name' }, move.name),
              el(
                'span',
                { class: 'boss-move-tags' },
                ...move.tags.map((t) => el('span', { class: 'boss-tag' }, t)),
                ...(move.area
                  ? [el('span', { class: 'boss-tag boss-tag-area' }, BOSS_TEXT.areaTag)]
                  : []),
                ...(move.windup === true
                  ? [el('span', { class: 'boss-tag boss-tag-windup' }, BOSS_TEXT.windupTag)]
                  : []),
              ),
            );
            button.addEventListener('click', () => {
              handlers.onPick(move.id);
            });
            grid.append(button);
          }
          body.push(header, grid);
        }
      }
      const again = ready ? null : sameAgainButton(handlers);
      if (again) body.push(el('div', { class: 'boss-picker-row' }, again));
      picker.replaceChildren(...body);
    },
    hidePicker: () => {
      if (!picker.hidden) dock.dataset['sheet'] = 'lowered';
      picker.hidden = true;
      picker.replaceChildren();
      picking = null;
      chipTap = null;
      drawChips();
    },
    reset: () => {
      hud.hidePicker();
      dock.dataset['sheet'] = 'rest';
    },
    dispose: () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      top.remove();
      dock.remove();
    },
  };
  return hud;
}

/** The warmth hearts: the server's coarse step, lit as hearts, never a number (mockup frame 3). */
function warmthRow(lit: number): HTMLElement {
  const row = el('div', {
    class: 'boss-warmth',
    'data-testid': 'boss-warmth',
    'data-lit': String(lit),
    'aria-label': BOSS_TEXT.warmer,
  });
  for (let i = 0; i < WARMTH_HEARTS; i++) {
    row.append(el('span', { class: `boss-heart${i < lit ? ' boss-heart-lit' : ''}` }, '💗'));
  }
  return row;
}

/**
 * The befriend panel for the result card, or null when there's nothing to
 * show. `onAsk` sends the ask; `onHome` takes the player home to make charms.
 */
export function befriendPanel(
  view: BefriendView,
  handlers: { onAsk: (ask: number) => void; onHome: () => void; busy: boolean },
): HTMLElement | null {
  const panel = (kind: string, ...children: Node[]) =>
    el(
      'div',
      { class: `boss-befriend boss-befriend-${kind}`, 'data-testid': `boss-befriend-${kind}` },
      ...children,
    );
  switch (view.kind) {
    case 'none':
      return null;
    case 'joined':
      return panel(
        'joined',
        el('p', { class: 'boss-befriend-title' }, view.headline),
        el('p', {}, view.sub),
        el('p', { class: 'battle-hint' }, view.fine),
      );
    case 'have-one':
      return panel(
        'have-one',
        el('p', { class: 'boss-befriend-title' }, view.headline),
        el('p', {}, view.sub),
      );
    case 'closed':
      return panel(
        'closed',
        ...(view.headline ? [el('p', { class: 'boss-befriend-title' }, view.headline)] : []),
        ...(view.warmth > 0 ? [warmthRow(view.warmth)] : []),
        el('p', { class: 'battle-hint' }, view.line),
      );
    case 'ask': {
      // Paired into rows so the card fits under the boss without scrolling.
      const row = (...nodes: Node[]) => el('div', { class: 'boss-befriend-row' }, ...nodes);
      const children: Node[] = [];
      if (view.notYet) {
        children.push(
          el('p', { class: 'boss-befriend-title', 'data-testid': 'boss-not-yet' }, view.notYet),
          row(warmthRow(view.warmth), el('p', { class: 'boss-warmer' }, BOSS_TEXT.warmer)),
        );
      } else {
        children.push(el('p', { class: 'boss-befriend-title' }, view.headline));
        // Warmer from an earlier visit's "not yet"s: the hearts carry across.
        if (view.warmth > 0) children.push(warmthRow(view.warmth));
      }
      const dots = el('span', {
        class: 'boss-dots',
        role: 'img',
        'aria-label': BOSS_TEXT.asksLeftLabel(view.asksLeft),
      });
      for (let i = 0; i < view.asksLeft; i++) dots.append(el('span', { class: 'boss-dot' }));
      children.push(
        row(
          ...(view.charmsLine ? [el('p', { class: 'boss-charm-pill' }, view.charmsLine)] : []),
          el(
            'p',
            { class: 'battle-hint boss-asks-left' },
            BOSS_TEXT.asksLeft,
            el('span', { class: 'boss-asks-win' }, BOSS_TEXT.asksLeftWin),
            ' ',
            dots,
          ),
        ),
      );
      const ask = el(
        'button',
        {
          type: 'button',
          class: buttonClass({ variant: 'primary' }),
          'data-testid': 'boss-ask',
        },
        handlers.busy ? BOSS_TEXT.asking : view.button,
      );
      ask.disabled = !view.enabled || handlers.busy;
      ask.addEventListener('click', () => {
        handlers.onAsk(view.ask);
      });
      if (view.needCharms) {
        // "Make Heart Charms 🏠" says where charms come from: the card stays short.
        const home = el(
          'button',
          {
            type: 'button',
            class: `${buttonClass({ small: true })} battle-cream`,
            'data-testid': 'boss-make-charms',
          },
          BOSS_TEXT.makeCharms,
        );
        home.addEventListener('click', handlers.onHome);
        children.push(row(ask, home));
      } else {
        children.push(ask);
      }
      return panel('ask', ...children);
    }
  }
}
