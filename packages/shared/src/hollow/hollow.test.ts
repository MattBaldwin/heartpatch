import { describe, expect, it } from 'vitest';
import { HOLLOW_RULES } from '../data/hollow.js';
import { HOME_BASE_RULES } from '../data/home-base.js';
import { RESCUE_GUARDIANS } from '../data/server/rescue-guardians.js';
import { SECRET_SPECIES } from '../data/server/secret-species.js';
import { GAME_DATA } from '../data/index.js';
import { BATTLE_RULES } from '../data/battle.js';
import { hexKey, hexSpiral, type Hex, type HexKey } from '../hex/index.js';
import { checkHollowRules, checkRescueGuardianRules } from '../schemas/data/hollow.js';
import type { Species } from '../schemas/data/species.js';
import {
  firstHollowNight,
  heartSeedOf,
  isLocalBefore,
  isNightAt,
  lastNightOf,
  minutesUntilNightChange,
  nightfall,
  mayTakeFrom,
  pickTaken,
  rescueReward,
  shelterOf,
  type NightSquishy,
} from './index.js';
import { resolveRescueGuardians } from './rescue-guardians.js';

const RULES = { ...HOME_BASE_RULES, ...HOLLOW_RULES };
const A = 'user-a';
const B = 'user-b';

describe('hollow rules data', () => {
  it('accepts the shipped rules', () => {
    expect(checkHollowRules(HOLLOW_RULES)).toEqual([]);
    expect(checkRescueGuardianRules(RESCUE_GUARDIANS)).toEqual([]);
  });

  it('refuses muddled rules', () => {
    expect(checkHollowRules({ ...HOLLOW_RULES, morningMinute: 1440 })).not.toEqual([]);
    expect(
      checkRescueGuardianRules({ ...RESCUE_GUARDIANS, levels: { min: 5, max: 2 } }).join(),
    ).toMatch(/min must not be more than max/);
  });

  it('only uses species the game knows, in a team that fits a battle side', () => {
    const species = new Set([...GAME_DATA.species, ...SECRET_SPECIES].map((s) => s.id));
    for (const entry of RESCUE_GUARDIANS.entries) expect(species).toContain(entry.species);
    expect(RESCUE_GUARDIANS.count).toBeLessThanOrEqual(BATTLE_RULES.teamSize);
  });
});

describe('night times', () => {
  it('names the night by the date its nightfall fell on', () => {
    expect(lastNightOf({ date: '2026-10-31', minute: 21 * 60 }, RULES)).toBe('2026-10-31');
    expect(lastNightOf({ date: '2026-10-31', minute: 21 * 60 - 1 }, RULES)).toBe('2026-10-30');
    expect(lastNightOf({ date: '2026-11-01', minute: 0 }, RULES)).toBe('2026-10-31');
    expect(lastNightOf({ date: '2026-01-01', minute: 60 }, RULES)).toBe('2025-12-31');
  });

  it('orders map-local times', () => {
    expect(
      isLocalBefore({ date: '2026-10-30', minute: 1439 }, { date: '2026-10-31', minute: 0 }),
    ).toBe(true);
    expect(
      isLocalBefore({ date: '2026-10-31', minute: 5 }, { date: '2026-10-31', minute: 5 }),
    ).toBe(false);
  });

  it('is night from nightfall to morning, and says when that changes', () => {
    const at = (minute: number) => ({ date: '2026-10-31', minute });
    expect(isNightAt(at(21 * 60), RULES)).toBe(true);
    expect(isNightAt(at(3 * 60), RULES)).toBe(true);
    expect(isNightAt(at(6 * 60), RULES)).toBe(false);
    expect(isNightAt(at(20 * 60 + 59), RULES)).toBe(false);
    expect(minutesUntilNightChange(at(20 * 60), RULES)).toBe(60);
    expect(minutesUntilNightChange(at(21 * 60), RULES)).toBe(9 * 60);
    expect(minutesUntilNightChange(at(5 * 60 + 59), RULES)).toBe(1);
    expect(minutesUntilNightChange(at(6 * 60), RULES)).toBe(15 * 60);
  });

  it('finds the Heart Seed in the middle of a home base', () => {
    expect(heartSeedOf(hexSpiral({ q: 3, r: -2 }, 1))).toEqual({ q: 3, r: -2 });
    expect(heartSeedOf([])).toBeNull();
    // Not a whole ring: no tile in the middle.
    expect(
      heartSeedOf([
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ]),
    ).toBeNull();
  });
});

/** Every way a squishy can spend the night, on a map where `SAFE` is lit. */
const SAFE_TILE: Hex = { q: 0, r: 0 };
const DARK_TILE: Hex = { q: 5, r: 0 };
const SAFE: ReadonlySet<HexKey> = new Set([hexKey(SAFE_TILE)]);
const PLACES = {
  'safe-bed': { state: 'active', sleepsAt: SAFE_TILE, post: null, shelter: 'safe' },
  'dark-bed': { state: 'active', sleepsAt: DARK_TILE, post: null, shelter: 'exposed' },
  homeless: { state: 'active', sleepsAt: null, post: null, shelter: 'exposed' },
  'on-watch': {
    state: 'active',
    sleepsAt: DARK_TILE,
    post: { tileOwnerUserId: A },
    shelter: 'on-watch',
  },
  // Its post changed hands: it went home, to a dark bed.
  'lost-post': {
    state: 'active',
    sleepsAt: DARK_TILE,
    post: { tileOwnerUserId: B },
    shelter: 'exposed',
  },
  hollowed: { state: 'hollowed', sleepsAt: DARK_TILE, post: null, shelter: 'hollowed' },
} as const;
type Place = keyof typeof PLACES;
const PLACE_NAMES = Object.keys(PLACES) as Place[];

function squishy(id: string, place: Place, owner = A): NightSquishy {
  const { state, sleepsAt, post } = PLACES[place];
  return { id, ownerUserId: owner, state, sleepsAt, post };
}

describe('nightfall', () => {
  it('knows where each squishy spends the night', () => {
    for (const place of PLACE_NAMES) {
      expect(shelterOf(squishy('s', place), SAFE)).toBe(PLACES[place].shelter);
    }
  });

  it('never takes a protected squishy, nor a last friend, and takes at most one per player (every 3-squishy mix)', () => {
    let nights = 0;
    for (const p1 of PLACE_NAMES) {
      for (const p2 of PLACE_NAMES) {
        for (const p3 of PLACE_NAMES) {
          const mine = [squishy('s1', p1), squishy('s2', p2), squishy('s3', p3)];
          const exposed = mine.filter(
            (s) => PLACES[placeOf(s, [p1, p2, p3])].shelter === 'exposed',
          );
          for (let n = 0; n < 8; n++) {
            const [outcome] = nightfall(
              [{ userId: A, squishies: mine }],
              SAFE,
              () => `night-${String(n)}`,
              true,
            );
            nights += 1;
            const active = mine.filter((s) => s.state === 'active').length;
            expect(outcome?.exposed).toBe(exposed.length);
            if (exposed.length === 0 || !mayTakeFrom(active)) expect(outcome?.taken).toBeNull();
            else expect(exposed.map((s) => s.id)).toContain(outcome?.taken);
          }
        }
      }
    }
    expect(nights).toBe(PLACE_NAMES.length ** 3 * 8);
  });

  it('takes nothing where the Hollow Man takes nothing (tutorial maps)', () => {
    const [outcome] = nightfall(
      [{ userId: A, squishies: [squishy('s1', 'dark-bed'), squishy('s2', 'homeless')] }],
      SAFE,
      () => 'seed',
      false,
    );
    expect(outcome).toEqual({ userId: A, taken: null, exposed: 2, sheltered: 0 });
  });

  it('takes nothing from a player in their first-night grace, and still counts the dark', () => {
    const outcomes = nightfall(
      [
        { userId: A, squishies: [squishy('a1', 'dark-bed'), squishy('a2', 'dark-bed')], grace: true },
        { userId: B, squishies: [squishy('b1', 'dark-bed', B), squishy('b2', 'dark-bed', B)] },
      ],
      SAFE,
      (userId) => userId,
      true,
    );
    expect(outcomes[0]).toEqual({ userId: A, taken: null, exposed: 2, sheltered: 0 });
    expect(outcomes[1]).toMatchObject({ userId: B, exposed: 2, sheltered: 0 });
    expect(['b1', 'b2']).toContain(outcomes[1]?.taken);
  });

  it('never takes a player’s last friend, wherever it sleeps (owner decision 2026-10-05)', () => {
    const fall = (mine: NightSquishy[]) =>
      nightfall([{ userId: A, squishies: mine }], SAFE, () => 'seed', true)[0];
    // One friend out in the dark: spared, and the dark still counted.
    expect(fall([squishy('s1', 'dark-bed')])).toEqual({
      userId: A,
      taken: null,
      exposed: 1,
      sheltered: 0,
    });
    // Friends already in the Hollow don't count as company.
    expect(fall([squishy('s1', 'homeless'), squishy('s2', 'hollowed')])?.taken).toBeNull();
    // A second active friend anywhere (even safe at home, or on watch) and he takes one.
    expect(fall([squishy('s1', 'dark-bed'), squishy('s2', 'safe-bed')])?.taken).toBe('s1');
    expect(fall([squishy('s1', 'dark-bed'), squishy('s2', 'on-watch')])?.taken).toBe('s1');
    expect(mayTakeFrom(0)).toBe(false);
    expect(mayTakeFrom(1)).toBe(false);
    expect(mayTakeFrom(2)).toBe(true);
  });

  it('decides each player alone, from their own squishies', () => {
    const outcomes = nightfall(
      [
        { userId: A, squishies: [squishy('a1', 'dark-bed'), squishy('b1', 'dark-bed', B)] },
        {
          userId: B,
          squishies: [
            squishy('b2', 'safe-bed', B),
            squishy('b3', 'on-watch', B),
            squishy('b4', 'safe-bed', B),
          ],
        },
      ],
      SAFE,
      (userId) => userId,
      true,
    );
    expect(outcomes).toEqual([
      // A's only friend is kept (b1 isn't theirs; the Hollow Man never takes a last friend).
      { userId: A, taken: null, exposed: 1, sheltered: 0 },
      // `on-watch` posts are on A's land: B's squishy there went home to a dark bed.
      { userId: B, taken: 'b3', exposed: 1, sheltered: 2 },
    ]);
  });

  it('picks the same squishy for a seed, whatever order they come in', () => {
    const ids = ['c', 'a', 'd', 'b'].map((id) => ({ id }));
    const picked = pickTaken(ids, 'seed');
    expect(pickTaken([...ids].reverse(), 'seed')).toBe(picked);
    expect(pickTaken([], 'seed')).toBeNull();
    // Different nights reach different squishies.
    const seen = new Set(Array.from({ length: 40 }, (_, n) => pickTaken(ids, `n${String(n)}`)));
    expect(seen.size).toBe(4);
  });
});

function placeOf(s: NightSquishy, places: readonly Place[]): Place {
  const place = places[Number(s.id.slice(1)) - 1];
  if (!place) throw new Error('no place');
  return place;
}

describe('rescues', () => {
  it('rewards the first rescues of the day only', () => {
    expect(rescueReward(0, HOLLOW_RULES)).toBe(HOLLOW_RULES.rescue.heartdust);
    expect(rescueReward(HOLLOW_RULES.rescue.rewardsPerDay, HOLLOW_RULES)).toBe(0);
  });

  it('meets the same shadows for a seed, at a level that follows the team', () => {
    const species = new Map<string, Species>(
      [...GAME_DATA.species, ...SECRET_SPECIES].map((s) => [s.id, s]),
    );
    const rules = { ...RESCUE_GUARDIANS, count: 2, levelOffset: -1, levels: { min: 1, max: 10 } };
    const team = resolveRescueGuardians({ seed: 's', strongestLevel: 5 }, rules, species);
    expect(team).toEqual(resolveRescueGuardians({ seed: 's', strongestLevel: 5 }, rules, species));
    expect(team.map((g) => g.id)).toEqual(['shadow-1', 'shadow-2']);
    expect(team.every((g) => g.level === 4)).toBe(true);
    expect(resolveRescueGuardians({ seed: 's', strongestLevel: 1 }, rules, species)[0]?.level).toBe(
      1,
    );
    expect(
      resolveRescueGuardians({ seed: 's', strongestLevel: 50 }, rules, species)[0]?.level,
    ).toBe(10);
    expect(resolveRescueGuardians({ seed: 's', strongestLevel: 5 }, rules, new Map())).toEqual([]);
  });
});

describe('first-night grace (owner decision 2026-10-03)', () => {
  const nine = HOME_BASE_RULES.nightfallMinute;
  it('skips the first graceNights nightfalls after joining', () => {
    expect(HOLLOW_RULES.graceNights).toBe(2);
    // Joined at 8:55 PM: that evening's nightfall is the first grace night.
    expect(firstHollowNight({ date: '2026-10-03', minute: nine - 5 }, RULES)).toBe('2026-10-05');
    // At or after 9 PM, tonight's has fallen: grace starts with tomorrow's.
    expect(firstHollowNight({ date: '2026-10-03', minute: nine }, RULES)).toBe('2026-10-06');
    expect(firstHollowNight({ date: '2026-10-03', minute: 0 }, RULES)).toBe('2026-10-05');
    // Across a month end, and with no grace at all.
    expect(firstHollowNight({ date: '2026-10-31', minute: 23 * 60 }, RULES)).toBe('2026-11-03');
    expect(
      firstHollowNight({ date: '2026-10-03', minute: nine - 5 }, { ...RULES, graceNights: 0 }),
    ).toBe('2026-10-03');
  });

  it('refuses a grace out of range', () => {
    expect(checkHollowRules({ ...HOLLOW_RULES, graceNights: -1 })).not.toEqual([]);
    expect(checkHollowRules({ ...HOLLOW_RULES, graceNights: 1.5 })).not.toEqual([]);
  });
});
