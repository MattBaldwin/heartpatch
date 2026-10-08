import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { CLOTHING, CLOTHING_BY_ID } from '../data/clothing.js';
import { MILESTONE_RULES, MILESTONE_TRACKS } from '../data/milestones.js';
import { SEASONS } from '../data/seasons.js';
import { SECRET_MILESTONES } from '../data/server/secret-milestones.js';
import {
  checkMilestoneData,
  MILESTONE_UNIT,
  type MilestoneTrack,
} from '../schemas/data/milestones.js';
import { milestoneCredits, milestoneEventTypes, shownProgress, tiersReached } from './index.js';

const KID = '11111111-1111-4111-8111-111111111111';
const PAL = '22222222-2222-4222-8222-222222222222';
const context = { clothing: CLOTHING, seasons: SEASONS.map((s) => s.id) };
const ALL = [...MILESTONE_TRACKS, ...SECRET_MILESTONES];
const track = (id: string): MilestoneTrack => {
  const found = ALL.find((t) => t.id === id);
  if (!found) throw new Error(`no track ${id}`);
  return found;
};

describe('milestone data', () => {
  it('is valid, public and secret together', () => {
    expect(
      checkMilestoneData({ public: MILESTONE_TRACKS, secret: SECRET_MILESTONES }, context),
    ).toEqual([]);
    expect(MILESTONE_RULES.minMembers).toBe(2);
  });

  it('has the Phase 1 tracks, plus The First Patch', () => {
    expect(MILESTONE_TRACKS.map((t) => t.id)).toEqual([
      'first-patch',
      'territory',
      'collector',
      'evolution',
      'caretaker',
      'defender',
      'rescuer',
      'halloween',
    ]);
    expect(track('halloween').season).toBe('halloween');
    expect(SECRET_MILESTONES.length).toBeGreaterThan(0);
  });

  it('keeps the words kind (style guide §8, §9)', () => {
    for (const t of ALL) {
      expect(findAvoidedWords(t.name)).toEqual([]);
      for (const tier of t.tiers) {
        expect(findAvoidedWords(tier.goal)).toEqual([]);
        expect(findAvoidedWords(tier.title.name)).toEqual([]);
      }
    }
  });

  it('gives account-bound milestone pieces that only milestones give', () => {
    const rewarded = ALL.flatMap((t) => t.tiers.flatMap((tier) => tier.clothing ?? []));
    expect(new Set(rewarded).size).toBe(rewarded.length);
    for (const id of rewarded) {
      const item = CLOTHING_BY_ID.get(id);
      expect(item?.sources).toEqual(['milestone']);
      expect(item?.tradable).toBe(false);
    }
    // Every milestone piece is some tier's reward, or it could never be got.
    const pieces = CLOTHING.filter((c) => c.sources.includes('milestone')).map((c) => c.id);
    expect(pieces.sort()).toEqual([...rewarded].sort());
    // A secret's piece would sit in the public catalog and give it away.
    expect(SECRET_MILESTONES.flatMap((t) => t.tiers.filter((tier) => tier.clothing))).toEqual([]);
  });

  it('names what is wrong', () => {
    const territory = structuredClone(track('territory'));
    const bad = {
      public: [
        { ...territory, secret: true },
        {
          ...territory,
          id: 'oops',
          progress: {
            from: 'events',
            sources: [
              { eventType: 'tile.captured', where: [], player: 'nobody' },
              { eventType: 'tile.captured', where: [], player: 'userId', distinct: 'terrain' },
            ],
          },
          tiers: [
            { ...territory.tiers[1]!, clothing: 'witch-hat' },
            { ...territory.tiers[0]!, clothing: 'not-a-thing' },
          ],
        },
      ],
      secret: [],
    };
    expect(checkMilestoneData(bad, context)).toEqual([
      'public["territory"].secret: secret tracks live in the server data, and only they do',
      'public["oops"].progress.sources[0]: "tile.captured" has no "nobody"',
      'public["oops"].progress.sources: a track counting kinds of things has one source',
      'public["oops"].tiers[0].title.id: "map-maker" is listed twice',
      'public["oops"].tiers[0].clothing: milestone pieces are account-bound milestone items',
      'public["oops"].tiers[1].threshold: each tier needs more than the one before',
      'public["oops"].tiers[1].title.id: "trailblazer" is listed twice',
      'public["oops"].tiers[1].clothing: unknown clothing "not-a-thing"',
    ]);
    // A secret track among the public ones (or the other way) is refused.
    expect(
      checkMilestoneData({ public: [], secret: [{ ...territory, secret: false }] }, context),
    ).toEqual([
      'secret["territory"].secret: secret tracks live in the server data, and only they do',
    ]);
  });
});

describe('milestoneCredits', () => {
  const credits = (type: string, payload: unknown, seasons: string[] = []) =>
    milestoneCredits(ALL, { type, payload }, seasons);

  it('counts each track from its event', () => {
    expect(credits('squishy.evolved', { userId: KID })).toEqual([
      { trackId: 'evolution', userId: KID, amount: MILESTONE_UNIT, key: null },
    ]);
    expect(credits('squishy.rescued', { userId: KID })).toEqual([
      { trackId: 'rescuer', userId: KID, amount: MILESTONE_UNIT, key: null },
    ]);
    expect(credits('squishy.cared', { userId: KID, full: true })).toEqual([
      { trackId: 'caretaker', userId: KID, amount: MILESTONE_UNIT, key: null },
    ]);
    // Past the first few a day it doesn't count (decision G).
    expect(credits('squishy.cared', { userId: KID, full: false })).toEqual([]);
  });

  it('credits the defender for land they held, not the challenger', () => {
    const raid = { attackerUserId: PAL, defenderUserId: KID };
    expect(credits('raid.resolved', { ...raid, outcome: 'held' })).toEqual([
      { trackId: 'defender', userId: KID, amount: MILESTONE_UNIT, key: null },
    ]);
    expect(credits('raid.resolved', { ...raid, outcome: 'taken' })).toEqual([]);
  });

  it("scales a tile by Gentle's share", () => {
    expect(credits('tile.captured', { userId: KID, rewardPercent: 100 })).toEqual([
      { trackId: 'territory', userId: KID, amount: 100, key: null },
    ]);
    expect(credits('tile.captured', { userId: KID, rewardPercent: 50 })).toEqual([
      { trackId: 'territory', userId: KID, amount: 50, key: null },
    ]);
    expect(credits('tile.captured', { userId: KID, rewardPercent: 0 })).toEqual([]);
  });

  it('counts kinds of squishy by species, and the secret one', () => {
    expect(credits('squishy.captured', { userId: KID, speciesId: 'puddlepuff' })).toEqual([
      { trackId: 'collector', userId: KID, amount: MILESTONE_UNIT, key: 'puddlepuff' },
    ]);
    expect(
      credits('squishy.captured', { userId: KID, speciesId: 'heartlet' }).map((c) => c.trackId),
    ).toEqual(['collector', 'heart-whisperer']);
  });

  it('counts Halloween things only in the Halloween window', () => {
    const gourdon = { userId: KID, speciesId: 'gourdon' };
    expect(credits('squishy.captured', gourdon).map((c) => c.trackId)).toEqual(['collector']);
    expect(credits('squishy.captured', gourdon, ['halloween']).map((c) => c.trackId)).toEqual([
      'collector',
      'halloween',
    ]);
    expect(
      credits('resource.gathered', { userId: KID, resource: 'pumpkins' }, ['halloween']),
    ).toEqual([{ trackId: 'halloween', userId: KID, amount: MILESTONE_UNIT, key: null }]);
    expect(
      credits('resource.gathered', { userId: KID, resource: 'timber' }, ['halloween']),
    ).toEqual([]);
    expect(
      credits('clothing.found', { userId: KID, itemId: 'witch-hat' }, ['halloween']).map(
        (c) => c.trackId,
      ),
    ).toEqual(['halloween']);
  });

  it('checks the secret conditions on the payload', () => {
    expect(credits('squishy.leveled', { userId: KID, level: 19 })).toEqual([]);
    expect(credits('squishy.leveled', { userId: KID, level: 20 }).map((c) => c.trackId)).toEqual([
      'squishy-coach',
    ]);
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(credits('outfit.changed', { userId: KID, wearing: seven.slice(1) })).toEqual([]);
    expect(
      credits('outfit.changed', { userId: KID, wearing: seven }).map((c) => c.trackId),
    ).toEqual(['dressed-up']);
    expect(
      credits('clothing.found', { userId: KID, itemId: 'cloud-onesie' }).map((c) => c.trackId),
    ).toEqual(['lucky-star']);
    // A Mythic find (#261) is rarer still, so it counts too.
    expect(
      credits('clothing.found', { userId: KID, itemId: 'hollow-man-costume' }).map(
        (c) => c.trackId,
      ),
    ).toEqual(['lucky-star']);
  });

  it('ignores events no track reads, and payloads without a player', () => {
    expect(credits('chat.quick', { userId: KID })).toEqual([]);
    expect(credits('squishy.evolved', { userId: null })).toEqual([]);
    expect(milestoneEventTypes(ALL).has('tile.captured')).toBe(true);
    expect(milestoneEventTypes(ALL).has('chat.quick')).toBe(false);
  });
});

describe('tiers', () => {
  it('reaches each tier at its threshold, in hundredths', () => {
    const territory = track('territory');
    expect(tiersReached(territory, 999)).toEqual([]);
    expect(tiersReached(territory, 1000)).toEqual([1]);
    expect(tiersReached(territory, 50 * MILESTONE_UNIT)).toEqual([1, 2]);
    expect(shownProgress(territory, 1050)).toBe(10);
    expect(shownProgress(territory, 999_999)).toBe(150);
  });
});
