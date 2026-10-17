import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { EngineStore } from '@babylonjs/core/Engines/engineStore';
import { portraitSnapshots } from '../procedural/portraits.js';
import type { PageStats } from './render-stats.js';

/** A scene that says when it has rendered (a Babylon `Scene`). */
export interface Rendered {
  readonly onAfterRenderObservable: { add(callback: () => void): unknown };
}

/**
 * Scene renders per second across a changing set of scenes (#501). Each
 * scene gets a counter on its after-render event the first time it's seen
 * (it goes with the scene), so only renders since then count. Not the
 * scene's render id: that moves at least twice a frame, more with render
 * targets.
 */
export class RenderRate {
  readonly #renders = new WeakMap<Rendered, { count: number; seen: number }>();
  #at: number | null = null;

  /** Renders per second since the last call (0 on the first). */
  sample(scenes: Iterable<Rendered>, now: number): number {
    let renders = 0;
    for (const scene of scenes) {
      let counter = this.#renders.get(scene);
      if (!counter) {
        const fresh = { count: 0, seen: 0 };
        scene.onAfterRenderObservable.add(() => {
          fresh.count++;
        });
        this.#renders.set(scene, fresh);
        counter = fresh;
      }
      renders += counter.count - counter.seen;
      counter.seen = counter.count;
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
    snapshots: portraitSnapshots.count,
    canvases: document.getElementsByTagName('canvas').length,
    domNodes: document.getElementsByTagName('*').length,
    animations: typeof document.getAnimations === 'function' ? document.getAnimations().length : 0,
    flags,
  };
}
