import { describe, expect, it } from 'vitest';
import { BOSS_SIM_CONFIG } from './boss-config.js';
import {
  bossContent,
  bossGates,
  bossSetup,
  renderBossSim,
  runBossSim,
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
});
