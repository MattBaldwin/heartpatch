import { describe, expect, it } from 'vitest';
import { GROWTH_RULES } from '../data/care.js';
import { evolvingMeter, xpForLevel, type EvolutionStep } from './growth.js';

// A base form evolving at 16, its form evolving at 32, and a secret branch.
const STEPS: EvolutionStep[] = [
  { from: 'puff', into: 'puffer', level: 16 },
  { from: 'puffer', into: 'puffking', level: 32 },
  { from: 'moss', into: 'secret-moss', level: 10 },
  { from: 'moss', into: 'mossling', level: 20 },
];
const SECRET = new Set(['secret-moss']);
const isPublic = (id: string) => !SECRET.has(id);
const xpAt = (level: number) => xpForLevel(level, GROWTH_RULES);
const meter = (speciesId: string, level: number, xp: number, joinedLevel: number | null = 1) =>
  evolvingMeter({ speciesId, level, xp, joinedLevel }, STEPS, isPublic, GROWTH_RULES);

describe('evolvingMeter (#205)', () => {
  it('counts from level 1 for a base form raised from the start', () => {
    expect(meter('puff', 1, 0)).toEqual({ percent: 0, levelsToGo: 15 });
    const half = Math.floor((xpAt(1) + xpAt(16)) / 2);
    expect(meter('puff', 9, half)?.percent).toBe(
      Math.floor(((half - xpAt(1)) * 100) / (xpAt(16) - xpAt(1))),
    );
    expect(meter('puff', 15, xpAt(16) - 1)?.percent).toBe(99);
  });

  it('is 100 at and past the evolution level (it evolves on its next XP)', () => {
    expect(meter('puff', 16, xpAt(16))).toEqual({ percent: 100, levelsToGo: 0 });
    expect(meter('puff', 40, xpAt(40))).toEqual({ percent: 100, levelsToGo: 0 });
  });

  it('counts a befriended squishy from the level it joined at', () => {
    // Joined at 12 with no XP yet: it counts from level 12's XP.
    expect(meter('puff', 12, 0, 12)).toEqual({ percent: 0, levelsToGo: 4 });
    const mid = Math.floor((xpAt(12) + xpAt(16)) / 2);
    expect(meter('puff', 14, mid, 12)?.percent).toBe(
      Math.floor(((mid - xpAt(12)) * 100) / (xpAt(16) - xpAt(12))),
    );
  });

  it('counts an evolved form from the level it evolved at', () => {
    expect(meter('puffer', 16, xpAt(16), 1)).toEqual({ percent: 0, levelsToGo: 16 });
  });

  it('counts an old squishy (no joined level kept) from its level now', () => {
    expect(meter('puff', 10, xpAt(10), null)).toEqual({ percent: 0, levelsToGo: 6 });
  });

  it('shows no meter on a top form or when a secret form comes next', () => {
    expect(meter('puffking', 50, xpAt(50))).toBeNull();
    expect(meter('moss', 5, xpAt(5))).toBeNull();
  });
});
