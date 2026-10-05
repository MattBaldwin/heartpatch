import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';
import { EYE_FLARE, HOLLOW_ARM, HOLLOW_HEM, HOLLOW_MAN } from './hollow-man-config.js';
import { armMatrix, HollowMan, raggedHem } from './hollow-man.js';

const H = HOLLOW_MAN.height;

describe('the Hollow Man (spooky-tense, owner decision 2026-10-04)', () => {
  const engine = new NullEngine({
    renderWidth: 390,
    renderHeight: 844,
    textureSize: 1,
    deterministicLockstep: false,
    lockstepMaxSteps: 1,
  });
  afterEach(() => {
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  const meshes = (scene: Scene) =>
    scene.meshes.filter((m) => m.name.startsWith('hollow-man')) as Mesh[];

  it('is three draw calls: body, both arms as thin instances of one mesh, and eyes', () => {
    const scene = new Scene(engine);
    new HollowMan(scene);
    const built = meshes(scene);
    expect(built.map((m) => m.name).sort()).toEqual([
      'hollow-man-arms',
      'hollow-man-body',
      'hollow-man-eyes',
    ]);
    expect(built.find((m) => m.name === 'hollow-man-arms')?.thinInstanceCount).toBe(2);
  });

  it('hangs his long arms at his sides, clear of the cloak, and reaches out, forward and down', () => {
    for (const side of [-1, 1] as const) {
      const shoulder = armMatrix(side, 0, H).matrix.getTranslation();
      const rest = armMatrix(side, 0, H).wrist;
      // Hanging: well below the shoulder, out to his own side, nearly to his knees.
      expect(Math.sign(rest.x)).toBe(side);
      expect(Math.abs(rest.x)).toBeGreaterThan(Math.abs(shoulder.x));
      expect(rest.y).toBeLessThan(shoulder.y - HOLLOW_ARM.length * H * 0.9);
      expect(Math.abs(rest.z - shoulder.z)).toBeLessThan(1e-6);
      // Reaching: out in front (−z, the camera's side) and still a little below the shoulder.
      const reach = armMatrix(side, 1, H).wrist;
      expect(Math.sign(reach.x)).toBe(side);
      expect(reach.z).toBeLessThan(shoulder.z - HOLLOW_ARM.length * H * 0.8);
      expect(reach.y).toBeLessThan(shoulder.y);
    }
  });

  it('frays the bottom of his cloak into soft tatters, and nothing above it', () => {
    const ring = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2];
    }).flat();
    const high = [0.1, H * 0.5, 0];
    const positions = [...ring, ...high];
    raggedHem(positions, H);
    const ys = ring.map((_, i) => positions[i * 3 + 1]!).filter((_, i) => i < 28);
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeGreaterThan(HOLLOW_HEM.depth * H * 0.8);
    expect(positions.slice(-3)).toEqual(high);
  });

  it('raises his arms and flares his eyes as he reaches, and settles back at rest', () => {
    const scene = new Scene(engine);
    const man = new HollowMan(scene);
    const eyes = meshes(scene).find((m) => m.name === 'hollow-man-eyes')!;
    const eyeMat = eyes.material as StandardMaterial;
    const calm = eyeMat.emissiveColor.clone();
    const matrices = () => Array.from(man.armData);
    const resting = matrices();

    man.pose({ x: 0, y: 0, z: 0 }, 1, 1, 1, 1);
    expect(matrices()).not.toEqual(resting);
    expect(eyes.scaling.x).toBeCloseTo(EYE_FLARE.scale);
    expect(eyeMat.emissiveColor.r + eyeMat.emissiveColor.g).toBeGreaterThan(calm.r + calm.g);

    // Reduced motion: the cinematic passes no flare, so the eyes never flash.
    man.pose({ x: 0, y: 0, z: 0 }, 1, 1, 1, 0);
    expect(eyes.scaling.x).toBe(1);
    expect(eyeMat.emissiveColor.equalsWithEpsilon(calm, 1e-6)).toBe(true);

    man.pose({ x: 0, y: 0, z: 0 }, 1, 1, 0, 0);
    expect(matrices()).toEqual(resting);
  });

  it('keeps his arms down on a map visit', () => {
    const scene = new Scene(engine);
    const man = new HollowMan(scene);
    const arms = meshes(scene).find((m) => m.name === 'hollow-man-arms')!;
    const resting = Array.from(man.armData);
    man.pose({ x: 0, y: 0, z: 0 }, 1, 1, 1, 1);
    man.pose({ x: 0, y: 0, z: 0 }, 0);
    man.visit({ x: 1, y: 0, z: 1 });
    expect(man.isVisiting).toBe(true);
    expect(Array.from(man.armData)).toEqual(resting);
    expect(arms.thinInstanceCount).toBe(2);
  });
});
