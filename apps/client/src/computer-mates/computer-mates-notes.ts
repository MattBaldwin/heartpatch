import { GAME_EVENTS, type WsEventMessage } from '@heartpatch/shared';
import { hpButton } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { computerAvatar, computerBadge } from './computer-badge.js';
import { COMPUTER_TEXT, goodbyeLine, helloTitle } from './computer-mates-model.js';

/*
 * Hello and goodbye (#386b, mockup 3a and 3c): when computer patch-mates
 * move in (`member.joined` with `computer`), one card names them all and
 * says they're run by the game; when one moves out to make room for a real
 * friend (`member.left` / `member.removed` with `madeRoomFor`), a short
 * toast says so with the mate badged in words. Turning the switch off
 * sends mates away without `madeRoomFor`, so no goodbye shows for that.
 * Events land one by one, so each waits a moment to gather its batch.
 */

/** Gathers one batch of arrivals into one card. */
const GATHER_MS = 1200; // TUNE: the server writes a fill's events together

/** How long the goodbye toast stays. */
const TOAST_MS = 5000; // TUNE

export interface ComputerMatesNotesOptions {
  root: HTMLElement;
  /** A member's name on the patch on screen, if the client knows it. */
  nameOf: (userId: string) => string | null;
  gatherMs?: number;
}

export interface ComputerMatesNotesDebug {
  readonly hello: string | null;
  readonly toast: string | null;
}

export interface ComputerMatesNotes {
  liveEvent: (event: WsEventMessage) => void;
  /** Forgets anything pending (a different patch opened). */
  reset: () => void;
  readonly debug: ComputerMatesNotesDebug;
}

export function createComputerMatesNotes(options: ComputerMatesNotesOptions): ComputerMatesNotes {
  const gatherMs = options.gatherMs ?? GATHER_MS;
  /** Names seen in this session's events, so a departed mate still has one. */
  const names = new Map<string, string>();
  let arrivals: string[] = [];
  let goodbyes: { mate: string; friendId: string | undefined }[] = [];
  let timer = 0;
  let toastTimer = 0;

  const scrim = el('div', { class: 'cf-hello-scrim', 'data-testid': 'computer-hello' });
  scrim.hidden = true;
  const toast = el('p', { class: 'cf-toast', role: 'status', 'data-testid': 'computer-goodbye' });
  toast.hidden = true;
  options.root.append(scrim, toast);

  const nameOf = (userId: string): string | null => names.get(userId) ?? options.nameOf(userId);

  function showHello(list: readonly string[]): void {
    const ok = hpButton(COMPUTER_TEXT.helloButton, {
      variant: 'primary',
      testId: 'computer-hello-ok',
    });
    ok.addEventListener('click', () => {
      scrim.hidden = true;
    });
    const card = el(
      'div',
      {
        class: 'cf-hello',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'cf-hello-title',
      },
      el(
        'div',
        { class: 'cf-hello-stack' },
        el(
          'div',
          { class: 'cf-hello-homes' },
          ...list.slice(0, 3).map(() => computerAvatar('avatar')),
        ),
        el('h2', { class: 'cf-hello-title', id: 'cf-hello-title' }, helloTitle(list)),
        el('p', { class: 'cf-hello-line' }, COMPUTER_TEXT.helloLine),
        computerBadge(list.length > 1),
      ),
      ok,
    );
    scrim.replaceChildren(card);
    scrim.hidden = false;
    ok.focus();
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }

  function flush(): void {
    timer = 0;
    if (arrivals.length > 0) showHello(arrivals);
    const last = goodbyes[goodbyes.length - 1];
    if (last) {
      const friend = last.friendId ? nameOf(last.friendId) : null;
      showToast(goodbyeLine(last.mate, friend));
    }
    arrivals = [];
    goodbyes = [];
  }

  function later(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, gatherMs);
  }

  return {
    liveEvent: (event) => {
      if (event.type === 'member.joined') {
        const joined = GAME_EVENTS['member.joined'].public.safeParse(event.data);
        if (!joined.success) return;
        names.set(joined.data.userId, joined.data.username);
        if (joined.data.computer) {
          arrivals.push(joined.data.username);
          later();
        }
        return;
      }
      if (event.type === 'member.left' || event.type === 'member.removed') {
        const left = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!left.success || !left.data.computer || !left.data.madeRoomFor) return;
        goodbyes.push({
          mate: nameOf(left.data.userId) ?? COMPUTER_TEXT.badge,
          friendId: left.data.madeRoomFor,
        });
        later();
      }
    },
    reset: () => {
      window.clearTimeout(timer);
      timer = 0;
      arrivals = [];
      goodbyes = [];
      scrim.hidden = true;
      toast.hidden = true;
    },
    get debug() {
      return {
        hello: scrim.hidden ? null : (scrim.querySelector('.cf-hello-title')?.textContent ?? null),
        toast: toast.hidden ? null : toast.textContent,
      };
    },
  };
}
