import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  type Hex,
  type MapView,
  type PublicTile,
  type StrandedTile,
} from '@heartpatch/shared';
import { dashedHexRing } from '../hollow/dark-land.js';
import { hexOutlineOnScreen } from '../map/map-scene.js';
import { splitStranded, nearestGap } from '../land/stranded-text.js';
import type { MeshArrays } from '../map/hex-mesh.js';
import { HEX_SIZE } from '../map/map-config.js';
import {
  meshFrom,
  overlayMaterial,
  placeAt,
  setInstances,
  TILE_RADIUS,
  topOf,
} from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';

// Stranded land (Wild Isle, #621): a flat tint and a dotted hex outline on
// land of mine that is cut off from home. Two looks, each one thin-instanced
// fill and one thin-instanced ring (four draw calls, none when nothing is cut
// off): "grace" (fading hasn't started: a pale grey-violet wash and an amber
// dashed edge) and "fading" (a deeper, duskier wash and a pale lilac edge).
// Both wash the land's own colour out to a faded, cool grey-violet, and
// neither uses the reds of the player's home borders. Fed by `set` from the
// tending fetch (land-screen).

const LOOK = {
  grace: { fill: [0.68, 0.56, 0.92, 0.56], ring: '#f1b94a' }, // TUNE
  fading: { fill: [0.4, 0.3, 0.7, 0.74], ring: '#efe6ff' }, // TUNE
} as const;
const FILL_INSET = 0.98; // TUNE: of the tile's radius
const LIFT = 0.015; // TUNE: above the tile top
const RING = { dashes: 5, fill: 0.55, width: 0.075 } as const; // TUNE: a chunky dashed edge

/** A flat hex disc at y = 0, one flat colour. */
function hexFill(radius: number, rgba: readonly number[]): MeshArrays {
  const positions = [0, 0, 0];
  const colors = [...rgba];
  const indices: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    positions.push(radius * Math.cos(a), 0, radius * Math.sin(a));
    colors.push(...rgba);
    indices.push(0, 1 + ((i + 1) % 6), 1 + i);
  }
  return { positions, indices, colors };
}

export interface StrandedLayer extends MapLayer {
  /** My cut-off land now (from the tending fetch); redraws. */
  set: (stranded: readonly StrandedTile[] | undefined) => void;
  /** The gap to show (nearest `from`, else going wild soonest), or null. */
  gap: (from?: Hex | null) => StrandedTile | null;
  /** Tiles drawn by look (the dev hook). */
  readonly debug: {
    grace: number;
    fading: number;
    onScreen: readonly { x: number; y: number }[];
    /** Every cut-off tile's centre then six corners, in CSS pixels (outside the canvas is off-screen). */
    outlines: readonly (readonly { x: number; y: number }[])[];
  };
}

export function createStrandedLayer(now: () => number = () => Date.now()): StrandedLayer {
  let scene: Scene | null = null;
  let view: MapView | null = null;
  let stranded: readonly StrandedTile[] = [];
  const meshes: Record<'grace' | 'fading', { fill: Mesh; ring: Mesh } | null> = {
    grace: null,
    fading: null,
  };
  const drawn = { grace: 0, fading: 0 };

  const draw = () => {
    const split = splitStranded(stranded, now());
    for (const kind of ['grace', 'fading'] as const) {
      const pair = meshes[kind];
      const tiles = split[kind];
      drawn[kind] = pair ? tiles.length : 0;
      if (!pair) continue;
      const byKey = new Map<string, PublicTile>((view?.tiles ?? []).map((t) => [hexKey(t), t]));
      const matrices: Matrix[] = tiles.map((t) => {
        const p = hexToWorld(t, HEX_SIZE);
        const tile = byKey.get(hexKey(t));
        return placeAt(p.x, (tile ? topOf(tile) : 0) + LIFT, p.z);
      });
      setInstances(pair.fill, matrices, true);
      setInstances(pair.ring, matrices, true);
    }
  };

  /** Cut-off tiles whose centre is inside the canvas right now, as 0..1 of its width and height (the dev hook). */
  const onScreen = () => {
    const camera = scene?.activeCamera;
    if (!scene || !camera) return [];
    const engine = scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const viewport = camera.viewport.toGlobal(w, h);
    const found: { x: number; y: number }[] = [];
    for (const t of stranded) {
      const p = hexToWorld(t, HEX_SIZE);
      const s = Vector3.Project(
        new Vector3(p.x, 0, p.z),
        Matrix.IdentityReadOnly,
        scene.getTransformMatrix(),
        viewport,
      );
      if (s.z >= 0 && s.z <= 1 && s.x >= 0 && s.x <= w && s.y >= 0 && s.y <= h)
        found.push({ x: s.x / w, y: s.y / h });
    }
    return found;
  };

  /** Each cut-off tile's centre and six corners on screen, in CSS pixels (the dev hook). */
  const outlines = () => {
    const sc = scene;
    return sc ? stranded.map((t) => hexOutlineOnScreen(sc, t)) : [];
  };

  return {
    attach: (next, nextView) => {
      scene = next;
      view = nextView;
      for (const kind of ['grace', 'fading'] as const) {
        const fillMat = overlayMaterial(next, `stranded-${kind}-fill`);
        const ringMat = overlayMaterial(next, `stranded-${kind}-ring`);
        ringMat.emissiveColor = Color3.FromHexString(LOOK[kind].ring).toLinearSpace();
        ringMat.diffuseColor = Color3.Black();
        ringMat.backFaceCulling = false;
        fillMat.backFaceCulling = false;
        const fill = meshFrom(
          next,
          `stranded-${kind}-fill`,
          hexFill(TILE_RADIUS * FILL_INSET, LOOK[kind].fill),
        );
        const ring = meshFrom(
          next,
          `stranded-${kind}-ring`,
          dashedHexRing(TILE_RADIUS * 0.92, RING.dashes, RING.fill, RING.width),
        );
        fill.material = fillMat;
        ring.material = ringMat;
        meshes[kind] = { fill, ring };
      }
      draw();
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        meshes.grace = null;
        meshes.fading = null;
      });
    },
    update: (nextView) => {
      view = nextView;
      if (scene) draw();
    },
    set: (next) => {
      stranded = next ?? [];
      if (scene) draw();
    },
    gap: (from) => nearestGap(stranded, from),
    get debug() {
      return { ...drawn, onScreen: onScreen(), outlines: outlines() };
    },
  };
}
