import { describe, expect, it } from 'vitest';
import { bossWeekOf } from '../../src/boss/schedule.js';
import { BOSS_EVENTS } from '../../src/data/server/boss-events.js';
import { addDays } from '../../src/home/local-date.js';
import { charmGateLines, charmSupply, renderCharms } from './economy-charms.js';
import {
  askPercent,
  askRoll,
  baseFormOf,
  joinLevel,
  standInBag,
  visitDays,
  visitOn,
} from './progression-boss.js';
import { bossGate, charmWeeks, formatBossGate, renderBoss } from './progression-boss-report.js';
import {
  BOSS_GATE,
  CURRENT_RULES,
  PROGRESSION_CONFIG,
  WITH_BOSS_RULES,
  type ProgressionConfig,
} from './progression-config.js';
import { firstsFacts } from './progression-firsts.js';
import { modelData, runProgression } from './progression.js';

const data = modelData();
const model = WITH_BOSS_RULES.boss!;
const events = { ...BOSS_EVENTS, bag: standInBag(model.standIns) };
/** Two weeks: the first visit opens once a Partner reaches the unlock level. */
const SHORT: ProgressionConfig = { ...PROGRESSION_CONFIG, days: 14, estimateGames: 4 };
const [casual, engaged] = PROGRESSION_CONFIG.kids;

describe('mini-boss visits (#190)', () => {
  it('spans three patch-local days: opens at 16:00 for 48 h', () => {
    expect(visitDays(BOSS_EVENTS)).toBe(3);
    expect(visitDays({ opensAtHour: 0, windowHours: 48 })).toBe(2);
  });

  it("follows the server's schedule: one visit a week, consecutive days, none with an empty bag", () => {
    const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(12 + i)}`);
    const out = dates.filter((d) => visitOn('seed-1', d, events) !== null);
    expect(out).toHaveLength(6);
    const firstWeek = out.slice(0, 3).map((d) => Number(d.slice(-2)));
    expect(firstWeek).toEqual([firstWeek[0], firstWeek[0]! + 1, firstWeek[0]! + 2]);
    expect(dates.every((d) => visitOn('seed-1', d, BOSS_EVENTS) === null)).toBe(true);
    expect(standInBag(model.standIns)).toHaveLength(model.standIns);
  });

  it('asks at the plan §3 odds: base + standing + warmth, sure after 4 misses', () => {
    const b = model.befriend;
    expect(askPercent(0, 0, b)).toBe(20);
    expect(askPercent(3, 0, b)).toBe(35);
    expect(askPercent(3, 2, b)).toBe(65);
    expect(askPercent(3, 3, b)).toBe(80);
    expect(askPercent(0, 4, b)).toBe(100);
    expect(askRoll('s', 100)).toBe(true);
    expect(askRoll('s', 0)).toBe(false);
    expect(askRoll('s', 50)).toBe(askRoll('s', 50));
  });

  it('befriends the base form below its first evolution, at half the Partner level (at least 5)', () => {
    const grown = [...data.species.values()].find(
      (s) => s.evolutions.length === 0 && baseFormOf(s.id, data.species) !== s.id,
    )!;
    const base = baseFormOf(grown.id, data.species);
    expect(data.species.get(base)?.evolutions.length).toBeGreaterThan(0);
    const first = Math.min(...data.species.get(base)!.evolutions.map((e) => e.level));
    expect(joinLevel(base, 4, data.species, model.befriend)).toBe(Math.min(5, first - 1));
    expect(joinLevel(base, 80, data.species, model.befriend)).toBe(Math.min(40, first - 1));
  });
});

describe('runProgression with mini-bosses (#190)', () => {
  const run = runProgression(data, SHORT, WITH_BOSS_RULES, engaged!, 4);
  const plain = runProgression(data, SHORT, CURRENT_RULES, engaged!, 4);

  it('leaves runs without boss rules alone', () => {
    expect(plain.kids[0]!.days.every((d) => d.boss === undefined)).toBe(true);
    expect(run.kids[0]!.days.every((d) => d.boss !== undefined)).toBe(true);
  });

  it('fights within the tries, stops for the visit after a win, and keeps the charm books', () => {
    for (const kid of run.kids) {
      let charms = model.charms.start;
      const won = new Set<string>();
      for (const d of kid.days) {
        const b = d.boss!;
        // Visits can sit back to back (Sunday, then Monday): track them by window week.
        const week = bossWeekOf(addDays(SHORT.startDate, d.day - 1));
        const wonThisVisit = won.has(week);
        expect(b.tries).toBeLessThanOrEqual(BOSS_EVENTS.triesPerDay);
        if (b.tries > 0) expect(b.canFight && b.out && !wonThisVisit).toBe(true);
        if (b.won) won.add(week);
        if (b.asks > 0) expect(b.won).toBe(true);
        expect(b.asks).toBeLessThanOrEqual(model.befriend.asksPerWin);
        expect(b.charmsBoss).toBe(b.asks * model.befriend.charmsPerAsk);
        charms += b.charmsIn - b.charmsWild - b.charmsBoss;
        expect(b.charms).toBe(charms);
      }
    }
    expect(run.kids[0]!.days.some((d) => d.boss!.tries > 0)).toBe(true);
  });

  it('is reproducible', () => {
    const again = runProgression(data, SHORT, WITH_BOSS_RULES, engaged!, 4);
    expect(again.kids.map((k) => k.days.map((d) => d.boss))).toEqual(
      run.kids.map((k) => k.days.map((d) => d.boss)),
    );
  });

  it('sums charms by week', () => {
    const weeks = charmWeeks(run.kids[0]!.days, 3);
    expect(weeks.map((w) => w.week)).toEqual([1, 2]);
    expect(weeks[1]!.left).toBe(run.kids[0]!.days[13]!.boss!.charms);
    expect(charmWeeks(plain.kids[0]!.days, 3)).toEqual([]);
  });

  it('gates firsts and XP against the run without bosses, and renders', () => {
    const runs = [casual!, engaged!].flatMap((kid) => [
      runProgression(data, SHORT, CURRENT_RULES, kid, 4),
      runProgression(data, SHORT, WITH_BOSS_RULES, kid, 4),
    ]);
    const facts = firstsFacts(data.species);
    const result = bossGate(runs, SHORT, facts, { ...BOSS_GATE, xpDays: [7, 14] })!;
    expect(result.firsts).toHaveLength(4);
    expect(result.xp).toHaveLength(4);
    expect(result.pass).toBe(result.firsts.every((f) => f.pass) && result.xp.every((x) => x.pass));
    const lines = formatBossGate(result, SHORT.days);
    expect(lines.every((l) => /: (PASS|FAIL)$/.test(l))).toBe(true);
    expect(bossGate(runs.slice(1), SHORT, facts)).toBeNull();
    expect(renderBoss(runs, SHORT, facts, { ...BOSS_GATE, xpDays: [7, 14] }).join('\n')).toContain(
      '## Mini-bosses (#190)',
    );
  });
});

describe('Heart Charm supply (#190, sim:economy)', () => {
  it('reports spare charms after wild befriending against 3–6 a week of boss asks', () => {
    const rows = charmSupply(SHORT, data);
    expect(rows.map((r) => r.kid)).toEqual(['casual', 'engaged']);
    for (const r of rows) {
      const full = r.weeks.filter((w) => w.week * 7 <= SHORT.days);
      expect(r.leastSpare).toBe(Math.min(...full.map((w) => w.made - w.wild)));
    }
    const lines = charmGateLines(rows);
    expect(lines[0]).toMatch(/^charm gate \(#190, soft\): casual .*: (PASS|FAIL)$/);
    expect(charmGateLines([{ kid: 'k', weeks: [], leastSpare: 5, short: 0 }])[0]).toMatch(/FAIL$/);
    expect(charmGateLines([{ kid: 'k', weeks: [], leastSpare: 6, short: 1 }])[0]).toMatch(/FAIL$/);
    expect(charmGateLines([{ kid: 'k', weeks: [], leastSpare: 6, short: 0 }])[0]).toMatch(/PASS$/);
    expect(renderCharms(rows)).toContain('| casual | 1 |');
  });
});
