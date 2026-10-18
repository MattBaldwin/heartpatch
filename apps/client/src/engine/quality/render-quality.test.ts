import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Constants } from '@babylonjs/core/Engines/constants';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rareGlow from '../../procedural/rare-glow.js';
import { NO_BISECT, setBisectFlags } from '../bisect-flags.js';
import { LIGHTING, TIER_SETTINGS, type QualityTier } from '../config.js';
import { createPostProcessing, RenderQuality } from './render-quality.js';

/** Shader programs the engine has compiled (its effect cache; a cache hit compiles nothing). */
const compiledEffects = (engine: NullEngine) =>
  Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects).length;

describe('createPostProcessing', () => {
  const engine = new NullEngine();
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 2, addEventListener: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  function setup(tier: QualityTier = 'high') {
    const scene = new Scene(engine);
    const camera = new TargetCamera('cam', Vector3.Zero(), scene);
    const chain = createPostProcessing(scene, camera, tier);
    const passes = () => camera._postProcesses.filter((p) => p !== null).map((p) => p.name);
    return { scene, camera, chain, passes };
  }

  it('tone-maps inside the materials, not as a post-process', () => {
    const { scene, passes } = setup();
    const ip = scene.imageProcessingConfiguration;
    expect(ip.isEnabled).toBe(true);
    expect(ip.applyByPostProcess).toBe(false);
    expect(ip.toneMappingEnabled).toBe(true);
    expect(passes()).not.toContain('imageProcessing');
  });

  it('draws bloom, then FXAA, on 8-bit targets with no MSAA', () => {
    const { camera, passes } = setup();
    expect(passes()).toEqual([
      'highlights',
      'horizontal blur',
      'vertical blur',
      'bloomMerge',
      'fxaa',
    ]);
    for (const p of camera._postProcesses) {
      expect(p?.samples).toBe(1);
      expect((p as unknown as { _textureType: number })._textureType).toBe(
        Constants.TEXTURETYPE_UNSIGNED_BYTE,
      );
    }
  });

  it('switches bloom by attaching its passes, building and compiling nothing (#501)', () => {
    const { camera, chain, passes } = setup();
    const built = [...camera._postProcesses];
    const compiled = compiledEffects(engine);
    const postProcesses = engine.postProcesses.length;
    // high → low → medium → high → low: every bloom kernel was compiled up front.
    for (const [on, kernel] of [
      [false, 0],
      [true, TIER_SETTINGS.medium.bloomKernel],
      [true, TIER_SETTINGS.high.bloomKernel],
      [false, 0],
    ] as const) {
      chain.setBloom(on, kernel);
      expect(passes()).toEqual(
        on ? ['highlights', 'horizontal blur', 'vertical blur', 'bloomMerge', 'fxaa'] : ['fxaa'],
      );
    }
    chain.setBloom(true, TIER_SETTINGS.high.bloomKernel);
    expect(camera._postProcesses).toEqual(built); // the same passes, back in their places
    expect(compiledEffects(engine)).toBe(compiled);
    expect(engine.postProcesses.length).toBe(postProcesses);
  });

  it('clears once per frame, in whichever pass comes first', () => {
    const { scene, camera, chain } = setup();
    const fxaa = camera._postProcesses.at(-1);
    expect(scene.autoClear).toBe(false);
    expect(camera._postProcesses[0]?.autoClear).toBe(true);
    expect(fxaa?.autoClear).toBe(false);
    chain.setBloom(false, 0);
    expect(fxaa?.autoClear).toBe(true);
  });

  it('follows the scene exposure into the highlights pass (battle moods)', () => {
    const { scene, camera } = setup();
    const highlights = camera._postProcesses[0] as unknown as { _exposure: number };
    expect(highlights._exposure).toBe(LIGHTING.exposure);
    scene.imageProcessingConfiguration.exposure = 1.4;
    expect(highlights._exposure).toBe(1.4);
  });

  it('frees every pass on dispose, attached or not', () => {
    const before = engine.postProcesses.length;
    const { scene, camera, chain } = setup();
    chain.setBloom(false, 0);
    chain.dispose();
    expect(engine.postProcesses.length).toBe(before);
    expect(camera._postProcesses.filter(Boolean)).toHaveLength(0);
    expect(scene.autoClear).toBe(true);
  });
});

describe('RenderQuality', () => {
  const engine = new NullEngine();
  // Client unit tests run in Node: just the bits of the DOM it listens to.
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 2, addEventListener: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const scene of [...engine.scenes]) scene.dispose();
  });

  it('asks for a rescale after a draw, and only applies it when told (#260)', () => {
    const scene = new Scene(engine);
    const quality = new RenderQuality(
      scene,
      new TargetCamera('cam', Vector3.Zero(), scene),
      'high',
    );
    const scaling = vi.spyOn(engine, 'setHardwareScalingLevel');
    // 25 fps, past the grace and a whole window: the governor wants less.
    let asked = false;
    for (let i = 0; i < 500 && !asked; i++) asked = quality.sample(40);
    expect(asked).toBe(true);
    // sample() runs right after a draw: resizing the canvas then would clear
    // the frame about to be shown.
    expect(scaling).not.toHaveBeenCalled();
    expect(quality.applyPending()).toBe(true);
    expect(scaling).toHaveBeenCalledTimes(1);
    expect(quality.snapshot.renderScale).toBeLessThan(1);
    expect(quality.applyPending()).toBe(false);
  });

  it('changes tier without rebuilding or recompiling any post-process (#501)', () => {
    const scene = new Scene(engine);
    const camera = new TargetCamera('cam', Vector3.Zero(), scene);
    const quality = new RenderQuality(scene, camera, 'high');
    const compiled = compiledEffects(engine);
    const built = [...camera._postProcesses];
    for (const tier of ['low', 'medium', 'high', 'low'] as const) {
      quality.hold(tier, 1);
      expect(quality.pending).toBe(true);
      expect(quality.applyPending()).toBe(true);
      expect(quality.pending).toBe(false);
      expect(camera._postProcesses.filter(Boolean)).toHaveLength(tier === 'low' ? 1 : 5);
    }
    quality.hold('high', 0.8);
    quality.applyPending();
    expect(camera._postProcesses).toEqual(built);
    expect(compiledEffects(engine)).toBe(compiled);
    quality.dispose();
  });

  it('hold switches the governor off (dev budget e2e)', () => {
    const scene = new Scene(engine);
    const quality = new RenderQuality(
      scene,
      new TargetCamera('cam', Vector3.Zero(), scene),
      'high',
    );
    quality.hold('medium', 0.9);
    quality.applyPending();
    for (let i = 0; i < 50; i++) expect(quality.sample(2000)).toBe(false);
    expect(quality.snapshot).toMatchObject({ tier: 'medium', renderScale: 0.9, pinned: true });
  });

  it('switches the rare glow with each tier’s setting (#391)', () => {
    const shown = vi.spyOn(rareGlow, 'setRareGlowForTier');
    for (const tier of ['high', 'medium', 'low'] as const) {
      const scene = new Scene(engine);
      new RenderQuality(scene, new TargetCamera('cam', Vector3.Zero(), scene), tier);
      expect(shown).toHaveBeenLastCalledWith(TIER_SETTINGS[tier].rareGlow);
    }
    shown.mockRestore();
  });

  it('holds a pinned tier at full resolution, however slow (dev captures, #335)', () => {
    const scene = new Scene(engine);
    const quality = new RenderQuality(
      scene,
      new TargetCamera('cam', Vector3.Zero(), scene),
      'high',
      { pinned: true },
    );
    // A software renderer: seconds a frame, which would crawl straight to low.
    for (let i = 0; i < 50; i++) expect(quality.sample(2000)).toBe(false);
    expect(quality.applyPending()).toBe(false);
    expect(quality.snapshot).toMatchObject({ tier: 'high', renderScale: 1, pinned: true });
  });

  describe('phones (#501)', () => {
    const passes = (camera: TargetCamera) => camera._postProcesses.filter(Boolean).length;

    it('draws FXAA alone on medium on a phone; an iPad keeps bloom', () => {
      for (const [phone, expected] of [
        [true, 1],
        [false, 5],
      ] as const) {
        const scene = new Scene(engine);
        const camera = new TargetCamera('cam', Vector3.Zero(), scene);
        const quality = new RenderQuality(scene, camera, 'medium', { phone });
        expect(passes(camera), phone ? 'phone' : 'iPad').toBe(expected);
        quality.dispose();
      }
    });

    it('keeps bloom on high on a phone, and drops it at the step to medium', () => {
      const scene = new Scene(engine);
      const camera = new TargetCamera('cam', Vector3.Zero(), scene);
      const quality = new RenderQuality(scene, camera, 'high', { phone: true });
      expect(passes(camera)).toBe(5);
      quality.hold('medium', 1);
      quality.applyPending();
      expect(passes(camera)).toBe(1);
      quality.dispose();
    });

    it('reads a phone from the screen by default', () => {
      vi.stubGlobal('window', {
        devicePixelRatio: 3,
        addEventListener: vi.fn(),
        screen: { width: 393, height: 852 },
      });
      const scene = new Scene(engine);
      const camera = new TargetCamera('cam', Vector3.Zero(), scene);
      const quality = new RenderQuality(scene, camera, 'medium');
      expect(passes(camera)).toBe(1);
      quality.dispose();
    });
  });

  describe('bisect flags (#501)', () => {
    afterEach(() => {
      setBisectFlags(NO_BISECT);
    });

    it('draws no post-process with ?nopost=1, still tone-mapping in the materials', () => {
      setBisectFlags({ ...NO_BISECT, noPost: true });
      const scene = new Scene(engine);
      const camera = new TargetCamera('cam', Vector3.Zero(), scene);
      const quality = new RenderQuality(scene, camera, 'high');
      expect(camera._postProcesses.filter(Boolean)).toHaveLength(0);
      expect(scene.imageProcessingConfiguration.toneMappingEnabled).toBe(true);
      expect(quality.ready).toBe(true);
      quality.dispose();
    });
  });

  describe('frame cap (#501)', () => {
    const sampleAt = (quality: RenderQuality, fps: number): boolean => {
      let asked = false;
      for (let i = 0; i < 500 && !asked; i++) asked = quality.sample(1000 / fps);
      return asked;
    };

    it('holds the cap as on target', () => {
      const scene = new Scene(engine);
      const quality = new RenderQuality(
        scene,
        new TargetCamera('cam', Vector3.Zero(), scene),
        'high',
        { capFps: 30 },
      );
      expect(sampleAt(quality, 30)).toBe(false);
      expect(quality.snapshot).toMatchObject({ tier: 'high', renderScale: 1 });
    });

    it('still steps down when a capped scene falls well below its cap', () => {
      const scene = new Scene(engine);
      const quality = new RenderQuality(
        scene,
        new TargetCamera('cam', Vector3.Zero(), scene),
        'high',
        { capFps: 30 },
      );
      expect(sampleAt(quality, 15)).toBe(true);
    });

    it('reads 30 fps as slow without a cap', () => {
      const scene = new Scene(engine);
      const quality = new RenderQuality(
        scene,
        new TargetCamera('cam', Vector3.Zero(), scene),
        'high',
      );
      expect(sampleAt(quality, 30)).toBe(true);
    });
  });
});
