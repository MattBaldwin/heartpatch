import { findAvoidedWords, type PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { clockText, coveredSince, LIVE_TEXT, liveTurnInfo } from './live-turn.js';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const TURN_MS = 30_000;

type LiveBits = Pick<PlayerBattle, 'live' | 'view' | 'mySide' | 'status'>;

function battle(
  patch: Partial<NonNullable<PlayerBattle['live']>> = {},
  phase: PlayerBattle['view']['phase'] = { type: 'turn' },
): LiveBits {
  return {
    status: 'active',
    mySide: 'b',
    view: { phase } as PlayerBattle['view'],
    live: {
      opponentUserId: '00000000-0000-7000-8000-00000000000a',
      deadlineAt: new Date(NOW + 18_000).toISOString(),
      myPick: null,
      opponentPicked: false,
      opponentHere: true,
      covered: [],
      ...patch,
    },
  };
}

describe('live turns on screen (#29)', () => {
  it('counts down to when Sprout picks', () => {
    const info = liveTurnInfo(battle(), NOW, TURN_MS)!;
    expect(info.secondsLeft).toBe(18);
    expect(info.fraction).toBeCloseTo(0.6);
    expect(info.myTurn).toBe(true);
    expect(liveTurnInfo(battle(), NOW + 60_000, TURN_MS)?.secondsLeft).toBe(0);
  });

  it('knows who has picked, never what they picked', () => {
    const info = liveTurnInfo(
      battle({ myPick: { type: 'move', move: 'giggle-drizzle' }, opponentPicked: true }),
      NOW,
      TURN_MS,
    )!;
    expect(info).toMatchObject({ myTurn: false, theyPicked: true });
  });

  it("a replace phase that isn't mine is the other Keeper's to pick", () => {
    expect(liveTurnInfo(battle({}, { type: 'replace', sides: ['a'] }), NOW, TURN_MS)?.myTurn).toBe(
      false,
    );
    expect(liveTurnInfo(battle({}, { type: 'replace', sides: ['b'] }), NOW, TURN_MS)?.myTurn).toBe(
      true,
    );
  });

  it('says when they stepped away, and nothing for a battle that isn’t live', () => {
    expect(liveTurnInfo(battle({ opponentHere: false }), NOW, TURN_MS)?.theyAway).toBe(true);
    expect(liveTurnInfo({ ...battle(), live: undefined }, NOW, TURN_MS)).toBeNull();
    expect(liveTurnInfo(battle({ deadlineAt: null }), NOW, TURN_MS)?.secondsLeft).toBeNull();
  });

  it('finds the turns Sprout picked for me since I last looked', () => {
    const b = battle({
      covered: [
        { turn: 2, side: 'b' },
        { turn: 3, side: 'a' },
        { turn: 4, side: 'b' },
      ],
    });
    expect(coveredSince(b, 'b', 2)).toEqual([4]);
    expect(coveredSince(b, 'b', -1)).toEqual([2, 4]);
  });

  it('formats the away clock', () => {
    expect(clockText(42)).toBe('0:42');
    expect(clockText(75)).toBe('1:15');
  });

  it('every line is kind and free of avoided words', () => {
    for (const value of Object.values(LIVE_TEXT)) {
      const line =
        typeof value === 'function' ? (value as (...a: unknown[]) => string)('Mira', 3) : value;
      expect(findAvoidedWords(line), line).toEqual([]);
    }
  });
});
