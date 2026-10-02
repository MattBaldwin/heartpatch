/**
 * Renderer lifecycle: start on the preferred renderer and, if the GPU context
 * is lost (iOS drops it under memory pressure and when a home-screen app is
 * backgrounded), tear everything down and start again on WebGL2 on a fresh
 * canvas (tech spec §6). That covers WebGPU device loss and a restored WebGL
 * context alike, so every resource is re-created exactly as on first load.
 *
 * Kept free of Babylon and the DOM (everything is injected) so the restart
 * path is unit-tested; real WebGPU device loss can't happen in CI.
 */

export interface LosableRenderer {
  readonly kind: string;
  readonly engine: { dispose(): void };
  onLost(callback: () => void): void;
}

export interface Disposable {
  dispose(): void;
}

export interface BootOptions<R extends LosableRenderer, S extends Disposable> {
  /** `webgpu` tries WebGPU first; any lost context restarts on WebGL2. */
  readonly preference: 'webgpu' | 'webgl2';
  /** Builds a renderer on `canvas`; may call `freshCanvas` before falling back. */
  readonly createRenderer: (
    canvas: HTMLCanvasElement,
    preference: 'webgpu' | 'webgl2',
    freshCanvas: () => HTMLCanvasElement,
  ) => Promise<R>;
  /** Returns the canvas in the page now, replacing the old one with a clean copy. */
  readonly freshCanvas: () => HTMLCanvasElement;
  /** Builds the scene, camera and render loop on a renderer. */
  readonly mount: (renderer: R, canvas: HTMLCanvasElement) => S;
  /** Told about every (re)start, e.g. to update the dev overlay and test hook. */
  readonly onStart?: (stage: S, renderer: R) => void;
  readonly onError?: (err: unknown) => void;
}

export async function boot<R extends LosableRenderer, S extends Disposable>(
  canvas: HTMLCanvasElement,
  opts: BootOptions<R, S>,
): Promise<void> {
  let current = canvas;
  const fresh = (): HTMLCanvasElement => {
    current = opts.freshCanvas();
    return current;
  };

  const start = async (preference: 'webgpu' | 'webgl2'): Promise<void> => {
    const renderer = await opts.createRenderer(current, preference, fresh);
    const stage = opts.mount(renderer, current);
    opts.onStart?.(stage, renderer);
    renderer.onLost(() => {
      stage.dispose();
      renderer.engine.dispose();
      fresh();
      start('webgl2').catch((err: unknown) => opts.onError?.(err));
    });
  };

  await start(opts.preference);
}
