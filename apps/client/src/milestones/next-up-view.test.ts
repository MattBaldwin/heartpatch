import { findAvoidedWords, type MilestonesResponse } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { inviteShareLine, NO_INVITE_LINE } from '../ui/lobby/family-codes.js';
import {
  chipView,
  NEAREST_COUNT,
  nearestGoals,
  NEXT_UP_TEXT,
  nextUpState,
  prizeChips,
  rowView,
  sproutKey,
} from './next-up-view.js';

const EARNED = '2026-10-03T12:00:00.000Z';
type Track = MilestonesResponse['tracks'][number];

/** A shown track: thresholds, how many tiers earned, progress. */
const track = (
  id: string,
  thresholds: number[],
  progress: number,
  earned = 0,
  extra: { secret?: boolean; season?: string | null; coins?: number } = {},
): Track => ({
  hidden: false,
  id,
  name: id.toUpperCase(),
  secret: extra.secret ?? false,
  season: extra.season ?? null,
  progress,
  tiers: thresholds.map((threshold, i) => ({
    tier: i + 1,
    threshold,
    goal: `Do ${String(threshold)} things.`,
    reward: {
      title: { id: `${id}-${String(i)}`, name: `${id} title ${String(i)}` },
      coins: extra.coins ?? 25,
      clothing: id === 'territory' && i === 0 ? 'explorers-hat' : null,
    },
    earnedAt: i < earned ? EARNED : null,
  })),
});

const response = (
  tracks: Track[],
  countsHere?: boolean,
  titles: string[] = [],
): MilestonesResponse => ({
  tracks,
  titles: titles.map((name, i) => ({ id: `t${String(i)}`, name })),
  equippedTitleId: null,
  news: [],
  ...(countsHere === undefined ? {} : { countsHere }),
});

describe('nearestGoals', () => {
  it('picks the three nearest tiers by progress, nearest first', () => {
    const goals = nearestGoals([
      track('territory', [10, 50], 7), // 70%
      track('collector', [3, 8], 6, 1), // 6 of 8, 75%
      track('seeker', [25], 12), // 48%
      track('evolution', [1, 5], 0), // 0%
      track('caretaker', [100], 90), // 90%
    ]);
    expect(goals.map((g) => g.trackId)).toEqual(['caretaker', 'collector', 'territory']);
    expect(goals).toHaveLength(NEAREST_COUNT);
    const collector = goals[1];
    expect(collector).toMatchObject({ have: 6, need: 8, percent: 75 });
    expect(collector?.short).toBe('Befriend 2 more kinds');
    expect(collector?.go).toBe('find');
    expect(collector?.goLabel).toBe('Find a squishy');
  });

  it('skips secret tracks, hidden ones and finished ones', () => {
    const goals = nearestGoals([
      { hidden: true },
      track('secret-room', [2], 1, 0, { secret: true }),
      track('first-patch', [1], 1, 1),
      track('territory', [10], 1),
    ]);
    expect(goals.map((g) => g.trackId)).toEqual(['territory']);
  });

  it('skips seasonal tracks out of season, once the season is known', () => {
    const tracks = [
      track('halloween', [5], 4, 0, { season: 'halloween' }),
      track('territory', [10], 1),
    ];
    expect(nearestGoals(tracks, (s) => s === 'christmas').map((g) => g.trackId)).toEqual([
      'territory',
    ]);
    expect(nearestGoals(tracks, (s) => s === 'halloween')[0]?.trackId).toBe('halloween');
    // Not known (no patch zone yet): kept.
    expect(nearestGoals(tracks, null)).toHaveLength(2);
  });

  it('breaks a tie with the bigger prize, then the server order', () => {
    const goals = nearestGoals([
      track('seeker', [10], 5, 0, { coins: 10 }),
      track('territory', [10], 5, 0, { coins: 50 }),
      track('collector', [10], 5, 0, { coins: 10 }),
    ]);
    expect(goals.map((g) => g.trackId)).toEqual(['territory', 'seeker', 'collector']);
  });

  it('says what is left in kid words, else the tier goal', () => {
    const [one] = nearestGoals([track('territory', [10], 9)]);
    expect(one?.short).toBe('Claim 1 more tile');
    const [other] = nearestGoals([track('set-attic', [6], 2)]);
    expect(other?.short).toBe('Do 6 things');
    expect(other?.go).toBe('map');
  });

  it('lists the prize as chips', () => {
    const [goal] = nearestGoals([track('territory', [10], 1)]);
    expect(goal?.prizes).toEqual(["Explorer's Hat", '25 Patch Coins', 'Title: territory title 0']);
    expect(prizeChips({ title: { id: 'x', name: 'Pal' }, coins: 0, clothing: null })).toEqual([
      'Title: Pal',
    ]);
  });
});

describe('nextUpState', () => {
  it('is nothing before a read', () => {
    expect(nextUpState(null)).toEqual({ kind: 'none' });
    expect(chipView({ kind: 'none' })).toBeNull();
    expect(rowView({ kind: 'none' })).toBeNull();
  });

  it('shows the nearest goal on the chip and the row (state A)', () => {
    const state = nextUpState(response([track('collector', [3, 8], 6, 1)], true));
    expect(state.kind).toBe('goals');
    expect(chipView(state)).toEqual({
      kicker: 'Next up · 6 of 8',
      line: 'Befriend 2 more kinds',
      icon: '🎯',
      percent: 75,
      look: 'goal',
    });
    expect(rowView(state)).toEqual({ sub: 'Befriend 2 more kinds', count: '6/8' });
  });

  it('is the solo card when milestones do not count on this patch, goals waiting', () => {
    const state = nextUpState(response([track('territory', [10], 3)], false));
    expect(state).toMatchObject({ kind: 'solo', goals: [{ trackId: 'territory' }] });
    expect(chipView(state)).toMatchObject({ line: 'Invite a friend to start', look: 'solo' });
    expect(rowView(state)).toEqual({ sub: 'Invite a friend to start', count: null });
    // Even with every tier earned, a solo patch says why first.
    expect(nextUpState(response([track('first-patch', [1], 1, 1)], false)).kind).toBe('solo');
  });

  it('is the quiet "All done" chip when every visible tier is earned', () => {
    const state = nextUpState(
      response([track('first-patch', [1], 1, 1), { hidden: true }], true, ["Sprout's Friend"]),
    );
    expect(state).toEqual({ kind: 'done', titles: ["Sprout's Friend"], secrets: 1 });
    expect(chipView(state)).toMatchObject({
      line: 'All done! Nice one',
      percent: 100,
      look: 'done',
    });
    expect(rowView(state)).toEqual({ sub: 'All done! Nice one', count: null });
  });

  it('comes back to state A when a new track arrives', () => {
    const done = response([track('first-patch', [1], 1, 1)], true);
    expect(nextUpState(done).kind).toBe('done');
    const more = response(
      [...done.tracks, track('halloween', [5], 0, 0, { season: 'halloween' })],
      true,
    );
    expect(nextUpState(more, () => true).kind).toBe('goals');
  });

  it('reads as the lobby without mapId (countsHere absent): goals', () => {
    expect(nextUpState(response([track('territory', [10], 3)])).kind).toBe('goals');
  });
});

describe('words', () => {
  it('shares the lobby invite line, one invite flow', () => {
    const now = Date.parse('2026-11-01T00:00:00.000Z');
    const expires = new Date(now + 6 * 86_400_000).toISOString();
    expect(inviteShareLine(expires, now)).toBe(
      'Works for 6 more days. New families can sign up with it too!',
    );
    expect(NO_INVITE_LINE).toBe('No code right now. Make one to invite a friend!');
  });

  it('keeps Sprout once per account', () => {
    expect(sproutKey('abc')).toBe('heartpatch.next-up.sprout.abc');
  });

  it('follows the style guide', () => {
    const all = [
      ...Object.values(NEXT_UP_TEXT).flatMap((v) => (typeof v === 'string' ? [v] : [])),
      NEXT_UP_TEXT.kickerCount(6, 8),
      NEXT_UP_TEXT.title('Pal'),
    ].join(' ');
    expect(findAvoidedWords(all)).toEqual([]);
    expect(NEXT_UP_TEXT.soloHeading).toBe('Milestones start counting when a friend joins 💛');
    expect(NEXT_UP_TEXT.sprout).toBe('Ooh, a goal!');
  });
});
