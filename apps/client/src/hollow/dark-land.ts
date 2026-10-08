import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_DATA,
  hexDistance,
  hexKey,
  hexToWorld,
  type Hex,
  type HexKey,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { mapSafeTiles } from '../home/home-layout.js';
import type { MeshArrays } from '../map/hex-mesh.js';
import { HEX_SIZE } from '../map/map-config.js';
import { findHomeBases } from '../map/map-layout.js';
import {
  meshFrom,
  placeAt,
  setInstances,
  TILE_RADIUS,
  tileScreenRectOf,
  topOf,
} from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import { DARK_EDGE } from './hollow-config.js';

// My dark land (#277, mockup screen 1): land of mine outside home that no lit
// Hearthfire's light reaches, where the Hollow Man can win land back or take
// a squishy at nightfall. Each dark tile gets a dashed lavender edge (one
// thin-instanced mesh: one draw call, only while there is dark land) and a
// little 🌙 (a DOM badge placed with the map's tile projection, as the
// gatherer badges are). The server decides what's safe at nightfall (rule
// 1); this is the same rule drawn early (`safeTiles`), so the kid can act.

/** My land outside home that no lit fire reaches, farthest from my Heart Seed first (his order). */
export function darkTiles(view: MapView, userId: string | null): PublicTile[] {
  if (!userId) return [];
  const safe = mapSafeTiles(view);
  const slot = view.members.find((m) => m.user.id === userId)?.homeSlot ?? null;
  const seed = findHomeBases(view.tiles).find((h) => h.slot === slot)?.seed ?? null;
  const far = (t: Hex) => (seed ? hexDistance(t, seed) : 0);
  return view.tiles
    .filter((t) => t.ownerUserId === userId && t.homeSlot === null && !safe.has(hexKey(t)))
    .sort((a, b) => far(b) - far(a) || a.q - b.q || a.r - b.r);
}

/** My Heart Seed's tile on this map, or null. */
export function heartSeedOf(view: MapView, userId: string | null): Hex | null {
  const slot = view.members.find((m) => m.user.id === userId)?.homeSlot ?? null;
  if (slot === null) return null;
  return findHomeBases(view.tiles).find((h) => h.slot === slot)?.seed ?? null;
}

const TERRAIN_NAMES = new Map(GAME_DATA.terrains.map((t) => [t.id, t.name]));

/** A tile of mine as the narrator says it: "your meadow". */
export function placeOf(tile: Pick<PublicTile, 'terrain'> | undefined): string {
  const name = tile ? TERRAIN_NAMES.get(tile.terrain) : undefined;
  return name ? `your ${name.toLowerCase()}` : 'your land';
}

/**
 * A dashed hex outline lying flat at y = 0 (pointy-top, like the tiles):
 * `dashes` dashes along each edge, each `fill` of its slot, `width` wide.
 */
export function dashedHexRing(
  radius: number,
  dashes: number,
  fill: number,
  width: number,
): MeshArrays {
  const positions: number[] = [];
  const indices: number[] = [];
  const corner = (i: number) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return { x: radius * Math.cos(a), z: radius * Math.sin(a) };
  };
  for (let side = 0; side < 6; side++) {
    const a = corner(side);
    const b = corner(side + 1);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // Across the edge, pointing in towards the middle, half the width each way.
    const nx = (-(b.z - a.z) / len) * (width / 2);
    const nz = ((b.x - a.x) / len) * (width / 2);
    for (let d = 0; d < dashes; d++) {
      const gap = (1 - fill) / 2;
      const t0 = (d + gap) / dashes;
      const t1 = (d + 1 - gap) / dashes;
      const p0 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
      const base = positions.length / 3;
      positions.push(
        p0.x - nx,
        0,
        p0.z - nz,
        p1.x - nx,
        0,
        p1.z - nz,
        p1.x + nx,
        0,
        p1.z + nz,
        p0.x + nx,
        0,
        p0.z + nz,
      );
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions, indices, colors: null };
}

export interface DarkLandDebug {
  /** My dark tiles drawn (dashed edges). */
  readonly tiles: number;
  /** Moons on screen now. */
  readonly moons: number;
}

export interface DarkLand extends MapLayer {
  readonly debug: DarkLandDebug;
}

/**
 * The dashed edge and 🌙 on my dark land, for whoever `userId` says is
 * signed in. With no `root` (unit tests) only the edge is drawn.
 */
export function createDarkLand(root: HTMLElement | null, userId: () => string | null): DarkLand {
  let scene: Scene | null = null;
  let edge: Mesh | null = null;
  let drawn = 0;
  const moons = new Map<HexKey, { tile: PublicTile; node: HTMLElement; at: string }>();

  const place = (moon: { tile: PublicTile; node: HTMLElement; at: string }) => {
    const rect = scene ? tileScreenRectOf(scene, moon.tile) : null;
    const seen =
      rect &&
      rect.x + rect.width > 0 &&
      rect.x < window.innerWidth &&
      rect.y + rect.height > 0 &&
      rect.y < window.innerHeight
        ? rect
        : null;
    const at = seen
      ? `${String(Math.round(seen.x + seen.width / 2))},${String(Math.round(seen.y + seen.height / 2))}`
      : 'hidden';
    if (at === moon.at) return;
    moon.at = at;
    moon.node.hidden = seen === null;
    if (seen) {
      const [x, y] = at.split(',');
      moon.node.style.transform = `translate(${x ?? '0'}px, ${y ?? '0'}px) translate(-50%, -50%)`;
    }
  };
  const placeAll = () => {
    for (const moon of moons.values()) place(moon);
  };

  const draw = (view: MapView) => {
    const dark = darkTiles(view, userId());
    const wanted = new Map(dark.map((t) => [hexKey(t), t] as const));
    for (const [key, moon] of moons) {
      if (wanted.has(key)) continue;
      moon.node.remove();
      moons.delete(key);
    }
    for (const [key, tile] of root ? wanted : []) {
      const moon = moons.get(key);
      if (moon) {
        moon.tile = tile;
        continue;
      }
      const node = el(
        'div',
        { class: 'dark-moon', 'aria-hidden': 'true', 'data-testid': 'dark-moon' },
        '🌙',
      );
      node.hidden = true;
      root?.append(node);
      const added = { tile, node, at: '' };
      moons.set(key, added);
      place(added);
    }
    drawn = dark.length;
    if (!edge) return;
    const matrices: Matrix[] = dark.map((t) => {
      const p = hexToWorld(t, HEX_SIZE);
      return placeAt(p.x, topOf(t) + DARK_EDGE.lift, p.z);
    });
    setInstances(edge, matrices, true);
  };

  const clear = () => {
    for (const moon of moons.values()) moon.node.remove();
    moons.clear();
    drawn = 0;
  };

  return {
    attach: (next, view) => {
      clear();
      scene = next;
      const mesh = meshFrom(
        next,
        'dark-edge',
        dashedHexRing(
          TILE_RADIUS * DARK_EDGE.inset,
          DARK_EDGE.dashes,
          DARK_EDGE.fill,
          DARK_EDGE.width,
        ),
      );
      const mat = new StandardMaterial('dark-edge-mat', next);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(DARK_EDGE.color).toLinearSpace();
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      // Flat on the ground: seen from either side as the camera tilts.
      mat.backFaceCulling = false;
      mat.freeze();
      mesh.material = mat;
      mesh.isPickable = false;
      edge = mesh;
      draw(view);
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        edge = null;
        clear();
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get debug() {
      return { tiles: drawn, moons: [...moons.values()].filter((m) => !m.node.hidden).length };
    },
  };
}
