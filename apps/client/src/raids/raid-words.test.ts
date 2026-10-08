import { findAvoidedWords, RaidOutcomeSchema, type Raid } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  RAID_TEXT,
  raidFencesLine,
  raidFireLine,
  raidLine,
  raidStyleLine,
  STANCES,
  stanceName,
} from './raid-words.js';

const raid = (over: Partial<Raid> = {}): Raid => ({
  id: '0190a000-0000-7000-8000-000000000001',
  battleId: '0190a000-0000-7000-8000-000000000002',
  attackerUserId: '0190a000-0000-7000-8000-000000000003',
  attackerName: 'Pumpkinpal',
  q: 1,
  r: -2,
  outcome: 'held',
  reason: 'tuckered-out',
  stance: 'balanced',
  resolvedAt: '2026-10-02T18:00:00.000Z',
  seenAt: null,
  replayable: true,
  lostFire: null,
  ...over,
});

describe('fences in the report (#203)', () => {
  it('says the fence held, with its energy, or that it was broken', () => {
    const held = raid({
      fence: { buildingId: 'hedge', broken: false, percent: 60 },
      reason: 'turn-limit',
    });
    expect(raidLine(held)).toBe(
      '🔨 Your Hedge kept Pumpkinpal out! It’s at 60%. Repair it from the land’s Fences.',
    );
    const stopped = raid({
      fence: { buildingId: 'hedge', broken: false, percent: 90 },
      reason: 'forfeit',
    });
    expect(raidLine(stopped)).toBe('🔨 Pumpkinpal came by, then stopped. Your Hedge is at 90%.');
    const broke = raid({
      outcome: 'lost',
      fence: { buildingId: 'ice-wall', broken: true, percent: 0 },
    });
    expect(raidLine(broke)).toContain('broke your Ice Wall');
    for (const r of [held, stopped, broke]) expect(findAvoidedWords(raidLine(r))).toEqual([]);
  });

  it('says fences were lost with the land, only when some were', () => {
    expect(raidFencesLine(raid())).toBeNull();
    expect(raidFencesLine(raid({ outcome: 'taken', lostFences: 1 }))).toBe(
      'Your fence there was lost when the land changed hands. 🪵',
    );
    const line = raidFencesLine(raid({ outcome: 'taken', lostFences: 3 }));
    expect(line).toBe('Your 3 fences there were lost when the land changed hands. 🪵');
    expect(findAvoidedWords(line ?? '')).toEqual([]);
  });
});

describe('a fire lost with the land (#202)', () => {
  it('says so kindly, only when there was a fire there', () => {
    expect(raidFireLine(raid())).toBeNull();
    const line = raidFireLine(raid({ outcome: 'taken', lostFire: { timber: 2 } }));
    expect(line).toBe(
      'Your fire there went out when the land changed hands. You got some things back 🔥',
    );
    expect(findAvoidedWords(line!)).toEqual([]);
  });
});

describe('raid words', () => {
  it('titles the sheet "Challenge report", so it never reads like the Hollow’s morning report', () => {
    expect(RAID_TEXT.title).toBe('Challenge report');
  });

  it('calls the player’s tiles their land, never their patch (style guide §9)', () => {
    expect(RAID_TEXT.challenged).toBe('Someone challenged your land!');
    for (const text of [RAID_TEXT.news, RAID_TEXT.challenged, RAID_TEXT.quiet]) {
      expect(text).not.toMatch(/patch|raid/i);
    }
  });

  it('names the three styles with the style guide words', () => {
    expect(STANCES.map((s) => s.name)).toEqual(['Bold', 'Balanced', 'Careful']);
    expect(stanceName('aggressive')).toBe('Bold');
    expect(stanceName('defensive')).toBe('Careful');
  });

  it('says who came by and how it went, gently', () => {
    expect(raidLine(raid())).toBe('Pumpkinpal tried to visit your land. Your squishies held on!');
    expect(raidLine(raid({ stance: null }))).toMatch(/guardians held on/);
    expect(raidLine(raid({ reason: 'forfeit' }))).toMatch(/scooted home/);
    expect(raidLine(raid({ outcome: 'taken' }))).toMatch(/Everyone came home safe/);
    expect(raidStyleLine(raid({ stance: 'aggressive' }))).toBe('Style: Bold');
    expect(raidStyleLine(raid({ stance: null }))).toBeNull();
  });

  it('never uses an avoided word, whatever happened', () => {
    const lines = RaidOutcomeSchema.options.flatMap((outcome) =>
      [null, 'balanced' as const].flatMap((stance) =>
        (['tuckered-out', 'forfeit'] as const).map((reason) =>
          raidLine(raid({ outcome, stance, reason })),
        ),
      ),
    );
    const all = [
      ...lines,
      ...Object.values(RAID_TEXT).map((t) => (typeof t === 'string' ? t : t('Bold'))),
      ...STANCES.flatMap((s) => [s.name, s.hint]),
    ];
    for (const line of all) expect(findAvoidedWords(line), line).toEqual([]);
  });
});
