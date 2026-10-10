import type { PlayerBattle, PublicUser, WsEventMessage } from '@heartpatch/shared';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { defenseApi, type DefenseApi } from './defense-api.js';
import {
  DEFENSE_TEXT,
  defensePromptFor,
  endsDefensePrompt,
  secondsLeft,
  type DefensePromptInfo,
} from './defense-prompt-model.js';
import './defense-prompt.css';

// "Defend now?" over any screen (#29-C). A rival started a challenge on land
// my squishies stand watch on while my app is open: "Defend!" plays it live,
// "Not now" (or letting the bar run out) leaves it to my defense style. The
// server decides everything; the card only asks, then opens the battle.

export interface DefensePromptOptions {
  root: HTMLElement;
  api?: DefenseApi;
  /** Who's challenging, by user id (the patch's members), for the card. */
  nameOf: (userId: string) => string | null;
  /** "Defend!" worked: the battle from my side. */
  openBattle: (battle: PlayerBattle) => void;
  now?: () => number;
  setTimer?: (task: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface DefensePromptDebug {
  readonly showing: string | null;
  readonly secondsLeft: number | null;
}

export interface DefensePrompt {
  setUser: (user: PublicUser | null) => void;
  /** Live events from the map on screen: a prompt for me opens; its answer closes it. */
  liveEvent: (event: WsEventMessage) => void;
  readonly isOpen: boolean;
  readonly debug: DefensePromptDebug;
}

const TICK_MS = 250;

export function createDefensePrompt(options: DefensePromptOptions): DefensePrompt {
  const api = options.api ?? defenseApi;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  let user: PublicUser | null = null;
  let prompt: DefensePromptInfo | null = null;
  let deadline = 0;
  let ticking: unknown = null;
  let working = false;

  const title = el('h2', { class: 'defense-title' }, DEFENSE_TEXT.title);
  const who = el('p', { class: 'defense-who', 'data-testid': 'defense-who' });
  const calm = el('p', { class: 'defense-calm' }, DEFENSE_TEXT.calm);
  const fill = el('span', { class: 'defense-bar-fill' });
  const count = el('span', { class: 'defense-count', 'data-testid': 'defense-count' });
  const bar = el('div', { class: 'defense-bar', 'aria-hidden': 'true' }, fill);
  const note = el('p', { class: 'defense-note', role: 'status' });
  const defend = el(
    'button',
    { type: 'button', class: 'auth-button defense-yes', 'data-testid': 'defense-yes' },
    DEFENSE_TEXT.defend,
  );
  const notNow = el(
    'button',
    { type: 'button', class: 'defense-no', 'data-testid': 'defense-no' },
    DEFENSE_TEXT.notNow,
  );
  const card = el(
    'section',
    {
      class: 'defense-card',
      role: 'alertdialog',
      'aria-label': DEFENSE_TEXT.title,
      'data-testid': 'defense-card',
    },
    el('div', { class: 'defense-shield', 'aria-hidden': 'true' }, '🛡️'),
    title,
    who,
    el('div', { class: 'defense-timer' }, bar, count),
    calm,
    note,
    el('div', { class: 'defense-buttons' }, defend, notNow),
  );
  card.hidden = true;
  options.root.append(card);

  const close = () => {
    prompt = null;
    working = false;
    card.hidden = true;
    if (ticking !== null) clearTimer(ticking);
    ticking = null;
  };

  const tick = () => {
    ticking = null;
    if (!prompt) return;
    const left = secondsLeft(deadline, now());
    count.textContent = DEFENSE_TEXT.secondsLeft(left);
    fill.style.transform = `scaleX(${String(Math.max(0, (deadline - now()) / prompt.windowMs))})`;
    // Out of time: the server lets the defense style play; nothing to say.
    if (left === 0 && !working) {
      close();
      return;
    }
    ticking = setTimer(tick, TICK_MS);
  };

  const open = (next: DefensePromptInfo) => {
    close();
    prompt = next;
    // Counted from when it arrived, for as long as the server gave it.
    deadline = now() + next.windowMs;
    who.textContent = DEFENSE_TEXT.visiting(options.nameOf(next.fromUserId));
    note.textContent = '';
    defend.disabled = false;
    notNow.disabled = false;
    card.hidden = false;
    tick();
  };

  const answer = async (reply: 'yes' | 'not-now') => {
    const asked = prompt;
    if (!asked || working) return;
    working = true;
    defend.disabled = true;
    notNow.disabled = true;
    try {
      const battle = await api.answer(asked.challengeId, reply, newIdempotencyKey());
      if (prompt !== asked) return;
      close();
      if (battle) options.openBattle(battle);
    } catch (err) {
      if (prompt !== asked) return;
      // "Too late!" and friends: say so for a moment, then step aside.
      note.textContent = messageOf(err);
      setTimer(() => {
        if (prompt === asked) close();
      }, 2_500);
    }
  };

  defend.addEventListener('click', () => void answer('yes'));
  notNow.addEventListener('click', () => void answer('not-now'));

  return {
    setUser: (next) => {
      user = next;
      if (!next) close();
    },
    liveEvent: (event) => {
      if (!user) return;
      const next = defensePromptFor(event, user.id);
      if (next) {
        open(next);
        return;
      }
      if (prompt && !working && endsDefensePrompt(event, prompt.challengeId)) close();
    },
    get isOpen() {
      return prompt !== null;
    },
    get debug() {
      return {
        showing: prompt?.challengeId ?? null,
        secondsLeft: prompt ? secondsLeft(deadline, now()) : null,
      };
    },
  };
}
