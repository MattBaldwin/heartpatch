import type { BattleSideId, PlayerBattle } from '@heartpatch/shared';

/*
 * A live battle's turn on screen (#29, the owner-approved mockup): both
 * Keepers pick at once, the turn plays when both have, and a timer counts
 * down to when Sprout picks for whoever hasn't. Pure: the battle screen and
 * the live bar draw what this says. Words follow the style guide.
 */

export const LIVE_TEXT = {
  yourPick: (who: string) => `Your pick! What will ${who} do?`,
  picked: (move: string) => `${move} it is!`,
  waitingFor: (name: string) => `Waiting for ${name} to pick…`,
  theyPicking: 'Picking…',
  theyPicked: 'Picked ✓',
  away: (left: string) => `Stepped away · ${left}`,
  timeUp: (move: string) => `Time's up! I picked ${move} for you. Ta-da!`,
  timeUpSendOut: (who: string) => `Time's up! I sent out ${who} for you.`,
  stillIn: "No worries, you're still in it.",
  welcomeBack: (name: string) => `Welcome back! Your battle with ${name} is still going.`,
  helped: (turns: number) =>
    turns === 1
      ? 'I picked once for you while you were away.'
      : `I picked ${String(turns)} times for you while you were away.`,
  cheer: 'Cheer',
  cheerTitle: 'Send a cheer',
  giveUp: 'Give up',
  giveUpAsk: 'Give up this friendly battle? Nobody loses anything.',
  giveUpYes: 'Yes, give up',
  keepPlaying: 'Keep playing',
  startCaption: (name: string) => `A friendly battle with ${name}! Just for fun.`,
  secondsLeft: (n: number) => `${String(n)} seconds left`,
  resultWon: (name: string) => `You won against ${name}!`,
  resultLost: (name: string) => `${name} won this one!`,
  friendlySub: 'Just for fun: nobody loses anything.',
  friendlyNote: 'Friendly battles give no XP.',
  gaveUp: 'You gave up. No worries!',
  theyGaveUp: (name: string) => `${name} gave up. You win!`,
} as const;

/** What the live bar shows for the turn on screen. */
export interface LiveTurnInfo {
  /** Whole seconds until Sprout steps in (0 once it's due); null once over. */
  secondsLeft: number | null;
  /** The ring's fill, 1 → 0 over the turn. */
  fraction: number;
  /** It's my turn to pick (or send someone out), and I haven't yet. */
  myTurn: boolean;
  /** The opponent has picked (their pick is never known). */
  theyPicked: boolean;
  /** The opponent's app isn't open right now. */
  theyAway: boolean;
}

/**
 * The live bar for `battle` at `nowMs` (the game clock, synced from the
 * view's `now`). `turnMs` is the ring's full length. Null for a battle that
 * isn't live.
 */
export function liveTurnInfo(
  battle: Pick<PlayerBattle, 'live' | 'view' | 'mySide' | 'status'>,
  nowMs: number,
  turnMs: number,
): LiveTurnInfo | null {
  const live = battle.live;
  if (!live) return null;
  const left = live.deadlineAt === null ? null : Date.parse(live.deadlineAt) - nowMs;
  const { phase } = battle.view;
  const owes =
    battle.status === 'active' &&
    (phase.type === 'turn' || (phase.type === 'replace' && phase.sides.includes(battle.mySide)));
  return {
    secondsLeft: left === null ? null : Math.max(0, Math.ceil(left / 1000)),
    fraction: left === null ? 0 : Math.min(1, Math.max(0, left / turnMs)),
    myTurn: owes && live.myPick === null,
    theyPicked: live.opponentPicked,
    theyAway: !live.opponentHere,
  };
}

/** The ring's full length for one deadline: when it was first seen. */
export interface RingSpan {
  deadlineAt: string;
  ms: number;
}

/**
 * The ring's full length for the deadline on screen. A new deadline starts a
 * new ring: the turn's length, or longer when more time is left than a turn
 * (Sprout waiting out an away-grace). The same deadline keeps its ring.
 */
export function ringSpan(
  previous: RingSpan | null,
  deadlineAt: string | null,
  nowMs: number,
  turnMs: number,
): RingSpan | null {
  if (deadlineAt === null) return null;
  if (previous?.deadlineAt === deadlineAt) return previous;
  return { deadlineAt, ms: Math.max(turnMs, Date.parse(deadlineAt) - nowMs) };
}

/** Turns the AI picked for `side` that came after `afterTurn` (new since the last look). */
export function coveredSince(
  battle: Pick<PlayerBattle, 'live'>,
  side: BattleSideId,
  afterTurn: number,
): number[] {
  return (battle.live?.covered ?? [])
    .filter((c) => c.side === side && c.turn > afterTurn)
    .map((c) => c.turn);
}

/** "0:42" for the away chip. */
export function clockText(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}
