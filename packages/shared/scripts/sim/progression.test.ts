import { describe, expect, it } from 'vitest';
import {
  BASELINE_RULES,
  COLLECTOR_RULES,
  UNCAPPED_BEFRIEND_RULES,
  CURRENT_RULES,
  NO_TRAINING_RULES,
  WITH_EXPLORE_RULES,
  WITH_FRIENDLIES_RULES,
  SHIPPED_FRIENDLY_XP,
  SHIPPED_BENCH_XP,
  BENCH_25_RULES,
  PROGRESSION_CONFIG,
  SOLO_GATE,
  SOLO_MATES_RULES,
  SOLO_RULES,
  type ProgressionConfig,
} from './progression-config.js';
import { GROWTH_RULES } from '../../src/data/care.js';
import { COMPUTER_MATES } from '../../src/data/server/computer-mates.js';
import { JOURNEY_RULES } from '../../src/data/journeys.js';
import {
  formatFriendlyGate,
  formatSoloGate,
  friendlyGate,
  soloGate,
  tierGateLine,
  gapWin,
  journeyGateMisses,
  renderProgression,
  summarise,
} from './progression-report.js';
import {
  firstsFacts,
  formatTierFirsts,
  formatTierGate,
  tierFirstsOf,
  tierGate,
} from './progression-firsts.js';
import {
  befriend,
  grant,
  mateChallenges,
  mateTeam,
  journeyOdds,
  payHold,
  playFriendly,
  modelData,
  rivalTargets,
  runProgression,
  sideB,
  wildOdds,
  type DayRecord,
  type Kid,
} from './progression.js';
import { hexKey, type HexKey } from '../../src/hex/index.js';
import type { MapTile } from '../../src/mapgen/index.js';

/** A short run: the same model, a few days and a small odds estimate. */
const SMALL: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 6, estimateGames: 4 };
const data = modelData();
const [casual, engaged] = PROGRESSION_CONFIG.kids;

describe('runProgression', () => {
  it('gives the same run for the same config and data', () => {
    const run = () => runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    expect(run()).toEqual(run());
  });

  it('never takes a level or a tile away, and shares the land between both kids', () => {
    const run = runProgression(data, SMALL, CURRENT_RULES, engaged!, 2);
    for (const kid of run.kids) {
      kid.days.forEach((day, i) => {
        const before = kid.days[i - 1];
        if (!before) return;
        day.levels.forEach((level, m) => {
          expect(level).toBeGreaterThanOrEqual(before.levels[m]!);
        });
        expect(day.tiles).toBeGreaterThanOrEqual(before.tiles);
      });
    }
    run.kids[0]!.days.forEach((day, i) => {
      const other = run.kids[1]!.days[i]!;
      // Each kid starts with a 7-tile home ring; neutral land is all the rest.
      expect(day.tiles - 7 + (other.tiles - 7) + day.neutralLeft).toBe(run.neutral);
      expect(day.tileBattles).toBeLessThanOrEqual(CURRENT_RULES.attemptsPerDay);
      expect(day.tileBattles + day.wildBattles).toBe(engaged!.battlesPerDay);
    });
  });

  it('uses the attempts each rule set allows', () => {
    const before = runProgression(data, SMALL, BASELINE_RULES, engaged!, 4).kids[0]!.days[0]!;
    const now = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4).kids[0]!.days[0]!;
    expect(before.tileBattles).toBe(BASELINE_RULES.attemptsPerDay);
    expect(now.tileBattles).toBe(CURRENT_RULES.attemptsPerDay);
  });
});

describe('headline numbers (a short run, so data changes show up here)', () => {
  it("pins each kid's Partner level by day under the shipped rules", () => {
    const levels = [casual!, engaged!].map((kid) =>
      runProgression(data, SMALL, CURRENT_RULES, kid, 4).kids[0]!.days.map((d) => d.partnerLevel),
    );
    // Wave 2's kinds (#382) reshuffled the seeded wild fights: the casual kid's days 2 and 3 moved.
    // #730 quartered the XP curve's knees: both kids pull ahead once past Lv 16.
    // #732's bench grows the casual kid's friends, who then win more of the
    // fights the Partner would have lost: its days 2–4 and 6 moved up.
    expect(levels).toEqual([
      [8, 13, 16, 19, 20, 22],
      [14, 20, 23, 26, 28, 31],
    ]);
  });

  it('moves no target by more than a day with Training Grounds (owner decision 2026-10-06)', () => {
    // A 30-day run, as the brief's targets are on days 14 and 30. Gap odds from
    // 8 games: at 4, adding species (#443's kids) reshuffles the seeded fights
    // enough to move Gap-ready by two days either way.
    const month: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 30, estimateGames: 8 };
    for (const kid of [casual!, engaged!]) {
      const now = summarise(runProgression(data, month, CURRENT_RULES, kid, 4), month);
      const without = summarise(runProgression(data, month, NO_TRAINING_RULES, kid, 4), month);
      for (const key of ['evolves', 'bigAndBouncy', 'gapReady'] as const) {
        expect(Math.abs((now[key] ?? 0) - (without[key] ?? 0))).toBeLessThanOrEqual(1);
      }
      // A day's lead is at most a level or so on days 14 and 30.
      for (const day of [14, 30]) {
        expect((now.level[day] ?? 0) - (without.level[day] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
    expect(CURRENT_RULES.training).toEqual({ slots: 3, xpPerDay: 192 });
  }, 30_000); // four 30-day runs: 2.3 s alone, 3.1 s under coverage, 13.8 s with the CPUs oversubscribed (#429)

  it('moves no target by more than a day with exploring (#199, owner decision 2026-10-07 Q6)', () => {
    // Gap odds from 8 games, as above: at 4, #732's bench reshuffled the
    // casual kid's estimate to day 5 without exploring and 7 with (7 / 7 at 8).
    const month: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 30, estimateGames: 8 };
    for (const kid of [casual!, engaged!]) {
      const now = summarise(runProgression(data, month, CURRENT_RULES, kid, 4), month);
      const exploring = summarise(runProgression(data, month, WITH_EXPLORE_RULES, kid, 4), month);
      for (const key of ['evolves', 'bigAndBouncy', 'gapReady'] as const) {
        expect(Math.abs((exploring[key] ?? 0) - (now[key] ?? 0))).toBeLessThanOrEqual(1);
      }
      for (const day of [14, 30]) {
        expect((exploring.level[day] ?? 0) - (now.level[day] ?? 0)).toBeLessThanOrEqual(1);
      }
    }
  }, 30_000); // four 30-day runs, like the case above: the default 5 s starves on CI's CPUs (#784)

  it('keeps befriended squishies below their evolution with the shipped cap', () => {
    const capped = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    const uncapped = runProgression(data, SMALL, UNCAPPED_BEFRIEND_RULES, engaged!, 4);
    // Total, not the top friend: a friend that is a final form keeps its level either way.
    const friends = (r: typeof capped) =>
      r.kids[0]!.days.at(-1)!
        .levels.slice(1)
        .reduce((sum, level) => sum + level, 0);
    expect(friends(capped)).toBeLessThan(friends(uncapped));
  });
});

describe('wildOdds', () => {
  it('gives a win rate for every team and offset, the same each time', () => {
    const odds = wildOdds(data, SMALL, [-2, 1], 4);
    expect(odds).toEqual(wildOdds(data, SMALL, [-2, 1], 4));
    expect(odds).toHaveLength(3);
    for (const row of odds) expect(row.odds.map((o) => o.offset)).toEqual([-2, 1]);
  });
});

describe('journeyOdds (#270)', () => {
  const runs = [casual!, engaged!].map((kid) => runProgression(data, SMALL, CURRENT_RULES, kid, 4));
  const options = { days: [3], distances: [1, 2, 3, 4, 8], games: 40 };

  it('gives the same table each time, with the data’s level and team size', () => {
    const rows = journeyOdds(data, SMALL, runs, JOURNEY_RULES, options);
    expect(rows).toEqual(journeyOdds(data, SMALL, runs, JOURNEY_RULES, options));
    expect(rows.map((r) => r.kid)).toEqual(['casual', 'engaged']);
    expect(rows[0]!.odds.map((o) => [o.distance, o.size, o.level])).toEqual([
      [1, 1, 6],
      [2, 1, 8],
      [3, 2, 10],
      [4, 2, 12],
      [8, 3, 20],
    ]);
  });

  it('passes the sim gate: a casual kid wins at distance ≤ 4 at least 60 % of the time on day 3', () => {
    const rows = journeyOdds(data, SMALL, runs, JOURNEY_RULES, options);
    expect(journeyGateMisses(rows)).toEqual([]);
    // Far posts stay a stretch for a casual kid on day 3 (owner decision 3: uncapped).
    expect(rows[0]!.odds.at(-1)!.percent).toBeLessThan(60);
  });
});

describe('the progression report', () => {
  it('summarises milestones and renders every table', () => {
    const runs = [casual!, engaged!].map((kid) =>
      runProgression(data, SMALL, CURRENT_RULES, kid, 4),
    );
    const summary = summarise(runs[1]!, SMALL);
    expect(summary).toMatchObject({ rules: 'now', seats: 4, kid: 'engaged' });
    expect(summary.evolves).not.toBeNull();
    const report = renderProgression(
      runs,
      { ...SMALL, seats: [4] },
      { seconds: 1, firsts: firstsFacts(data.species) },
    );
    expect(report).toContain('## Milestones by day');
    expect(report).toContain('## now: 4-seat map');
    // #736: the firsts table and its soft gate.
    expect(report).toContain('## Firsts (#736)');
    expect(report).toContain('soft until #730');
    expect(report).toContain('| now | 4 | engaged | day 1 |');
  });

  it('works out what a Gap win pays from the curve', () => {
    // 20 XP × 3 guardians × level 16 × 1.5 for a win.
    expect(gapWin(22, 100, CURRENT_RULES)).toMatchObject({ base: 1440, xp: 1440, levels: 0 });
    expect(gapWin(22, 100, BASELINE_RULES).levels).toBeGreaterThan(1);
  });
});

describe('friendlies and defences (#728)', () => {
  it('fields the other kid as side b, lifted to the watch floor', () => {
    const team = [
      { id: 'partner', speciesId: 'emberbun', level: 10 },
      { id: 'friend-1', speciesId: 'fuzzbolt', level: 15 },
      { id: 'friend-2', speciesId: 'pebblesnooze', level: 3 },
    ];
    const side = sideB(team, PROGRESSION_CONFIG, 2, 13);
    expect(side.squishies.map((s) => [s.id, s.level])).toEqual([
      ['b:partner', 13],
      ['b:friend-1', 15],
    ]);
    expect(sideB(team, PROGRESSION_CONFIG).squishies.map((s) => s.level)).toEqual([10, 15, 3]);
  });

  it("plays the day's friendlies on top of the battles, and none under the shipped rules", () => {
    const run = runProgression(data, SMALL, WITH_FRIENDLIES_RULES, engaged!, 4);
    const perDay = WITH_FRIENDLIES_RULES.friendlies?.perDay['engaged'];
    expect(perDay).toBe(3);
    // The variant reads the shipped knobs (#728b), so the sim pays what the server does.
    expect(WITH_FRIENDLIES_RULES.friendlies).toMatchObject(SHIPPED_FRIENDLY_XP);
    expect(SHIPPED_FRIENDLY_XP).toEqual({
      xpPercent: GROWTH_RULES.battleXpFalloff?.friendlyPercent,
      oneOpponent: GROWTH_RULES.battleXpFalloff?.friendlyOneOpponent,
    });
    for (const kid of run.kids) {
      for (const day of kid.days) {
        expect(day.friendlies).toBe(perDay);
        expect(day.tileBattles + day.wildBattles).toBe(engaged!.battlesPerDay);
      }
    }
    const now = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    for (const day of now.kids.flatMap((k) => k.days)) {
      expect([day.friendlies, day.defences, day.defencesHeld]).toEqual([0, 0, 0]);
    }
    // One opponent's worth at 50 % (#728b): no snowball, the pair's leader
    // stays within a level of the shipped pace (that friendly XP lands at
    // all is the call-site test below).
    const level = (r: typeof run) => Math.max(...r.kids.map((k) => k.days.at(-1)!.partnerLevel));
    expect(level(run)).toBeLessThanOrEqual(level(now) + 1);
  }, 30_000);

  it("picks the other kid's tiles only after the shield, under the loss cap, outside home rings", () => {
    const defences = WITH_FRIENDLIES_RULES.defences!;
    const tile = (q: number, homeSlot: number | null) =>
      ({ q, r: 0, terrain: 'meadow', homeSlot }) as unknown as MapTile;
    const tiles = [tile(0, 1), tile(1, null), tile(2, null), tile(3, null)];
    const owner = new Map<HexKey, number | null>([
      [hexKey(tiles[0]!), 1], // the rival's home ring
      [hexKey(tiles[1]!), 1],
      [hexKey(tiles[2]!), 0],
      [hexKey(tiles[3]!), null],
    ]);
    const open = defences.shieldDays + 1;
    const pick = (day: number, lost: number) =>
      rivalTargets(tiles, owner, 1, day, lost, defences).map((t) => t.q);
    expect(pick(open, 0)).toEqual([1]);
    expect(pick(defences.shieldDays, 0)).toEqual([]);
    expect(pick(open, defences.lossCapPerDay - 1)).toEqual([1]);
    expect(pick(open, defences.lossCapPerDay)).toEqual([]);
  });

  it('counts only a won friendly and every hold toward the falloff', () => {
    const kidOf = (slot: number): Kid => ({
      profile: engaged!,
      slot,
      team: [
        { id: 'partner', speciesId: 'emberbun', level: 12, xp: 0, winsToday: 0 },
        { id: 'friend-1', speciesId: 'pebblesnooze', level: 8, xp: 0, winsToday: 0 },
      ],
      evolved: [],
    });
    const kids = [kidOf(0), kidOf(1)];
    // Side a alternates by day and by battle.
    const first = playFriendly(data, kids, PROGRESSION_CONFIG, WITH_FRIENDLIES_RULES, 1, 0);
    const second = playFriendly(data, kids, PROGRESSION_CONFIG, WITH_FRIENDLIES_RULES, 1, 1);
    const nextDay = playFriendly(data, kids, PROGRESSION_CONFIG, WITH_FRIENDLIES_RULES, 2, 0);
    expect([first.sideA, second.sideA, nextDay.sideA]).toEqual([1, 0, 0]);
    // The Partners lead off, so they join every friendly and are paid each
    // time, but only a won one fills a falloff slot (owner decision 2026-11-15).
    for (const r of [first, second, nextDay]) expect(r.partnerXp.every((xp) => xp > 0)).toBe(true);
    const won = [0, 0];
    for (const r of [first, second, nextDay]) {
      if (r.winner === 'a') won[r.sideA]! += 1;
      else if (r.winner === 'b') won[1 - r.sideA]! += 1;
    }
    expect(kids.map((k) => k.team[0]!.winsToday)).toEqual(won);
    // One slot per decided friendly, never one for each side.
    const decided = [first, second, nextDay].filter((r) => r.winner !== null).length;
    expect(won[0]! + won[1]!).toBe(decided);
    expect(decided).toBeGreaterThan(0);

    // A hold counts as the guards' win and pays them.
    const guard = kidOf(0);
    expect(payHold(data, guard, WITH_FRIENDLIES_RULES, new Map([['partner', 40]]))).toBeGreaterThan(
      0,
    );
    // The guard that never came out sat on the bench (#732): paid, and its slot filled too.
    expect(guard.team.map((m) => m.winsToday)).toEqual([1, 1]);
    expect(guard.team[1]!.xp).toBeGreaterThan(0);

    // A lost wild battle doesn't count, and past `fullWinsPerDay` a battle pays the falloff's share.
    const member = guard.team[0]!;
    const xp = new Map([['partner', 40]]);
    grant(data, guard, WITH_FRIENDLIES_RULES, xp, false);
    expect(member.winsToday).toBe(1);
    member.winsToday = WITH_FRIENDLIES_RULES.growth.battleXpFalloff!.fullWinsPerDay;
    const thinned = grant(data, guard, WITH_FRIENDLIES_RULES, xp, false, { counts: true });
    member.winsToday = 0;
    const full = grant(data, guard, WITH_FRIENDLIES_RULES, xp, false, { counts: true });
    expect(thinned).toBeLessThan(full);
  });

  it('pays holds and keeps to the loss cap when the kids meet', () => {
    // Every try is worth it, so the 2-seat map's land runs out and the kids meet.
    const eager: ProgressionConfig = { ...SMALL, days: 8, tryTileAt: 0 };
    const rules = { ...WITH_FRIENDLIES_RULES, attemptsPerDay: 30 };
    const run = runProgression(data, eager, rules, engaged!, 2);
    const days = run.kids.flatMap((k) => k.days);
    const { shieldDays, lossCapPerDay } = WITH_FRIENDLIES_RULES.defences!;
    expect(days.reduce((n, d) => n + d.defences, 0)).toBeGreaterThan(0);
    expect(days.reduce((n, d) => n + d.tilesLost, 0)).toBeGreaterThan(0);
    for (const d of days) {
      if (d.day <= shieldDays) expect(d.defences).toBe(0);
      expect(d.tilesLost).toBeLessThanOrEqual(lossCapPerDay);
      expect(d.defencesHeld + d.tilesLost).toBeLessThanOrEqual(d.defences);
      // A hold pays the guards (the Partner always guards); no hold, no defence XP.
      expect(d.defenceXp > 0).toBe(d.defencesHeld > 0);
    }
  }, 30_000);

  it("adds a friendly's XP to the day's Partner XP (the call site, 728d follow-up)", () => {
    // No battles or tile tries of their own: the friendlies are the day's only battle XP.
    const idle = { ...engaged!, battlesPerDay: 0 };
    const rules = { ...WITH_FRIENDLIES_RULES, defences: undefined };
    const day1 = (r: typeof rules | typeof CURRENT_RULES) =>
      runProgression(data, { ...SMALL, days: 1 }, r, idle, 4).kids.map((k) => k.days[0]!);
    const without = day1(CURRENT_RULES);
    const withFriendlies = day1(rules);
    withFriendlies.forEach((day, k) => {
      expect(day.friendlies).toBeGreaterThan(0);
      expect(day.partnerXp).toBeGreaterThan(without[k]!.partnerXp);
    });
  }, 30_000);

  it('pays a friendly as one opponent with `oneOpponent`, and less at a lower `xpPercent`', () => {
    const one = {
      ...WITH_FRIENDLIES_RULES,
      defences: undefined,
      friendlies: { ...WITH_FRIENDLIES_RULES.friendlies!, oneOpponent: true, xpPercent: 100 },
    };
    const full = { ...one, friendlies: { ...one.friendlies, oneOpponent: false } };
    const half = { ...one, friendlies: { ...one.friendlies, xpPercent: 50 } };
    const xp = (rules: typeof one) =>
      runProgression(data, { ...SMALL, days: 1 }, rules, engaged!, 4).kids[0]!.days[0]!.partnerXp;
    expect(xp(one)).toBeLessThan(xp(full));
    expect(xp(half)).toBeLessThan(xp(one));
  }, 30_000);

  it("gates the day's level move", () => {
    const runs = [CURRENT_RULES, WITH_FRIENDLIES_RULES].map((rules) =>
      runProgression(data, SMALL, rules, engaged!, 4),
    );
    const gate = { kid: 'engaged', day: 6, maxLevels: 1 };
    const result = friendlyGate(runs, SMALL, gate);
    const level = (i: number, k: number) => runs[i]!.kids[k]!.days[5]!.partnerLevel;
    const deltas = [0, 1].map((k) => level(1, k) - level(0, k));
    const slot = deltas.indexOf(Math.max(...deltas));
    expect(result).toMatchObject({
      slot,
      before: level(0, slot),
      after: level(1, slot),
      delta: Math.max(...deltas),
    });
    expect(result?.passes).toBe((result?.delta ?? 0) <= 1);
    expect(friendlyGate(runs, SMALL, { ...gate, maxLevels: 99 })?.passes).toBe(true);
    expect(formatFriendlyGate({ ...result!, delta: 2, passes: false })).toMatch(
      /\(\+2, at most \+1\): FAIL$/,
    );
    expect(friendlyGate(runs.slice(0, 1), SMALL, gate)).toBeNull();
  }, 30_000);
});

describe('the collector befriend choice (#732 D3)', () => {
  const kidWith = (): Kid => ({
    profile: casual!,
    slot: 0,
    team: [
      { id: 'partner', speciesId: 'emberbun', level: 30, xp: 0, winsToday: 0 },
      { id: 'friend-1', speciesId: 'pebblesnooze', level: 24, xp: 0, winsToday: 0 },
      { id: 'friend-2', speciesId: 'fuzzbolt', level: 25, xp: 0, winsToday: 0 },
    ],
    evolved: [],
  });
  // A rare (Moonmoth) at the befriend cap, weaker than both common friends.
  const rare = { id: 'friend-new', speciesId: 'moonmoth', level: 21 };

  it('takes a rarer, weaker friend in the least-rare, weakest friend’s place', () => {
    const kid = kidWith();
    expect(befriend(data, kid, rare, 'collector')).toBe(true);
    expect(kid.team.map((m) => m.speciesId)).toEqual(['emberbun', 'moonmoth', 'fuzzbolt']);
    expect(kid.team[1]).toMatchObject({ level: 21, xp: 0, winsToday: 0 });
  });

  it('falls back to a stronger friend when the new one is no rarer, and never touches the Partner', () => {
    const kid = kidWith();
    const common = { id: 'friend-new', speciesId: 'pebblesnooze', level: 26 };
    expect(befriend(data, kid, common, 'collector')).toBe(true);
    expect(kid.team.map((m) => m.level)).toEqual([30, 26, 25]);
    expect(befriend(data, kid, { ...common, level: 20 }, 'collector')).toBe(false);
    expect(kid.team[0]?.speciesId).toBe('emberbun');
  });

  it('still refuses the rarer, weaker friend under the stronger choice (the default)', () => {
    const byDefault = kidWith();
    const stronger = kidWith();
    expect(befriend(data, byDefault, rare)).toBe(false);
    expect(befriend(data, stronger, rare, 'stronger')).toBe(false);
    for (const kid of [byDefault, stronger]) {
      expect(kid.team.map((m) => m.speciesId)).toEqual(['emberbun', 'pebblesnooze', 'fuzzbolt']);
    }
  });

  it("leaves the default rows' levels where they were", () => {
    const explicit = { ...CURRENT_RULES, befriendPolicy: 'stronger' as const };
    const days = (rules: typeof CURRENT_RULES) =>
      runProgression(data, SMALL, rules, casual!, 4).kids.map((k) => k.days);
    expect(days(explicit)).toEqual(days(CURRENT_RULES));
    expect(CURRENT_RULES.befriendPolicy).toBeUndefined();
    expect(COLLECTOR_RULES).toMatchObject({
      label: 'now (collector)',
      befriendPolicy: 'collector',
    });
  }, 30_000);

  it("marks the Partner's own evolutions, so the per-tier line skips them", () => {
    const run = runProgression(data, SMALL, CURRENT_RULES, engaged!, 4);
    const evolved = run.kids[0]!.days.flatMap((d) => d.evolved);
    expect(evolved.some((e) => e.partner === true && e.from === 'emberbun')).toBe(true);
  });
});

describe("#732's per-tier first-evolve line", () => {
  const facts = firstsFacts(data.species);
  const day = (n: number, evolved: DayRecord['evolved']): Pick<DayRecord, 'day' | 'evolved'> => ({
    day: n,
    evolved,
  });

  it('reports `never` cleanly when nothing evolves', () => {
    const firsts = tierFirstsOf([day(1, []), day(2, [])], facts);
    expect(firsts.every((f) => f.day === null)).toBe(true);
    expect(formatTierFirsts(firsts, 60)).toBe(
      'common never (> day 60), uncommon never (> day 60), rare never (> day 60), epic never (> day 60), legendary never (> day 60)',
    );
    const result = tierGate(firsts, { rare: 10, epic: 20 });
    expect(result.pass).toBe(false);
    expect(formatTierGate(result, 'casual', 'collector')).toBe(
      '#732 per-tier gate: rare ≤ day 10, epic ≤ day 20 (casual, collector): FAIL: rare never, epic never (soft, #732 owner decision 2026-11-15; does not fail the run)',
    );
  });

  it("goes by the line's base rarity, skips the Partner, and passes on time", () => {
    const firsts = tierFirstsOf(
      [
        day(2, [{ from: 'emberbun', into: 'kindlebun', partner: true }]),
        day(4, [{ from: 'pebblesnooze', into: 'x' }]),
        day(9, [{ from: 'duskmoth', into: 'lunamoth' }]),
        day(15, [{ from: 'dawndrop', into: 'y' }]),
      ],
      facts,
    );
    expect(firsts.map((f) => f.day)).toEqual([4, null, 9, 15, null]);
    expect(tierGate(firsts, { rare: 10, epic: 20 }).pass).toBe(true);
    expect(tierGate(firsts, { rare: 8 }).pass).toBe(false);
  });

  it('prints the gate line in the report only when the collector run is there', () => {
    const runs = [runProgression(data, SMALL, COLLECTOR_RULES, casual!, 4)];
    const config = { ...SMALL, seats: [4] };
    expect(tierGateLine(runs, config, facts)).toMatch(
      /^#732 per-tier gate: rare ≤ day 10, epic ≤ day 20 \(casual, collector\): (PASS|FAIL)/,
    );
    expect(tierGateLine([], config, facts)).toBeNull();
    const report = renderProgression(runs, config, { seconds: 1, firsts: facts });
    expect(report).toContain('## First evolve by rarity line (#732)');
    expect(report).toContain('| now (collector) | 4 | casual |');
  }, 30_000);
});

describe("#732's bench share in the sim", () => {
  const kidOf = (): Kid => ({
    profile: engaged!,
    slot: 0,
    team: [
      { id: 'partner', speciesId: 'emberbun', level: 12, xp: 0, winsToday: 0 },
      { id: 'friend-1', speciesId: 'pebblesnooze', level: 8, xp: 0, winsToday: 0 },
    ],
    evolved: [],
  });

  it('reads the shipped knob, as the battles service pays it', () => {
    expect(SHIPPED_BENCH_XP).toBe(GROWTH_RULES.benchXpPercent);
    expect(CURRENT_RULES.benchXpPercent).toBe(SHIPPED_BENCH_XP);
    expect(WITH_FRIENDLIES_RULES.benchXpPercent).toBe(SHIPPED_BENCH_XP);
    expect(BENCH_25_RULES.benchXpPercent).toBe(25);
  });

  it('pays a bench member half the best award in grant, and takes a slot on a win only', () => {
    const won = kidOf();
    grant(data, won, CURRENT_RULES, new Map([['partner', 41]]), true);
    const [partner, bench] = won.team;
    // The same as the friend fighting for floor(41 × 50 %) = 20 itself, with the bench off.
    const same = kidOf();
    grant(data, same, { ...CURRENT_RULES, benchXpPercent: 0 }, new Map([['friend-1', 20]]), true);
    expect(bench!.xp).toBe(same.team[1]!.xp);
    expect(bench!.xp).toBeGreaterThan(0);
    expect(partner!.xp).toBeGreaterThan(0);
    expect(won.team.map((m) => m.winsToday)).toEqual([1, 1]);
    const lost = kidOf();
    grant(data, lost, CURRENT_RULES, new Map([['partner', 5]]), false);
    expect(lost.team.map((m) => m.winsToday)).toEqual([0, 0]);
    expect(lost.team[1]!.xp).toBeGreaterThan(0);
  });

  it('pays the bench nothing with the knob at 0, and nothing when the side earned nothing', () => {
    const off = kidOf();
    grant(data, off, { ...CURRENT_RULES, benchXpPercent: 0 }, new Map([['partner', 41]]), true);
    expect(off.team[1]).toMatchObject({ xp: 0, winsToday: 0 });
    const scoot = kidOf();
    grant(data, scoot, CURRENT_RULES, new Map([['partner', 0]]), true);
    expect(scoot.team[1]).toMatchObject({ xp: 0, winsToday: 0 });
  });

  it('pays only the guards on watch on a hold: a member past maxDefenders was not in the setup', () => {
    const rules = {
      ...WITH_FRIENDLIES_RULES,
      defences: { ...WITH_FRIENDLIES_RULES.defences!, maxDefenders: 1 },
    };
    const guard = kidOf();
    payHold(data, guard, rules, new Map([['partner', 40]]));
    expect(guard.team.map((m) => m.winsToday)).toEqual([1, 0]);
    expect(guard.team[1]!.xp).toBe(0);
  });
});

describe('solo and computer mates (#386e)', () => {
  it("spreads the mates' challenges evenly, at most the weekly count, none in the shield", () => {
    const shield = SOLO_MATES_RULES.defences!.shieldDays;
    const perWeek = SOLO_MATES_RULES.computerMates!.challengesPerWeek;
    expect(perWeek).toBe(COMPUTER_MATES.rules.challengesPerPatchWeek.gentle);
    const days = Array.from({ length: 28 }, (_, i) => mateChallenges(i + 1, perWeek, shield));
    for (let week = 0; week < 4; week++) {
      expect(days.slice(week * 7, week * 7 + 7).reduce((n, c) => n + c, 0)).toBe(perWeek);
    }
    expect(days.slice(0, shield).every((c) => c === 0)).toBe(true);
    expect(mateChallenges(5, 0, 0)).toBe(0);
    expect(mateChallenges(1, 4, 2)).toBe(0);
  });

  it("fields the kid's team at the Partner level + the offset, never below 1", () => {
    const kid: Kid = {
      profile: casual!,
      slot: 0,
      team: [
        { id: 'partner', speciesId: 'emberbun', level: 2, xp: 0, winsToday: 0 },
        { id: 'friend-1', speciesId: 'fuzzbolt', level: 9, xp: 0, winsToday: 0 },
      ],
      evolved: [],
    };
    expect(mateTeam(kid, SMALL, -2).squishies).toEqual([
      { id: 'mate:partner', speciesId: 'emberbun', level: 1 },
      { id: 'mate:friend-1', speciesId: 'fuzzbolt', level: 1 },
    ]);
    kid.team[0]!.level = 12;
    expect(mateTeam(kid, SMALL, -2).squishies.map((s) => s.level)).toEqual([10, 10]);
  });

  it('seats one kid: no friendlies or defences alone, and the mates play both', () => {
    const config = { ...SMALL, days: 8 };
    const alone = runProgression(data, config, SOLO_RULES, engaged!, 4);
    expect(alone.kids).toHaveLength(1);
    for (const d of alone.kids[0]!.days) {
      expect([d.friendlies, d.defences, d.defencesHeld]).toEqual([0, 0, 0]);
    }
    const mates = runProgression(data, config, SOLO_MATES_RULES, engaged!, 4);
    const days = mates.kids[0]!.days;
    const { shieldDays } = SOLO_MATES_RULES.defences!;
    for (const d of days) {
      expect(d.friendlies).toBe(SOLO_MATES_RULES.friendlies!.perDay['engaged']);
      expect(d.defences).toBe(
        mateChallenges(d.day, SOLO_MATES_RULES.computerMates!.challengesPerWeek, shieldDays),
      );
      expect(d.defenceXp > 0).toBe(d.defencesHeld > 0);
      // Mates claim no land and take no tile.
      expect(d.tilesLost).toBe(0);
    }
    expect(days.reduce((n, d) => n + d.defences, 0)).toBeGreaterThan(0);
    expect(days.reduce((n, d) => n + d.defencesHeld, 0)).toBeGreaterThan(0);
  }, 30_000);

  it('passes the gate (plan §9): solo + mates within ±10 % of the 4-seat friendlies pair on days 14 and 30', () => {
    // Odds from 8 games, as the other 30-day tests; the report uses 16.
    const month: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 30, estimateGames: 8 };
    const runs = [WITH_FRIENDLIES_RULES, SOLO_RULES, SOLO_MATES_RULES].flatMap((rules) =>
      [casual!, engaged!].map((kid) => runProgression(data, month, rules, kid, 4)),
    );
    const rows = soloGate(runs, month);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.kid)).toEqual(['casual', 'engaged']);
    expect(rows!.flatMap((r) => r.days.map((d) => d.day))).toEqual([14, 30, 14, 30]);
    expect(formatSoloGate(rows!)).toMatch(/: PASS$/);
    expect(rows!.every((r) => r.passes)).toBe(true);
    expect(SOLO_GATE).toEqual({ days: [14, 30], maxPercent: 10 });
    expect(soloGate(runs.slice(0, 2), month)).toBeNull();
    const report = renderProgression(runs, { ...month, seats: [4] }, { seconds: 1 });
    expect(report).toContain('## Solo and computer mates (#386e)');
    expect(report).toContain('| solo + computer mates | 4 | casual |');
  }, 120_000); // six 30-day runs: about 10 s alone; generous for slow CI CPUs
});
