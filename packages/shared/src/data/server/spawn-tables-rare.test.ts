import { describe, expect, it } from 'vitest';
import { SPECIES } from '../species.js';
import { SPAWN_TABLES } from './spawn-tables.js';

const RARE = new Set(['rare', 'epic', 'legendary']);
const rarityOf = new Map(SPECIES.map((s) => [s.id, s.rarity]));

describe('rare spawns on every everyday terrain (#732)', () => {
  // Everyday = any season, any time of day: what a kid meets on a plain day.
  const everyday = SPAWN_TABLES.filter((t) => t.season === undefined && t.timeOfDay === undefined);
  const terrains = [...new Set(everyday.flatMap((t) => t.terrains))];

  it('covers the whole launch roster of terrains', () => {
    for (const terrain of ['meadow', 'lake', 'coast', 'pumpkin-fields', 'forest', 'hills']) {
      expect(terrains).toContain(terrain);
    }
  });

  it.each(terrains)('%s has at least one rare, epic or legendary row', (terrain) => {
    const rares = everyday
      .filter((t) => t.terrains.includes(terrain))
      .flatMap((t) => t.entries)
      .filter((e) => RARE.has(rarityOf.get(e.species) ?? ''));
    expect(rares.length, terrain).toBeGreaterThan(0);
  });
});
