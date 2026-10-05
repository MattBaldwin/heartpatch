import { ELEMENTS } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import type { EffectKind } from './choreography.js';
import {
  ELEMENT_FX,
  elementFx,
  emit,
  IMPACT,
  PARTICLE_SHAPES,
  particleAt,
  type EmitAt,
  type ParticleState,
} from './element-fx.js';

const at = (extra: Partial<EmitAt> = {}): EmitAt => ({
  kind: 'impact',
  element: 'fire',
  strength: 1,
  now: 1000,
  at: { x: 2, y: 1.5, z: 1 },
  height: 3,
  salt: 1,
  reduced: false,
  ...extra,
});

const KINDS: EffectKind[] = [
  'charge',
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

describe('element signatures', () => {
  it('gives every element in the game its own look', () => {
    const seen = new Set<string>();
    for (const element of ELEMENTS) {
      const fx = ELEMENT_FX[element.id];
      expect(fx, element.id).toBeDefined();
      const key = `${fx!.shape}/${fx!.motion}/${fx!.flourish}`;
      expect(seen.has(key), `${element.id} looks like another element (${key})`).toBe(false);
      seen.add(key);
      expect(PARTICLE_SHAPES).toContain(fx!.shape);
    }
    expect(elementFx('moonbeam')).toBe(ELEMENT_FX['light']);
    expect(elementFx(null)).toBe(ELEMENT_FX['light']);
  });

  it('bursts each element with its own motion and flourish', () => {
    const water = emit(at({ element: 'water' }));
    expect(water.some((p) => p.shape === 'drop' && p.motion === 'ballistic')).toBe(true);
    expect(water.some((p) => p.motion === 'ring')).toBe(true);
    const leaf = emit(at({ element: 'leaf' }));
    expect(leaf.some((p) => p.shape === 'leaf' && p.motion === 'flutter')).toBe(true);
    const stone = emit(at({ element: 'stone' }));
    expect(stone.filter((p) => p.motion === 'ballistic' && p.gravity > 10).length).toBeGreaterThan(
      5,
    );
    const spark = emit(at({ element: 'spark' }));
    expect(spark.some((p) => p.motion === 'zap')).toBe(true);
    const shadow = emit(at({ element: 'shadow' }));
    expect(shadow.some((p) => p.motion === 'swirl')).toBe(true);
    const frost = emit(at({ element: 'frost' }));
    expect(frost.some((p) => p.motion === 'twinkle')).toBe(true);
  });
});

describe('emit', () => {
  it('emits something for every effect kind, all born now or later', () => {
    for (const kind of KINDS) {
      const out = emit(at({ kind, to: { x: -2, y: 1.5, z: -1 }, duration: 500 }));
      expect(out.length, kind).toBeGreaterThan(0);
      for (const p of out) {
        expect(p.born, kind).toBeGreaterThanOrEqual(1000);
        expect(p.life, kind).toBeGreaterThan(0);
        expect(p.size, kind).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic: the same spawn gives the same particles', () => {
    expect(emit(at({ salt: 7 }))).toEqual(emit(at({ salt: 7 })));
    expect(emit(at({ salt: 7 }))).not.toEqual(emit(at({ salt: 8 })));
  });

  it('adds speed lines to a hit, and sky rays only to a super one', () => {
    const normal = emit(at());
    expect(normal.filter((p) => p.motion === 'speedline')).toHaveLength(IMPACT.speedLines);
    expect(normal.filter((p) => p.motion === 'ray')).toHaveLength(0);
    const superHit = emit(at({ strength: 1.45 }));
    expect(superHit.filter((p) => p.motion === 'ray')).toHaveLength(IMPACT.rays);
    expect(superHit.length).toBeGreaterThan(normal.length);
  });

  it('is thinner for reduced motion: fewer bits, no speed lines or rays', () => {
    const calm = emit(at({ strength: 1.45, reduced: true }));
    expect(calm.filter((p) => p.motion === 'speedline' || p.motion === 'ray')).toHaveLength(0);
    expect(calm.length).toBeLessThan(emit(at({ strength: 1.45 })).length);
  });

  it('streams a trail along the dash path', () => {
    const trail = emit(
      at({ kind: 'trail', duration: 200, path: (t) => ({ x: (t - 1000) / 100, y: 1, z: 0 }) }),
    );
    const xs = trail.map((p) => p.origin.x);
    expect(Math.max(...xs)).toBeGreaterThan(Math.min(...xs) + 1);
  });

  it('throws the charm from the thrower to the squishy', () => {
    const charm = emit(at({ kind: 'charm', to: { x: -4, y: 2, z: -3 }, duration: 1300 }));
    const heart = charm.find((p) => p.shape === 'heart');
    expect(heart?.origin).toEqual({ x: -4, y: 2, z: -3 });
    expect(heart?.target?.x).toBe(2);
    expect(heart?.life).toBe(1300);
  });
});

describe('particleAt', () => {
  const state = (): ParticleState => ({
    x: 0,
    y: 0,
    z: 0,
    sx: 1,
    sy: 1,
    sz: 1,
    yaw: 0,
    tumble: 0,
    billboard: false,
    roll: 0,
  });

  it('is alive only during its life, growing in and fading out', () => {
    const [p] = emit(at({ kind: 'dust' }));
    const s = state();
    expect(particleAt(p!, p!.born - 1, s)).toBe(false);
    expect(particleAt(p!, p!.born + p!.life, s)).toBe(false);
    expect(particleAt(p!, p!.born + p!.life * 0.5, s)).toBe(true);
    const mid = s.sx;
    particleAt(p!, p!.born + p!.life * 0.95, s);
    expect(s.sx).toBeLessThan(mid);
  });

  it('keeps thrown things above the ground and billboards lines', () => {
    const s = state();
    for (const p of emit(at({ element: 'stone' }))) {
      for (let t = p.born; t < p.born + p.life; t += 50) {
        if (particleAt(p, t, s) && !s.billboard) expect(s.y).toBeGreaterThanOrEqual(0.05);
      }
    }
    const line = emit(at()).find((p) => p.motion === 'speedline')!;
    particleAt(line, line.born + 50, s);
    expect(s.billboard).toBe(true);
    expect(s.roll).toBe(line.angle);
    expect(s.x).toBeGreaterThan(0);
  });

  it('lands the charm at its target and wobbles there', () => {
    const [heart] = emit(at({ kind: 'charm', to: { x: -4, y: 2, z: -3 }, duration: 1000 }));
    const s = state();
    particleAt(heart!, heart!.born + 600, s);
    expect(s.x).toBeCloseTo(2, 5);
    expect(s.z).toBeCloseTo(1, 5);
    expect(s.y).toBeGreaterThanOrEqual(0.15);
    expect(s.y).toBeLessThan(0.5);
  });
});
