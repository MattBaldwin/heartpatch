import { Constants } from '@babylonjs/core/Engines/constants';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, hexToWorld, type MapView } from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import {
  CORNER,
  meshFrom,
  overlayMaterial,
  SEGMENTS,
  setInstances,
  TILE_RADIUS,
  topOf,
} from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { KEY_GLOW } from './hollowed-config.js';
import { keyGlowArrays } from './key-glow-mesh.js';
import { keyGlows } from './key-hunt-view.js';

// The cellar key's tile on the world map (#306, owner decision 2026-10-22:
// "really highlight" it): a gold glow with a pulsing rim, a soft column of
// light and sparkles rising in it (key-glow-mesh.ts), no words, seen only by
// the Keeper hunting for it. One thin-instanced mesh, built only while a
// hunt is on. It breathes on the frames the map draws anyway (ambient life),
// so it never asks for a frame of its own, and each breath only rewrites
// its instances' matrices into scratch it keeps (no allocation per frame);
// with reduced motion it stays still.

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
  /** Where each glowing tile's glow stands (world), kept for each breath. */
  let bases: Vector3[] = [];
  // Scratch each breath writes into: nothing is allocated per frame.
  const matrix = new Matrix();
  const stretch = new Vector3(1, 1, 1);
  const turn = Quaternion.Identity();

  /** Pulses the glow and stretches its column (lifting the sparkles) with one breath. */
  const breathe = (): void => {
    const m = mesh;
    if (!m?.isEnabled()) return;
    const { low, high, periodS } = KEY_GLOW;
    const wave = still()
      ? 1
      : 0.5 + 0.5 * Math.sin((performance.now() / 1000 / periodS) * Math.PI * 2);
    m.visibility = low + (high - low) * wave;
    stretch.y = 1 + KEY_GLOW.stretch * wave;
    bases.forEach((at, i) => {
      Matrix.ComposeToRef(stretch, turn, at, matrix);
      m.thinInstanceSetMatrixAt(i, matrix, i === bases.length - 1);
    });
  };

  const draw = (view: MapView): void => {
    const target = scene;
    if (!target) return;
    const byKey = new Map(view.tiles.map((t) => [hexKey(t), t] as const));
    const tiles = keyGlows(view, me()).flatMap((h) => byKey.get(hexKey(h)) ?? []);
    glowing = tiles.map((t) => ({ q: t.q, r: t.r }));
    if (tiles.length === 0 && !mesh) return;
    if (!mesh) {
      mesh = meshFrom(
        target,
        'key-glow',
        keyGlowArrays({ radius: TILE_RADIUS, corner: CORNER, segments: SEGMENTS }),
      );
      const material = overlayMaterial(target, 'key-glow-mat');
      // The column is seen from outside and in, as the camera swings round,
      // and adds its light to what's behind it: it glows even in the night look.
      material.backFaceCulling = false;
      material.alphaMode = Constants.ALPHA_ADD;
      mesh.material = material;
    }
    bases = tiles.map((t) => {
      const p = hexToWorld(t, HEX_SIZE);
      return new Vector3(p.x, topOf(t) + KEY_GLOW.lift, p.z);
    });
    setInstances(
      mesh,
      bases.map((at) => Matrix.Translation(at.x, at.y, at.z)),
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
        bases = [];
      });
    },
    update: draw,
    get glowing() {
      return glowing;
    },
  };
}
