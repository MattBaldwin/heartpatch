import { describe, expect, it } from 'vitest';
import { createBattleContent } from '../battle/content.js';
import { BUILDINGS } from '../data/buildings.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { GAME_DATA } from '../data/index.js';
import { PUSH_RULES, PUSH_TEXT } from '../data/push.js';
import { RESOURCES, RETIRED_RESOURCES } from '../data/resources.js';
import { serverBattleData } from '../data/server/battle-data.js';
import { SERVER_GAME_DATA } from '../data/server/index.js';
import { TRADE_VALUES } from '../data/trading.js';
import {
  AdventClaimRowSchema,
  AdventDaySchema,
  AdventResultSchema,
  KeeperWarmthRowSchema,
  MapViewChristmasSchema,
  PatchTreeRowSchema,
} from './christmas.js';
import { BuildingSchema, LightsBuildingSchema } from './data/buildings.js';
import { isBuildable } from './data/home-base.js';
import { checkPushRules, checkPushText } from './data/push.js';
import { BuildingKindSchema } from './buildings.js';
import { GAME_EVENTS, parseGameEventPayload } from './events.js';
import { HollowStatusSchema, LongNightKindSchema } from './hollow.js';
import { ItemChangeReasonSchema } from './inventory.js';
import { MapViewSchema } from './maps.js';
import { PushKindSchema, PushSettingsSchema } from './push.js';

// The Christmas shared contracts (#37 C0): every new field and kind parses,
// and nothing secret or projected changes.

const userA = '0190a000-0000-7000-8000-000000000001';
const userB = '0190a000-0000-7000-8000-000000000002';
const mapId = '0190a000-0000-7000-8000-0000000000a1';
const rowId = '0190a000-0000-7000-8000-0000000000c1';
const tileId = '0190a000-0000-7000-8000-0000000000d1';
const at = '2026-12-03T17:00:00.000Z';

describe('advent days and claims', () => {
  it('takes December 1 to 25 only', () => {
    for (const day of ['2026-12-01', '2026-12-24', '2026-12-25']) {
      expect(AdventDaySchema.parse(day)).toBe(day);
    }
    for (const day of ['2026-11-30', '2026-12-26', '2026-12-00', '2026-01-12']) {
      expect(AdventDaySchema.safeParse(day).success, day).toBe(false);
    }
  });

  it('round-trips a claim and a catch-up, and refuses an early or mislabelled one', () => {
    const claim = {
      id: rowId,
      userId: userA,
      day: '2026-12-03',
      mapId,
      seed: 'c0ffee',
      result: { treats: 3, heartdust: 1 },
      catchUp: false,
      claimedOn: '2026-12-03',
      claimedAt: at,
    };
    expect(AdventClaimRowSchema.parse(claim)).toEqual(claim);
    const late = { ...claim, day: '2026-12-01', catchUp: true, mapId: null };
    expect(AdventClaimRowSchema.parse(late)).toEqual(late);
    expect(AdventClaimRowSchema.safeParse({ ...claim, catchUp: true }).success).toBe(false);
    expect(AdventClaimRowSchema.safeParse({ ...late, catchUp: false }).success).toBe(false);
    expect(AdventClaimRowSchema.safeParse({ ...claim, claimedOn: '2026-12-02' }).success).toBe(
      false,
    );
    expect(AdventClaimRowSchema.safeParse({ ...claim, extra: 1 }).success).toBe(false);
  });

  it('holds at least one thing and never a chance', () => {
    expect(AdventResultSchema.parse({ fireworks: 1 })).toEqual({ fireworks: 1 });
    expect(AdventResultSchema.safeParse({}).success).toBe(false);
    expect(AdventResultSchema.safeParse({ treats: 0 }).success).toBe(false);
    expect(AdventResultSchema.safeParse({ treats: 0.5 }).success).toBe(false);
    // Every entry counts at least one, not just some.
    expect(AdventResultSchema.safeParse({ treats: 0, pies: 1 }).success).toBe(false);
  });
});

describe('warmth and the Patch Tree rows', () => {
  it('stores a pair once, ordered', () => {
    const row = { mapId, userAId: userA, userBId: userB, warmth: 2, updatedAt: at };
    expect(KeeperWarmthRowSchema.parse(row)).toEqual(row);
    expect(
      KeeperWarmthRowSchema.safeParse({ ...row, userAId: userB, userBId: userA }).success,
    ).toBe(false);
    expect(KeeperWarmthRowSchema.safeParse({ ...row, userBId: userA }).success).toBe(false);
    expect(KeeperWarmthRowSchema.safeParse({ ...row, warmth: -1 }).success).toBe(false);
  });

  it('round-trips a tree, with and without its star', () => {
    const tree = { mapId, postTileId: tileId, ornaments: 0, starLitAt: null, createdAt: at };
    expect(PatchTreeRowSchema.parse(tree)).toEqual(tree);
    const lit = { ...tree, ornaments: 12, starLitAt: at };
    expect(PatchTreeRowSchema.parse(lit)).toEqual(lit);
    expect(PatchTreeRowSchema.safeParse({ ...tree, ornaments: -1 }).success).toBe(false);
  });
});

describe('additive API fields', () => {
  const christmas = { tree: { postIndex: 2, ornaments: 5, starLit: false }, presentWaiting: true };

  it('MapView.christmas is optional, so older servers still parse', () => {
    expect(MapViewChristmasSchema.parse(christmas)).toEqual(christmas);
    const warm = { ...christmas, warmth: [{ userId: userB, warmth: 2 }] };
    expect(MapViewChristmasSchema.parse(warm)).toEqual(warm);
    expect(
      MapViewChristmasSchema.safeParse({ ...christmas, tree: { ornaments: 5, starLit: false } })
        .success,
    ).toBe(false);
    expect(
      MapViewChristmasSchema.safeParse({ ...christmas, warmth: [{ userId: userB, warmth: 0 }] })
        .success,
    ).toBe(false);
    const view = {
      map: { id: mapId, name: 'Pumpkin Hollow', timeZone: 'UTC', pvpMode: 'gentle', maxPlayers: 6 },
      members: [],
      tiles: [],
      seq: 0,
    };
    expect(MapViewSchema.parse(view)).not.toHaveProperty('christmas');
    expect(MapViewSchema.parse({ ...view, christmas }).christmas).toEqual(christmas);
    // No tree yet: still a valid christmas block.
    expect(MapViewSchema.parse({ ...view, christmas: { presentWaiting: true } }).christmas).toEqual(
      {
        presentWaiting: true,
      },
    );
    expect(MapViewSchema.safeParse({ ...view, christmas: { tree: christmas.tree } }).success).toBe(
      false,
    );
  });

  it('MapView.christmas parses with no tree', () => {
    expect(MapViewChristmasSchema.parse({ presentWaiting: true })).toEqual({
      presentWaiting: true,
    });
  });

  it("HollowStatus.longNight.kind is 'weekly' today and open for a later kind", () => {
    expect(LongNightKindSchema.parse('weekly')).toBe('weekly');
    expect(LongNightKindSchema.parse('christmas-eve')).toBe('christmas-eve');
    expect(LongNightKindSchema.safeParse('').success).toBe(false);
    expect(LongNightKindSchema.safeParse('Not An Id').success).toBe(false);
    const longNight = HollowStatusSchema.shape.longNight.unwrap();
    const night = { weekday: 5, tonight: false, nextAt: at, gap: null };
    expect(longNight.parse(night)).not.toHaveProperty('kind');
    expect(longNight.parse({ ...night, kind: 'weekly' }).kind).toBe('weekly');
    expect(longNight.parse({ ...night, kind: 'christmas-eve' }).kind).toBe('christmas-eve');
  });
});

describe('new kinds', () => {
  it('adds the advent and present-opening ledger reasons', () => {
    expect(ItemChangeReasonSchema.parse('advent')).toBe('advent');
    expect(ItemChangeReasonSchema.parse('present-open')).toBe('present-open');
  });

  it('adds the two Christmas nudges, with words, a TTL and a priority', () => {
    for (const kind of ['present', 'christmas-eve'] as const) {
      expect(PushKindSchema.parse(kind)).toBe(kind);
      expect(PUSH_TEXT[kind].title.length).toBeGreaterThan(0);
      expect(PUSH_RULES.ttlSeconds[kind]).toBeGreaterThan(0);
      expect(PUSH_RULES.priority).toContain(kind);
    }
    expect(checkPushRules(PUSH_RULES)).toEqual([]);
    expect(checkPushText(PUSH_TEXT)).toEqual([]);
    // The switch is server-side until its Settings row lands (no client field yet).
    expect(Object.keys(PushSettingsSchema.shape)).not.toContain('christmas');
  });

  it("parses a 'lights' building and checks its fields", () => {
    expect(BuildingKindSchema.parse('lights')).toBe('lights');
    // The Twinkle Lights the lights lane (2a) adds to BUILDINGS with its model.
    const lights = {
      id: 'twinkle-lights',
      kind: 'lights',
      name: 'Twinkle Lights',
      description: 'Twinkly bulbs for your land. So cozy on a snowy night!',
      season: 'christmas',
      placement: 'owned',
      maxPerHome: 12,
      maxPerTile: 1,
      slot: 'ring',
      glowNights: ['12-24', '12-25'],
      safeRadius: 0,
      levels: [{ cost: { timber: 6, glimmer: 2 } }],
    };
    expect(BuildingSchema.parse(lights)).toEqual(lights);
    // Lane 2a: in the data and buildable. The kind id must be `lights`, or the
    // Christmas Eve head start (X2 counts `buildings.kind = 'lights'`) stays 0.
    const twinkle = BUILDINGS.find((b) => b.id === 'twinkle-lights');
    expect(twinkle?.kind).toBe('lights');
    expect(BUILDINGS.filter((b) => b.kind === 'lights').map((b) => b.id)).toEqual([
      'twinkle-lights',
    ]);
    expect((HOME_BASE_RULES.buildableKinds as readonly string[]).includes('lights')).toBe(true);
    if (twinkle?.kind !== 'lights') throw new Error('no Twinkle Lights');
    expect(twinkle.season).toBe('christmas');
    expect(twinkle.placement).toBe('owned');
    expect(twinkle.glowNights).toEqual(['12-24', '12-25']);
    expect(twinkle.safeRadius).toBe(0);
    expect(twinkle.maxPerTile).toBe(1);
    expect(twinkle.maxPerHome).toBeGreaterThan(0);
    // Timber plus Glimmer, no fuel.
    expect(Object.keys(twinkle.levels[0]?.cost ?? {}).sort()).toEqual(['glimmer', 'timber']);
    expect(isBuildable(HOME_BASE_RULES, twinkle)).toBe(true);
    // A Clockwork beacon (#874) is the same kind with a wider reach.
    const beacon = { ...lights, id: 'clockwork-beacon', safeRadius: 2 };
    expect(LightsBuildingSchema.parse(beacon)).toEqual(beacon);
    for (const bad of [
      { ...lights, safeRadius: 3 },
      { ...lights, glowNights: [] },
      { ...lights, glowNights: ['12-24', '12-24'] },
      { ...lights, glowNights: ['12-32'] },
      { ...lights, fuelPerNight: 1 },
    ]) {
      expect(BuildingSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('brings Presents and Fireworks back: tradable, valued', () => {
    for (const id of ['presents', 'fireworks']) {
      expect(RETIRED_RESOURCES).not.toContain(id);
      expect(RESOURCES.find((r) => r.id === id)?.tradable).not.toBe(false);
      expect(TRADE_VALUES.items[id]).toBeGreaterThan(0);
    }
  });
});

describe('Christmas game events', () => {
  it('registers advent, present and tree events, keeping ids internal', () => {
    const cases = [
      [
        'advent.claimed',
        { userId: userA, claimId: rowId, day: '2026-12-03', catchUp: false, items: { pies: 2 } },
        { userId: userA, day: '2026-12-03', catchUp: false, items: { pies: 2 } },
      ],
      [
        'present.opened',
        { userId: userA, openingId: rowId, items: { treats: 3 } },
        { userId: userA, items: { treats: 3 } },
      ],
      [
        'tree.decorated',
        {
          offerId: rowId,
          postTileId: tileId,
          postIndex: 1,
          fromUserId: userA,
          toUserId: userB,
          source: 'present-gift',
          added: 2,
          ornaments: 12,
          starLit: true,
        },
        {
          postIndex: 1,
          fromUserId: userA,
          toUserId: userB,
          source: 'present-gift',
          added: 2,
          ornaments: 12,
          starLit: true,
        },
      ],
    ] as const;
    for (const [type, internal, shown] of cases) {
      expect(parseGameEventPayload(type, internal), type).toEqual(internal);
      expect(GAME_EVENTS[type].public.parse(internal), type).toEqual(shown);
      expect(() => parseGameEventPayload(type, { ...internal, extra: 1 }), type).toThrow();
    }
    expect(() =>
      parseGameEventPayload('advent.claimed', { ...cases[0][1], day: '2026-12-26' }),
    ).toThrow();
  });

  it('adds an optional season to longnight.resolved', () => {
    const resolved = {
      night: '2026-12-24',
      held: true,
      heldBy: [userA],
      keeperOfNight: userA,
      outcomes: [],
    };
    expect(parseGameEventPayload('longnight.resolved', resolved)).toEqual(resolved);
    const dated = { ...resolved, season: 'christmas' };
    expect(parseGameEventPayload('longnight.resolved', dated)).toEqual(dated);
    expect(GAME_EVENTS['longnight.resolved'].public.parse(dated)).toEqual({
      night: '2026-12-24',
      held: true,
      heldBy: [userA],
      keeperOfNight: userA,
      season: 'christmas',
    });
  });
});

describe('battle content hash (pinned on purpose, #37 C0)', () => {
  // C0 changes resources (no `battleEffect`), buildings and push, none of
  // which the battle content projects. If either hash moves, a C0 change
  // reached a projected field: stop and look (every stored battle replays
  // against its hash). Re-pin only in a PR that means to change content.
  it('is unchanged by the Christmas contracts', () => {
    expect(createBattleContent(GAME_DATA).contentHash).toBe('28aea29116d27d7b660e7e4849f3caf2');
    expect(createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA)).contentHash).toBe(
      // Re-pinned on purpose by #37 X3: Snowbundle and Bundlebit, their four
      // moves and the evolution row are new server battle content (was
      // 73742c3adf689cad4491470975ac3536).
      'e6506a67040d6ebd093bbe2f02e1b5da',
    );
  });
});
