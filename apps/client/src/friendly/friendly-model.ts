import {
  CHALLENGE_RULES,
  GAME_EVENTS,
  levelGapNote,
  type ChallengeView,
  type WsEventMessage,
} from '@heartpatch/shared';

/*
 * Friendly battles (#29, the owner-approved mockup's frames 1–5): who's here
 * now, "Battle me?", the ask a friend sees ("Battle!" or "Not now!"), the
 * wait, and a kind "not now". Pure: the screen draws what this says. Words
 * follow the style guide (cozy, short, no avoided words).
 */

export const FRIENDLY_TEXT = {
  open: 'Friends',
  title: "Who's here now",
  intro: 'Ask a friend for a friendly battle. Nothing to lose, just for fun!',
  battleMe: 'Battle me?',
  busy: 'Busy',
  here: (level: number) => `Here now · team level ${String(level)}`,
  inBattle: 'In a battle right now',
  away: 'Away',
  onlyHere: 'Only Keepers with the game open show as here.',
  nobodyHere: 'Nobody else is here right now. Try again in a bit!',
  switchedOff: 'Friendly battles are switched off on this patch.',
  close: 'Close',
  cardTitle: (name: string) => `A friendly battle with ${name}?`,
  you: 'You',
  and: 'and',
  stronger: (name: string) =>
    `Heads up! ${name}'s team is a lot stronger. It's just for fun, so give it a go!`,
  newer: (name: string) => `Heads up! ${name}'s team is still growing. Go easy and have fun!`,
  yourTeam: 'Your team',
  changeTeam: 'Change',
  nothingAtStake: 'No tries used. Nobody loses anything.',
  maybeLater: 'Maybe later',
  asking: (name: string) => `Asking ${name}…`,
  askingSub: (name: string) => `Your team is ready. We'll start the moment ${name} says yes!`,
  waitUpTo: 'Waiting up to a minute',
  neverMind: 'Never mind',
  saysBattleMe: (name: string) => `${name} says: Battle me?`,
  justForFun: 'A friendly battle, just for fun. Nobody loses anything!',
  teams: (theirs: number, mine: number) =>
    `Their team: level ${String(theirs)} · yours: level ${String(mine)}`,
  notNow: 'Not now!',
  battle: 'Battle!',
  floatsAway: 'This ask waits a little while, then floats away.',
  saidNotNow: (name: string) => `${name} said: Not now! Maybe later?`,
  cantNow: (name: string) => `${name} can't battle right now`,
  cantNowSub: 'Your squishies are a tiny bit sleepy anyway. Try again in a little while!',
  askAgainIn: (name: string) =>
    `You can ask ${name} again in ${String(CHALLENGE_RULES.notNowRestMinutes)} minutes`,
  okay: 'Okay!',
  floatedAway: 'That ask floated away. You can ask again!',
  starting: 'Here we go!',
  ownerSwitch: 'Friendly battles',
  ownerOn: 'On',
  ownerOnHint: 'Keepers who are here can ask each other "Battle me?". Nothing is at stake.',
  ownerOff: 'Off',
  ownerOffHint: 'Nobody can ask for a friendly battle on this patch.',
} as const;

/** The card's heads-up, from my side (null for a fair-ish match). */
export function gapLine(mine: number, theirs: number, name: string): string | null {
  switch (levelGapNote(mine, theirs)) {
    case 'they-are-stronger':
      return FRIENDLY_TEXT.stronger(name);
    case 'they-are-newer':
      return FRIENDLY_TEXT.newer(name);
    case null:
      return null;
  }
}

/** How much of an ask's wait is left, 1 → 0 (the bar under "Battle!"). */
export function waitLeft(
  challenge: Pick<ChallengeView, 'createdAt' | 'expiresAt'>,
  nowMs: number,
): number {
  const start = Date.parse(challenge.createdAt);
  const end = Date.parse(challenge.expiresAt);
  if (!(end > start)) return 0;
  return Math.min(1, Math.max(0, (end - nowMs) / (end - start)));
}

/** An ask event of mine (as one of its two Keepers), with what it says. */
export type ChallengeEvent =
  | { type: 'sent'; challengeId: string; fromUserId: string; toUserId: string }
  | {
      type: 'answered';
      challengeId: string;
      fromUserId: string;
      toUserId: string;
      answer: 'yes' | 'not-now';
      battleId: string | null;
    }
  | {
      type: 'cancelled';
      challengeId: string;
      fromUserId: string;
      toUserId: string;
      reason: 'cancelled' | 'expired' | 'switched-off';
    };

/** The pair part of an ask event: friendly, and mine (as one of its two Keepers). */
function mine(
  data: { challengeId: string; kind: string; fromUserId: string; toUserId: string },
  me: string,
): { challengeId: string; fromUserId: string; toUserId: string } | null {
  if (data.kind !== 'friendly' || (data.fromUserId !== me && data.toUserId !== me)) return null;
  return { challengeId: data.challengeId, fromUserId: data.fromUserId, toUserId: data.toUserId };
}

/** A live event about a friendly ask of mine, or null for anything else. */
export function challengeEventFor(event: WsEventMessage, me: string): ChallengeEvent | null {
  switch (event.type) {
    case 'challenge.sent': {
      const parsed = GAME_EVENTS['challenge.sent'].public.safeParse(event.data);
      const base = parsed.success ? mine(parsed.data, me) : null;
      return base ? { type: 'sent', ...base } : null;
    }
    case 'challenge.answered': {
      const parsed = GAME_EVENTS['challenge.answered'].public.safeParse(event.data);
      if (!parsed.success) return null;
      const base = mine(parsed.data, me);
      return base
        ? { type: 'answered', ...base, answer: parsed.data.answer, battleId: parsed.data.battleId }
        : null;
    }
    case 'challenge.cancelled': {
      const parsed = GAME_EVENTS['challenge.cancelled'].public.safeParse(event.data);
      if (!parsed.success) return null;
      const base = mine(parsed.data, me);
      return base ? { type: 'cancelled', ...base, reason: parsed.data.reason } : null;
    }
    default:
      return null;
  }
}
