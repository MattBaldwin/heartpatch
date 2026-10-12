import { describe, expect, it } from 'vitest';
import { HomeSquishySchema } from './buildings.js';
import { CareSquishySchema } from './care.js';
import { GAME_EVENTS, parseGameEventPayload } from './events.js';
import { HouseViewSchema, MoveResidentRequestSchema } from './house.js';
import { JobSquishySchema } from './jobs.js';

const squishyId = '0190a000-0000-7000-8000-000000000001';
const userId = '0190a000-0000-7000-8000-000000000002';
const mapId = '0190a000-0000-7000-8000-000000000003';

describe('MoveResidentRequestSchema (#381)', () => {
  it('takes a squishy and a room, or null to move out, nothing else', () => {
    expect(MoveResidentRequestSchema.parse({ squishyId, roomId: 'snug' })).toEqual({
      squishyId,
      roomId: 'snug',
    });
    expect(MoveResidentRequestSchema.parse({ squishyId, roomId: null }).roomId).toBeNull();
    expect(MoveResidentRequestSchema.safeParse({ squishyId }).success).toBe(false);
    expect(MoveResidentRequestSchema.safeParse({ squishyId, roomId: 'Snug!' }).success).toBe(false);
    expect(MoveResidentRequestSchema.safeParse({ squishyId, roomId: null, x: 1 }).success).toBe(
      false,
    );
  });
});

describe('resident.moved (#381)', () => {
  it('keeps the room it left internal', () => {
    const payload = { userId, squishyId, roomId: 'playroom', fromRoomId: 'snug' };
    expect(parseGameEventPayload('resident.moved', payload)).toEqual(payload);
    expect(GAME_EVENTS['resident.moved'].public.parse(payload)).toEqual({
      userId,
      squishyId,
      roomId: 'playroom',
    });
    expect(() =>
      parseGameEventPayload('resident.moved', { userId, squishyId, roomId: null }),
    ).toThrow();
  });
});

describe('house.gift (#381 PR H)', () => {
  it('keeps the gift id and the giver internal', () => {
    const payload = {
      userId,
      giftId: mapId,
      day: '2026-10-12',
      giverSquishyId: squishyId,
      itemId: 'timber',
      count: 3,
    };
    expect(parseGameEventPayload('house.gift', payload)).toEqual(payload);
    expect(parseGameEventPayload('house.gift', { ...payload, giverSquishyId: null })).toEqual({
      ...payload,
      giverSquishyId: null,
    });
    expect(GAME_EVENTS['house.gift'].public.parse(payload)).toEqual({
      userId,
      day: '2026-10-12',
      itemId: 'timber',
      count: 3,
    });
    expect(() => parseGameEventPayload('house.gift', { ...payload, count: 0 })).toThrow();
  });
});

describe('HouseView.gift', () => {
  const view = {
    level: 1,
    levelName: 'The Snug',
    exterior: 'hut',
    final: false,
    rooms: [],
    next: null,
    items: {},
    now: '2026-10-12T12:00:00.000Z',
  };

  it('parses a reply from an older server, with no gift, as null', () => {
    expect(HouseViewSchema.parse(view).gift).toBeNull();
  });

  it("parses today's gift", () => {
    const gift = {
      day: '2026-10-12',
      giverSquishyId: squishyId,
      itemId: 'timber',
      count: 3,
      note: 'Mochi dreamed about pancakes 🥞',
      claimed: false,
    };
    expect(HouseViewSchema.parse({ ...view, gift }).gift).toEqual(gift);
    expect(
      HouseViewSchema.parse({ ...view, gift: { ...gift, giverSquishyId: null } }).gift,
    ).toMatchObject({ giverSquishyId: null });
    expect(HouseViewSchema.safeParse({ ...view, gift: { ...gift, day: 'today' } }).success).toBe(
      false,
    );
  });
});

/**
 * `houseRoomId` is strictly additive (coordinator, 2026-10-12): a reply from
 * a server before #381 PR C has none and still parses, as "not a resident".
 */
describe('houseRoomId on older replies', () => {
  it('parses a HomeSquishy without it as null', () => {
    const older = {
      id: squishyId,
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
      nickname: null,
      level: 3,
      habitatId: null,
      trainingId: null,
      job: 'resting',
      accessory: null,
    };
    expect(HomeSquishySchema.parse(older).houseRoomId).toBeNull();
    expect(HomeSquishySchema.parse({ ...older, houseRoomId: 'snug' }).houseRoomId).toBe('snug');
  });

  it('parses a JobSquishy without it as null', () => {
    const older = {
      squishy: {
        id: squishyId,
        mapId,
        ownerUserId: userId,
        speciesId: 'puddlepuff',
        element: 'water',
        feeling: 'silly',
        nickname: null,
        level: 3,
        xp: 0,
        state: 'active',
      },
      job: 'resting',
      teamSlot: null,
      post: null,
      habitatId: null,
      work: null,
      training: null,
      fullXpResetAt: null,
      gatherFits: [],
    };
    expect(JobSquishySchema.parse(older).houseRoomId).toBeNull();
  });

  it('parses a CareSquishy without it as null', () => {
    const older = {
      id: squishyId,
      speciesId: 'puddlepuff',
      element: 'water',
      feeling: 'silly',
      nickname: null,
      level: 3,
      xp: 0,
      xpIntoLevel: 0,
      xpToNext: 10,
      stats: { hp: 20, attack: 10, defense: 10, speed: 10 },
      contentment: 60,
      mood: 'happy',
      xpBonusPercent: 100,
      habitatId: null,
      caredToday: 0,
      fullCareLeft: 3,
      nextCareAt: {},
      newEvolution: null,
    };
    expect(CareSquishySchema.parse(older).houseRoomId).toBeNull();
  });
});
