import { GAME_DATA, visualRegistry, type Floater, type SpeciesVisual } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { FIXED_COLORS } from './config.js';
import { hexToRgb, paramsHash, squishyParams, type SquishySpecies } from './params.js';

const registry = visualRegistry(GAME_DATA);

const look = (visual: Partial<SpeciesVisual> = {}): SquishySpecies => ({
  id: 'test-puff',
  visual: {
    body: 'blob',
    palette: ['#ffb3c7', '#fff4ea'],
    parts: ['dot-eyes', 'smile', 'round-ears', 'spots'],
    ...visual,
  },
});

/**
 * Pinned so a change to generation (or to these registry entries) is a
 * deliberate one. The gallery e2e test checks the same value in WebKit, which
 * proves the parameters are identical across JS engines. Update both together.
 */
const GOLDEN = {
  species: look(),
  instanceId: 'golden-1',
  hash: '5654119afb5e849d771236b7e645fd4d',
};

describe('squishyParams', () => {
  it('is deterministic for the same species and instance', () => {
    const a = squishyParams(look(), 'squishy-1', registry);
    const b = squishyParams(look(), 'squishy-1', registry);
    expect(b).toEqual(a);
    expect(paramsHash(b)).toBe(paramsHash(a));
  });

  it('varies between instances of one species, but only a little', () => {
    const a = squishyParams(look(), 'squishy-1', registry);
    const b = squishyParams(look(), 'squishy-2', registry);
    expect(paramsHash(b)).not.toBe(paramsHash(a));
    for (const [i, s] of a.body.scale.entries()) {
      expect(Math.abs(s - (b.body.scale[i] ?? 0))).toBeLessThan(0.15);
    }
    expect(a.body.id).toBe(b.body.id);
    expect(a.parts.map((p) => p.id)).toEqual(b.parts.map((p) => p.id));
  });

  it('keeps variation within the body and part jitter', () => {
    const body = registry.bodies.get('blob')!;
    for (let i = 0; i < 200; i++) {
      const p = squishyParams(look(), `jitter-${i}`, registry);
      for (const s of p.body.scale) {
        expect(s).toBeGreaterThanOrEqual(1 - body.jitter);
        expect(s).toBeLessThanOrEqual(1 + body.jitter);
      }
      expect(p.motion.phase).toBeGreaterThanOrEqual(0);
      expect(p.motion.phase).toBeLessThan(1);
      for (const c of p.body.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('does not move other parts when a part is added', () => {
    const before = squishyParams(look({ parts: ['dot-eyes', 'smile'] }), 'same', registry);
    const after = squishyParams(
      look({ parts: ['dot-eyes', 'smile', 'round-ears'] }),
      'same',
      registry,
    );
    const smile = (p: typeof before) => p.parts.find((part) => part.id === 'smile');
    expect(smile(after)).toEqual(smile(before));
    expect(after.body).toEqual(before.body);
  });

  it('mirrors paired parts exactly, so faces stay symmetric', () => {
    const p = squishyParams(look(), 'pair', registry);
    const eyes = p.parts.find((part) => part.id === 'dot-eyes')!;
    const [left, right] = eyes.placements;
    expect(left?.side).toBe(-1);
    expect(right?.side).toBe(1);
    expect(left?.around).toBe(-(right?.around ?? 0));
    expect(left?.up).toBe(right?.up);
    expect(left?.size).toEqual(right?.size);
  });

  it('adds a white glint after eyes with a highlight, and keeps mouths centred', () => {
    const p = squishyParams(look(), 'glint', registry);
    expect(p.parts.map((part) => part.id)).toEqual([
      'dot-eyes',
      'dot-eyes-glint',
      'smile',
      'round-ears',
      'spots',
    ]);
    const glint = p.parts[1]!;
    expect(glint.color).toEqual(hexToRgb(FIXED_COLORS.white));
    expect(glint.lift).toBeGreaterThan(0);
    expect(p.parts.find((part) => part.id === 'smile')?.placements[0]?.around).toBe(0);
  });

  it('scatters pattern pieces apart and varies them per squishy', () => {
    const spots = (id: string) =>
      squishyParams(look(), id, registry).parts.find((part) => part.id === 'spots')!;
    const a = spots('spots-a');
    expect(a.placements.length).toBeGreaterThan(2);
    expect(a.placements.length).toBeLessThanOrEqual(6);
    for (const [i, p] of a.placements.entries()) {
      for (const q of a.placements.slice(i + 1)) {
        const d = Math.hypot(p.around - q.around, p.up - q.up) * (180 / Math.PI);
        expect(d).toBeGreaterThanOrEqual(18 - 1e-9);
      }
    }
    expect(spots('spots-b').placements).not.toEqual(a.placements);
  });

  it('scales with the species size', () => {
    const small = squishyParams(look(), 'size', registry);
    const big = squishyParams(look({ size: 1.5 }), 'size', registry);
    expect(big.height).toBeCloseTo(small.height * 1.5, 10);
    const ear = (p: typeof small) => p.parts.find((part) => part.id === 'round-ears')!;
    expect(ear(big).placements[0]!.size[0]).toBeCloseTo(ear(small).placements[0]!.size[0] * 1.5);
  });

  it('falls back from palette gaps to related colours', () => {
    const p = squishyParams(
      look({ palette: ['#ff8a3d'], parts: ['dot-eyes', 'belly-patch'] }),
      'x',
      registry,
    );
    const belly = p.parts.find((part) => part.id === 'belly-patch')!;
    expect(belly.color).not.toEqual(p.body.color); // secondary is a lighter primary
  });

  it('draws unknown bodies and parts with what it has and reports them', () => {
    const p = squishyParams(
      look({ body: 'hovercraft', parts: ['dot-eyes', 'jetpack'] }),
      'x',
      registry,
    );
    expect(p.missing).toEqual(['hovercraft', 'jetpack']);
    expect(p.body.id).toBe('blob');
    expect(p.parts.map((part) => part.id)).toEqual(['dot-eyes', 'dot-eyes-glint']);
  });

  it('matches the pinned golden hash', () => {
    const p = squishyParams(GOLDEN.species, GOLDEN.instanceId, registry);
    expect(paramsHash(p)).toBe(GOLDEN.hash);
  });
});

describe('optional species visual fields stay off by default', () => {
  it('builds every public species without a floater key', () => {
    // The client never loads secret species (CLAUDE.md rule 6); the shared
    // `species-visual-defaults` test covers their visuals.
    for (const species of GAME_DATA.species) {
      expect(species.visual, species.id).not.toHaveProperty('floater');
      for (const instanceId of ['a', 'b']) {
        expect(squishyParams(species, instanceId, registry), species.id).not.toHaveProperty(
          'floater',
        );
      }
    }
  });
});

describe('floater params', () => {
  const floater: Floater = {
    glyph: 'music-note',
    size: 0.4,
    above: 0.1,
    side: 0.4,
    color: 'detail',
    bob: { height: 0.05, speed: 0.5 },
  };
  const singer = look({ palette: ['#9a70f0', '#ffd0e6', '#1e0a2e', '#ffb627'], floater });

  it('adds only a floater: everything else is built as before', () => {
    const plain = squishyParams(look({ palette: singer.visual.palette }), 'same', registry);
    const { floater: built, ...rest } = squishyParams(singer, 'same', registry);
    expect(rest).toEqual(plain);
    expect(built).toBeDefined();
  });

  it('floats above the top and to the viewer’s right, sized from the body', () => {
    const p = squishyParams(singer, 'f', registry);
    const blob = registry.bodies.get('blob')!;
    const f = p.floater!;
    expect(f.glyph).toBe('music-note');
    expect(f.size).toBeCloseTo(0.4 * blob.height);
    expect(f.at[0]).toBeCloseTo(0.4 * blob.width);
    // Its bottom is `above` over the top.
    expect(f.at[1] - f.size / 2).toBeCloseTo(p.height + 0.1 * blob.height);
    expect(f.at[2]).toBe(0);
    // The palette's `detail` gold (with this squishy's small colour variation).
    expect(f.color[0] - f.color[2]).toBeGreaterThan(0.6);
    expect(f.bob).toEqual({ height: 0.05 * blob.height, speed: 0.5 });
    expect(
      squishyParams({ ...singer, visual: { ...singer.visual, size: 1.5 } }, 'f', registry).floater!
        .size,
    ).toBeCloseTo(f.size * 1.5);
  });

  it('glows with the parts', () => {
    expect(squishyParams(singer, 'g', registry).floater!.glow).toBe(false);
    const glowing = look({ ...singer.visual, glow: 'body' });
    expect(squishyParams(glowing, 'g', registry).floater!.glow).toBe(true);
    const accent = look({ ...singer.visual, glow: 'accent' });
    expect(squishyParams(accent, 'g', registry).floater!.glow).toBe(false);
  });
});

describe('sparkle kept off a face', () => {
  it('adds only the flag: everything else is built as before', () => {
    const plain = squishyParams(look(), 'same', registry);
    const { sparkleOffFace, ...rest } = squishyParams(
      look({ sparkleOffFace: true }),
      'same',
      registry,
    );
    expect(sparkleOffFace).toBe(true);
    expect(rest).toEqual(plain);
    expect(squishyParams(look({ sparkleOffFace: false }), 'same', registry)).toEqual(plain);
  });

  it('is off for every public species', () => {
    for (const species of GAME_DATA.species) {
      expect(squishyParams(species, 'x', registry), species.id).not.toHaveProperty(
        'sparkleOffFace',
      );
    }
  });
});
