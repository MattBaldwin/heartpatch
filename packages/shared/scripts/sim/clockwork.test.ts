import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../../src/data/buildings.js';
import { RESEARCH_TREE } from '../../src/data/research.js';
import { CLOCKWORK_CONFIG as CONFIG } from './clockwork-config.js';
import {
  blueprintSinks,
  clockworkGuards,
  renderClockwork,
  researchNodes,
  runClockwork,
  runFacts,
  stepCost,
  tier1Blueprints,
  windmillPerDay,
} from './clockwork.js';
import { PROGRESSION_CONFIG } from './progression-config.js';

/*
 * `pnpm sim:clockwork` (#874 Wave 1, lane C6). The guards are the plan's
 * (§3 row C6, R1.3), TUNE all; a data edit that breaks one fails CI here.
 */

describe('the Clockwork Isle economy model (#874 C6)', () => {
  const runs = runClockwork(CONFIG, PROGRESSION_CONFIG);
  const run = (kid: string, ruling = true) => {
    const r = runs.find((x) => x.kid === kid && x.ruling === ruling);
    if (!r) throw new Error(`no run ${kid}`);
    return r;
  };

  it('plans only real Clockwork builds, research nodes and lines', () => {
    const clockwork = new Set(
      BUILDINGS.filter((b) => b.patchTypes?.includes('clockwork-isle')).map((b) => b.id),
    );
    const nodes = new Set(RESEARCH_TREE.nodes.map((n) => n.id));
    for (const kid of CONFIG.kids) {
      for (const step of kid.plan) {
        if (step.kind === 'build') expect(clockwork, step.building).toContain(step.building);
        if (step.kind === 'research') expect(nodes, step.node).toContain(step.node);
        if (step.kind === 'rail') expect(step.gatherer).toBeLessThan(kid.partsGatherers);
        // Every step has a real cost (a wire run within maxRun, or it throws).
        expect(Object.keys(stepCost(step, RESEARCH_TREE.nodes)).length).toBeGreaterThan(0);
      }
    }
  });

  it('passes every guard with the owner’s Blueprint ruling', () => {
    const guards = clockworkGuards(runs, CONFIG);
    expect(guards.length).toBe(7);
    expect(guards.filter((g) => !g.pass)).toEqual([]);
  });

  // The guards one by one, so a failure names its number.
  it('builds a casual kid a Windmill by day 3 and a Sorter by day 7', () => {
    const f = runFacts(run('casual'));
    expect(f.windmillDay).not.toBeNull();
    expect(f.windmillDay!).toBeLessThanOrEqual(CONFIG.casualWindmillByDay);
    expect(f.sorterDay).not.toBeNull();
    expect(f.sorterDay!).toBeLessThanOrEqual(CONFIG.casualSorterByDay);
  });

  it('never runs Spark Jars negative, and Parts income covers Parts spend', () => {
    for (const r of runs) {
      const f = runFacts(r);
      expect(f.minSpark, r.kid).toBeGreaterThanOrEqual(0);
      expect(f.partsIn, r.kid).toBeGreaterThanOrEqual(f.partsSpent);
      // Spark the machines and research used came from the Windmill.
      expect(f.sparkUsed, r.kid).toBeLessThanOrEqual(f.sparkMade);
    }
  });

  it('gives an engaged kid a Beacon by day 10, wrapping at most 2 presents a day', () => {
    const f = runFacts(run('engaged'));
    expect(f.beaconDay).not.toBeNull();
    expect(f.beaconDay!).toBeLessThanOrEqual(CONFIG.engagedBeaconByDay);
    expect(f.wrapperDay).not.toBeNull();
    expect(f.presents).toBeGreaterThan(0);
    expect(f.maxPresentsPerDay).toBeLessThanOrEqual(CONFIG.maxPresentsPerDay);
  });

  // Supervisor 58 (owner ruling 2026-11-28): tier 1 grants 8, enough for
  // every Wave 1 Blueprint sink built once.
  it('models the Blueprint ruling: 8 from tier 1 covers every Wave 1 sink', () => {
    const needed = blueprintSinks().reduce((a, s) => a + s.blueprints, 0);
    expect(tier1Blueprints(researchNodes(CONFIG, true))).toBe(CONFIG.tier1Blueprints);
    expect(CONFIG.tier1Blueprints).toBeGreaterThanOrEqual(needed);
    expect(run('engaged').stuck).toBeNull();
    expect(run('engaged').blueprintsSpent).toBeLessThanOrEqual(run('engaged').blueprintsGranted);
    // Overrides only raise grants, and only on real tier-1 nodes.
    for (const [id, grants] of Object.entries(CONFIG.grantsOverride)) {
      const node = RESEARCH_TREE.nodes.find((n) => n.id === id);
      expect(node?.tier, id).toBe(1);
      expect(grants['blueprints'] ?? 0, id).toBeGreaterThanOrEqual(node?.grants['blueprints'] ?? 0);
    }
  });

  it('reads the Windmill from the data: faster in a stronger wind and at level 2', () => {
    expect(windmillPerDay(1, 1)).toBeLessThan(windmillPerDay(1, 2));
    expect(windmillPerDay(1, 2)).toBeLessThan(windmillPerDay(1, 3));
    expect(windmillPerDay(2, 2)).toBeGreaterThan(windmillPerDay(1, 2));
  });

  it('renders a report with the guards, the Blueprint balance and both kids', () => {
    const report = renderClockwork(runs, CONFIG, { seconds: 1 });
    expect(report).toContain('## Guards (with the ruling)');
    expect(report).toContain('## Blueprint balance');
    expect(report).toContain('## casual kid, day by day (ruling)');
    expect(report).toContain('## engaged kid, day by day (ruling)');
    expect(report).not.toContain('❌');
  });
});
