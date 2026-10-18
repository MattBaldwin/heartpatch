import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Scene } from '@babylonjs/core/scene';
import {
  LIGHTING,
  QUALITY_TIERS,
  SCALER,
  TIER_SETTINGS,
  type QualityTier,
  type ScalerConfig,
} from '../config.js';
import { cappedPixelRatio, hardwareScalingFor } from '../dpr.js';
import {
  cappedScaler,
  initialGovernor,
  resumeGovernor,
  stepGovernor,
  type GovernorState,
} from './governor.js';
import { PostChain } from './post-chain.js';
import { isPhoneScreen, tierBloom } from './tiers.js';
import { setRareGlowForTier } from '../../procedural/rare-glow.js';
import { bisectFlags } from '../bisect-flags.js';

/**
 * Tone mapping, FXAA and bloom with 8-bit targets and no MSAA (tech spec §6
 * "Memory and heat"), built once (`PostChain`). Tone mapping, exposure and
 * contrast are applied inside the materials, before the 8-bit write, not as
 * a post-process. `tier` is where the governor starts: the bloom kernels of
 * it and every tier below that draws bloom on this device (`phone`) are
 * compiled up front.
 */
export function createPostProcessing(
  scene: Scene,
  camera: Camera,
  tier: QualityTier = 'high',
  phone = false,
): PostChain {
  setupToneMapping(scene);
  const reachable = QUALITY_TIERS.slice(QUALITY_TIERS.indexOf(tier)).filter((t) =>
    tierBloom(t, phone),
  );
  const kernels = [...new Set(reachable.map((t) => TIER_SETTINGS[t].bloomKernel))];
  return new PostChain(scene, camera, kernels, cappedPixelRatio(window.devicePixelRatio));
}

/** Tone mapping, exposure and contrast, applied inside the materials (with or without the chain). */
function setupToneMapping(scene: Scene): void {
  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  // Khronos PBR Neutral keeps pastel colours true instead of ACES' contrasty look.
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  ip.exposure = LIGHTING.exposure;
  ip.contrast = LIGHTING.contrast;
}

export interface QualitySnapshot {
  readonly tier: QualityTier;
  /** The tier is pinned for a dev capture (`?tier=`): the governor is off. */
  readonly pinned: boolean;
  readonly renderScale: number;
  /** Render pixels per CSS pixel actually in use. */
  readonly pixelRatio: number;
}

export interface RenderQualityOptions {
  /** Dev captures (`?tier=`): hold the tier at full resolution, with the governor off. */
  readonly pinned?: boolean;
  /** The stage's frame cap (`FrameCap.fps`), which the governor reads as on target. */
  readonly capFps?: number | null;
  /** A phone's screen (no bloom on medium, #501); read from `window.screen` by default. */
  readonly phone?: boolean;
}

/**
 * Post-processing (FXAA, gentle bloom, in-material tone mapping) and the
 * dynamic resolution governor for one scene + camera. The stage feeds it
 * frame times through `sample` (only between consecutive drawn frames, so it
 * pauses while idle). Call `dispose` when the scene goes away.
 */
export class RenderQuality {
  /** None with `?nopost=1` (#501 bisect): no bloom or FXAA pass at all. */
  private readonly pipeline: PostChain | null;
  /** Under a frame cap (explore, `?cap30=1`; #501) the governor reads the cap as on target. */
  private readonly config: Readonly<ScalerConfig>;
  private readonly phone: boolean;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private state: GovernorState;
  private appliedTier: QualityTier | null = null;
  private appliedScale = 0;
  private readonly stop = new AbortController();
  /** Dev captures (`?tier=`): the tier and full resolution hold, whatever the frame rate. */
  private pinned: boolean;

  constructor(
    scene: Scene,
    camera: Camera,
    tier: QualityTier,
    {
      pinned = false,
      capFps = null,
      phone = isPhoneScreen(window.screen),
    }: RenderQualityOptions = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.pinned = pinned;
    this.phone = phone;
    this.config = capFps === null ? SCALER : cappedScaler(SCALER, capFps);
    this.state = initialGovernor(tier, this.config);
    if (bisectFlags().noPost) setupToneMapping(scene);
    this.pipeline = bisectFlags().noPost ? null : createPostProcessing(scene, camera, tier, phone);
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
    if (this.pinned) return false;
    this.state = stepGovernor(this.state, frameMs, {
      config: this.config,
      devicePixelRatio: window.devicePixelRatio,
    });
    return this.pending;
  }

  /** True while the governor's tier or scale isn't applied yet (`applyPending`). */
  get pending(): boolean {
    return this.state.tier !== this.appliedTier || this.state.renderScale !== this.appliedScale;
  }

  /**
   * Dev and tests only (the post-process budget e2e): switch the governor
   * off and hold this tier and render scale, applied at the top of the next
   * frame as a governor change would be. One-way: the governor stays off
   * for this stage.
   */
  hold(tier: QualityTier, renderScale: number): void {
    this.pinned = true;
    this.state = { ...this.state, tier, renderScale };
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
      pinned: this.pinned,
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
    this.pipeline?.setPixelRatio(cappedPixelRatio(window.devicePixelRatio));
    this.appliedScale = 0;
    this.apply();
  }

  dispose(): void {
    this.stop.abort();
    this.pipeline?.dispose();
  }

  /** Pushes the governor's state into Babylon; true if anything changed. */
  private apply(): boolean {
    const { tier, renderScale } = this.state;
    let changed = false;
    if (tier !== this.appliedTier) {
      changed = true;
      const t = TIER_SETTINGS[tier];
      // Attaches or detaches bloom's passes: nothing is rebuilt (#501).
      this.pipeline?.setBloom(tierBloom(tier, this.phone), t.bloomKernel);
      setRareGlowForTier(t.rareGlow);
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
