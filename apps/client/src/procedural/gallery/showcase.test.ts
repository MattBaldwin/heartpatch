import { BODIES, checkSpeciesVisual, PARTS, SPECIES, visualRegistry } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { galleryLooks, showcaseLooks } from './showcase.js';

describe('showcaseLooks', () => {
  const looks = showcaseLooks(BODIES, PARTS);

  it('puts every body and every part on screen', () => {
    expect(new Set(looks.map((l) => l.visual.body))).toEqual(new Set(BODIES.map((b) => b.id)));
    expect(new Set(looks.flatMap((l) => l.visual.parts))).toEqual(new Set(PARTS.map((p) => p.id)));
  });

  it('only builds looks a species could have', () => {
    const registry = visualRegistry({ bodies: BODIES, parts: PARTS });
    const problems: string[] = [];
    for (const look of looks) {
      checkSpeciesVisual(look.visual, registry, [look.id], (path, message) => {
        problems.push(`${path.join('.')}: ${message}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('gives every look a unique id', () => {
    expect(new Set(looks.map((l) => l.id)).size).toBe(looks.length);
  });
});

describe('galleryLooks', () => {
  it('lists every species in the roster first, then the showcase', () => {
    const looks = galleryLooks(SPECIES, BODIES, PARTS);
    expect(looks.slice(0, SPECIES.length).map((l) => l.id)).toEqual(SPECIES.map((s) => s.id));
    expect(new Set(looks.map((l) => l.id)).size).toBe(looks.length);
  });
});
