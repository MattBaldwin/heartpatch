import type { WsEventMessage } from '@heartpatch/shared';

// "Defend now?" (#29-C): a rival is challenging land I'm standing watch on
// while my app is open. Words follow the style guide (§6, §9): "Challenge",
// never "attack"; calm, and fine to say no to.

export const DEFENSE_TEXT = {
  /** The card's title. */
  title: 'Defend now?',
  /** Who's visiting: their name, or a kind stand-in. */
  visiting: (name: string | null) =>
    `${name ?? 'Someone'} is challenging your land! Play your squishies yourself?`,
  /** If they say no, nothing bad happens. */
  calm: 'Not now? Your squishies on watch will play on their own.',
  defend: 'Defend!',
  notNow: 'Not now',
  secondsLeft: (n: number) => `${String(n)}s`,
} as const;

/** A prompt waiting for me, as the card needs it. */
export interface DefensePromptInfo {
  challengeId: string;
  battleId: string;
  fromUserId: string;
  /** How long it had when the server sent it (its `expiresAt` minus the event's time). */
  windowMs: number;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The prompt in a `defense.prompted` event, if it's for me. Else null. */
export function defensePromptFor(event: WsEventMessage, me: string): DefensePromptInfo | null {
  if (event.type !== 'defense.prompted') return null;
  const challengeId = str(event.data['challengeId']);
  const battleId = str(event.data['battleId']);
  const fromUserId = str(event.data['fromUserId']);
  const toUserId = str(event.data['toUserId']);
  const expiresAt = str(event.data['expiresAt']);
  if (!challengeId || !battleId || !fromUserId || toUserId !== me || !expiresAt) return null;
  // Measured on the server's clock both ends, so a phone's own clock can't skew it.
  const windowMs = Date.parse(expiresAt) - Date.parse(event.at);
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;
  return { challengeId, battleId, fromUserId, windowMs };
}

/** True when `event` says the prompt is over (answered here or elsewhere, expired, called off). */
export function endsDefensePrompt(event: WsEventMessage, challengeId: string): boolean {
  return event.type === 'defense.answered' && event.data['challengeId'] === challengeId;
}

/** Whole seconds left on the card, never below zero. */
export function secondsLeft(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
