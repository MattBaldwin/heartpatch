import { describe, expect, it } from 'vitest';
import { BOSS_SIM_CONFIG } from './boss-config.js';
import {
  bossContent,
  bossGates,
  bossSetup,
  christmasBag,
  renderBossSim,
  renderChristmasSim,
  runBossSim,
  runChristmasSim,
  runPatchTally,
  simBosses,
  standInBosses,
} from './boss.js';
import { BOSS_EVENTS } from '../../src/data/server/boss-events.js';
import { hiddenUntilSeen } from '../../src/schemas/data/species.js';

const content = bossContent();
const small = { ...BOSS_SIM_CONFIG, games: 4, bosses: 2 };

describe('pnpm sim:boss (#190)', () => {
  it('stands in grown-ups of different elements as bosses', () => {
    const bosses = standInBosses(content, 3);
    expect(bosses).toHaveLength(3);
    expect(new Set(bosses.map((b) => b.element)).size).toBe(3);
    expect(bosses.every((b) => b.evolutions.length === 0)).toBe(true);
  });

  it('builds team-format setups with a boss on side b, seeded per game', () => {
    const [shape] = BOSS_SIM_CONFIG.shapes;
    const [boss] = standInBosses(content, 1);
    const setup = bossSetup(content, small, shape!, boss!, 5, 0);
    expect(setup.format).toEqual({ a: 3, b: 1 });
    expect(setup.sides.a.squishies.map((s) => s.level)).toEqual([30, 27, 24]);
    expect(setup.sides.b.squishies[0]).toMatchObject({
      boss: true,
      speciesId: boss!.id,
      level: 25,
    });
    expect(bossSetup(content, small, shape!, boss!, 5, 0)).toEqual(setup);
    expect(bossSetup(content, small, shape!, boss!, 5, 1).seed).not.toBe(setup.seed);
  });

  it("fights the visiting bag's bosses (#234), or stand-ins when the bag is empty", () => {
    const bosses = simBosses(content, small.bosses);
    expect(bosses.map((b) => b.id)).toEqual(BOSS_EVENTS.bag.map((e) => e.speciesId));
    expect(bosses.every((b) => b.line === 'boss')).toBe(true);
    expect(simBosses(content, 2, []).map((b) => b.id)).toEqual(
      standInBosses(content, 2).map((b) => b.id),
    );
  });

  it('never puts a secret or boss-line squishy on the team', () => {
    const [shape] = BOSS_SIM_CONFIG.shapes;
    for (const boss of simBosses(content, 1)) {
      for (let game = 0; game < 20; game++) {
        for (const member of bossSetup(content, small, shape!, boss, 0, game).sides.a.squishies) {
          const species = 'speciesId' in member ? content.species.get(member.speciesId) : undefined;
          expect(species && hiddenUntilSeen(species)).toBe(false);
        }
      }
    }
  });

  it('plays the real bag', () => {
    const cells = runBossSim({ ...small, games: 2 }, content);
    expect(new Set(cells.map((c) => c.boss))).toEqual(
      new Set(BOSS_EVENTS.bag.map((e) => e.speciesId)),
    );
    expect(renderBossSim(cells, bossGates(cells, small), small)).toContain('visiting bag');
  });

  it('plays every cell, reads the gates and renders a report', () => {
    const cells = runBossSim(small, content, []);
    expect(cells).toHaveLength(small.shapes.length * 2 * small.levelBonuses.length);
    for (const cell of cells) {
      expect(cell.winPercent).toBeGreaterThanOrEqual(0);
      expect(cell.winPercent).toBeLessThanOrEqual(100);
      expect(cell.medianRounds).toBeGreaterThan(0);
    }
    expect(runBossSim(small, content, [])).toEqual(cells);
    const gates = bossGates(cells, small);
    expect(gates).toHaveLength(5);
    const report = renderBossSim(cells, gates, small, []);
    expect(report).toContain('| team of 3 |');
    expect(report).toMatch(/PASS|FAIL/);
  });

  it('runs the Christmas Eve boss on its own, gated at the Eve floor (#37 X3)', () => {
    expect(christmasBag().map((e) => e.speciesId)).toEqual([BOSS_EVENTS.christmasEve?.speciesId]);
    expect(christmasBag({ ...BOSS_EVENTS, christmasEve: undefined })).toEqual([]);
    const tiny = { ...small, games: 2 };
    const bag = runBossSim(tiny, content);
    const runs = runChristmasSim(tiny, bag, content);
    expect(runs.map((r) => r.level)).toEqual([
      small.christmas.gatedLevel,
      ...small.christmas.referenceLevels,
    ]);
    const [gated, ...reference] = runs;
    expect(new Set(gated!.cells.map((c) => c.boss))).toEqual(new Set(['snowbundle']));
    expect(gated!.cells.every((c) => c.level === small.christmas.gatedLevel)).toBe(true);
    expect(gated!.gates).toHaveLength(5);
    expect(gated!.gates[4]!.name).toContain('bag bosses');
    for (const run of reference) expect(run.gates).toEqual([]);
    // The bag's own cells are untouched by the Eve run.
    expect(runBossSim(tiny, content)).toEqual(bag);
  });

  it('reads the spread gate across the Eve boss and the bag', () => {
    const cell = (boss: string, winPercent: number) => ({
      shape: 'team of 3',
      boss,
      bonus: 0,
      games: 1,
      level: 10,
      winPercent,
      medianRounds: 7,
    });
    const spread = (eve: number, bag: number[]) =>
      bossGates(
        [cell('snowbundle', eve)],
        small,
        bag.map((w, i) => cell(`b${String(i)}`, w)),
      )[4]!;
    expect(spread(58, [61, 56])).toMatchObject({ pass: true, value: '5 points' });
    expect(spread(70, [56])).toMatchObject({ pass: false, value: '14 points' });
  });

  it('tallies the Eve bar points a patch of Keepers chips (`--patch`)', () => {
    const tiny = {
      ...small,
      christmas: { ...small.christmas, patch: { patches: 2, tries: 3, partnerLevels: [5, 30] } },
    };
    const tally = runPatchTally(tiny, content)!;
    const eve = BOSS_EVENTS.christmasEve!;
    expect(tally.rows.map((r) => [r.partnerLevel, r.bossLevel, r.fights])).toEqual([
      [5, eve.gates.minLevel, 6],
      [30, 30 + eve.gates.levelBonus, 6],
    ]);
    for (const row of tally.rows) {
      expect(row.pointsPerFight).toBeGreaterThanOrEqual(0);
      expect(row.pointsPerFight).toBeLessThanOrEqual(eve.bar.pointsPerWin);
    }
    expect(Math.abs(tally.pointsPerKeeper - tally.pointsPerFight * 3)).toBeLessThanOrEqual(2);
    expect(runPatchTally(tiny, content)).toEqual(tally);
    expect(runPatchTally(tiny, content, { ...BOSS_EVENTS, christmasEve: undefined })).toBeNull();
    const report = renderChristmasSim(
      runChristmasSim({ ...tiny, games: 1 }, [], content),
      tally,
      tiny,
    );
    expect(report).toContain('Patch tally');
    expect(report).toContain('(the Eve floor, gated)');
  });
});
