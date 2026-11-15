import { describe, expect, it } from 'vitest';
import { BOSS_SIM_CONFIG } from './boss-config.js';
import {
  bossContent,
  bossGates,
  bossSetup,
  renderBossSim,
  runBossSim,
  standInBosses,
} from './boss.js';

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

  it('plays every cell, reads the gates and renders a report', () => {
    const cells = runBossSim(small, content);
    expect(cells).toHaveLength(small.shapes.length * 2 * small.levelBonuses.length);
    for (const cell of cells) {
      expect(cell.winPercent).toBeGreaterThanOrEqual(0);
      expect(cell.winPercent).toBeLessThanOrEqual(100);
      expect(cell.medianRounds).toBeGreaterThan(0);
    }
    expect(runBossSim(small, content)).toEqual(cells);
    const gates = bossGates(cells, small);
    expect(gates).toHaveLength(5);
    const report = renderBossSim(cells, gates, small);
    expect(report).toContain('| team of 3 |');
    expect(report).toMatch(/PASS|FAIL/);
  });
});
