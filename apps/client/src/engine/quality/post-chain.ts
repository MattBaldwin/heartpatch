import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { BloomEffect } from '@babylonjs/core/PostProcesses/bloomEffect';
import { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess';
import type { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { Scene } from '@babylonjs/core/scene';
import { LIGHTING } from '../config.js';

/**
 * Bloom then FXAA on one camera, built once per stage and never rebuilt
 * (#501). Babylon's `DefaultRenderingPipeline` disposes and recreates every
 * post-process, FXAA included, each time bloom is switched (`bloomEnabled`
 * calls `_buildPipeline`): new render targets and recompiled shaders on every
 * tier change, which on a struggling GPU made each of the governor's probes
 * a stall of its own. Here bloom's four passes are attached in front of FXAA
 * or detached from the camera (`attachPostProcess` / `detachPostProcess`),
 * keeping their compiled shaders and their targets for the next time.
 *
 * Same output as the pipeline it replaces: 8-bit targets, no MSAA, tone
 * mapping inside the materials (tech spec §6 "Memory and heat"), bloom over
 * the brightest highlights at half resolution.
 *
 * The blur kernel is set in render pixels at full resolution
 * (`bloomKernel × device pixel ratio`), not at the governor's render scale:
 * a blur kernel is compiled into its shader, so following every scale step
 * would recompile the blur each time. Scaled down, the glow is a touch wider.
 */
export class PostChain {
  private readonly camera: Camera;
  private readonly bloom: BloomEffect;
  /** Bloom's passes in chain order (highlights, blur x, blur y, merge). */
  private readonly bloomPasses: readonly PostProcess[];
  private readonly fxaa: FxaaPostProcess;
  private readonly exposure: Observer<ImageProcessingConfiguration>;
  private readonly scene: Scene;
  private bloomAttached = true;
  private bloomKernel = 0;
  private pixelRatio: number;

  /**
   * `kernels` are every bloom kernel the governor may switch to (one per
   * tier it can reach): each is compiled now, while the stage loads, so a
   * tier change later compiles nothing.
   */
  constructor(scene: Scene, camera: Camera, kernels: readonly number[], pixelRatio: number) {
    this.scene = scene;
    this.camera = camera;
    this.pixelRatio = pixelRatio;
    const engine = scene.getEngine();
    const [first = 0, ...rest] = kernels;
    this.bloom = new BloomEffect(
      scene,
      LIGHTING.bloomScale,
      LIGHTING.bloomWeight,
      first * pixelRatio,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    this.bloom.threshold = LIGHTING.bloomThreshold;
    this.bloomKernel = first;
    // Babylon keeps each compiled effect in the engine's cache, so the
    // blur shaders for the other kernels stay ready once built.
    for (const kernel of rest) this.setBloomKernel(kernel);
    this.setBloomKernel(first); // back on the starting tier's, a cache hit
    const ip = scene.imageProcessingConfiguration;
    this.bloom._downscale._exposure = ip.exposure;
    this.exposure = ip.onUpdateParameters.add(() => {
      this.bloom._downscale._exposure = ip.exposure;
    });
    this.bloomPasses = [...this.bloom._effects];
    this.fxaa = new FxaaPostProcess(
      'fxaa',
      1,
      null,
      Texture.BILINEAR_SAMPLINGMODE,
      engine,
      false,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    // The first pass clears its target (the scene's), as the pipeline did;
    // the rest each draw a full-screen quad over theirs.
    scene.autoClear = false;
    for (const pass of this.bloomPasses) camera.attachPostProcess(pass);
    camera.attachPostProcess(this.fxaa);
    this.updateClears();
  }

  /** Bloom on or off for a tier, with its blur kernel (CSS pixels). */
  setBloom(on: boolean, kernel: number): void {
    if (on) this.setBloomKernel(kernel);
    if (on === this.bloomAttached) return;
    this.bloomAttached = on;
    this.bloomPasses.forEach((pass, i) => {
      // Detaching leaves a null slot, so each pass goes back where it was.
      if (on) this.camera.attachPostProcess(pass, i);
      else this.camera.detachPostProcess(pass);
    });
    this.updateClears();
  }

  /** The device pixel ratio changed (a window moved screens): rescale the blur. */
  setPixelRatio(pixelRatio: number): void {
    if (pixelRatio === this.pixelRatio) return;
    this.pixelRatio = pixelRatio;
    this.bloom.kernel = this.bloomKernel * pixelRatio;
  }

  dispose(): void {
    this.scene.imageProcessingConfiguration.onUpdateParameters.remove(this.exposure);
    // Detached passes still own their targets and shaders.
    for (const pass of this.bloomPasses) pass.dispose(this.camera);
    this.fxaa.dispose(this.camera);
    this.scene.autoClear = true;
  }

  private setBloomKernel(kernel: number): void {
    if (kernel === this.bloomKernel) return;
    this.bloomKernel = kernel;
    this.bloom.kernel = kernel * this.pixelRatio;
  }

  /** Only the chain's first pass clears: it holds the scene's own render. */
  private updateClears(): void {
    const [highlights] = this.bloomPasses;
    if (highlights) highlights.autoClear = true;
    this.fxaa.autoClear = !this.bloomAttached;
  }
}
