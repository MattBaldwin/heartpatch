import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import type { Scene } from '@babylonjs/core/scene';
import { LIGHTING, SCALER, TIER_SETTINGS, type QualityTier } from '../config.js';
import { hardwareScalingFor } from '../dpr.js';
import { initialGovernor, resumeGovernor, stepGovernor, type GovernorState } from './governor.js';

/**
 * Tone mapping, FXAA and bloom with 8-bit targets and no MSAA (tech spec §6
 * "Memory and heat"). With `hdr = false` Babylon applies image processing
 * (tone mapping, exposure, contrast) inside the materials, before the 8-bit
 * write, instead of as a post-process. Don't set the pipeline's
 * `imageProcessingEnabled` to false: that switches it off for the whole scene.
 */
export function createPostProcessing(scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  // Khronos PBR Neutral keeps pastel colours true instead of ACES' contrasty look.
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  ip.exposure = LIGHTING.exposure;
  ip.contrast = LIGHTING.contrast;

  const pipeline = new DefaultRenderingPipeline('quality', false, scene, [camera]);
  pipeline.samples = 1;
  pipeline.fxaaEnabled = true;
  pipeline.bloomThreshold = LIGHTING.bloomThreshold;
  pipeline.bloomWeight = LIGHTING.bloomWeight;
  pipeline.bloomScale = LIGHTING.bloomScale;
  return pipeline;
}

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
  private readonly stop = new AbortController();

  constructor(scene: Scene, camera: Camera, tier: QualityTier) {
    this.scene = scene;
    this.camera = camera;
    this.state = initialGovernor(tier, SCALER);
    this.pipeline = createPostProcessing(scene, camera);
    this.apply();
    // A frame spanning a pause (tab hidden, app switch, device asleep) is a
    // gap, never a crawling frame (governor `crawl`), however many come
    // around the pause.
    const resume = () => {
      this.state = resumeGovernor(this.state);
    };
    document.addEventListener('visibilitychange', resume, { signal: this.stop.signal });
    window.addEventListener('pageshow', resume, { signal: this.stop.signal });
  }

  /**
   * Feeds one real frame time to the governor. Returns true when it wants a
   * new resolution or tier, which `applyPending` then pushes into Babylon.
   * Never touches the engine itself: it runs right after a draw, and a
   * resize then would clear the frame about to be shown (#260).
   */
  sample(frameMs: number): boolean {
    this.state = stepGovernor(this.state, frameMs, {
      config: SCALER,
      devicePixelRatio: window.devicePixelRatio,
    });
    return this.state.tier !== this.appliedTier || this.state.renderScale !== this.appliedScale;
  }

  /**
   * Applies what `sample` asked for, before a frame is drawn. True if
   * anything changed, so the caller draws with the new settings.
   */
  applyPending(): boolean {
    return this.apply();
  }

  /**
   * The governor's tier and scale, which can be a frame ahead of what's
   * applied (`applyPending` runs at the top of the next frame); `pixelRatio`
   * is what the engine draws at now.
   */
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
    this.stop.abort();
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
