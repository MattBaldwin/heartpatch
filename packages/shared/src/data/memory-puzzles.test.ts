import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from './avoided-words.js';
import { MAP_GEN } from './map-gen.js';
import { MEMORY_PUZZLES } from './memory-puzzles.js';
import { TERRAINS } from './terrains.js';
import { MemoryPuzzleRulesSchema } from '../schemas/data/memory-puzzles.js';

describe('MEMORY_PUZZLES (#306 PR 2b)', () => {
  it('is valid data: three skins of four different pieces, by terrain', () => {
    expect(MemoryPuzzleRulesSchema.parse(MEMORY_PUZZLES)).toEqual(MEMORY_PUZZLES);
    expect(MEMORY_PUZZLES.pieceCount).toBe(4);
    expect(MEMORY_PUZZLES.skins.map((s) => s.id)).toEqual(['music-box', 'mural', 'fountain']);
  });

  it('names only real terrains, none a village never stands on', () => {
    const terrains = new Set(TERRAINS.map((t) => t.id));
    const never = new Set(MAP_GEN.communities.excludedTerrains);
    for (const skin of MEMORY_PUZZLES.skins) {
      for (const t of skin.terrains) {
        expect(terrains.has(t)).toBe(true);
        expect(never.has(t)).toBe(false);
      }
    }
  });

  it('keeps the words short and kind (style guide §2, §9)', () => {
    for (const skin of MEMORY_PUZZLES.skins) {
      for (const line of [skin.name, skin.watch, skin.play, skin.easy, skin.fixed]) {
        expect(findAvoidedWords(line)).toEqual([]);
      }
      expect(skin.easy.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('names a doubled skin, a short skin, repeated pieces and an unknown default', () => {
    const [first] = MEMORY_PUZZLES.skins;
    if (!first) throw new Error('no skin');
    const bad = {
      ...MEMORY_PUZZLES,
      skins: [
        first,
        { ...first, terrains: ['meadow'], pieces: first.pieces.slice(0, 3) },
        {
          ...first,
          id: 'twin',
          terrains: [],
          pieces: [first.pieces[0], ...first.pieces.slice(0, 3)],
        },
      ],
      defaultSkin: 'nope',
    };
    const issues = MemoryPuzzleRulesSchema.safeParse(bad).error?.issues.map((i) => i.message);
    expect(issues).toEqual(
      expect.arrayContaining([
        'listed twice',
        'needs exactly 4 pieces',
        'pieces repeat',
        '"meadow" already has a skin',
        'no such skin',
      ]),
    );
  });
});
