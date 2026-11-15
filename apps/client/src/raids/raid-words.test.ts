import { findAvoidedWords, RaidOutcomeSchema, type Raid } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  RAID_TEXT,
  raidByComputer,
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

describe('a building lost with the land (#202, #295)', () => {
  it('says so kindly, only when there was a building there', () => {
    expect(raidFireLine(raid())).toBeNull();
    const line = raidFireLine(raid({ outcome: 'taken', lostFire: { timber: 2 } }));
    expect(line).toBe(
      'Your building there came down when the land changed hands. You got some things back 🏡',
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

describe('a challenge I defended live (#29-C)', () => {
  it('says so for every outcome, proudly and kindly', () => {
    for (const outcome of RaidOutcomeSchema.options) {
      const line = raidLine(raid({ outcome, live: true, stance: null }));
      expect(line).toMatch(/defend/i);
      expect(findAvoidedWords(line)).toEqual([]);
    }
    expect(raidLine(raid({ live: true, stance: null }))).toBe(
      '🛡️ You defended live and kept Pumpkinpal out. Your land is safe!',
    );
    expect(raidLine(raid({ live: true, stance: null, reason: 'forfeit' }))).toMatch(/scooted home/);
  });

  it('shows "Defended live" where the style would go, and guardians still say nothing', () => {
    expect(raidStyleLine(raid({ live: true, stance: null }))).toBe(RAID_TEXT.defendedLive);
    expect(raidStyleLine(raid({ live: false, stance: null }))).toBeNull();
    expect(raidStyleLine(raid({ stance: 'aggressive' }))).toBe('Style: Bold');
  });
});

describe('what a hold paid (#728)', () => {
  const earned = { xp: 12, patch: 3, heart: 3 };

  it('says the XP and the coins a hold earned', () => {
    expect(raidLine(raid({ earned }))).toBe(
      'Pumpkinpal tried to visit your land. Your squishies held on and earned 12 XP! You got 3\u00a0Patch\u00a0Coins and 💛\u00a03.',
    );
    // A daily cap kept the coins: just the XP, never "You got 0".
    expect(raidLine(raid({ earned: { xp: 12, patch: 0, heart: 0 } }))).toBe(
      'Pumpkinpal tried to visit your land. Your squishies held on and earned 12 XP!',
    );
    // A scoot pays XP, never coins.
    expect(raidLine(raid({ reason: 'forfeit', earned: { xp: 5, patch: 0, heart: 0 } }))).toBe(
      'Pumpkinpal came to visit, then scooted home. Your land is safe! Your squishies earned 5 XP!',
    );
  });

  it('says what a live hold earned too', () => {
    expect(raidLine(raid({ live: true, stance: null, earned }))).toBe(
      '🛡️ You defended live and kept Pumpkinpal out. Your land is safe! Your squishies earned 12 XP! You got 3\u00a0Patch\u00a0Coins and 💛\u00a03.',
    );
    // Played with the guardians: coins, no XP.
    expect(
      raidLine(raid({ live: true, stance: null, earned: { xp: 0, patch: 3, heart: 3 } })),
    ).toBe(
      '🛡️ You defended live and kept Pumpkinpal out. Your land is safe! You got 3\u00a0Patch\u00a0Coins and 💛\u00a03.',
    );
  });

  it('nudges toward the guard job once when the guardians held alone', () => {
    expect(raidLine(raid({ stance: null, earned: null }))).toBe(
      'Pumpkinpal tried to visit your land. The land’s guardians held on! Put a squishy on watch to earn from holds!',
    );
    // Only on a hold.
    expect(raidLine(raid({ stance: null, outcome: 'lost' }))).not.toMatch(/on watch/);
  });

  it('keeps an old row’s words', () => {
    expect(raidLine(raid({ earned: undefined }))).toBe(
      'Pumpkinpal tried to visit your land. Your squishies held on!',
    );
    expect(raidLine(raid({ earned: null }))).toBe(
      'Pumpkinpal tried to visit your land. Your squishies held on!',
    );
    expect(raidLine(raid({ live: true, stance: null, earned: null }))).toBe(
      '🛡️ You defended live and kept Pumpkinpal out. Your land is safe!',
    );
  });

  it('never uses an avoided word', () => {
    for (const line of [
      raidLine(raid({ earned })),
      raidLine(raid({ live: true, earned })),
      raidLine(raid({ stance: null })),
    ]) {
      expect(findAvoidedWords(line), line).toEqual([]);
    }
  });
});

describe('a Computer friend challenger (#386f)', () => {
  const base = {
    attackerName: 'Marigold',
    outcome: 'held' as const,
    reason: 'ko' as never,
    stance: 'balanced' as const,
  };
  it('names it honestly in the words', () => {
    expect(raidLine(base, true)).toContain('Marigold (Computer friend)');
    expect(raidLine(base)).not.toContain('Computer friend');
  });
});

describe('a departed Computer friend (#386)', () => {
  const base = {
    attackerUserId: '00000000-0000-4000-8000-000000000001',
    attackerName: 'Bramble',
    outcome: 'held' as const,
    reason: 'ko' as never,
    stance: 'balanced' as const,
  };
  const notAMember = () => false;
  it("trusts the server's flag even after the mate has left the patch", () => {
    const raid = { ...base, attackerComputer: true };
    expect(raidByComputer(raid, notAMember)).toBe(true);
    expect(raidLine(raid, raidByComputer(raid, notAMember))).toContain('Bramble (Computer friend)');
  });
  it('a false flag wins over the member list', () => {
    expect(raidByComputer({ ...base, attackerComputer: false }, () => true)).toBe(false);
  });
  it('falls back to the member list for older raids', () => {
    expect(raidByComputer(base, () => true)).toBe(true);
    expect(raidByComputer(base, notAMember)).toBe(false);
    expect(raidByComputer(base)).toBe(false);
  });
});
