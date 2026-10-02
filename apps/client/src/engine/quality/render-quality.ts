import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { Scene } from '@babylonjs/core/scene';
import { LIGHTING, SCALER, TIER_SETTINGS, type QualityTier } from '../config.js';
import { hardwareScalingFor } from '../dpr.js';
import { initialGovernor, stepGovernor, type GovernorState } from './governor.js';

export interface QualitySnapshot {
  readonly tier: QualityTier;
  readonly renderScale: number;
  /** Render pixels per CSS pixel actually in use. */
  readonly pixelRatio: number;
}

/**
 * Post-processing (FXAA, gentle bloom, in-material tone mapping) and the
 * dynamic resolution governor for one scene + camera. The stage feeds it
 * frame times through `sample` (only between consecutive drawn frames, so it
 * pauses while idle). Call `dispose` when the scene goes away.
 */
export class RenderQuality {
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private state: GovernorState;
  private appliedTier: QualityTier | null = null;
  private appliedScale = 0;

  constructor(scene: Scene, camera: Camera, tier: QualityTier) {
    this.scene = scene;
    this.camera = camera;
    this.state = initialGovernor(tier, SCALER);

    // Tone mapping runs inside the materials, before the 8-bit write, so the
    // post chain needs no half-float targets (tech spec §6 "Memory and heat").
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    // Khronos PBR Neutral keeps pastel colours true instead of ACES' contrasty look.
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = LIGHTING.exposure;
    ip.contrast = LIGHTING.contrast;

    // 8-bit targets, no MSAA: FXAA is the only anti-aliasing on every tier.
    this.pipeline = new DefaultRenderingPipeline('quality', false, scene, [camera]);
    this.pipeline.samples = 1;
    this.pipeline.imageProcessingEnabled = false;
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomThreshold = LIGHTING.bloomThreshold;
    this.pipeline.bloomWeight = LIGHTING.bloomWeight;
    this.pipeline.bloomScale = LIGHTING.bloomScale;

    this.apply();
  }

  /**
   * Feeds one real frame time to the governor. Returns true when it changed
   * resolution or tier, so the caller can draw a frame with the new settings.
   */
  sample(frameMs: number): boolean {
    this.state = stepGovernor(this.state, frameMs, {
      config: SCALER,
      devicePixelRatio: window.devicePixelRatio,
    });
    return this.apply();
  }

  get snapshot(): QualitySnapshot {
    return {
      tier: this.state.tier,
      renderScale: this.state.renderScale,
      pixelRatio: 1 / this.scene.getEngine().getHardwareScalingLevel(),
    };
  }

  /**
   * True once the post-process shaders (FXAA, bloom) have compiled. They
   * compile asynchronously and `scene.isReady()` doesn't cover them; drawing
   * before they're ready presents an empty frame. (`_postProcesses` is
   * Babylon-internal but typed.)
   */
  get ready(): boolean {
    return this.camera._postProcesses.every((p) => !p || p.isReady());
  }

  /** Re-applies the pixel ratio, e.g. after the window moves to another screen. */
  refreshPixelRatio(): void {
    this.appliedScale = 0;
    this.apply();
  }

  dispose(): void {
    this.pipeline.dispose();
  }

  /** Pushes the governor's state into Babylon; true if anything changed. */
  private apply(): boolean {
    const { tier, renderScale } = this.state;
    let changed = false;
    if (tier !== this.appliedTier) {
      changed = true;
      const t = TIER_SETTINGS[tier];
      this.pipeline.bloomEnabled = t.bloom;
      if (t.bloom) this.pipeline.bloomKernel = t.bloomKernel;
      this.appliedTier = tier;
    }
    if (renderScale !== this.appliedScale) {
      this.scene
        .getEngine()
        .setHardwareScalingLevel(hardwareScalingFor(window.devicePixelRatio, renderScale));
      this.appliedScale = renderScale;
      changed = true;
    }
    return changed;
  }
}
