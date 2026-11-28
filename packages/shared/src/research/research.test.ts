import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '../data/avoided-words.js';
import { GAME_DATA } from '../data/index.js';
import { RAIL_RULES } from '../data/rails.js';
import { RESEARCH_TREE } from '../data/research.js';
import type { ResearchRules } from '../schemas/data/research.js';
import { nextNodes, RESEARCH_TEXT, researchGateProblem, researchReadyAt } from './index.js';

const T0 = new Date('2026-12-01T10:00:00.000Z');

/** A small tree with a tier-2 node, so `requires` has something to test. */
const TREE: ResearchRules = {
  oneAtATime: true,
  nodes: [
    ...RESEARCH_TREE.nodes,
    {
      id: 'pressing',
      tier: 2,
      name: 'Pressing',
      description: 'Squish Greens into Pies.',
      cost: { parts: 14, spark: 10 },
      seconds: 6 * 3600,
      requires: ['sorting'],
      grants: { blueprints: 3 },
    },
  ],
};

describe('researchReadyAt', () => {
  it('is the node seconds at 100 % bench pace (bench L1)', () => {
    expect(researchReadyAt(T0, { seconds: 7200 }, 100)).toEqual(
      new Date('2026-12-01T12:00:00.000Z'),
    );
  });

  it('is two thirds of it at 150 % (bench L2)', () => {
    expect(researchReadyAt(T0, { seconds: 10_800 }, 150)).toEqual(
      new Date('2026-12-01T12:00:00.000Z'),
    );
  });

  it('rounds up to a whole second, never early', () => {
    // 100 s × 100 / 150 = 66.67 s → 67 s.
    expect(researchReadyAt(T0, { seconds: 100 }, 150).getTime() - T0.getTime()).toBe(67_000);
  });

  it('refuses a pace that is not a positive whole number', () => {
    for (const pace of [0, -100, 12.5, Number.NaN]) {
      expect(() => researchReadyAt(T0, { seconds: 60 }, pace)).toThrow(RangeError);
    }
  });
});

describe('nextNodes', () => {
  const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);

  it('offers every tier-1 node to a new tinkerer, in tree order', () => {
    expect(ids(nextNodes(TREE, []))).toEqual(['sorting', 'bright-bulbs', 'tidy-rails', 'wrapping']);
  });

  it('leaves out known nodes and the one going', () => {
    expect(ids(nextNodes(TREE, ['bright-bulbs'], 'tidy-rails'))).toEqual(['sorting', 'wrapping']);
  });

  it('offers a node only once everything it requires is known', () => {
    expect(ids(nextNodes(TREE, ['bright-bulbs']))).not.toContain('pressing');
    expect(ids(nextNodes(TREE, ['sorting']))).toContain('pressing');
  });

  it('is empty when every node is known', () => {
    expect(nextNodes(TREE, ids(TREE.nodes))).toEqual([]);
  });
});

describe('researchGateProblem', () => {
  it('needs nothing for an ungated build', () => {
    expect(researchGateProblem(undefined, new Set(), RESEARCH_TREE)).toBeNull();
  });

  it('asks a kid to tinker first, naming the node', () => {
    expect(researchGateProblem('sorting', new Set(), RESEARCH_TREE)).toBe(
      'Tinker first! Research Sorting at your Bench.',
    );
    expect(researchGateProblem('tidy-rails', new Set(['sorting']), RESEARCH_TREE)).toBe(
      'Tinker first! Research Tidy Rails at your Bench.',
    );
  });

  it('lets a known node through', () => {
    expect(researchGateProblem('sorting', new Set(['sorting']), RESEARCH_TREE)).toBeNull();
  });
});

describe('RESEARCH_TEXT', () => {
  it('reads as the plan §7 lines', () => {
    expect(RESEARCH_TEXT.going('2h')).toBe('Tinkering… ready in 2h');
    expect(RESEARCH_TEXT.done).toBe('Ta-da! New blueprints in your bag 📜');
  });

  it('uses no avoided words', () => {
    const lines = [
      RESEARCH_TEXT.gate('Sorting'),
      RESEARCH_TEXT.going('2h'),
      RESEARCH_TEXT.done,
      ...RESEARCH_TREE.nodes.flatMap((n) => [n.name, n.description]),
    ];
    for (const line of lines) expect(findAvoidedWords(line), line).toEqual([]);
  });
});

describe('the Blueprint economy (owner ruling 2026-11-28)', () => {
  const tier1 = RESEARCH_TREE.nodes.filter((n) => n.tier === 1);
  const granted = tier1.reduce((sum, n) => sum + (n.grants.blueprints ?? 0), 0);

  it('grants 8 Blueprints across tier 1', () => {
    expect(granted).toBe(8);
  });

  it('buys one of each Clockwork building and every level-2 upgrade', () => {
    const clockwork = GAME_DATA.buildings.filter((b) => b.patchTypes?.includes('clockwork-isle'));
    expect(clockwork.length).toBeGreaterThan(0);
    const needed =
      clockwork
        .flatMap((b) => b.levels)
        .reduce((sum, l) => sum + ((l.cost as Record<string, number>).blueprints ?? 0), 0) +
      RAIL_RULES.levels.reduce(
        (sum, l) => sum + ((l.cost as Record<string, number>).blueprints ?? 0),
        0,
      );
    expect(needed).toBeGreaterThan(0);
    expect(granted).toBeGreaterThanOrEqual(needed);
  });
});
