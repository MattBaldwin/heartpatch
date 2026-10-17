import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { EngineStore } from '@babylonjs/core/Engines/engineStore';
import type { PageStats } from './render-stats.js';

/** Anything that counts its renders (a Babylon `Scene`). */
export interface Rendered {
  getRenderId(): number;
}

/**
 * Renders per second across a changing set of scenes (#501): each scene's
 * own render count since it was last seen. A scene seen for the first time
 * starts from where it is, so the game's scene doesn't count its whole past.
 */
export class RenderRate {
  readonly #seen = new WeakMap<Rendered, number>();
  #at: number | null = null;

  /** Renders per second since the last call (0 on the first). */
  sample(scenes: Iterable<Rendered>, now: number): number {
    let renders = 0;
    for (const scene of scenes) {
      const id = scene.getRenderId();
      const last = this.#seen.get(scene);
      if (last !== undefined) renders += Math.max(0, id - last);
      this.#seen.set(scene, id);
    }
    const since = this.#at === null ? null : now - this.#at;
    this.#at = now;
    return since === null || since <= 0 ? 0 : (renders * 1000) / since;
  }
}

/** Every scene an engine has, virtual ones (portrait snapshots) included. */
function scenesOf(engine: AbstractEngine): Rendered[] {
  return [...engine.scenes, ...engine._virtualScenes];
}

/** The page-wide counts for the badge's third line (`formatPageStats`). */
export function readPageStats(rate: RenderRate, flags: string): PageStats {
  const engines = EngineStore.Instances.filter((e) => !e.isDisposed);
  return {
    engines: engines.length,
    framesPerSecond: rate.sample(engines.flatMap(scenesOf), performance.now()),
    targets: engines.flatMap((e) =>
      e._renderTargetWrapperCache.map((t) => ({
        width: t.width,
        height: t.height,
        samples: t.samples,
      })),
    ),
    canvases: document.getElementsByTagName('canvas').length,
    domNodes: document.getElementsByTagName('*').length,
    animations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
    flags,
  };
}
