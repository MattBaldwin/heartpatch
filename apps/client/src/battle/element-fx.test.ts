import { ELEMENTS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { EffectKind } from './choreography.js';
import { POOL_SIZE } from './effects.js';
import {
  ELEMENT_FX,
  elementFx,
  emit,
  PARTICLE_SHAPES,
  particleAt,
  type EmitAt,
  type ParticleState,
} from './element-fx.js';

const KINDS: EffectKind[] = [
  'trail',
  'impact',
  'flash',
  'bolt',
  'aura',
  'sparkle',
  'droop',
  'dizzy',
  'sleepy',
  'dust',
  'charm',
  'confetti',
];

const at = (kind: EffectKind, element: string | null, extra: Partial<EmitAt> = {}): EmitAt => ({
  kind,
  element,
  strength: 1,
  now: 1000,
  at: { x: 0, y: 1, z: 0 },
  height: 2,
  to: { x: 3, y: 1, z: 2 },
  path: (t) => ({ x: (t - 1000) / 100, y: 1, z: 0 }),
  duration: 200,
  share: 1,
  ...extra,
});

const state = (): ParticleState => ({ x: 0, y: 0, z: 0, scale: 0, yaw: 0, tumble: 0 });

describe('element effects', () => {
  it.each(ELEMENTS.map((e) => e.id))('%s has its own look', (id) => {
    expect(ELEMENT_FX[id]).toBeDefined();
    expect(elementFx(id)).toBe(ELEMENT_FX[id]);
  });

  it('gives an unknown element the light look', () => {
    expect(elementFx('rainbow')).toBe(ELEMENT_FX['light']);
    expect(elementFx(null)).toBe(ELEMENT_FX['light']);
  });

  it('looks different for each element', () => {
    const looks = new Set(ELEMENTS.map((e) => JSON.stringify(ELEMENT_FX[e.id])));
    expect(looks.size).toBe(ELEMENTS.length);
  });

  it('emits particles for every effect and element, with shapes the pool has', () => {
    for (const kind of KINDS) {
      for (const element of [...ELEMENTS.map((e) => e.id), null]) {
        const particles = emit(at(kind, element), 7);
        expect(particles.length, `${kind} ${String(element)}`).toBeGreaterThan(0);
        for (const p of particles) {
          expect(PARTICLE_SHAPES).toContain(p.shape);
          expect(p.life).toBeGreaterThan(0);
          expect(p.size).toBeGreaterThan(0);
          expect(p.born).toBeGreaterThanOrEqual(1000);
        }
      }
    }
  });

  it('never makes more of a shape in one burst than the pool holds', () => {
    for (const kind of KINDS) {
      const particles = emit(at(kind, 'fire', { strength: 1.5 }), 1);
      for (const shape of PARTICLE_SHAPES) {
        expect(particles.filter((p) => p.shape === shape).length).toBeLessThanOrEqual(
          POOL_SIZE[shape],
        );
      }
    }
  });

  it('scatters the same way every time (replays look the same), and differently per cue', () => {
    expect(emit(at('impact', 'stone'), 3)).toEqual(emit(at('impact', 'stone'), 3));
    expect(emit(at('impact', 'stone'), 3)).not.toEqual(emit(at('impact', 'stone'), 4));
  });

  it('makes fewer particles when told to (low tier, reduced motion)', () => {
    expect(emit(at('impact', 'fire', { share: 0.5 }), 1).length).toBeLessThan(
      emit(at('impact', 'fire'), 1).length,
    );
  });

  it('makes a bigger burst for a super hit', () => {
    expect(emit(at('impact', 'leaf', { strength: 1.45 }), 1).length).toBeGreaterThan(
      emit(at('impact', 'leaf', { strength: 0.65 }), 1).length,
    );
  });

  it('streams a trail along the dash', () => {
    const trail = emit(at('trail', 'fire'), 2);
    const xs = trail.map((p) => p.origin.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
  });
});

describe('particleAt', () => {
  const [p] = emit(at('impact', 'water'), 5);
  if (!p) throw new Error('no particle');

  it('is only drawn while alive', () => {
    expect(particleAt(p, p.born - 1, state())).toBe(false);
    expect(particleAt(p, p.born + 1, state())).toBe(true);
    expect(particleAt(p, p.born + p.life, state())).toBe(false);
  });

  it('pops in and shrinks away', () => {
    const s = state();
    particleAt(p, p.born + 1, s);
    const early = s.scale;
    particleAt(p, p.born + p.life * 0.4, s);
    const middle = s.scale;
    particleAt(p, p.born + p.life * 0.99, s);
    expect(early).toBeLessThan(middle);
    expect(s.scale).toBeLessThan(middle);
  });

  it('keeps falling bits above the ground', () => {
    for (const q of emit(at('impact', 'stone'), 9)) {
      for (let t = q.born; t < q.born + q.life; t += 20) {
        const s = state();
        if (particleAt(q, t, s)) expect(s.y).toBeGreaterThan(0);
      }
    }
  });

  it('flies a hex bolt to the other fighter, and a Heart Charm to the wild squishy', () => {
    const [bolt] = emit(at('bolt', 'shadow'), 1);
    const s = state();
    particleAt(bolt!, bolt!.born + bolt!.life - 1, s);
    expect(s.x).toBeCloseTo(3, 0);
    const [charm] = emit(at('charm', null, { duration: 1100 }), 1);
    expect(charm).toMatchObject({ shape: 'heart', life: 1100 });
    particleAt(charm!, charm!.born + charm!.life * 0.6, s);
    // Down at the wild squishy (`at`), thrown from the Keeper (`to`).
    expect(s.x).toBeCloseTo(0, 1);
    expect(charm!.origin).toEqual({ x: 3, y: 1, z: 2 });
  });
});
