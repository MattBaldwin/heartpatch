import { describe, expect, it } from 'vitest';
import { FloaterSchema, SpeciesVisualSchema, type Floater } from './species.js';

describe('FloaterSchema', () => {
  const note: Floater = {
    glyph: 'music-note',
    size: 0.4,
    above: 0.08,
    side: 0.42,
    color: 'detail',
    bob: { height: 0.04, speed: 0.45 },
  };
  const visual = { body: 'heart', palette: ['#9a70f0'], parts: ['happy-eyes'] };

  it('is optional on a species visual and off by default', () => {
    expect(SpeciesVisualSchema.parse(visual)).not.toHaveProperty('floater');
    expect(SpeciesVisualSchema.parse({ ...visual, floater: note }).floater).toEqual(note);
  });

  it('refuses unknown glyphs, colours and fields', () => {
    expect(FloaterSchema.safeParse({ ...note, glyph: 'sparkle-burst' }).success).toBe(false);
    expect(FloaterSchema.safeParse({ ...note, color: 'gold' }).success).toBe(false);
    expect(FloaterSchema.safeParse({ ...note, spin: 1 }).success).toBe(false);
    expect(FloaterSchema.safeParse({ ...note, bob: { ...note.bob, wiggle: 1 } }).success).toBe(
      false,
    );
  });

  it('keeps placement and bob within bounds', () => {
    for (const bad of [
      { size: 0.05 },
      { size: 0.9 },
      { above: -0.6 },
      { above: 0.9 },
      { side: 1.1 },
      { side: -1.1 },
      { bob: { height: 0.3, speed: 0.4 } },
      { bob: { height: 0.04, speed: 3 } },
      { bob: { height: -0.01, speed: 0.4 } },
    ]) {
      expect(FloaterSchema.safeParse({ ...note, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(FloaterSchema.safeParse({ ...note, bob: { height: 0, speed: 0 } }).success).toBe(true);
  });
});
