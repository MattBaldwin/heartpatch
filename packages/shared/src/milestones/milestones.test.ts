import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { CLOTHING, CLOTHING_BY_ID } from '../data/clothing.js';
import { EVERYDAY_COMMON_SPECIES, MILESTONE_RULES, MILESTONE_TRACKS } from '../data/milestones.js';
import { CLOCKWORK_ISLE_SPECIES } from '../data/species-wave-3.js';
import { SEASONS } from '../data/seasons.js';
import { SPAWN_TABLES } from '../data/server/spawn-tables.js';
import { SECRET_SPECIES } from '../data/server/secret-species.js';
import { SPECIES } from '../data/species.js';
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

describe('Every Common list (#732 B2)', () => {
  it('is every public, all-year common base form, and nothing seasonal or secret', () => {
    const evolved = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
    expect(EVERYDAY_COMMON_SPECIES).toEqual(
      SPECIES.filter(
        (s) =>
          s.rarity === 'common' &&
          s.season === undefined &&
          !evolved.has(s.id) &&
          !CLOCKWORK_ISLE_SPECIES.has(s.id),
      ).map((s) => s.id),
    );
    // #874 C6: the isle's kinds leave the goal where it was on main.
    expect(EVERYDAY_COMMON_SPECIES).toHaveLength(15);
    expect(EVERYDAY_COMMON_SPECIES.length).toBeGreaterThan(0);
    const secret = new Set(SECRET_SPECIES.map((s) => s.id));
    for (const id of EVERYDAY_COMMON_SPECIES) {
      const species = SPECIES.find((s) => s.id === id)!;
      expect(species.season, id).toBeUndefined();
      expect(species.rarity, id).toBe('common');
      expect(secret.has(id), id).toBe(false);
    }
    const tier = track('commons').tiers[0]!;
    expect(track('commons').tiers).toHaveLength(1);
    expect(tier.threshold).toBe(EVERYDAY_COMMON_SPECIES.length);
  });

  it('only lists kinds that spawn wild all year, so the goal can be reached', () => {
    // A kind that spawns only in a season's window (or never) would make the track unreachable.
    for (const id of EVERYDAY_COMMON_SPECIES) {
      const tables = SPAWN_TABLES.filter((t) => t.entries.some((e) => e.species === id));
      // …and on every patch type: an isle-only table (#874) doesn't count.
      expect(
        tables.some((t) => t.season === undefined && t.patchTypes === undefined),
        id,
      ).toBe(true);
    }
  });

  // #874 C6: a kind found only on some patch types (every table it's in
  // names `patchTypes`) is an isle kind, so the public set can't drift.
  it('lists every isle-only kind in CLOCKWORK_ISLE_SPECIES', () => {
    const spawned = new Set(SPAWN_TABLES.flatMap((t) => t.entries.map((e) => e.species)));
    const isleOnly = [...spawned].filter((id) =>
      SPAWN_TABLES.filter((t) => t.entries.some((e) => e.species === id)).every(
        (t) => t.patchTypes !== undefined,
      ),
    );
    expect(isleOnly.length).toBeGreaterThan(0);
    for (const id of isleOnly) expect(CLOCKWORK_ISLE_SPECIES.has(id), id).toBe(true);
  });
});

describe('milestone data', () => {
  it('is valid, public and secret together', () => {
    expect(
      checkMilestoneData({ public: MILESTONE_TRACKS, secret: SECRET_MILESTONES }, context),
    ).toEqual([]);
    expect(MILESTONE_RULES.minMembers).toBe(2);
  });

  it('has the Phase 1 tracks, plus The First Patch, the far Hollow (#306 6b), the found sets (#306 PR 5) and Big Friend (#190)', () => {
    expect(MILESTONE_TRACKS.map((t) => t.id)).toEqual([
      'first-patch',
      'territory',
      'collector',
      'commons',
      'evolution',
      'caretaker',
      'defender',
      'rescuer',
      'big-friend',
      'seeker',
      'halloween',
      'cozy-harvest',
      'christmas',
      'lantern-keeper',
      'set-rekindled',
    ]);
    expect(track('halloween').season).toBe('halloween');
    expect(track('cozy-harvest').season).toBe('thanksgiving');
    expect(track('christmas').season).toBe('christmas');
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

  it('names every kind of thing a seasonal track counts, in every tier (#34)', () => {
    // The card shows only the next tier's goal, so each tier has to say what counts.
    const kind = {
      'squishy.captured': /befriend/i,
      'resource.gathered': /gather/i,
      'clothing.found': /find/i,
    };
    for (const id of ['halloween', 'cozy-harvest']) {
      const t = track(id);
      if (t.progress.from !== 'events') throw new Error(`${id} counts events`);
      for (const source of t.progress.sources) {
        const words = kind[source.eventType as keyof typeof kind];
        expect(words, `${id} source ${source.eventType} has copy words`).toBeDefined();
        for (const tier of t.tiers) {
          expect(tier.goal, `${id} ${String(tier.threshold)}`).toMatch(words);
        }
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
    expect(credits('squishy.evolved', { userId: KID, squishyId: 'sq-1' })).toEqual([
      { trackId: 'evolution', userId: KID, amount: MILESTONE_UNIT, key: 'sq-1' },
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
      { trackId: 'commons', userId: KID, amount: MILESTONE_UNIT, key: 'puddlepuff' },
    ]);
    expect(
      credits('squishy.captured', { userId: KID, speciesId: 'heartlet' }).map((c) => c.trackId),
    ).toEqual(['collector', 'heart-whisperer']);
  });

  it('counts Every Common (#732 B2) for everyday commons only, one step per kind', () => {
    const commons = track('commons');
    const ids = (speciesId: string) =>
      credits('squishy.captured', { userId: KID, speciesId })
        .filter((c) => c.trackId === 'commons')
        .map((c) => c.key);
    // An uncommon, a seasonal common, a kid form (never wild) and a secret don't count.
    for (const other of ['mossmuffin', 'gourdon', 'rippletad', 'heartlet']) {
      expect(ids(other), other).toEqual([]);
    }
    // Befriending the same kind again is the same key, so the runner counts it once.
    expect(ids('quackle')).toEqual(['quackle']);
    expect(ids('quackle')).toEqual(['quackle']);
    const all = EVERYDAY_COMMON_SPECIES.length * MILESTONE_UNIT;
    expect(tiersReached(commons, all - MILESTONE_UNIT)).toEqual([]);
    expect(tiersReached(commons, all)).toEqual([1]);
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

  it('counts Cozy Harvest things only in the Thanksgiving window (#34)', () => {
    const crunchkin = { userId: KID, speciesId: 'crunchkin' };
    expect(credits('squishy.captured', crunchkin).map((c) => c.trackId)).toEqual(['collector']);
    expect(credits('squishy.captured', crunchkin, ['thanksgiving']).map((c) => c.trackId)).toEqual([
      'collector',
      'cozy-harvest',
    ]);
    expect(
      credits('resource.gathered', { userId: KID, resource: 'magic-fallen-leaves' }, [
        'thanksgiving',
      ]),
    ).toEqual([{ trackId: 'cozy-harvest', userId: KID, amount: MILESTONE_UNIT, key: null }]);
    // Pumpkins are Halloween's, and a Halloween piece doesn't count either.
    expect(
      credits('resource.gathered', { userId: KID, resource: 'pumpkins' }, ['thanksgiving']),
    ).toEqual([]);
    expect(
      credits('clothing.found', { userId: KID, itemId: 'witch-hat' }, ['thanksgiving']),
    ).toEqual([]);
    expect(
      credits('clothing.found', { userId: KID, itemId: 'leaf-crown' }, ['thanksgiving']).map(
        (c) => c.trackId,
      ),
    ).toEqual(['cozy-harvest']);
    // The costume is the top tier's prize, not something found, so it never counts.
    expect(
      credits('clothing.found', { userId: KID, itemId: 'leaf-pile-costume' }, ['thanksgiving']),
    ).toEqual([]);
  });

  it("gives the Leaf Pile Costume at Cozy Harvest's top tier (#34)", () => {
    const tiers = track('cozy-harvest').tiers;
    expect(tiers.map((t) => [t.threshold, t.title.name, t.coins, t.clothing])).toEqual([
      [4, 'Leaf Lover', 25, undefined],
      [10, 'Cozy Crunch', 50, undefined],
      [20, 'Pile Pal', 100, 'leaf-pile-costume'],
    ]);
    const costume = CLOTHING_BY_ID.get('leaf-pile-costume');
    expect(costume).toMatchObject({
      slot: 'costume',
      rarity: 'legendary',
      season: 'thanksgiving',
      sources: ['milestone'],
      tradable: false,
    });
    // It dresses the Keeper rather than replacing the body (the face shows in the renders).
    expect(costume?.visual.replacesBody).toBeUndefined();
  });

  it('counts Christmas things only in the Christmas window (#37)', () => {
    const advent = {
      userId: KID,
      claimId: KID,
      day: '2026-12-03',
      catchUp: false,
      items: { treats: 2 },
    };
    const present = { userId: KID, openingId: KID, items: { pies: 1 } };
    const chip = (points: number) => ({
      window: '2026-12-24',
      userId: KID,
      battleId: KID,
      points,
      chipped: 40,
      goal: 200,
    });
    const step = { trackId: 'christmas', userId: KID, amount: MILESTONE_UNIT, key: null };
    for (const [type, payload] of [
      ['advent.claimed', advent],
      ['present.opened', present],
      ['boss.chipped', chip(38)],
      // A fight that barely tickled still "helped" (the card says so): it counts.
      ['boss.chipped', chip(0)],
    ] as const) {
      expect(credits(type, payload, ['christmas']), type).toEqual([step]);
      expect(credits(type, payload), type).toEqual([]);
      expect(credits(type, payload, ['thanksgiving']), type).toEqual([]);
    }
    // Left out on purpose (see the track's comment): gifts.
    const gift = { offerId: KID, fromUserId: PAL, toUserId: KID };
    expect(credits('gift.collected', gift, ['christmas'])).toEqual([]);
    // The Patch Tree (#37 2c): only the gift that lights the star, for its giver.
    const decorated = (starLit: boolean) => ({
      offerId: PAL,
      postTileId: PAL,
      postIndex: 0,
      fromUserId: KID,
      toUserId: PAL,
      source: 'gift',
      added: 1,
      ornaments: 12,
      starLit,
    });
    expect(credits('tree.decorated', decorated(true), ['christmas'])).toEqual([step]);
    expect(credits('tree.decorated', decorated(false), ['christmas'])).toEqual([]);
    expect(credits('tree.decorated', decorated(true))).toEqual([]);
    expect(track('christmas').progress).toMatchObject({
      sources: [
        { eventType: 'advent.claimed' },
        { eventType: 'present.opened' },
        { eventType: 'boss.chipped' },
        { eventType: 'tree.decorated' },
      ],
    });
  });

  it('gives the Jolly Elf Costume at the Christmas top tier (#37)', () => {
    const tiers = track('christmas').tiers;
    expect(tiers.map((t) => [t.threshold, t.title.name, t.coins, t.clothing])).toEqual([
      [5, 'Jingle Pal', 25, undefined],
      [15, 'Cocoa Cuddler', 50, undefined],
      [30, 'Merry Helper', 100, 'jolly-elf-costume'],
    ]);
    const costume = CLOTHING_BY_ID.get('jolly-elf-costume');
    expect(costume).toMatchObject({
      slot: 'costume',
      rarity: 'legendary',
      season: 'christmas',
      sources: ['milestone'],
      tradable: false,
    });
    // It dresses the Keeper rather than replacing the body (the face shows in the renders).
    expect(costume?.visual.replacesBody).toBeUndefined();
    expect(findAvoidedWords(costume?.name ?? '')).toEqual([]);
    expect(findAvoidedWords(costume?.description ?? '')).toEqual([]);
  });

  it("names every Christmas activity in every tier's goal, never just a count (#37)", () => {
    // Owner decision 2026-11-28: the card shows only the next tier's goal, so
    // each one lists what a kid can do. One word per source the track counts.
    const named: Record<string, RegExp> = {
      'advent.claimed': /\badvent\b/i,
      'present.opened': /\bbag\b/i,
      'boss.chipped': /\bhelp on Eve\b/,
      'tree.decorated': /\blight the star\b/,
    };
    const christmas = track('christmas');
    if (christmas.progress.from !== 'events') throw new Error('christmas counts events');
    const sources = christmas.progress.sources.map((s) => s.eventType);
    expect(sources.toSorted()).toEqual(Object.keys(named).toSorted());
    for (const tier of christmas.tiers) {
      for (const type of sources)
        expect(tier.goal, `${tier.title.name}: ${type}`).toMatch(named[type]!);
      expect(tier.goal).not.toMatch(/\bthings\b/);
      // Short enough for the iPhone Milestones card and the Next-up sheet.
      expect(tier.goal.length, tier.title.name).toBeLessThanOrEqual(64);
    }
  });

  it('never names or hints at a Christmas BIG squishy in the Christmas track (rule 6)', () => {
    // The Eve's species is a secret until December 24: no squishy name,
    // public or secret, appears anywhere in the track or its prize.
    const christmas = track('christmas');
    const costume = CLOTHING_BY_ID.get('jolly-elf-costume');
    const text = JSON.stringify([christmas, costume?.name, costume?.description]).toLowerCase();
    for (const species of [...SPECIES, ...SECRET_SPECIES]) {
      expect(text, species.id).not.toContain(species.name.toLowerCase());
    }
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
