import { describe, expect, it } from 'vitest';
import { ART_RULES, BODIES, PARTS } from '../../data/visuals.js';
import {
  checkRosterArt,
  checkSpeciesArt,
  contrastRatio,
  dominantPart,
  hueFamily,
} from './art-rules.js';
import type { ElementId } from './elements.js';
import type { SpeciesVisual } from './species.js';
import { visualRegistry } from './visuals.js';

const registry = visualRegistry({ bodies: BODIES, parts: PARTS });

interface Row {
  id: string;
  element: ElementId;
  feeling: 'silly' | 'cozy' | 'joy' | 'sleepy' | 'brave' | 'spooky';
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  visual: SpeciesVisual;
  evolutions: { into: string }[];
}

const row = (
  over: Omit<Partial<Row>, 'visual'> & { visual?: Partial<SpeciesVisual> } = {},
): Row => ({
  id: 'puff',
  element: 'water',
  feeling: 'silly',
  rarity: 'common',
  evolutions: [],
  ...over,
  visual: {
    body: 'drop',
    palette: ['#7cc0f4', '#e8f6ff', '#3f86d8'],
    parts: ['dot-eyes', 'open-mouth', 'water-curl'],
    ...over.visual,
  },
});

function speciesProblems(r: Row): string[] {
  const out: string[] = [];
  checkSpeciesArt(r, registry, ART_RULES, [r.id], (path, message) => {
    out.push(`${path.join('.')}: ${message}`);
  });
  return out;
}

function rosterProblems(rows: Row[]): string[] {
  const out: string[] = [];
  checkRosterArt('species', rows, registry, ART_RULES, (path, message) => {
    out.push(`${path.join('.')}: ${message}`);
  });
  return out;
}

describe('colour helpers', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3b2a3f', '#3b2a3f')).toBeCloseTo(1, 5);
  });

  it('names hue families a kid would use', () => {
    expect(hueFamily('#7cc0f4')).toBe('blue');
    expect(hueFamily('#ffc93c')).toBe('yellow');
    expect(hueFamily('#c4f27a')).toBe('green');
    expect(hueFamily('#3d3550')).toBe('dark');
    expect(hueFamily('#fbf8ff')).toBe('white');
    expect(hueFamily('#b4ada2')).toBe('neutral');
  });

  it('finds the biggest sticking-out part, ignoring the face', () => {
    expect(dominantPart(row().visual, registry)).toBe('water-curl');
    expect(
      dominantPart(row({ visual: { parts: ['dot-eyes', 'open-mouth'] } }).visual, registry),
    ).toBe('none');
  });
});

describe('checkSpeciesArt', () => {
  it('accepts a squishy that follows every rule', () => {
    expect(speciesProblems(row())).toEqual([]);
  });

  it('needs readable face ink on dark bodies, and accepts a chosen cream ink', () => {
    const dark = row({ visual: { palette: ['#3d3550'] } });
    expect(speciesProblems(dark)).toEqual([expect.stringContaining('face ink #3b2a3f on #3d3550')]);
    expect(speciesProblems(row({ visual: { palette: ['#3d3550'], ink: '#fff4dc' } }))).toEqual([]);
  });

  it('checks ink against a big patch on the face too', () => {
    const patch = row({
      visual: {
        palette: ['#3d3550', '#fff1d6'],
        parts: ['dot-eyes', 'open-mouth', 'belly-patch'],
        ink: '#fff4dc',
      },
    });
    expect(speciesProblems(patch)).toEqual([expect.stringContaining('on #fff1d6')]);
  });

  it('matches the finish to the rarity', () => {
    expect(speciesProblems(row({ rarity: 'epic' }))).toEqual([
      expect.stringContaining('epic squishies use the "sparkle" finish'),
    ]);
    expect(speciesProblems(row({ rarity: 'epic', visual: { finish: 'sparkle' } }))).toEqual([]);
    expect(speciesProblems(row({ visual: { finish: 'iridescent' } }))).toEqual([
      expect.stringContaining('common squishies use the "vinyl" finish'),
    ]);
  });

  it('makes Light and Fire glow, and lets others opt in', () => {
    expect(speciesProblems(row({ element: 'light' }))).toEqual([
      expect.stringContaining('light squishies glow ("body")'),
    ]);
    expect(speciesProblems(row({ element: 'fire', visual: { glow: 'accent' } }))).toEqual([]);
    expect(speciesProblems(row({ visual: { glow: 'body' } }))).toEqual([]);
  });

  it("needs the feeling's face kit", () => {
    expect(speciesProblems(row({ feeling: 'brave' }))).toEqual([
      expect.stringContaining('brave squishies need one of "brave-brows"'),
    ]);
    expect(
      speciesProblems(
        row({ feeling: 'brave', visual: { parts: ['dot-eyes', 'brave-brows', 'cat-mouth'] } }),
      ),
    ).toEqual([]);
  });
});

describe('checkRosterArt', () => {
  const base = row({ evolutions: [{ into: 'puff-2' }] });
  const grown = (visual: Partial<SpeciesVisual>) =>
    row({ id: 'puff-2', rarity: 'uncommon', visual });

  it('accepts an evolution that grows and gains a new part', () => {
    const evo = grown({ size: 1.3, parts: ['dot-eyes', 'open-mouth', 'water-curl', 'fin-crest'] });
    expect(rosterProblems([base, evo])).toEqual([]);
  });

  it('refuses an evolution that only recolours', () => {
    const evo = grown({ size: 1.1, palette: ['#3477cc'] });
    expect(rosterProblems([base, evo])).toEqual([
      expect.stringContaining('an evolution is ×1.2–1.4 the size of puff, not ×1.10'),
      expect.stringContaining('an evolution adds a new sticking-out part'),
    ]);
  });

  it('refuses two lines with the same body, dominant part and hue family', () => {
    const twin = row({ id: 'twin', visual: { palette: ['#6cb6f2'] } });
    expect(rosterProblems([row(), twin])).toEqual([
      expect.stringContaining('twin and puff share body + dominant part + hue family'),
    ]);
    const teal = row({ id: 'teal', visual: { palette: ['#8fded9'] } });
    expect(rosterProblems([row(), teal])).toEqual([]);
  });
});
