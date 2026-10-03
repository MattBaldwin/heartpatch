import { findAvoidedWords, type MilestoneNews } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  barPercent,
  earnedCount,
  freshNews,
  mayEarnMilestone,
  MILESTONES_TEXT,
  nextTier,
  progressLabel,
  rewardLine,
  seasonLabel,
  type ShownTrack,
} from './milestones-view.js';

const ME = '11111111-1111-4111-8111-111111111111';
const PAL = '22222222-2222-4222-8222-222222222222';
const EARNED = '2026-10-03T12:00:00.000Z';

const track = (progress: number, earned: number, season: string | null = null): ShownTrack => ({
  hidden: false,
  id: 'territory',
  name: 'Explorer',
  secret: false,
  season,
  progress,
  tiers: [10, 50, 150].map((threshold, i) => ({
    tier: i + 1,
    threshold,
    goal: `Claim ${String(threshold)} tiles.`,
    reward: {
      title: { id: `t${String(i)}`, name: `Title ${String(i)}` },
      coins: 25,
      clothing: i === 0 ? 'explorers-hat' : null,
    },
    earnedAt: i < earned ? EARNED : null,
  })),
});

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : typeof value === 'function'
      ? strings((value as (...args: never[]) => unknown)(...([3, 10] as never[])))
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(strings)
        : [];

describe('milestone words (style guide)', () => {
  it('uses none of the avoided words', () => {
    const texts = strings(MILESTONES_TEXT);
    expect(texts.length).toBeGreaterThan(20);
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });
});

describe('a track on the Milestones screen', () => {
  it('fills the bar towards the next tier and says how far', () => {
    expect(barPercent(track(3, 0))).toBe(30);
    expect(progressLabel(track(3, 0))).toBe('3 of 10');
    expect(nextTier(track(12, 1))?.threshold).toBe(50);
    expect(barPercent(track(12, 1))).toBe(24);
    expect(progressLabel(track(12, 1))).toBe('12 of 50');
  });

  it('says all done once every tier is earned', () => {
    const done = track(150, 3);
    expect(nextTier(done)).toBeNull();
    expect(barPercent(done)).toBe(100);
    expect(progressLabel(done)).toBe('All done!');
    expect(earnedCount(done)).toBe(3);
  });

  it('names its season', () => {
    expect(seasonLabel(track(0, 0, 'halloween'))).toBe('Halloween only');
    expect(seasonLabel(track(0, 0))).toBeNull();
  });

  it('lists the prize in words', () => {
    expect(
      rewardLine({ title: { id: 'a', name: 'Trailblazer' }, coins: 25, clothing: 'explorers-hat' }),
    ).toBe("Explorer's Hat, 25 Patch Coins and the title “Trailblazer”");
    expect(rewardLine({ title: { id: 'a', name: 'Watchful' }, coins: 25, clothing: null })).toBe(
      '25 Patch Coins and the title “Watchful”',
    );
    expect(rewardLine({ title: { id: 'a', name: 'Pal' }, coins: 0, clothing: null })).toBe(
      'the title “Pal”',
    );
  });
});

describe('the celebration', () => {
  const news = (id: string): MilestoneNews => ({
    id,
    trackName: 'Rescuer',
    goal: 'Bring a squishy home from the Hollow.',
    reward: { title: { id: 'hollow-rescuer', name: 'Hollow Rescuer' }, coins: 25, clothing: null },
    earnedAt: EARNED,
  });

  it('queues only news this device has not queued yet', () => {
    const all = [news('a'), news('b'), news('c')];
    expect(freshNews(all, new Set(['b'])).map((n) => n.id)).toEqual(['a', 'c']);
    expect(freshNews(all, new Set(['a', 'b', 'c']))).toEqual([]);
  });

  it("looks after the player's own play, not someone else's", () => {
    expect(mayEarnMilestone({ type: 'tile.captured', data: { userId: ME } }, ME)).toBe(true);
    expect(mayEarnMilestone({ type: 'tile.captured', data: { userId: PAL } }, ME)).toBe(false);
    // A challenge on my land that I held is mine, not the challenger's.
    const raid = { attackerUserId: PAL, defenderUserId: ME };
    expect(mayEarnMilestone({ type: 'raid.resolved', data: raid }, ME)).toBe(true);
    expect(mayEarnMilestone({ type: 'raid.resolved', data: raid }, PAL)).toBe(false);
    // The Glade is mine alone.
    expect(mayEarnMilestone({ type: 'tutorial.advanced', data: { stepId: null } }, ME)).toBe(true);
    // Chat earns nothing.
    expect(mayEarnMilestone({ type: 'chat.quick', data: { userId: ME } }, ME)).toBe(false);
  });
});
