import { describe, expect, it } from 'vitest';
import { CARE_RULES } from '../data/care.js';
import { RequirementSchema, type Requirement } from '../schemas/data/requirements.js';
import {
  EMPTY_PROGRESS_FACTS,
  evaluateRequirements,
  requirementAmount,
  requirementGroup,
  requirementLine,
  requirementsMet,
  type ProgressFacts,
  type RequirementContext,
} from './index.js';

const context: RequirementContext = {
  care: CARE_RULES,
  buildingName: (id) => (id === 'cozy-meadow' ? 'Cozy Meadow' : id),
  trackName: (id) => (id === 'collector' ? 'Collector' : id),
  solo: false,
};

/** One fact of each kind, all set, for the "done" side. */
const facts: ProgressFacts = {
  heartSeedLevel: 2,
  ownedTileDistances: [0, 1, 1, 2, 3, 5],
  milestoneTiers: { collector: 2, territory: 1 },
  befriended: 7,
  buildings: [
    { buildingId: 'cozy-meadow', kind: 'habitat' },
    { buildingId: 'cozy-meadow', kind: 'habitat' },
    { buildingId: 'ember-den', kind: 'habitat' },
    { buildingId: 'hearthfire', kind: 'hearthfire' },
  ],
  explored: 3,
  speciesSeen: 12,
  litFires: 2,
  decorations: 0,
  residents: [
    { contentment: 80, level: 12, evolved: true },
    { contentment: 45, level: 9, evolved: false },
    { contentment: 5, level: 20, evolved: false },
  ],
  trades: [
    { kind: 'trade', partnerUserId: 'a' },
    { kind: 'gift', partnerUserId: 'a' },
    { kind: 'gift', partnerUserId: 'b' },
  ],
  postsUsed: 1,
  tilesTended: 9,
  homesteads: 1,
};

/** Every kind, with the amount `facts` has of it. */
const EVERY_KIND: [Requirement, number][] = [
  [{ kind: 'ownedTilesWithin', radius: 1, count: 3 }, 3],
  [{ kind: 'milestonesReached', count: 3 }, 3],
  [{ kind: 'milestonesReached', trackId: 'collector', count: 3 }, 2],
  [{ kind: 'squishiesBefriended', count: 5 }, 7],
  [{ kind: 'buildingsBuilt', count: 4 }, 4],
  [{ kind: 'buildingsBuilt', buildingKind: 'habitat', count: 2 }, 3],
  [{ kind: 'buildingsBuilt', buildingId: 'cozy-meadow', count: 1 }, 2],
  [{ kind: 'tilesFullyExplored', count: 3 }, 3],
  [{ kind: 'speciesSeen', count: 20 }, 12],
  [{ kind: 'habitatKinds', count: 2 }, 2],
  [{ kind: 'litFires', count: 1 }, 2],
  [{ kind: 'decorations', count: 5 }, 0],
  [{ kind: 'residentsContent', mood: 'happy', count: 2 }, 2],
  [{ kind: 'residentsContent', mood: 'glowing', count: 1 }, 1],
  [{ kind: 'residentsLevel', level: 10, count: 2 }, 2],
  [{ kind: 'residentsEvolved', count: 1 }, 1],
  [{ kind: 'tradesCompleted', count: 2 }, 3],
  [{ kind: 'tradesCompleted', tradeKinds: ['gift'], count: 2 }, 2],
  [{ kind: 'patchMatesTradedWith', count: 3 }, 2],
  [{ kind: 'postsUsed', count: 3 }, 1],
  [{ kind: 'tilesTended', count: 8 }, 9],
  [{ kind: 'homesteads', count: 1 }, 1],
  [{ kind: 'heartSeedLevel', level: 3 }, 2],
];

describe('requirements (#381 plan §8)', () => {
  it('covers all 18 kinds', () => {
    expect(new Set(EVERY_KIND.map(([req]) => req.kind)).size).toBe(18);
  });

  it.each(EVERY_KIND)('reads %j as %i', (req, have) => {
    const amount = requirementAmount(req, facts, CARE_RULES);
    expect(amount.have).toBe(have);
    expect(Number.isInteger(amount.have) && Number.isInteger(amount.need)).toBe(true);
  });

  it('is done when have reaches need, and not before', () => {
    const [fires, posts] = evaluateRequirements(
      [
        { kind: 'litFires', count: 2 },
        { kind: 'postsUsed', count: 2 },
      ],
      facts,
      context,
    );
    expect(fires).toMatchObject({ have: 2, need: 2, done: true, hint: null });
    expect(posts).toMatchObject({ have: 1, need: 2, done: false });
  });

  it('meets nothing for a brand-new Keeper except the level-1 Seed', () => {
    for (const [req] of EVERY_KIND) {
      const met = requirementsMet([req], EMPTY_PROGRESS_FACTS, CARE_RULES);
      expect(met).toBe(false);
    }
    expect(
      requirementsMet([{ kind: 'heartSeedLevel', level: 1 }], EMPTY_PROGRESS_FACTS, CARE_RULES),
    ).toBe(true);
    expect(requirementsMet([], EMPTY_PROGRESS_FACTS, CARE_RULES)).toBe(true);
  });

  it('writes a short line for every kind (style guide §2: under 10 words)', () => {
    for (const [req] of EVERY_KIND) {
      const line = requirementLine(req, context);
      expect(line.split(/\s+/).length, line).toBeLessThan(10);
    }
    expect(requirementLine({ kind: 'litFires', count: 1 }, context)).toBe('Light a fire 🔥');
    expect(requirementLine({ kind: 'residentsContent', mood: 'happy', count: 1 }, context)).toBe(
      '1 resident feeling happy',
    );
    expect(
      requirementLine({ kind: 'buildingsBuilt', buildingId: 'cozy-meadow', count: 1 }, context),
    ).toBe('Build a Cozy Meadow');
    expect(requirementLine({ kind: 'heartSeedLevel', level: 2 }, context)).toBe(
      'Your Heart Seed is level 2 🌱',
    );
  });

  it('groups rows under the Seed and the four kinds of getting better', () => {
    expect(requirementGroup('heartSeedLevel')).toBe('seed');
    expect(requirementGroup('litFires')).toBe('home');
    expect(requirementGroup('residentsEvolved')).toBe('residents');
    expect(requirementGroup('postsUsed')).toBe('patch-mates');
    expect(requirementGroup('tilesTended')).toBe('land');
  });

  it('invites a patch-mate on a solo patch, only on unmet patch-mate rows', () => {
    const solo = { ...context, solo: true };
    const rows = evaluateRequirements(
      [
        { kind: 'tradesCompleted', count: 10 },
        { kind: 'tradesCompleted', count: 1 },
        { kind: 'tilesTended', count: 99 },
      ],
      facts,
      solo,
    );
    expect(rows.map((r) => r.hint)).toEqual(['Invite a patch-mate to grow further 💌', null, null]);
  });

  it('gives each row a stable id from its kind and place', () => {
    const rows = evaluateRequirements(
      [
        { kind: 'litFires', count: 1 },
        { kind: 'litFires', count: 3 },
      ],
      facts,
      context,
    );
    expect(rows.map((r) => r.id)).toEqual(['litFires-0', 'litFires-1']);
  });

  it('refuses an unknown kind and a count below 1', () => {
    expect(RequirementSchema.safeParse({ kind: 'vibes', count: 1 }).success).toBe(false);
    expect(RequirementSchema.safeParse({ kind: 'litFires', count: 0 }).success).toBe(false);
  });
});
