import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from './avoided-words.js';
import { MAP_GEN } from './map-gen.js';
import { MEMORY_PUZZLES } from './memory-puzzles.js';
import { TERRAINS } from './terrains.js';
import { MemoryPuzzleRulesSchema } from '../schemas/data/memory-puzzles.js';

describe('MEMORY_PUZZLES (#306 PR 2b)', () => {
  it('is valid data: three skins by terrain, and Relight grows with depth', () => {
    expect(MemoryPuzzleRulesSchema.parse(MEMORY_PUZZLES)).toEqual(MEMORY_PUZZLES);
    expect(MEMORY_PUZZLES.skins.map((s) => s.id)).toEqual(['music-box', 'mural', 'fountain']);
    const { rim, inner, heart } = MEMORY_PUZZLES.relight;
    expect([rim.size, inner.size, heart.size]).toEqual([4, 5, 6]);
    expect(rim.minWork).toBeLessThan(inner.minWork);
    expect(inner.minWork).toBeLessThan(heart.minWork);
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
      for (const line of [skin.name, skin.fixed]) {
        expect(findAvoidedWords(line)).toEqual([]);
      }
    }
  });

  it('names a doubled skin, an unknown default and a tier that cannot be built', () => {
    const [first] = MEMORY_PUZZLES.skins;
    if (!first) throw new Error('no skin');
    const bad = {
      ...MEMORY_PUZZLES,
      skins: [first, { ...first, id: 'twin' }],
      defaultSkin: 'nope',
      relight: {
        ...MEMORY_PUZZLES.relight,
        rim: { ...MEMORY_PUZZLES.relight.rim, size: 3, lanterns: 4, shadows: 4 },
        inner: { ...MEMORY_PUZZLES.relight.inner, empty: 0 },
      },
    };
    const issues = MemoryPuzzleRulesSchema.safeParse(bad).error?.issues.map((i) => i.message);
    expect(issues).toEqual(
      expect.arrayContaining([
        '"meadow" already has a skin',
        'no such skin',
        'too much on too small a grid',
        'wooden pieces need empty slots',
      ]),
    );
  });

  it('holds the forgotten story: time-neutral moments a kid can read, 5 or 6 a day', () => {
    const { story } = MEMORY_PUZZLES;
    expect(story.moments.length).toBeGreaterThanOrEqual(6);
    expect(story.sizes.map((s) => s.moments)).toEqual([5, 6]);
    for (const m of story.moments) {
      for (const line of [m.did, m.act, m.ing]) expect(findAvoidedWords(line)).toEqual([]);
      // No "night" or "morning": everyday sense never fights a clue.
      expect(`${m.did} ${m.act} ${m.ing}`).not.toMatch(/night|morning|evening|dawn|dusk|noon/i);
    }
  });

  it('names a doubled moment, an oversized day and sizes out of order', () => {
    const { story } = MEMORY_PUZZLES;
    const [first] = story.moments;
    if (!first) throw new Error('no moment');
    const bad = {
      ...MEMORY_PUZZLES,
      story: {
        ...story,
        moments: [first, ...story.moments],
        sizes: [
          { tiles: 6, moments: 6 },
          { tiles: 4, moments: 6 },
        ],
      },
    };
    const issues = MemoryPuzzleRulesSchema.safeParse(bad).error?.issues.map((i) => i.message);
    expect(issues).toEqual(expect.arrayContaining(['listed twice', 'sizes go smallest first']));
    const big = {
      ...MEMORY_PUZZLES,
      story: { ...story, moments: story.moments.slice(0, 6), sizes: [{ tiles: 1, moments: 7 }] },
    };
    expect(MemoryPuzzleRulesSchema.safeParse(big).success).toBe(false);
  });
});
