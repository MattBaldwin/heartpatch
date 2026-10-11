import { describe, expect, it } from 'vitest';
import { SpeciesVisualSchema } from '../../schemas/data/species.js';
import { GAME_DATA } from '../index.js';
import { SECRET_SPECIES } from './secret-species.js';

/**
 * The optional `floater` (a camera-facing glyph above a squishy, like
 * Heartsong's song note) is off unless a species asks for it. These species
 * ask for it; everyone else must come through the schema untouched.
 */
const FLOATERS = ['heartsong'];

describe('optional species visual fields stay off by default', () => {
  it('parses every species without a floater to exactly what is written', () => {
    for (const species of [...GAME_DATA.species, ...SECRET_SPECIES]) {
      const parsed = SpeciesVisualSchema.parse(species.visual);
      if (FLOATERS.includes(species.id)) {
        expect(parsed, species.id).toHaveProperty('floater');
        continue;
      }
      // The schema adds no key and no default to a species that doesn't use it.
      expect(parsed, species.id).not.toHaveProperty('floater');
      expect(parsed, species.id).toEqual(species.visual);
    }
  });
});
