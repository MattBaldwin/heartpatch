import { describe, expect, it } from 'vitest';
import { ART_RULES, BODIES, PARTS } from '../../data/visuals.js';
import { checkSpeciesArt } from './art-rules.js';
import type { SpeciesVisual } from './species.js';
import { checkSpeciesVisual, PartSchema, visualRegistry, type Part } from './visuals.js';

// #234 kit extension: the `box` shape, `anchor: 'behind'` and `replaces: 'mouth'`.

const bar: Part = {
  id: 'test-rake-bar',
  slot: 'mane',
  shape: 'box',
  size: [1.2, 0.06, 0.14],
  color: 'detail',
  layout: { kind: 'single' },
  around: 0,
  up: -5,
  jitter: 0,
  replaces: 'mouth',
};
const handle: Part = {
  id: 'test-rake-handle',
  slot: 'horns',
  shape: 'capsule',
  size: [0.08, 1.4, 0.08],
  color: 'detail',
  layout: { kind: 'single' },
  around: 0,
  up: -5,
  tilt: 10,
  jitter: 0,
  anchor: 'behind',
};

const registry = visualRegistry({ bodies: BODIES, parts: [...PARTS, bar, handle] });

function visualProblems(parts: string[]): string[] {
  const out: string[] = [];
  checkSpeciesVisual({ body: 'blob', parts }, registry, ['v'], (path, message) => {
    out.push(`${path.join('.')}: ${message}`);
  });
  return out;
}

function artProblems(parts: string[]): string[] {
  const visual: SpeciesVisual = {
    body: 'drop',
    palette: ['#7cc0f4', '#e8f6ff', '#3f86d8', '#7a4a2e'],
    parts,
    size: 1,
    finish: 'vinyl',
  };
  const out: string[] = [];
  checkSpeciesArt(
    { id: 'puff', element: 'water', feeling: 'silly', rarity: 'common', visual },
    registry,
    ART_RULES,
    ['puff'],
    (path, message) => out.push(`${path.join('.')}: ${message}`),
  );
  return out;
}

describe('kit extension schema', () => {
  it('parses the new optional fields and the box shape', () => {
    expect(PartSchema.parse(bar)).toEqual(bar);
    expect(PartSchema.parse(handle)).toEqual(handle);
  });

  it('leaves existing parts unchanged (the fields are optional)', () => {
    for (const p of PARTS) {
      expect(p.anchor).toBeUndefined();
      expect(p.replaces).toBeUndefined();
      expect(PartSchema.parse(p)).toEqual(p);
    }
  });

  it('refuses unknown anchors and replacements', () => {
    expect(PartSchema.safeParse({ ...handle, anchor: 'inside' }).success).toBe(false);
    expect(PartSchema.safeParse({ ...bar, replaces: 'eyes' }).success).toBe(false);
    expect(PartSchema.safeParse({ ...bar, shape: 'cube' }).success).toBe(false);
  });
});

describe('kit extension checks', () => {
  it('accepts a behind-anchored handle and a mouth-replacing bar', () => {
    expect(visualProblems(['dot-eyes', 'test-rake-bar', 'test-rake-handle'])).toEqual([]);
  });

  it('only lets sticking-out single or pair parts stand behind', () => {
    const onFace = { ...handle, id: 'test-behind-mouth', slot: 'mouth' as const };
    const ring = {
      ...handle,
      id: 'test-behind-ring',
      layout: { kind: 'ring' as const, count: 3, spread: 20 },
    };
    const reg = visualRegistry({ bodies: BODIES, parts: [...PARTS, onFace, ring] });
    const out: string[] = [];
    checkSpeciesVisual(
      { body: 'blob', parts: ['dot-eyes', 'test-behind-mouth', 'test-behind-ring'] },
      reg,
      ['v'],
      (path, message) => out.push(`${path.join('.')}: ${message}`),
    );
    expect(out).toEqual([
      expect.stringContaining('"test-behind-mouth" can\'t stand behind'),
      expect.stringContaining('"test-behind-ring" can\'t stand behind'),
    ]);
  });

  it('reports a mouth part next to a mouth replacement', () => {
    expect(visualProblems(['dot-eyes', 'open-mouth', 'test-rake-bar'])).toEqual([
      'v.parts: part "test-rake-bar" replaces the mouth, so "open-mouth" isn\'t needed',
    ]);
  });

  it('lets a declared mouth replacement meet the face kit, ART_RULES unchanged', () => {
    expect(ART_RULES.feelingFaces.silly).toEqual([['dot-eyes', 'sharp-eyes'], ['open-mouth']]);
    expect(artProblems(['dot-eyes', 'test-rake-bar'])).toEqual([]);
    // Without the replacement the mouth is still required...
    expect(artProblems(['dot-eyes', 'water-curl'])).toEqual([
      expect.stringContaining('silly squishies need one of "open-mouth"'),
    ]);
    // ...and it only stands in for mouths, not eyes.
    expect(artProblems(['oval-eyes', 'test-rake-bar'])).toEqual([
      expect.stringContaining('silly squishies need one of "dot-eyes", "sharp-eyes"'),
    ]);
  });
});

// #234 round 11: `anchor: 'front'` with `standoff` (tines along a rake head).
describe('front anchor and standoff', () => {
  const tines: Part = {
    id: 'test-rake-front-tines',
    slot: 'fangs',
    shape: 'bent',
    size: [0.08, 0.5, 0.27],
    color: 'metal',
    layout: { kind: 'ring', count: 5, spread: 40 },
    around: 0,
    up: -20,
    tilt: 30,
    jitter: 0,
    anchor: 'front',
    standoff: 0.08,
  };

  function problems(extra: Part[], parts: string[]): string[] {
    const reg = visualRegistry({ bodies: BODIES, parts: [...PARTS, bar, ...extra] });
    const out: string[] = [];
    checkSpeciesVisual({ body: 'blob', parts }, reg, ['v'], (path, message) => {
      out.push(`${path.join('.')}: ${message}`);
    });
    return out;
  }

  it('parses, and keeps standoff in range', () => {
    expect(PartSchema.safeParse(tines).success).toBe(true);
    expect(PartSchema.safeParse({ ...tines, standoff: -0.1 }).success).toBe(false);
    expect(PartSchema.safeParse({ ...tines, standoff: 0.6 }).success).toBe(false);
  });

  it('accepts a ring of front-anchored tines under a bar', () => {
    expect(problems([tines], ['dot-eyes', 'test-rake-bar', 'test-rake-front-tines'])).toEqual([]);
  });

  it('only lets sticking-out parts stand in front, and standoff needs the front anchor', () => {
    const onFace = { ...tines, id: 'test-front-mouth', slot: 'mouth' as const };
    const loose = {
      ...tines,
      id: 'test-loose-standoff',
      slot: 'horns' as const,
      anchor: undefined,
    };
    expect(
      problems([onFace, loose], ['dot-eyes', 'test-front-mouth', 'test-loose-standoff']),
    ).toEqual([
      expect.stringContaining('"test-front-mouth" can\'t stand in front'),
      expect.stringContaining('"test-loose-standoff" has a standoff'),
    ]);
  });
});
