import type { Invite, MilestonesResponse, PublicUser } from '@heartpatch/shared';
import { hpButton, hpClose } from '../ui/button/button.js';
import { el, messageOf } from '../ui/dom.js';
import { inviteShareLine, NO_INVITE_LINE } from '../ui/lobby/family-codes.js';
import { milestonesApi } from './milestones-api.js';
import {
  chipView,
  NEXT_UP_TEXT,
  nextUpState,
  rowView,
  sproutKey,
  type NextUpGo,
  type NextUpGoal,
  type NextUpState,
} from './next-up-view.js';
import './next-up.css';

// The Next-up chip (#731, owner-approved mockups v4): bottom centre on the
// map, the nearest milestone by progress. A tap opens the goals sheet (the
// three nearest, each with a button to where it's done); the Adventure tray's
// Goals row opens the same sheet. On a patch that's only you, both say why
// milestones wait and put the invite code one tap away.
//
// Read on patch switch, when a milestone party arrives and when a friend
// joins or leaves the patch, never on a loop (CLAUDE.md rule 4). Hidden while
// the tile panel, the lobby's Back pill, an open tray or the Hollow's cards
// are up (next-up.css); it sits above the night's chips; never on the Glade.

/** What the solo card needs to show the patch's code. */
export interface NextUpInvite {
  /** The patch's live code, null when there's none, or 'not-owner' (only the owner sees it). */
  load: (mapId: string) => Promise<Invite | null | 'not-owner'>;
  /** Makes a fresh code (the lobby's "Make a code"). */
  make: (mapId: string) => Promise<Invite>;
}

export interface NextUpOptions {
  root: HTMLElement;
  /** The Adventure tray section the Goals row goes in. */
  rowRoot: HTMLElement;
  api?: Pick<typeof milestonesApi, 'getFor'>;
  invite: NextUpInvite;
  /** The game clock, for "Works for 6 more days." */
  now: () => number;
  /** Whether a season is on now on the patch on screen, or null if not known. */
  inSeason: () => ((season: string) => boolean) | null;
  /** A goal's button was tapped; the sheet has closed. */
  onGo: (go: NextUpGo) => void;
  /** True while Sprout's line would be in the way (another card, the trays' hint). */
  busy: () => boolean;
  canCopy: boolean;
  copy: (text: string) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  setTimer?: (task: () => void, ms: number) => unknown;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface NextUpDebug {
  readonly mapId: string | null;
  readonly state: NextUpState['kind'];
  readonly goals: readonly string[];
  readonly chipShown: boolean;
  readonly sheetOpen: boolean;
  readonly sprout: boolean;
}

export interface NextUp {
  setUser: (user: PublicUser | null) => void;
  /** The patch on screen (null: off the map, or the Glade). Reads its goals again. */
  setMap: (mapId: string | null) => void;
  /** Reads again (a milestone party arrived). */
  refresh: () => void;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: NextUpDebug;
}

/** How long Sprout's line stays up. */
const SPROUT_MS = 5_000; // TUNE:
/** How soon a Sprout line that found the screen busy tries again. */
const SPROUT_RETRY_MS = 2_500; // TUNE:
/** How many busy looks before Sprout waits for the next read (about a minute). */
const SPROUT_TRIES = 24; // TUNE:
/** How long "Copied!" shows before the button reads "Copy code" again. */
const COPIED_MS = 2_000; // TUNE:

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createNextUp(options: NextUpOptions): NextUp {
  const api = options.api ?? milestonesApi;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const setTimer = options.setTimer ?? ((task, ms) => window.setTimeout(task, ms));
  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let response: MilestonesResponse | null = null;
  let state: NextUpState = { kind: 'none' };
  /** Each read's number, so a slow read for the last patch is dropped. */
  let readNo = 0;
  let sproutPending = false;
  let sproutTimerSet = false;
  /** Busy looks left before Sprout waits for the next read instead. */
  let sproutTries = 0;
  /** What opened the sheet, so closing it hands focus back. */
  let opener: HTMLElement | null = null;

  // ── The chip ────────────────────────────────────────────────────────────
  const ringIcon = el('span', { class: 'next-up-ring-icon', 'aria-hidden': 'true' });
  const ring = el('span', { class: 'next-up-ring', 'aria-hidden': 'true' }, ringIcon);
  const kicker = el('span', { class: 'next-up-kicker', 'data-testid': 'next-up-kicker' });
  const line = el('span', { class: 'next-up-line', 'data-testid': 'next-up-line' });
  const chip = el(
    'button',
    {
      type: 'button',
      class: 'next-up-chip',
      'data-testid': 'next-up-chip',
      'aria-haspopup': 'dialog',
      'aria-controls': 'next-up-sheet',
    },
    ring,
    el('span', { class: 'next-up-text' }, kicker, line),
    el('span', { class: 'next-up-go', 'aria-hidden': 'true' }, '›'),
  );
  chip.hidden = true;
  chip.addEventListener('click', () => {
    open();
  });

  const sprout = el(
    'p',
    { class: 'next-up-sprout', role: 'status', 'data-testid': 'next-up-sprout' },
    el('span', { class: 'next-up-sprout-face', 'aria-hidden': 'true' }),
    NEXT_UP_TEXT.sprout,
  );
  sprout.hidden = true;

  // ── The tray row (same look as the sheet's rows) ────────────────────────
  // Built here, not with trays.ts's `trayRow()`: its sub line and count change
  // with every read, and `trayRow()` makes a fixed row.
  const rowSub = el('span', { class: 'tray-row-sub', 'data-testid': 'next-up-row-sub' });
  const rowCount = el('span', { class: 'next-up-row-count', 'aria-hidden': 'true' });
  const row = el(
    'button',
    {
      type: 'button',
      class: 'tray-row next-up-row',
      'data-testid': 'next-up-row',
      'aria-haspopup': 'dialog',
    },
    el('span', { class: 'tray-row-icon', 'aria-hidden': 'true' }, '🎯'),
    el(
      'span',
      { class: 'tray-row-text' },
      el('span', { class: 'tray-row-label' }, NEXT_UP_TEXT.rowLabel),
      rowSub,
    ),
    rowCount,
  );
  row.hidden = true;
  row.addEventListener('click', () => {
    // The tray shuts itself for a tapped row; the sheet takes its place.
    open();
  });
  options.rowRoot.prepend(row);

  // ── The sheet ───────────────────────────────────────────────────────────
  const sheetTitle = el('h2', { class: 'next-up-title', id: 'next-up-title' });
  const close = hpClose(NEXT_UP_TEXT.close, 'next-up-close');
  close.addEventListener('click', () => {
    shut();
  });
  const body = el('div', { class: 'next-up-body', 'data-testid': 'next-up-body' });
  const card = el(
    'section',
    {
      class: 'next-up-sheet',
      id: 'next-up-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'next-up-title',
      'data-testid': 'next-up-sheet',
    },
    el('header', { class: 'next-up-head' }, sheetTitle, close),
    body,
  );
  const scrim = el('div', { class: 'next-up-scrim', 'data-testid': 'next-up-scrim' }, card);
  scrim.hidden = true;
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) shut();
  });
  scrim.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shut();
  });
  options.root.append(chip, sprout, scrim);

  const goalCard = (goal: NextUpGoal, waiting: boolean): HTMLElement => {
    const bar = el('span', { class: 'next-up-bar-fill' });
    bar.style.width = `${String(goal.percent)}%`;
    const top = el(
      'div',
      { class: 'next-up-goal-top' },
      el('span', { class: 'next-up-goal-icon', 'aria-hidden': 'true' }, '🎯'),
      el(
        'span',
        { class: 'next-up-goal-words' },
        el('span', { class: 'next-up-goal-short' }, goal.short),
        el('span', { class: 'next-up-goal-track' }, `${goal.trackName} · ${goal.goal}`),
      ),
      el('span', { class: 'next-up-goal-count' }, `${String(goal.have)} of ${String(goal.need)}`),
    );
    const out = el(
      'div',
      {
        class: `next-up-goal${waiting ? ' next-up-goal-waiting' : ''}`,
        'data-track': goal.trackId,
        'data-testid': 'next-up-goal',
      },
      top,
      el('span', { class: 'next-up-bar', 'aria-hidden': 'true' }, bar),
      el(
        'span',
        { class: 'next-up-prizes' },
        ...goal.prizes.map((p) => el('span', { class: 'next-up-prize' }, p)),
      ),
    );
    if (!waiting) {
      const go = hpButton(goal.goLabel, {
        variant: 'primary',
        small: true,
        testId: `next-up-go-${goal.trackId}`,
      });
      go.classList.add('next-up-go-button');
      go.addEventListener('click', () => {
        shut();
        options.onGo(goal.go);
      });
      out.append(go);
    }
    return out;
  };

  /** The solo card: why milestones wait, and the patch's code with Copy. */
  const soloCard = (forMap: string): HTMLElement => {
    const codeBox = el(
      'div',
      { class: 'next-up-code-box', 'data-testid': 'next-up-code-box' },
      el('p', { class: 'next-up-sub' }, NEXT_UP_TEXT.soloLoading),
    );
    const showInvite = (invite: Invite | null | 'not-owner') => {
      if (mapId !== forMap) return;
      if (invite === 'not-owner') {
        codeBox.replaceChildren(el('p', { class: 'next-up-sub' }, NEXT_UP_TEXT.soloNotOwner));
        return;
      }
      if (invite === null) {
        const make = hpButton(NEXT_UP_TEXT.makeCode, {
          variant: 'primary',
          small: true,
          testId: 'next-up-make-code',
        });
        const note = el('p', { class: 'next-up-sub', role: 'status' });
        make.addEventListener('click', () => {
          make.disabled = true;
          options.invite.make(forMap).then(showInvite, (err: unknown) => {
            make.disabled = false;
            note.textContent = messageOf(err);
          });
        });
        // The lobby's words when there's no code (one invite flow).
        codeBox.replaceChildren(el('p', { class: 'next-up-sub' }, NO_INVITE_LINE), make, note);
        return;
      }
      const parts: HTMLElement[] = [
        el('p', { class: 'next-up-code', 'data-testid': 'next-up-code' }, invite.code),
      ];
      if (options.canCopy) {
        const copy = hpButton(NEXT_UP_TEXT.copy, {
          variant: 'primary',
          small: true,
          testId: 'next-up-copy',
        });
        copy.addEventListener('click', () => {
          options.copy(invite.code).then(
            () => {
              copy.textContent = NEXT_UP_TEXT.copied;
              setTimer(() => {
                copy.textContent = NEXT_UP_TEXT.copy;
              }, COPIED_MS);
            },
            () => {
              copy.textContent = NEXT_UP_TEXT.copyFailed;
            },
          );
        });
        parts.push(copy);
      }
      parts.push(
        el(
          'p',
          { class: 'next-up-sub', 'data-testid': 'next-up-code-line' },
          inviteShareLine(invite.expiresAt, options.now()),
        ),
      );
      codeBox.replaceChildren(...parts);
    };
    options.invite.load(forMap).then(showInvite, (err: unknown) => {
      if (mapId === forMap)
        codeBox.replaceChildren(el('p', { class: 'next-up-sub' }, messageOf(err)));
    });
    return el(
      'div',
      { class: 'next-up-solo', 'data-testid': 'next-up-solo' },
      el('h3', { class: 'next-up-solo-heading' }, NEXT_UP_TEXT.soloHeading),
      el('p', { class: 'next-up-solo-line' }, NEXT_UP_TEXT.soloLine),
      codeBox,
    );
  };

  const fillSheet = () => {
    switch (state.kind) {
      case 'none':
        body.replaceChildren();
        return;
      case 'goals':
        sheetTitle.textContent = NEXT_UP_TEXT.sheetTitle;
        body.replaceChildren(...state.goals.map((g) => goalCard(g, false)));
        return;
      case 'solo': {
        sheetTitle.textContent = NEXT_UP_TEXT.sheetTitle;
        const waiting = state.goals.slice(0, 2).map((g) => goalCard(g, true));
        body.replaceChildren(
          ...(mapId ? [soloCard(mapId)] : []),
          ...(waiting.length > 0
            ? [el('p', { class: 'next-up-sub' }, NEXT_UP_TEXT.soloWaiting), ...waiting]
            : []),
        );
        return;
      }
      case 'done': {
        sheetTitle.textContent = NEXT_UP_TEXT.allDoneTitle;
        const parts: HTMLElement[] = [el('p', { class: 'next-up-sub' }, NEXT_UP_TEXT.allDoneLine)];
        if (state.titles.length > 0) {
          parts.push(
            el(
              'div',
              { class: 'next-up-medals' },
              ...state.titles.map((t) =>
                el('span', { class: 'next-up-medal' }, el('i', { 'aria-hidden': 'true' }, '★'), t),
              ),
            ),
          );
        }
        if (state.secrets > 0) {
          parts.push(
            el(
              'div',
              { class: 'next-up-goal next-up-goal-waiting' },
              el(
                'div',
                { class: 'next-up-goal-top' },
                el('span', { class: 'next-up-goal-icon', 'aria-hidden': 'true' }, '❓'),
                el(
                  'span',
                  { class: 'next-up-goal-words' },
                  el('span', { class: 'next-up-goal-short' }, NEXT_UP_TEXT.secretName),
                  el('span', { class: 'next-up-goal-track' }, NEXT_UP_TEXT.secretGoal),
                ),
              ),
            ),
          );
        }
        body.replaceChildren(...parts);
        return;
      }
    }
  };

  // ── Drawing ─────────────────────────────────────────────────────────────
  const render = () => {
    const view = mapId === null ? null : chipView(state);
    const sheetOpen = !scrim.hidden;
    chip.hidden = view === null || sheetOpen;
    row.hidden = view === null;
    if (view) {
      chip.dataset['look'] = view.look;
      ring.style.setProperty('--next-up-p', String(view.percent));
      ringIcon.textContent = view.icon;
      kicker.textContent = view.kicker;
      line.textContent = view.line;
      chip.setAttribute('aria-label', `${view.kicker}: ${view.line}. ${NEXT_UP_TEXT.open}`);
      const rv = rowView(state);
      rowSub.textContent = rv?.sub ?? '';
      rowCount.textContent = rv?.count ?? '';
      rowCount.hidden = rv?.count == null;
    }
    if (view === null && sheetOpen) shut();
    // Only once there's a real goal to point at (not the solo card).
    if (view !== null && state.kind !== 'solo' && user) offerSprout(user.id);
    else hideSprout();
  };

  // ── Sprout's one-time line (owner decision 4) ───────────────────────────
  const said = (accountId: string): boolean => {
    try {
      return storage?.getItem(sproutKey(accountId)) === '1';
    } catch {
      return true;
    }
  };
  const hideSprout = () => {
    sproutPending = false;
    sprout.hidden = true;
  };
  const offerSprout = (accountId: string) => {
    if (!sprout.hidden || said(accountId)) return;
    if (options.busy() || !chipOnScreen()) {
      sproutPending = true;
      if (!sproutTimerSet && sproutTries < SPROUT_TRIES) {
        sproutTries += 1;
        sproutTimerSet = true;
        setTimer(() => {
          sproutTimerSet = false;
          if (sproutPending && user && mapId !== null && chipView(state)) offerSprout(user.id);
        }, SPROUT_RETRY_MS);
      }
      return;
    }
    sproutPending = false;
    try {
      storage?.setItem(sproutKey(accountId), '1');
    } catch {
      // Private mode: it may say it again next time.
    }
    sprout.hidden = false;
    setTimer(() => {
      sprout.hidden = true;
    }, SPROUT_MS);
  };
  /** The chip is really showing (not hidden by a panel over it, next-up.css). */
  const chipOnScreen = (): boolean =>
    !chip.hidden && chip.isConnected && getComputedStyle(chip).display !== 'none';

  // ── Reading ─────────────────────────────────────────────────────────────
  const read = () => {
    const forMap = mapId;
    const no = ++readNo;
    sproutTries = 0;
    if (forMap === null || user === null) {
      response = null;
      state = { kind: 'none' };
      render();
      return;
    }
    api.getFor(forMap).then(
      (next) => {
        if (no !== readNo) return;
        response = next;
        state = nextUpState(response, options.inSeason());
        if (!scrim.hidden) fillSheet();
        render();
      },
      () => {
        // Nothing wrong is shown: the chip waits for the next read.
        if (no !== readNo) return;
        response = null;
        state = { kind: 'none' };
        render();
      },
    );
  };

  const open = () => {
    if (state.kind === 'none') return;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : chip;
    fillSheet();
    scrim.hidden = false;
    hideSprout();
    render();
    close.focus();
  };
  const shut = () => {
    if (scrim.hidden) return;
    scrim.hidden = true;
    render();
    // Back to the chip or row that opened it, if it's still there to hold focus.
    const back = opener;
    opener = null;
    if (back && !back.hidden && back.isConnected) back.focus();
  };

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      read();
    },
    setMap: (next) => {
      if (next !== mapId) {
        // Another patch: what showed was for the last one.
        state = { kind: 'none' };
        shut();
      }
      mapId = next;
      render();
      read();
    },
    refresh: () => {
      if (mapId !== null) read();
    },
    close: shut,
    get isOpen() {
      return !scrim.hidden;
    },
    get debug() {
      return {
        mapId,
        state: state.kind,
        goals:
          state.kind === 'goals' || state.kind === 'solo' ? state.goals.map((g) => g.trackId) : [],
        chipShown: chipOnScreen(),
        sheetOpen: !scrim.hidden,
        sprout: !sprout.hidden,
      };
    },
  };
}
