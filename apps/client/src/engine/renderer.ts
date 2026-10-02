import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Logger } from '@babylonjs/core/Misc/logger';

export type RendererKind = 'webgpu' | 'webgl2' | 'webgl1';
/** `webgpu` means "try WebGPU, fall back to WebGL2". */
export type RendererPreference = 'webgpu' | 'webgl2';

export interface Renderer {
  readonly engine: AbstractEngine;
  readonly kind: RendererKind;
  /**
   * Subscribes to unrecoverable GPU loss (WebGPU device loss). WebGL context
   * loss is restored by Babylon itself, so this never fires for WebGL.
   */
  onLost(callback: () => void): void;
}

/**
 * WebGL2 is the Phase 1 default and WebGPU is opt-in (tech spec §6,
 * DECISIONS 2026-10-02 E): `?renderer=webgpu` until the settings screen
 * exists.
 */
export function parseRendererPreference(value: string | null | undefined): RendererPreference {
  return value === 'webgpu' ? 'webgpu' : 'webgl2';
}

/**
 * WebGPU when asked for and available, WebGL2 otherwise. Each engine is
 * imported on demand so a device only downloads the one it uses.
 *
 * A canvas that has handed out a `webgpu` context can never give a `webgl2`
 * one, so `freshCanvas` must swap in a new element before every attempt after
 * the first.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  preference: RendererPreference,
  freshCanvas: () => HTMLCanvasElement,
): Promise<Renderer> {
  if (preference === 'webgpu' && 'gpu' in navigator) {
    try {
      return await createWebGPU(canvas);
    } catch (err) {
      Logger.Warn(`WebGPU unavailable, using WebGL2: ${String(err)}`);
      canvas = freshCanvas();
    }
  }
  return createWebGL(canvas);
}

async function createWebGPU(canvas: HTMLCanvasElement): Promise<Renderer> {
  const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine');
  // Checked first because a failed initAsync logs a console error.
  if (!(await WebGPUEngine.IsSupportedAsync)) throw new Error('no WebGPU adapter');
  const engine = new WebGPUEngine(canvas, {
    antialias: false, // no MSAA on the default framebuffer; FXAA runs as a post-process
    stencil: true,
    powerPreference: 'high-performance',
    // We replace the engine with WebGL2 on device loss instead of letting
    // Babylon re-create the WebGPU device (see onLost below).
    doNotHandleContextLost: true,
  });
  try {
    await engine.initAsync();
  } catch (err) {
    engine.dispose();
    throw err;
  }
  if (import.meta.env.DEV) warnOnGlslFallback(engine);

  return {
    engine,
    kind: 'webgpu',
    onLost(callback) {
      // `_device` is Babylon-internal but typed; Babylon only exposes loss via
      // its own restore path, which we turned off above.
      void engine._device.lost.then(() => {
        if (!engine.isDisposed) callback();
      });
    },
  };
}

async function createWebGL(canvas: HTMLCanvasElement): Promise<Renderer> {
  const { Engine } = await import('@babylonjs/core/Engines/engine');
  const engine = new Engine(
    canvas,
    false, // no MSAA on the default framebuffer; FXAA runs as a post-process
    { stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: false },
    false, // we manage the pixel ratio ourselves (dpr.ts)
  );
  return {
    engine,
    kind: engine.webGLVersion >= 2 ? 'webgl2' : 'webgl1',
    onLost() {
      // Babylon restores lost WebGL contexts itself.
    },
  };
}

/**
 * Under WebGPU, a GLSL shader makes Babylon download its glslang/twgsl WASM
 * converters from a CDN: slow, and outside the first-load budget (tech spec
 * §6). Warn loudly in dev so it's caught before it ships.
 */
function warnOnGlslFallback(engine: { prepareGlslangAndTintAsync(): Promise<void> }): void {
  const original = engine.prepareGlslangAndTintAsync.bind(engine);
  engine.prepareGlslangAndTintAsync = () => {
    Logger.Error('A GLSL shader was compiled under WebGPU; write it in WGSL (tech spec §6).');
    return original();
  };
}
