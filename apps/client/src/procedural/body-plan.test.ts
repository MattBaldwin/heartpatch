import { BODIES, GAME_DATA, visualRegistry, type SpeciesVisual } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { squishyParams, type SquishySpecies } from './params.js';
import { partMatrix } from './placement.js';

const registry = visualRegistry(GAME_DATA);
const body = (id: string) => BODIES.find((b) => b.id === id)!;

const look = (visual: Partial<SpeciesVisual>): SquishySpecies => ({
  id: 'plan-test',
  visual: {
    body: 'barrel',
    palette: ['#b8dcff', '#ffffff', '#5f8fdb'],
    parts: ['dot-eyes'],
    ...visual,
  },
});

/** Row-vector matrix: the y axis is row 1, the translation row 3. */
const yAxis = (m: readonly number[]) => [m[4]!, m[5]!, m[6]!] as const;
const origin = (m: readonly number[]) => [m[12]!, m[13]!, m[14]!] as const;

describe('body plans (ART_BIBLE §1.2)', () => {
  it('lays out four legs, rings and rows', () => {
    const p = squishyParams(
      look({
        parts: ['dot-eyes', 'stubby-legs', 'back-spines', 'icicle-mane'],
        head: { body: 'orb', size: 1, forward: 0.4, up: 0.3 },
      }),
      'a',
      registry,
    );
    const count = (id: string) => p.parts.find((part) => part.id === id)!.placements.length;
    expect(count('stubby-legs')).toBe(4);
    expect(count('back-spines')).toBe(5);
    expect(count('icicle-mane')).toBe(7);
  });

  it('puts face and mane on the head and limbs on the torso', () => {
    const p = squishyParams(
      look({
        parts: ['dot-eyes', 'stubby-legs', 'icicle-mane'],
        head: { body: 'orb', size: 1, forward: 0.4, up: 0.3 },
      }),
      'a',
      registry,
    );
    const host = (id: string) => p.parts.find((part) => part.id === id)!.host;
    expect(host('dot-eyes')).toBe('head');
    expect(host('icicle-mane')).toBe('head');
    expect(host('stubby-legs')).toBe('body');
    expect(p.head?.id).toBe('orb');
  });

  it('sizes and places the head against the torso, and lifts the torso by its stance', () => {
    const p = squishyParams(
      look({ head: { body: 'orb', size: 0.8, forward: 0.5, up: 0.6 }, stance: 0.4 }),
      'a',
      registry,
    );
    const torso = body('barrel').height;
    expect(p.lift).toBeCloseTo(0.4 * torso, 9);
    expect(p.head!.scale[1] * body('orb').height).toBeCloseTo(0.8 * torso, 9);
    expect(p.head!.offset).toEqual([0, p.lift + 0.6 * torso, -0.5 * torso]);
    expect(p.height).toBeCloseTo(p.head!.offset[1] + 0.8 * torso, 9);
  });

  it('grows legs from the lifted torso down to the ground', () => {
    const p = squishyParams(look({ parts: ['dot-eyes', 'long-legs'], stance: 0.6 }), 'a', registry);
    const legs = p.parts.find((part) => part.id === 'long-legs')!;
    for (const placement of legs.placements) {
      const m = partMatrix(body('barrel'), p.body.scale, legs, placement, [0, p.lift, 0]);
      const [ox, oy, oz] = origin(m);
      const [yx, yy, yz] = yAxis(m); // scaled by the leg's length
      const bottom = [ox + yx / 2, oy + yy / 2, oz + yz / 2];
      expect(bottom[1]).toBeCloseTo(0, 9);
      expect(yy).toBeLessThan(0); // pointing down
    }
  });

  it('chains pieces away from the body, shrinking as they go', () => {
    const p = squishyParams(
      look({ body: 'orb', parts: ['dot-eyes', 'serpent-body'], stance: 0.45 }),
      'a',
      registry,
    );
    const chain = p.parts.find((part) => part.id === 'serpent-body')!;
    expect(chain.placements).toHaveLength(9);
    const centres = chain.placements.map((pl) =>
      origin(partMatrix(body('orb'), p.body.scale, chain, pl, [0, p.lift, 0])),
    );
    for (let i = 1; i < centres.length; i++) {
      // Each piece is further behind the body (+z is the back) and no bigger than the last.
      expect(centres[i]![2]).toBeGreaterThan(centres[i - 1]![2]);
      expect(chain.placements[i]!.size[0]).toBeLessThanOrEqual(chain.placements[i - 1]!.size[0]);
    }
  });
});
