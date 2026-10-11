import { QUICK_MESSAGES } from '@heartpatch/shared';
import { lookOf } from '../chat/chat-view.js';
import { el } from '../ui/dom.js';
import { LIVE_TEXT, type LiveTurnInfo } from './live-turn.js';

/*
 * A live battle's bar (#29, the owner-approved mockup's frames 6–8 and 11):
 * the turn timer as a ring, a line about whose pick it is, the opponent's
 * chip ("Picking…", "Picked ✓", "Stepped away"), and Cheer, which opens the
 * quick phrases and emoji. Only ids are ever sent (CLAUDE.md rule 9). DOM
 * only; the battle screen decides what it says.
 */

/** Cheers offered in a battle: kind phrases and every emoji (stickers stay in chat). */
const CHEER_PHRASES = new Set(['nice-move', 'good-game', 'oops', 'so-cute', 'hi', 'thank-you']);
export const CHEERS = QUICK_MESSAGES.messages.filter(
  (m) => m.kind === 'emoji' || CHEER_PHRASES.has(m.id),
);

const RING_R = 18;
const RING_LENGTH = 2 * Math.PI * RING_R;
const SVG = 'http://www.w3.org/2000/svg';

export interface LiveBar {
  /** Redraws the ring, the line and the chip. */
  update: (info: LiveTurnInfo, line: string, chip: string | null) => void;
  /** Sprout's note over the sheet ("Time's up! I picked…"), or null to clear it. */
  setNote: (text: string | null) => void;
  /** A cheer is on its way: the tray steps aside, and the button waits. */
  setSending: (sending: boolean) => void;
  dispose: () => void;
}

export function mountLiveBar(
  slot: HTMLElement,
  options: { onCheer: (messageId: string) => void },
): LiveBar {
  const ring = document.createElementNS(SVG, 'svg');
  ring.setAttribute('viewBox', '0 0 44 44');
  ring.setAttribute('class', 'battle-live-ring');
  ring.setAttribute('role', 'img');
  const track = document.createElementNS(SVG, 'circle');
  const fill = document.createElementNS(SVG, 'circle');
  for (const c of [track, fill]) {
    c.setAttribute('cx', '22');
    c.setAttribute('cy', '22');
    c.setAttribute('r', String(RING_R));
  }
  track.setAttribute('class', 'battle-live-ring-track');
  fill.setAttribute('class', 'battle-live-ring-fill');
  fill.setAttribute('stroke-dasharray', String(RING_LENGTH));
  fill.setAttribute('transform', 'rotate(-90 22 22)');
  const number = document.createElementNS(SVG, 'text');
  number.setAttribute('x', '22');
  number.setAttribute('y', '27');
  number.setAttribute('text-anchor', 'middle');
  number.setAttribute('class', 'battle-live-ring-number');
  ring.append(track, fill, number);

  const line = el('p', { class: 'battle-live-line', 'data-testid': 'battle-live-line' });
  const chip = el('span', { class: 'battle-live-chip', 'data-testid': 'battle-live-chip' });
  const cheerButton = el(
    'button',
    {
      type: 'button',
      class: 'battle-button battle-button-soft battle-button-small',
      'data-testid': 'battle-cheer',
    },
    LIVE_TEXT.cheer,
  );
  const note = el('p', {
    class: 'battle-live-note',
    role: 'status',
    'data-testid': 'battle-live-note',
  });
  note.hidden = true;
  const tray = el('div', { class: 'battle-cheers', 'data-testid': 'battle-cheers' });
  tray.hidden = true;
  tray.append(el('p', { class: 'battle-cheers-title' }, LIVE_TEXT.cheerTitle));
  const phrases = el('div', { class: 'battle-cheers-row' });
  const emoji = el('div', { class: 'battle-cheers-row' });
  for (const message of CHEERS) {
    const look = lookOf(message);
    const button = el(
      'button',
      {
        type: 'button',
        class: `battle-cheer-pick battle-cheer-${message.kind}`,
        'data-message': message.id,
        'aria-label': look.label,
      },
      look.kind === 'emoji' ? look.emoji : look.label,
    );
    button.addEventListener('click', () => {
      tray.hidden = true;
      options.onCheer(message.id);
    });
    (message.kind === 'emoji' ? emoji : phrases).append(button);
  }
  tray.append(phrases, emoji);
  cheerButton.addEventListener('click', () => {
    tray.hidden = !tray.hidden;
  });

  const row = el('div', { class: 'battle-live-row' }, ring, line, chip, cheerButton);
  slot.replaceChildren(note, row, tray);
  slot.hidden = false;

  return {
    update: (info, text, chipText) => {
      const seconds = info.secondsLeft ?? 0;
      number.textContent = info.secondsLeft === null ? '' : String(seconds);
      fill.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - info.fraction)));
      ring.classList.toggle('battle-live-ring-low', info.secondsLeft !== null && seconds <= 10);
      ring.setAttribute('aria-label', LIVE_TEXT.secondsLeft(seconds));
      ring.style.visibility = info.secondsLeft === null ? 'hidden' : 'visible';
      line.textContent = text;
      chip.textContent = chipText ?? '';
      chip.hidden = chipText === null;
      chip.classList.toggle('battle-live-chip-done', info.theyPicked);
      chip.classList.toggle('battle-live-chip-away', info.theyAway);
    },
    setNote: (text) => {
      note.textContent = text ?? '';
      note.hidden = text === null;
    },
    setSending: (sending) => {
      cheerButton.disabled = sending;
      if (sending) tray.hidden = true;
    },
    dispose: () => {
      slot.replaceChildren();
      slot.hidden = true;
    },
  };
}
