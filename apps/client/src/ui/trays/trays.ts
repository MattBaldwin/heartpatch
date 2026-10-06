import { el } from '../dom.js';
import {
  handleBadge,
  INITIAL_TRAYS,
  newPeeks,
  SETTLING,
  trayReducer,
  type TrayAction,
  type TrayAlert,
  type TraySide,
  type TrayState,
} from './tray-state.js';
import './trays.css';

// The map's controls live in two trays that slide out from the screen's
// edges (owner decision 2026-10-04), so the world stays full-screen:
// "Adventure" on the left (team, finding and befriending squishies, land,
// raids, the Hollow) and "My Home" on the right (home, building, the
// recipe book, the bag, squishies' jobs). Each handle is a big labelled tab at
// thumb height; news shows as a glowing badge on it instead of a banner.
//
// Features keep their own entry buttons and mount them into a tray's slot;
// a button inside a tray shuts the tray when tapped (it opened something).
// Any visible element in a tray marked `data-tray-alert` counts towards its
// handle's badge (its text is the count, else 1; the attribute's value is a
// short line that peeks out beside the handle).

export type TraySlot =
  'team' | 'battle' | 'adventure' | 'heartpatch' | 'squishies' | 'top-left' | 'top-right';

export interface TraysOptions {
  root: HTMLElement;
  /** Where the first-time hint remembers it was answered (null: never remembered). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TraysDebug {
  readonly visible: boolean;
  readonly open: TraySide | null;
  readonly hint: boolean;
  readonly badges: Readonly<Record<TraySide, string | null>>;
}

export interface Trays {
  /** Where a feature mounts its entry button. */
  slot: (name: TraySlot) => HTMLElement;
  /** The map is on screen (true) or not: shows or hides the handles. */
  setVisible: (visible: boolean) => void;
  open: (side: TraySide) => void;
  close: () => void;
  /** Sprout's first-time hint about the handles, once per account. */
  offerHint: (accountId: string) => void;
  /** A short friendly line over the map (e.g. "Tap land next to yours…"). */
  say: (text: string) => void;
  readonly debug: TraysDebug;
}

// Player-facing text (style guide §2, §6).
export const TRAY_TEXT = {
  adventure: 'Adventure',
  heartpatch: 'My Home',
  heartpatchShort: 'Home',
  open: (name: string) => `Open ${name}`,
  close: (name: string) => `Close ${name}`,
  news: (n: string) => `, ${n} new`,
  closeTray: 'Close',
  sprout: 'Sprout',
  /** Sprout's first-time hint, one half pointing at each handle. */
  hintLeft: 'Adventures are on the left.',
  hintRight: 'Your home is on the right!',
  gotIt: 'Got it!',
} as const;

/** Stroke icons for the handles (vector, never pixelated; design doc §19). */
const ICONS: Record<TraySide | 'close', string> = {
  adventure: 'M12 3a9 9 0 1 0 0.01 0Z M15.5 8.5l-2 5-5 2 2-5Z',
  heartpatch:
    'M4 11l8-7 8 7v9H4Z M12 17.5s-3.2-1.9-3.2-3.9a1.7 1.7 0 0 1 3.2-.8 1.7 1.7 0 0 1 3.2.8c0 2-3.2 3.9-3.2 3.9Z',
  close: 'M6 6l12 12 M18 6L6 18',
};

const SVG = 'http://www.w3.org/2000/svg';

/** A 24px stroke icon. */
export function strokeIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tray-icon');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

const HINT_KEY = (accountId: string) => `heartpatch.trays.hint.${accountId}`;

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** How long a badge's line peeks out beside its handle. */
const PEEK_MS = 4000; // TUNE:
const SAY_MS = 3200; // TUNE:
/**
 * If no `transitionend` comes (a transition switched off), the tray settles
 * anyway. Keep it above the slide in trays.css (`.tray` transform, 280 ms).
 */
const SETTLE_FALLBACK_MS = 450;

/** Writes an attribute only when it changes, so observers aren't woken for nothing. */
function setAttr(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function createTrays(options: TraysOptions): Trays {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  let state: TrayState = INITIAL_TRAYS;
  let alerts: TrayAlert[] = [];
  let hintKey: string | null = null;
  let peekTimer: number | undefined;
  let sayTimer: number | undefined;
  /** Just came back on screen: what's already in the trays isn't news. */
  let quietNext = false;

  const slots = new Map<TraySlot, HTMLElement>();
  const slotBox = (name: TraySlot, cls = 'tray-section') => {
    const box = el('div', { class: cls, 'data-tray-slot': name });
    slots.set(name, box);
    return box;
  };

  // ── One tray and its handle ───────────────────────────────────────────
  const side = (which: TraySide, title: string, short: string, body: HTMLElement[]) => {
    const id = `tray-${which}`;
    const close = el(
      'button',
      { type: 'button', class: 'tray-close', 'aria-label': TRAY_TEXT.close(title) },
      strokeIcon(ICONS.close),
    );
    close.addEventListener('click', () => {
      dispatch({ type: 'close' });
    });
    const trayBody = el('div', { class: 'tray-body' }, ...body);
    const tray = el(
      'section',
      // A dialog, like every sheet over the map, so Sprout waits its turn
      // behind an open tray that isn't on the step's way (tutorial/sheets.ts).
      {
        class: `tray tray-${which}`,
        id,
        role: 'dialog',
        'aria-label': title,
        'data-testid': id,
      },
      el('header', { class: 'tray-head' }, el('h2', { class: 'tray-title' }, title), close),
      trayBody,
    );
    // Shut until opened: out of the tab order and hidden from VoiceOver.
    tray.setAttribute('inert', '');
    tray.setAttribute('aria-hidden', 'true');
    const icon = el('span', { class: 'tray-handle-icon' }, strokeIcon(ICONS[which]));
    const badge = el('span', { class: 'tray-badge', 'aria-hidden': 'true' });
    badge.hidden = true;
    const handle = el(
      'button',
      {
        type: 'button',
        class: `tray-handle tray-handle-${which}`,
        'aria-controls': id,
        'aria-expanded': 'false',
        'data-testid': `tray-handle-${which}`,
      },
      icon,
      el('span', { class: 'tray-handle-label' }, short),
      badge,
    );
    handle.addEventListener('click', () => {
      dispatch({ type: 'toggle', side: which });
    });
    const peek = el('p', { class: `tray-peek tray-peek-${which}`, 'aria-hidden': 'true' });
    peek.hidden = true;
    // A tap on a button in the tray opened something: the tray steps aside.
    tray.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target.closest('button') : null;
      if (target && target !== close && !target.closest('[data-tray-keep]')) {
        dispatch({ type: 'close' });
      }
    });
    // While it slides in, the tray is "settling": the tutorial's spotlight
    // waits for the button inside to come to rest (highlight-targets.ts).
    let settleTimer: number | undefined;
    const settled = () => {
      window.clearTimeout(settleTimer);
      tray.classList.remove(SETTLING);
    };
    tray.addEventListener('transitionend', (e) => {
      if (e.target === tray) settled();
    });
    const settle = (open: boolean) => {
      if (!open) {
        settled();
        return;
      }
      tray.classList.add(SETTLING);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settled, SETTLE_FALLBACK_MS);
    };
    return { which, title, tray, body: trayBody, handle, icon, badge, peek, settle, shown: false };
  };

  const adventure = side('adventure', TRAY_TEXT.adventure, TRAY_TEXT.adventure, [
    slotBox('team'),
    slotBox('battle'),
    slotBox('adventure'),
  ]);
  const heartpatch = side('heartpatch', TRAY_TEXT.heartpatch, TRAY_TEXT.heartpatchShort, [
    slotBox('heartpatch'),
    slotBox('squishies'),
  ]);
  const sides = [adventure, heartpatch] as const;

  const scrim = el('button', {
    type: 'button',
    class: 'tray-scrim',
    'aria-label': TRAY_TEXT.closeTray,
    tabindex: '-1',
  });
  scrim.addEventListener('click', () => {
    dispatch({ type: 'close' });
  });

  const topLeft = slotBox('top-left', 'tray-top-left');
  const topRight = slotBox('top-right', 'tray-top-right');

  const toast = el('p', { class: 'tray-say', role: 'status', 'data-testid': 'tray-say' });
  toast.hidden = true;

  // The first-time hint: Sprout points at both handles (style guide §3:
  // teach one thing at a time; trays must be obvious).
  const hintOk = el(
    'button',
    { type: 'button', class: 'tray-hint-ok', 'data-testid': 'tray-hint-ok' },
    TRAY_TEXT.gotIt,
  );
  hintOk.addEventListener('click', () => {
    dispatch({ type: 'dismiss-hint' });
  });
  // Small and clear of both handles (owner, 2026-10-05: Sprout never covers
  // what it's pointing at); each half of the line points at its own handle.
  const hint = el(
    'div',
    {
      class: 'tray-hint',
      role: 'dialog',
      'aria-label': TRAY_TEXT.sprout,
      'data-testid': 'tray-hint',
    },
    // Room for Sprout's portrait later; a glowing orb for now.
    el('span', { class: 'tray-hint-sprout', 'aria-hidden': 'true' }),
    el(
      'p',
      { class: 'tray-hint-line' },
      el(
        'span',
        { class: 'tray-hint-left' },
        el('span', { class: 'tray-hint-arrow', 'aria-hidden': 'true' }, '‹'),
        ` ${TRAY_TEXT.hintLeft}`,
      ),
      el(
        'span',
        { class: 'tray-hint-right' },
        `${TRAY_TEXT.hintRight} `,
        el('span', { class: 'tray-hint-arrow', 'aria-hidden': 'true' }, '›'),
      ),
    ),
    hintOk,
  );
  hint.hidden = true;

  const layer = el(
    'div',
    { class: 'trays', 'data-testid': 'trays' },
    scrim,
    topLeft,
    topRight,
    ...sides.flatMap((s) => [s.tray, s.handle, s.peek]),
    toast,
    hint,
  );
  layer.hidden = true;
  options.root.append(layer);

  // ── Badges from the trays' content ────────────────────────────────────
  const readAlerts = (): TrayAlert[] =>
    sides.flatMap((s) =>
      [...s.tray.querySelectorAll<HTMLElement>('[data-tray-alert]')]
        .filter((node) => !node.closest('[hidden]') && node.textContent.trim() !== '')
        .map((node) => {
          const n = Number.parseInt(node.textContent, 10);
          const peekText = node.dataset['trayAlert'] ?? '';
          return {
            side: s.which,
            count: Number.isFinite(n) && n > 0 ? n : 1,
            peek: peekText === '' ? null : peekText,
          };
        }),
    );

  let alertFrame = 0;
  const refreshAlerts = () => {
    alertFrame = 0;
    const next = readAlerts();
    const fresh = newPeeks(alerts, next);
    alerts = next;
    for (const s of sides) {
      const { text } = handleBadge(alerts, s.which);
      if (s.badge.textContent !== (text ?? '')) s.badge.textContent = text ?? '';
      setHidden(s.badge, text === null || state.open === s.which);
      const news = text !== null && state.open !== s.which;
      if (s.handle.classList.contains('tray-handle-news') !== news) {
        s.handle.classList.toggle('tray-handle-news', news);
      }
      setAttr(
        s.handle,
        'aria-label',
        (state.open === s.which ? TRAY_TEXT.close(s.title) : TRAY_TEXT.open(s.title)) +
          (text === null ? '' : TRAY_TEXT.news(text)),
      );
    }
    // Back from Home or a battle, the same alerts are still there: no peek.
    const quiet = quietNext;
    quietNext = false;
    if (fresh.length > 0 && state.visible && !quiet) showPeeks(fresh);
  };
  const scheduleAlerts = () => {
    alertFrame ||= requestAnimationFrame(refreshAlerts);
  };
  // Only the trays' content: the handles and badges this draws aren't watched.
  const watcher = new MutationObserver(scheduleAlerts);
  for (const s of sides) {
    watcher.observe(s.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-tray-alert'],
    });
  }

  const showPeeks = (fresh: readonly TrayAlert[]) => {
    for (const s of sides) {
      const line = fresh.find((a) => a.side === s.which)?.peek ?? null;
      if (line === null || state.open !== null) continue;
      s.peek.textContent = line;
      s.peek.hidden = false;
    }
    window.clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => {
      for (const s of sides) s.peek.hidden = true;
    }, PEEK_MS);
  };

  // ── Drawing ───────────────────────────────────────────────────────────
  function render(): void {
    setHidden(layer, !state.visible);
    document.body.classList.toggle('hp-trays-on', state.visible);
    layer.classList.toggle('trays-open', state.open !== null);
    setHidden(scrim, state.open === null);
    for (const s of sides) {
      const open = state.open === s.which;
      if (open !== s.shown) {
        s.shown = open;
        s.settle(open);
        s.tray.classList.toggle('tray-shown', open);
        s.tray.toggleAttribute('inert', !open);
        s.tray.setAttribute('aria-hidden', open ? 'false' : 'true');
        s.handle.classList.toggle('tray-handle-open', open);
        s.handle.setAttribute('aria-expanded', open ? 'true' : 'false');
        s.icon.replaceChildren(strokeIcon(open ? ICONS.close : ICONS[s.which]));
      }
      if (state.open !== null) setHidden(s.peek, true);
    }
    setHidden(hint, !state.hint);
    layer.classList.toggle('trays-hinting', state.hint);
    refreshAlerts();
  }

  function dispatch(action: TrayAction): void {
    const before = state;
    state = trayReducer(state, action);
    if (!before.visible && state.visible) quietNext = true;
    if (before.hint && !state.hint && hintKey) {
      try {
        storage?.setItem(hintKey, '1');
      } catch {
        // Private mode: the hint may come back next time, which is fine.
      }
    }
    if (state !== before) render();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open !== null) dispatch({ type: 'close' });
  });

  return {
    slot: (name) => {
      const box = slots.get(name);
      if (!box) throw new Error(`no tray slot ${name}`);
      return box;
    },
    setVisible: (visible) => {
      dispatch({ type: visible ? 'show' : 'hide' });
    },
    open: (which) => {
      dispatch({ type: 'open', side: which });
    },
    close: () => {
      dispatch({ type: 'close' });
    },
    offerHint: (accountId) => {
      hintKey = HINT_KEY(accountId);
      let seen: boolean;
      try {
        seen = storage !== null && storage.getItem(hintKey) !== null;
      } catch {
        seen = false;
      }
      if (!seen) dispatch({ type: 'hint' });
    },
    say: (text) => {
      toast.textContent = text;
      toast.hidden = false;
      window.clearTimeout(sayTimer);
      sayTimer = window.setTimeout(() => {
        toast.hidden = true;
      }, SAY_MS);
    },
    get debug() {
      return {
        visible: state.visible,
        open: state.open,
        hint: state.hint,
        badges: {
          adventure: handleBadge(alerts, 'adventure').text,
          heartpatch: handleBadge(alerts, 'heartpatch').text,
        },
      };
    },
  };
}

export interface TrayRowOptions {
  icon: string;
  label: string;
  /** A short second line. */
  sub?: string;
  testId: string;
  onTap: () => void;
}

/** A plain tray row (an entry that has no feature button of its own). */
export function trayRow(options: TrayRowOptions): HTMLButtonElement {
  const row = el(
    'button',
    { type: 'button', class: 'tray-row', 'data-testid': options.testId },
    el('span', { class: 'tray-row-icon', 'aria-hidden': 'true' }, options.icon),
    el(
      'span',
      { class: 'tray-row-text' },
      el('span', { class: 'tray-row-label' }, options.label),
      ...(options.sub ? [el('span', { class: 'tray-row-sub' }, options.sub)] : []),
    ),
  );
  row.addEventListener('click', options.onTap);
  return row;
}
