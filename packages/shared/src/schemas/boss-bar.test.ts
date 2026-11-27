import { describe, expect, it } from 'vitest';
import { createBattleContent } from '../battle/content.js';
import { GAME_DATA } from '../data/index.js';
import { PUSH_RULES, PUSH_TEXT } from '../data/push.js';
import { serverBattleData } from '../data/server/battle-data.js';
import { BOSS_EVENTS } from '../data/server/boss-events.js';
import { SECRET_SPECIES, SERVER_GAME_DATA } from '../data/server/index.js';
import { QUIET_NIGHTS } from '../data/server/long-night.js';
import { PlayerBattleBossSchema } from './battle.js';
import {
  BossBarChipRowSchema,
  BossBarRowSchema,
  BossBarStateSchema,
  BossPatchBarSchema,
  BossThanksKindSchema,
  BossVisitEventSchema,
  BossWindowKindSchema,
} from './boss-bar.js';
import { BossVisitSchema } from './boss.js';
import { MapViewChristmasEveSchema, MapViewChristmasSchema } from './christmas.js';
import { checkBossEventRules } from './data/boss-events.js';
import { MonthDaySchema } from './data/seasons.js';
import { GAME_EVENTS, parseGameEventPayload } from './events.js';
import { ItemChangeReasonSchema } from './inventory.js';
import { PushKindSchema } from './push.js';

// The Christmas Eve shared contracts (#37 C0b): every new field and kind
// parses, older payloads still parse, bad ones are refused, and nothing
// projected changes.

const userId = '0190a8c4-0000-7000-8000-000000000002';
const mapId = '0190a8c4-0000-7000-8000-000000000001';
const battleId = '0190a8c4-0000-7000-8000-000000000005';
const OPENS = '2026-12-24T16:00:00.000Z';
const CLOSES = '2026-12-25T10:00:00.000Z';

describe('Christmas Eve kinds and states', () => {
  it('adds the visit kind, bar states and thanks kinds, and the ledger reason', () => {
    expect(BossWindowKindSchema.options).toEqual(['weekly', 'christmas-eve']);
    expect(BossBarStateSchema.options).toEqual(['open', 'fell', 'dozed']);
    expect(BossThanksKindSchema.options).toEqual(['fell', 'dozed']);
    expect(ItemChangeReasonSchema.parse('christmas-boss')).toBe('christmas-boss');
    expect(() => BossWindowKindSchema.parse('easter')).toThrow();
    expect(() => BossBarStateSchema.parse('won')).toThrow();
  });
});

describe('the patch bar a Keeper sees', () => {
  it('round-trips open, fell and dozed, and fights after the fall', () => {
    for (const bar of [
      { goal: 360, chipped: 0, state: 'open' },
      { goal: 360, chipped: 360, state: 'fell' },
      { goal: 360, chipped: 420, state: 'fell' },
      { goal: 360, chipped: 359, state: 'dozed' },
    ] as const) {
      expect(BossPatchBarSchema.parse(bar)).toEqual(bar);
    }
  });

  it('refuses a short fall, a full doze, a zero goal and negatives', () => {
    for (const bar of [
      { goal: 360, chipped: 359, state: 'fell' },
      { goal: 360, chipped: 360, state: 'dozed' },
      { goal: 0, chipped: 0, state: 'open' },
      { goal: 360, chipped: -1, state: 'open' },
      { goal: 360, chipped: 1.5, state: 'open' },
    ]) {
      expect(() => BossPatchBarSchema.parse(bar), JSON.stringify(bar)).toThrow();
    }
  });

  it('adds an optional patchBar to a boss fight, and never who chipped', () => {
    const boss = {
      eventWindow: { id: '2026-12-21', endsAt: CLOSES },
      triesLeftToday: 2,
      charmsPerAsk: 3,
      asksLeft: 0,
      befriend: 'none',
      baseName: 'Snowdrift',
      warmth: 0,
    };
    // An older payload, or a weekly fight, has none.
    const weekly = PlayerBattleBossSchema.parse(boss);
    expect(weekly).toEqual(boss);
    expect(weekly.patchBar).toBeUndefined();
    const withBar = { ...boss, patchBar: { goal: 360, chipped: 138, state: 'open' } };
    expect(PlayerBattleBossSchema.parse(withBar)).toEqual(withBar);
    // The client view strips anything else (z.object), so a chipper list can't ride along.
    const leaky = { ...withBar, patchBar: { ...withBar.patchBar, chippers: [userId] } };
    expect(JSON.stringify(PlayerBattleBossSchema.parse(leaky))).not.toContain(userId);
    expect(() =>
      PlayerBattleBossSchema.parse({ ...boss, patchBar: { goal: 360, state: 'open' } }),
    ).toThrow();
  });
});

describe('the visit and the map', () => {
  const visit = {
    window: { id: '2026-12-21', endsAt: CLOSES },
    tile: { q: 2, r: -1 },
    species: null,
    state: 'here',
    triesLeftToday: 3,
  } as const;

  it('adds an optional Christmas Eve event to the visit; a weekly visit has none', () => {
    expect(BossVisitSchema.parse(visit)).toEqual(visit);
    const eve = {
      ...visit,
      event: { kind: 'christmas-eve', gatesLowered: true, closesAt: CLOSES },
    } as const;
    expect(BossVisitSchema.parse(eve)).toEqual(eve);
    expect(BossVisitEventSchema.parse(eve.event)).toEqual(eve.event);
    for (const event of [
      { kind: 'weekly', gatesLowered: true, closesAt: CLOSES },
      { kind: 'christmas-eve', gatesLowered: false, closesAt: CLOSES },
      { kind: 'christmas-eve', gatesLowered: true },
      { kind: 'christmas-eve', gatesLowered: true, closesAt: 'tomorrow' },
    ]) {
      expect(() => BossVisitSchema.parse({ ...visit, event }), JSON.stringify(event)).toThrow();
    }
  });

  it('adds an optional eve to MapView.christmas: a notice, then the whole bar', () => {
    const christmas = { presentWaiting: false };
    expect(MapViewChristmasSchema.parse(christmas)).toEqual(christmas);
    const notice = { ...christmas, eve: { opensAt: OPENS } };
    expect(MapViewChristmasSchema.parse(notice)).toEqual(notice);
    for (const bar of [
      { state: 'open', chipped: 46, goal: 360 },
      { state: 'fell', chipped: 362, goal: 360 },
      { state: 'dozed', chipped: 200, goal: 360 },
    ]) {
      const eve = { opensAt: OPENS, ...bar };
      expect(MapViewChristmasEveSchema.parse(eve)).toEqual(eve);
    }
    for (const eve of [
      {},
      { opensAt: 'Christmas Eve' },
      // The bar comes whole or not at all.
      { opensAt: OPENS, state: 'open' },
      { opensAt: OPENS, chipped: 4, goal: 360 },
      { opensAt: OPENS, state: 'open', chipped: 4 },
      { opensAt: OPENS, state: 'fell', chipped: 4, goal: 360 },
      { opensAt: OPENS, state: 'dozed', chipped: 360, goal: 360 },
      { opensAt: OPENS, state: 'open', chipped: 0, goal: 0 },
    ]) {
      expect(() => MapViewChristmasEveSchema.parse(eve), JSON.stringify(eve)).toThrow();
    }
  });
});

describe('server-only rows', () => {
  const bar = {
    mapId,
    windowId: '2026-12-21',
    goal: 360,
    chipped: 46,
    state: 'open',
    headStart: 46,
    headStartLights: 3,
    headStartStar: true,
    opensAt: OPENS,
    closesAt: CLOSES,
    fellAt: null,
  } as const;

  it('round-trips a bar and a chip', () => {
    expect(BossBarRowSchema.parse(bar)).toEqual(bar);
    const fell = { ...bar, state: 'fell', chipped: 362, fellAt: '2026-12-24T19:30:00.000Z' };
    expect(BossBarRowSchema.parse(fell)).toEqual(fell);
    const chip = {
      id: '0190a8c4-0000-7000-8000-0000000000c1',
      mapId,
      windowId: '2026-12-21',
      userId,
      battleId,
      points: 0,
      createdAt: OPENS,
    };
    expect(BossBarChipRowSchema.parse(chip)).toEqual(chip);
    expect(() => BossBarChipRowSchema.parse({ ...chip, points: -1 })).toThrow();
    expect(() => BossBarChipRowSchema.parse({ ...chip, extra: 1 })).toThrow();
  });

  it('mirrors the migration CHECKs', () => {
    for (const row of [
      { ...bar, closesAt: OPENS },
      { ...bar, chipped: 10 },
      { ...bar, state: 'fell', chipped: 362 },
      { ...bar, state: 'fell', fellAt: CLOSES },
      { ...bar, fellAt: CLOSES },
      { ...bar, state: 'dozed', chipped: 360 },
      { ...bar, goal: 0 },
      { ...bar, extra: 1 },
    ]) {
      expect(() => BossBarRowSchema.parse(row), JSON.stringify(row)).toThrow();
    }
  });
});

describe('Christmas Eve events', () => {
  it('round-trips each, and refuses extras and bad values', () => {
    const cases = [
      [
        'boss.chipped',
        { window: '2026-12-21', userId, battleId, points: 38, chipped: 138, goal: 360 },
        { window: '2026-12-21', chipped: 138, goal: 360 },
      ],
      [
        'boss.fell',
        { window: '2026-12-21', fellAt: '2026-12-24T19:30:00.000Z', chipped: 362, goal: 360 },
        { window: '2026-12-21', fellAt: '2026-12-24T19:30:00.000Z', chipped: 362, goal: 360 },
      ],
      [
        'boss.thanked',
        {
          window: '2026-12-21',
          userId,
          kind: 'fell',
          items: { 'heart-charm': 6, heartdust: 10 },
          asks: 2,
        },
        {
          window: '2026-12-21',
          userId,
          kind: 'fell',
          items: { 'heart-charm': 6, heartdust: 10 },
          asks: 2,
        },
      ],
    ] as const;
    for (const [type, internal, shown] of cases) {
      expect(parseGameEventPayload(type, internal), type).toEqual(internal);
      expect(() => parseGameEventPayload(type, { ...internal, extra: 1 }), type).toThrow();
      // The registry's public cut. `boss.chipped`'s per-recipient view (points
      // for the chipper only) is the server's `PUBLIC_VIEWS`, tested there.
      const cut = GAME_EVENTS[type].public.parse(internal);
      if (type === 'boss.chipped') {
        expect(cut).toEqual({ ...shown, points: 38 });
        expect(JSON.stringify(cut)).not.toContain(userId);
        expect(JSON.stringify(cut)).not.toContain(battleId);
      } else {
        expect(cut, type).toEqual(shown);
      }
    }
    const thanked = cases[2][1];
    // A dozed-off thanks has no asks (owner answer 4) and always holds something.
    const dozed = { ...thanked, kind: 'dozed', items: { treats: 3 }, asks: 0 };
    expect(parseGameEventPayload('boss.thanked', dozed)).toEqual(dozed);
    expect(() => parseGameEventPayload('boss.thanked', { ...dozed, asks: 1 })).toThrow();
    expect(() => parseGameEventPayload('boss.thanked', { ...thanked, items: {} })).toThrow();
    expect(() => parseGameEventPayload('boss.chipped', { ...cases[0][1], points: -1 })).toThrow();
    expect(() => parseGameEventPayload('boss.fell', { ...cases[1][1], goal: 0 })).toThrow();
  });
});

describe('Christmas Eve rules (server-only data)', () => {
  const species = new Set(SECRET_SPECIES.filter((s) => s.line === 'boss').map((s) => s.id));
  const terrains = new Set(GAME_DATA.terrains.map((t) => t.id));
  const items = new Set(GAME_DATA.resources.map((r) => r.id));
  const eve = BOSS_EVENTS.christmasEve!;

  it('ships a Christmas Eve block that checks clean, with no species until X3', () => {
    expect(eve).toBeDefined();
    expect(eve.speciesId).toBeNull();
    expect(eve.day).toBe('12-24');
    expect(checkBossEventRules(BOSS_EVENTS, species, terrains, items)).toEqual([]);
    // Lowered gates (owner answer 3): never above the weekly ones.
    expect(eve.gates.minPlayerLevel).toBeLessThan(BOSS_EVENTS.minPlayerLevel);
    expect(eve.gates.minPartnerLevel).toBeNull();
    expect(eve.gates.minLevel).toBeLessThan(BOSS_EVENTS.minLevel);
    // One finished fight shares the fall (owner answer 2); the fall gets two asks.
    expect(eve.contributorMinFights).toBe(1);
    expect(eve.fallAsks).toBe(2);
    // The fall's bundle pays for its asks.
    expect(eve.fallBundle['heart-charm']).toBe(eve.fallAsks * BOSS_EVENTS.befriend.charmsPerAsk);
  });

  it('refuses raised gates, unknown content and a bar that fills itself', () => {
    const check = (christmasEve: unknown) =>
      checkBossEventRules({ ...BOSS_EVENTS, christmasEve }, species, terrains, items);
    expect(check({ ...eve, gates: { ...eve.gates, minPlayerLevel: 20 } })).toEqual([
      'christmas eve: minPlayerLevel is above the weekly one',
    ]);
    expect(check({ ...eve, gates: { ...eve.gates, minPartnerLevel: 30 } })).toEqual([
      'christmas eve: minPartnerLevel is above the weekly one',
    ]);
    expect(check({ ...eve, gates: { ...eve.gates, minLevel: 30 } })).toEqual([
      'christmas eve: minLevel is above the weekly one',
    ]);
    expect(check({ ...eve, speciesId: 'nobody', terrains: ['nowhere'] })).toEqual([
      'christmas eve: unknown species "nobody"',
      'christmas eve: unknown terrain "nowhere"',
    ]);
    expect(check({ ...eve, speciesId: 'papa-brrr' })).toEqual([
      'christmas eve: "papa-brrr" is also in the weekly bag',
    ]);
    expect(check({ ...eve, bar: { ...eve.bar, minGoal: 2000 } })).toEqual([
      'christmas eve: minGoal is above maxGoal',
    ]);
    expect(
      check({
        ...eve,
        bar: { ...eve.bar, headStartLightsMaxPercent: 90, headStartStarPercent: 10 },
      }),
    ).toEqual(['christmas eve: the head start fills the bar by itself']);
    expect(check({ ...eve, fallAsks: 5 })).toEqual([
      'christmas eve: more fall asks than a win gets',
    ]);
    expect(check({ ...eve, dozedBundle: {}, fallBundle: { nothing: 1 } })).toEqual([
      'christmas eve fall bundle: unknown item "nothing"',
      'christmas eve: the dozed bundle is empty',
    ]);
    expect(check({ ...eve, day: '12-32' }).length).toBeGreaterThan(0);
    expect(check({ ...eve, extra: 1 }).length).toBeGreaterThan(0);
    // Without the block: no Christmas visit, and the weekly rules still check.
    const weekly = { ...BOSS_EVENTS, christmasEve: undefined };
    expect(checkBossEventRules(weekly, species, terrains, items)).toEqual([]);
  });

  it('keeps Christmas Eve quiet of the Long Night', () => {
    expect(QUIET_NIGHTS).toEqual(['12-24']);
    for (const day of QUIET_NIGHTS) expect(MonthDaySchema.parse(day)).toBe(day);
    expect(QUIET_NIGHTS).toContain(eve.day);
  });
});

describe('the Christmas Eve push needs nothing more (#37 C0b)', () => {
  it('has its kind, words, priority and time to live from C0', () => {
    expect(PushKindSchema.options).toContain('christmas-eve');
    expect(PUSH_TEXT['christmas-eve'].title).toBeTruthy();
    expect(PUSH_RULES.priority).toContain('christmas-eve');
    expect(PUSH_RULES.ttlSeconds['christmas-eve']).toBeGreaterThan(0);
  });
});

describe('battle content hash (pinned on purpose, #37 C0b)', () => {
  // C0b adds schemas, rows, events and BOSS_EVENTS data, none of which the
  // battle content projects (BOSS_EVENTS isn't in SERVER_GAME_DATA). If
  // either hash moves, a C0b change reached a projected field: stop and look
  // (every stored battle replays against its hash). Re-pin only in a PR that
  // means to change content (X3).
  it('is unchanged by the Christmas Eve contracts', () => {
    expect(createBattleContent(GAME_DATA).contentHash).toBe('28aea29116d27d7b660e7e4849f3caf2');
    expect(createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA)).contentHash).toBe(
      '73742c3adf689cad4491470975ac3536',
    );
  });
});
