import { describe, expect, it } from 'vitest';
import { checkStarters } from '../schemas/data/starters.js';
import { GAME_DATA } from './index.js';
import { SERVER_GAME_DATA } from './server/index.js';
import { isStarterSpecies, STARTERS } from './starters.js';

const speciesById = new Map(GAME_DATA.species.map((s) => [s.id, s]));
const starters = STARTERS.speciesIds.map((id) => speciesById.get(id));

describe('starters (owner decision 2026-10-03)', () => {
  it('are valid', () => {
    expect(checkStarters(STARTERS)).toEqual([]);
  });

  it('rejects a list that is not three different species', () => {
    const gift = STARTERS.firstPickGift;
    expect(
      checkStarters({ speciesIds: ['puddlepuff', 'emberbun'], firstPickGift: gift }),
    ).not.toEqual([]);
    expect(
      checkStarters({ speciesIds: ['puddlepuff', 'puddlepuff', 'emberbun'], firstPickGift: gift }),
    ).not.toEqual([]);
  });

  it("gives Sprout's 3 Heart Charms with the first pick, all real items (owner decision 2026-10-04)", () => {
    expect(STARTERS.firstPickGift).toEqual({ 'heart-charm': 3 });
    const items = new Set(GAME_DATA.resources.map((r) => r.id));
    for (const id of Object.keys(STARTERS.firstPickGift)) expect(items.has(id), id).toBe(true);
    expect(
      checkStarters({ speciesIds: STARTERS.speciesIds, firstPickGift: { 'heart-charm': 0 } }),
    ).not.toEqual([]);
  });

  it('includes Puddlepuff (design doc §4)', () => {
    expect(isStarterSpecies('puddlepuff')).toBe(true);
    expect(isStarterSpecies('splashmallow')).toBe(false);
  });

  it('are real public species, never secret ones (CLAUDE.md rule 6)', () => {
    const secretIds = new Set(SERVER_GAME_DATA.secretSpecies.map((s) => s.id));
    for (const [i, id] of STARTERS.speciesIds.entries()) {
      expect(starters[i], id).toBeDefined();
      expect(starters[i]?.rarity, id).not.toBe('secret');
      expect(secretIds.has(id), id).toBe(false);
    }
  });

  it('are year-round base forms', () => {
    const evolvedForms = new Set(
      [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].flatMap((s) =>
        s.evolutions.map((e) => e.into),
      ),
    );
    for (const s of starters) {
      expect(s?.season, s?.id).toBeUndefined();
      expect(evolvedForms.has(s?.id ?? ''), s?.id).toBe(false);
    }
  });

  it('have three different element families that go round in a circle', () => {
    const elements = starters.flatMap((s) => (s ? [s.element] : []));
    expect(new Set(elements).size).toBe(3);
    // Each one is strong against the one before it, so no pick is the best one.
    for (const [i, attacker] of elements.entries()) {
      const defender = elements[(i + 2) % 3];
      if (!defender) throw new Error('three starters expected');
      expect(GAME_DATA.elementMatrix[attacker][defender], `${attacker} → ${defender}`).toBe(1.5);
    }
  });
});
