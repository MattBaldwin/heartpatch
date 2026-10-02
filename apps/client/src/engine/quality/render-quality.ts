import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Observer } from '@babylonjs/core/Misc/observable';
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
 * Post-processing (MSAA/FXAA, gentle bloom, tone mapping) and the dynamic
 * resolution governor for one scene + camera. Call `dispose` when the scene
 * goes away.
 */
export class RenderQuality {
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly observer: Observer<Scene> | null;
  private readonly scene: Scene;
  private state: GovernorState;
  private appliedTier: QualityTier | null = null;
  private appliedScale = 0;

  constructor(scene: Scene, camera: Camera, tier: QualityTier) {
    this.scene = scene;
    this.state = initialGovernor(tier, SCALER);

    // HDR intermediate targets when the GPU can render to half floats, so
    // bloom picks up highlights above 1.0; 8-bit otherwise.
    this.pipeline = new DefaultRenderingPipeline('quality', true, scene, [camera]);
    this.pipeline.fxaaEnabled = true;
    this.pipeline.bloomThreshold = LIGHTING.bloomThreshold;
    this.pipeline.bloomWeight = LIGHTING.bloomWeight;
    this.pipeline.bloomScale = LIGHTING.bloomScale;
    this.pipeline.imageProcessingEnabled = true;
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    // Khronos PBR Neutral keeps pastel colours true instead of ACES' contrasty look.
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = LIGHTING.exposure;
    ip.contrast = LIGHTING.contrast;

    this.apply();
    this.observer = scene.onAfterRenderObservable.add(() => {
      this.state = stepGovernor(this.state, scene.getEngine().getDeltaTime(), {
        config: SCALER,
        devicePixelRatio: window.devicePixelRatio,
      });
      this.apply();
    });
  }

  get snapshot(): QualitySnapshot {
    return {
      tier: this.state.tier,
      renderScale: this.state.renderScale,
      pixelRatio: 1 / this.scene.getEngine().getHardwareScalingLevel(),
    };
  }

  /** Re-applies the pixel ratio, e.g. after the window moves to another screen. */
  refreshPixelRatio(): void {
    this.appliedScale = 0;
    this.apply();
  }

  dispose(): void {
    this.scene.onAfterRenderObservable.remove(this.observer);
    this.pipeline.dispose();
  }

  private apply(): void {
    const { tier, renderScale } = this.state;
    if (tier !== this.appliedTier) {
      const t = TIER_SETTINGS[tier];
      this.pipeline.samples = t.msaaSamples;
      this.pipeline.bloomEnabled = t.bloom;
      if (t.bloom) this.pipeline.bloomKernel = t.bloomKernel;
      this.appliedTier = tier;
    }
    if (renderScale !== this.appliedScale) {
      this.scene
        .getEngine()
        .setHardwareScalingLevel(hardwareScalingFor(window.devicePixelRatio, renderScale));
      this.appliedScale = renderScale;
    }
  }
}
