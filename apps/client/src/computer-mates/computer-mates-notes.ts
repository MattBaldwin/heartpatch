import type { MapView } from '@heartpatch/shared';
import type { MapLayer } from '../map/map-screen.js';
import { hpButton } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { computerAvatar, computerBadge } from './computer-badge.js';
import {
  COMPUTER_TEXT,
  goodbyeLine,
  helloTitle,
  isComputer,
  rosterDelta,
} from './computer-mates-model.js';

/*
 * Hello and goodbye (#386b, mockup 3a and 3c), from the roster: each time
 * the map redraws from a newer view (a live event's resync), the patch's
 * members are compared with the last view's. Mates who are new get one
 * hello card naming them all, which says they're run by the game. A mate
 * who left in the same moment a real kid moved in waved goodbye to make
 * room: a short toast says so, the mate badged in words. Mates sent home
 * by the owner's switch leave with no kid arriving, so no goodbye shows.
 * The roster, not the events: a fill's `member.joined` events land in one
 * burst, and the first one's resync skips the rest of the burst.
 */

/** Gathers one batch of changes into one card or toast. */
const GATHER_MS = 1200; // TUNE: a resync can land in two steps

/** How often a hello that found the screen busy tries again. */
const BUSY_RETRY_MS = 3000; // TUNE

/** How long the goodbye toast stays. */
const TOAST_MS = 5000; // TUNE

export interface ComputerMatesNotesOptions {
  root: HTMLElement;
  /** Something owns the screen (the tutorial, a battle, a sheet): the card waits. */
  busy?: () => boolean;
  gatherMs?: number;
}

export interface ComputerMatesNotesDebug {
  readonly hello: string | null;
  readonly toast: string | null;
}

export interface ComputerMatesNotes {
  /** A map layer: `attach` starts from the opened view, `update` compares each newer one. */
  readonly layer: Pick<MapLayer, 'attach' | 'update'>;
  readonly debug: ComputerMatesNotesDebug;
}

const greetedKey = (mapId: string) => `hp.computer-greeted.${mapId}`;

/** The mates this device already said hello to on a patch (empty if storage is off). */
function greeted(mapId: string): Set<string> {
  try {
    const raw = localStorage.getItem(greetedKey(mapId));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function remember(mapId: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(greetedKey(mapId), JSON.stringify([...ids]));
  } catch {
    // Private mode: the hello may show again next time, which is fine.
  }
}

export function createComputerMatesNotes(options: ComputerMatesNotesOptions): ComputerMatesNotes {
  const gatherMs = options.gatherMs ?? GATHER_MS;
  /** The last view's members: map id, then user id → name and whether a mate. */
  let roster: { mapId: string; members: Map<string, { name: string; computer: boolean }> } | null =
    null;
  let arrivals: string[] = [];
  let departed: string[] = [];
  let newKids: string[] = [];
  let timer = 0;
  let toastTimer = 0;

  const scrim = el('div', { class: 'cf-hello-scrim', 'data-testid': 'computer-hello' });
  scrim.hidden = true;
  const toast = el('p', { class: 'cf-toast', role: 'status', 'data-testid': 'computer-goodbye' });
  toast.hidden = true;
  options.root.append(scrim, toast);

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
    if (options.busy?.()) {
      timer = window.setTimeout(flush, BUSY_RETRY_MS);
      return;
    }
    if (arrivals.length > 0) showHello(arrivals);
    const mate = departed[departed.length - 1];
    if (mate !== undefined && newKids.length > 0) showToast(goodbyeLine(mate, newKids[0] ?? null));
    arrivals = [];
    departed = [];
    newKids = [];
  }

  function later(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, gatherMs);
  }

  const membersOf = (view: MapView) =>
    new Map(
      view.members.map((m) => [m.user.id, { name: m.user.username, computer: isComputer(m) }]),
    );

  /** Who was greeted per patch, so blocked storage still greets each mate once a session. */
  const memory = new Map<string, Set<string>>();

  function compare(view: MapView): void {
    const next = membersOf(view);
    const mapId = view.map.id;
    const last = roster?.mapId === mapId ? roster.members : null;
    roster = { mapId, members: next };
    const seen = memory.get(mapId) ?? greeted(mapId);
    memory.set(mapId, seen);
    const delta = rosterDelta(last, next, seen);
    if (delta.arrivals.length > 0) remember(mapId, seen);
    arrivals.push(...delta.arrivals);
    departed.push(...delta.departed);
    newKids.push(...delta.newKids);
    if (delta.arrivals.length + delta.departed.length + delta.newKids.length > 0) later();
  }

  return {
    layer: {
      attach: (_scene, view) => {
        compare(view);
      },
      update: compare,
    },
    get debug() {
      return {
        hello: scrim.hidden ? null : (scrim.querySelector('.cf-hello-title')?.textContent ?? null),
        toast: toast.hidden ? null : toast.textContent,
      };
    },
  };
}
