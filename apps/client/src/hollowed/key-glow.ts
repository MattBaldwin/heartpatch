import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, hexToWorld, type MapView } from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import { buildTileGlow, placeAt, setInstances, topOf } from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { KEY_GLOW } from './hollowed-config.js';
import { keyGlows } from './key-hunt-view.js';

// The cellar key's tile on the world map (#306, owner decision 2026-10-22):
// a soft gold glow, no words, seen only by the Keeper hunting for it. The
// homestead glow's shape (`buildTileGlow`) in gold: one thin-instanced mesh,
// built only while a hunt is on. It breathes on the frames the map draws
// anyway (ambient life), so it never asks for a frame of its own; with
// reduced motion it stays still.

export interface KeyGlow extends MapLayer {
  /** The tiles glowing now (the dev hook). */
  readonly glowing: readonly { q: number; r: number }[];
}

/** Reduced motion, read from one media query (never one per frame). */
function stillMotion(): () => boolean {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  return () => query.matches;
}

export function createKeyGlow(
  me: () => string | null,
  still: () => boolean = stillMotion(),
): KeyGlow {
  let scene: Scene | null = null;
  let mesh: Mesh | null = null;
  let glowing: { q: number; r: number }[] = [];

  const breathe = (): void => {
    if (!mesh?.isEnabled()) return;
    const { low, high, periodS } = KEY_GLOW;
    if (still()) {
      mesh.visibility = high;
      return;
    }
    const phase = (performance.now() / 1000 / periodS) * Math.PI * 2;
    mesh.visibility = low + (high - low) * (0.5 + 0.5 * Math.sin(phase));
  };

  const draw = (view: MapView): void => {
    const target = scene;
    if (!target) return;
    const byKey = new Map(view.tiles.map((t) => [hexKey(t), t] as const));
    const tiles = keyGlows(view, me()).flatMap((h) => byKey.get(hexKey(h)) ?? []);
    glowing = tiles.map((t) => ({ q: t.q, r: t.r }));
    if (tiles.length === 0 && !mesh) return;
    mesh ??= buildTileGlow(target, 'key-glow', KEY_GLOW.look);
    setInstances(
      mesh,
      tiles.map((t) => {
        const p = hexToWorld(t, HEX_SIZE);
        return placeAt(p.x, topOf(t) + KEY_GLOW.lift, p.z);
      }),
      true,
    );
    breathe();
  };

  return {
    attach: (next, view) => {
      scene = next;
      mesh = null;
      draw(view);
      const beat = next.onBeforeRenderObservable.add(breathe);
      next.onDisposeObservable.addOnce(() => {
        next.onBeforeRenderObservable.remove(beat);
        if (scene !== next) return;
        scene = null;
        mesh = null;
        glowing = [];
      });
    },
    update: draw,
    get glowing() {
      return glowing;
    },
  };
}
