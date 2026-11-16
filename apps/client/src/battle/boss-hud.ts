import { buttonClass } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { WIDE_MIN } from './battle-config.js';
import {
  BOSS_TEXT,
  WARMTH_HEARTS,
  type BefriendView,
  type BossPlates,
  type PickerState,
} from './boss-view.js';

// The mini-boss fight's own HUD pieces (#190, owner-approved arena A and
// picker A1): the boss's wide plate with the visit's chips, one slim plate
// per friend above the sheet, the team picker in the sheet, and the befriend
// panel on the result card. battle.css styles them (`.boss-*`).

/** A move button's look in the picker: name, its tag pills, and the area tag. */
export interface PickerMove {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly area: boolean;
}

export interface PickerHandlers {
  readonly onPick: (move: string) => void;
  readonly onChip: (slot: number) => void;
  readonly onGo: () => void;
  readonly onChange: () => void;
  /** Null hides "Same again" (nothing to repeat yet). */
  readonly onSameAgain: (() => void) | null;
}

export interface BossHud {
  /** Over the fight (the boss plate, the friends' plates): goes in the HUD's root. */
  readonly top: HTMLElement;
  /** In the sheet, above the caption's controls: the picker. */
  readonly picker: HTMLElement;
  setPlates: (plates: BossPlates) => void;
  /**
   * Each friend's plate under its body: `x` its middle and `feet` its lowest
   * point, in page pixels (`BattleScene.screenSpot`).
   */
  placeFriends: (spots: ReadonlyMap<number, FriendSpot>) => void;
  setChips: (chips: { tries: number | null; until: string | null }) => void;
  /** The "Round N" pill (mockup frame 1), or null to hide it. */
  setRound: (round: number | null) => void;
  /**
   * The turn-order strip while a round plays (mockup frame 1): who moves, in
   * the order the server's log has them, the one moving now outlined. Null hides it.
   */
  setOrder: (order: { movers: readonly OrderMover[]; current: number } | null) => void;
  /** "Stomp again!" next to the boss, or a friend's callout over its plate. */
  callout: (who: 'boss' | number, text: string) => void;
  showPicker: (
    state: PickerState,
    moves: (slot: number) => readonly PickerMove[],
    handlers: PickerHandlers,
  ) => void;
  hidePicker: () => void;
  dispose: () => void;
}

const CALLOUT_MS = 1100; // TUNE: the HUD's own callout length

/** Where a friend stands on screen, in page pixels. */
export interface FriendSpot {
  readonly x: number;
  readonly feet: number;
}

/** A plate sits this far under the lowest friend's feet on a wide screen. */
const PLATE_GAP = 8; // TUNE:
/** Left to right, for `placeFriends`' sort (one function, not one per pass). */
const byX = (a: { x: number }, b: { x: number }) => a.x - b.x;

/** One mover on the order strip: the boss, or a friend by slot. */
export interface OrderMover {
  readonly who: 'boss' | number;
  readonly name: string;
}

const bar = (testId: string) => {
  const fill = el('div', { class: 'battle-energy-fill' });
  const track = el(
    'div',
    { class: 'battle-energy', role: 'progressbar', 'aria-label': 'Energy', 'data-testid': testId },
    fill,
  );
  return { track, fill };
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

export function mountBossHud(): BossHud {
  const bossName = el('span', { class: 'boss-name', 'data-testid': 'boss-name' });
  const bossLevel = el('span', { class: 'boss-level' });
  const stomps = el('span', { class: 'boss-chip boss-chip-gold' }, BOSS_TEXT.stompsTwice);
  const tries = el('span', { class: 'boss-chip boss-chip-try', 'data-testid': 'boss-tries' });
  const until = el('span', { class: 'boss-chip boss-chip-until', 'data-testid': 'boss-until' });
  const bossBar = bar('boss-energy');
  const bossCallout = el('span', {
    class: 'boss-callout',
    role: 'status',
    'data-testid': 'boss-callout',
  });
  bossCallout.hidden = true;
  const bossPlate = el(
    'div',
    { class: 'boss-plate', 'data-testid': 'boss-plate' },
    el('div', { class: 'boss-plate-row' }, bossName, bossLevel, stomps),
    bossBar.track,
    el('div', { class: 'boss-plate-row boss-plate-chips' }, tries, until),
  );
  const friendRow = el('div', { class: 'boss-friends', 'data-testid': 'boss-friends' });
  const round = el('span', { class: 'boss-round', 'data-testid': 'boss-round' });
  round.hidden = true;
  const orderDots = el('span', { class: 'boss-order-dots' });
  const order = el(
    'div',
    { class: 'boss-order', 'data-testid': 'boss-order', role: 'img' },
    el('span', { class: 'boss-order-label', 'aria-hidden': 'true' }, BOSS_TEXT.order),
    orderDots,
  );
  order.hidden = true;
  // The boss plate with the order strip under it, centred (mockup frame 1).
  const head = el('div', { class: 'boss-head' }, bossPlate, order);
  const top = el('div', { class: 'boss-top' }, round, head, bossCallout, friendRow);
  const picker = el('div', { class: 'boss-picker', 'data-testid': 'boss-picker' });
  picker.hidden = true;

  const friendNodes = new Map<
    number,
    {
      node: HTMLElement;
      name: HTMLElement;
      b: ReturnType<typeof bar>;
      callout: HTMLElement;
      /** `placeFriends`' working value: its x in the row, then its plate's left. */
      x: number;
      /** The left and width last written, so an unchanged pass writes nothing. */
      left: string;
      width: string;
    }
  >();
  /** `placeFriends`' left-to-right order, reused pass after pass. */
  const plateOrder: { x: number; node: HTMLElement; left: string; width: string }[] = [];
  let lastLift = '';
  /** Writes a plate's left and width only when they change (rounded to whole px). */
  const setPlace = (
    plate: { node: HTMLElement; left: string; width: string },
    left: string,
    width: string,
  ) => {
    if (plate.left !== left) {
      plate.left = left;
      plate.node.style.left = left;
    }
    if (plate.width !== width) {
      plate.width = width;
      plate.node.style.width = width;
    }
  };
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

  return {
    top,
    picker,
    setPlates: (plates) => {
      bossName.textContent = plates.boss.name;
      bossLevel.textContent = `Lv ${String(plates.boss.level)}`;
      stomps.hidden = !plates.boss.stomps;
      setBar(bossBar, plates.boss.percent, plates.boss.energyText);
      const seen = new Set<number>();
      for (const friend of plates.friends) {
        seen.add(friend.slot);
        let node = friendNodes.get(friend.slot);
        if (!node) {
          const name = el('span', { class: 'boss-friend-name' });
          const b = bar(`boss-friend-energy-${String(friend.slot)}`);
          const callout = el('span', { class: 'boss-callout boss-callout-small', role: 'status' });
          callout.hidden = true;
          const wrap = el(
            'div',
            {
              // The same colour as its dot in the turn-order strip (`m.who % 3`).
              class: `boss-friend boss-friend-tint-${String(friend.slot % 3)}`,
              'data-testid': `boss-friend-${String(friend.slot)}`,
            },
            name,
            b.track,
            callout,
          );
          node = { node: wrap, name, b, callout, x: 0, left: '', width: '' };
          friendNodes.set(friend.slot, node);
          friendRow.append(wrap);
        }
        node.name.textContent = friend.name;
        node.node.classList.toggle('boss-friend-down', friend.down);
        setBar(node.b, friend.percent, friend.energyText);
      }
      for (const [slot, node] of friendNodes) {
        if (!seen.has(slot)) {
          node.node.remove();
          friendNodes.delete(slot);
        }
      }
    },
    placeFriends: (spots) => {
      // Runs each frame the camera moves (`once-per-frame.ts`): one layout read,
      // reused buffers, and a style is written only when it changes.
      const row = friendRow.getBoundingClientRect();
      if (row.width <= 0) return;
      let placed = friendNodes.size > 0;
      plateOrder.length = 0;
      for (const [slot, node] of friendNodes) {
        const spot = spots.get(slot);
        if (!spot) placed = false;
        node.x = (spot?.x ?? 0) - row.left;
        plateOrder.push(node);
      }
      friendRow.classList.toggle('boss-friends-placed', placed);
      if (!placed) {
        for (const plate of plateOrder) setPlace(plate, '', '');
      } else {
        const gap = 8;
        const n = Math.max(1, plateOrder.length);
        // Never wider than a third of the row less the gaps, so plates never overlap.
        const width = Math.min(114, (row.width - gap * (n - 1)) / n);
        const half = width / 2;
        // Left to right, each at least a plate and a gap from the last, inside the row.
        plateOrder.sort(byX);
        let min = half;
        for (const plate of plateOrder) {
          plate.x = Math.max(min, plate.x);
          min = plate.x + width + gap;
        }
        // Pushed past the right edge: slide the lot back in.
        let max = row.width - half;
        for (let i = plateOrder.length - 1; i >= 0; i--) {
          const plate = plateOrder[i];
          if (!plate) continue;
          plate.x = Math.min(plate.x, max);
          max = plate.x - width - gap;
        }
        const w = `${String(Math.floor(width))}px`;
        for (const plate of plateOrder) setPlace(plate, `${String(Math.round(plate.x))}px`, w);
      }
      // On iPad the row is pinned above the sheet's full share, well below the
      // friends' feet: lift the plates (never lower them) to just under the
      // lowest friend's feet, all in one line. The row's own box stays put, so
      // the camera's frame (which reads it) doesn't chase the plates.
      let lift = 0;
      if (placed && window.innerWidth >= WIDE_MIN) {
        let feet = 0;
        for (const spot of spots.values()) feet = Math.max(feet, spot.feet);
        lift = Math.min(0, Math.round(feet + PLATE_GAP - row.top));
      }
      const liftPx = `${String(lift)}px`;
      if (liftPx !== lastLift) {
        lastLift = liftPx;
        friendRow.style.setProperty('--boss-plate-lift', liftPx);
      }
    },
    setRound: (n) => {
      round.hidden = n === null;
      round.textContent = n === null ? '' : BOSS_TEXT.round(n);
    },
    setOrder: (o) => {
      order.hidden = o === null || o.movers.length === 0;
      if (!o) return;
      orderDots.replaceChildren(
        ...o.movers.map((m, i) =>
          el(
            'span',
            {
              class: `boss-order-dot ${
                m.who === 'boss' ? 'boss-order-boss' : `boss-order-friend-${String(m.who % 3)}`
              }${i === o.current ? ' boss-order-now' : ''}`,
            },
            m.who === 'boss' ? '👣' : (m.name[0] ?? ''),
          ),
        ),
      );
      order.setAttribute(
        'aria-label',
        BOSS_TEXT.orderLabel(o.movers.map((m) => m.name).join(', ')),
      );
    },
    setChips: (chips) => {
      tries.hidden = chips.tries === null;
      tries.textContent = chips.tries === null ? '' : BOSS_TEXT.triesLeft(chips.tries);
      until.hidden = chips.until === null;
      until.textContent = chips.until ?? '';
    },
    callout: (who, text) => {
      const node = who === 'boss' ? bossCallout : friendNodes.get(who)?.callout;
      if (node) flash(node, text);
    },
    showPicker: (state, moves, handlers) => {
      picker.hidden = false;
      const chips = el('div', {
        class: 'boss-steps',
        'data-testid': 'boss-steps',
        role: 'group',
        'aria-label': BOSS_TEXT.goBackHint,
      });
      const ready = state.at >= state.steps.length;
      state.steps.forEach((step, i) => {
        const pick = state.picks[step.slot];
        const current = i === state.at;
        const moveName = pick ? (moves(step.slot).find((m) => m.id === pick)?.name ?? '') : '';
        const status = current
          ? BOSS_TEXT.picking
          : pick
            ? ready
              ? moveName
              : `${moveName} ✓`
            : BOSS_TEXT.next;
        const chip = el(
          'button',
          {
            type: 'button',
            class: `boss-step${current ? ' boss-step-current' : ''}`,
            'data-testid': `boss-step-${String(step.slot)}`,
            'aria-current': current ? 'step' : 'false',
          },
          el('span', { class: 'boss-step-name' }, step.name),
          el('span', { class: 'boss-step-status' }, status),
        );
        // A finished chip goes back to that squishy's step.
        if (pick !== undefined && !current) {
          chip.addEventListener('click', () => {
            handlers.onChip(step.slot);
          });
        } else chip.disabled = !current;
        chips.append(chip);
      });
      const body: HTMLElement[] = [chips];
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
          header.append('What should ', el('b', {}, step.name), ' do?');
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
      picker.hidden = true;
      picker.replaceChildren();
    },
    dispose: () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      top.remove();
      picker.remove();
    },
  };
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
