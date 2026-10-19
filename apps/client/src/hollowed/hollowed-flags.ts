import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, hexNeighbors, hexToWorld, type MapView, type PublicTile } from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import { DOME, TILE_RADIUS, tileScreenRectOf, topOf } from '../map/map-scene.js';
import type { MapLayer } from '../map/map-screen.js';
import { el } from '../ui/dom.js';
import { hollowedClusters, hollowedFlagLabel, hollowedPreview, type HollowedCluster } from './hollowed-preview.js';
import './hollowed.css';

/*
 * PROTOTYPE (#306 plan): a flag over each Hollowed Community, like the
 * trading posts' (#269), and a soft lavender ring on the tiles my land
 * touches (its doorstep), so the reach rule shows on the map.
 */

const RING = { diameter: TILE_RADIUS * 1.84, thickness: 0.045, lift: 0.012, color: '#b9a6e6' };

/** PROTOTYPE: the home's typed name, shown as a flag over my Heart Seed. */
let homeName: string | null = null;
export function setHomeName(name: string | null): void {
  homeName = name;
}

export function createHollowedFlags(root: HTMLElement, me: () => string | null): MapLayer & { shown: number } {
  let scene: Scene | null = null;
  const flags = new Map<string, { c: HollowedCluster; node: HTMLElement; tile: PublicTile; lift: number }>();
  const rings: Mesh[] = [];
  let ringMat: StandardMaterial | null = null;

  const placeAll = () => {
    if (!scene) return;
    for (const f of flags.values()) {
      const rect = tileScreenRectOf(scene, f.tile);
      if (!rect) {
        f.node.hidden = true;
        continue;
      }
      f.node.hidden = false;
      // Kept inside the screen's sides and under the patch-name pill, like a post's flag.
      const half = Math.max(60, f.node.offsetWidth / 2);
      const x = Math.min(window.innerWidth - half - 8, Math.max(half + 8, rect.x + rect.width / 2));
      const y = Math.max(150, rect.y + rect.height * f.lift);
      f.node.style.transform = `translate(${String(Math.round(x))}px, ${String(Math.round(y))}px) translate(-50%, -100%)`;
    }
  };

  const draw = (view: MapView) => {
    for (const f of flags.values()) f.node.remove();
    flags.clear();
    for (const r of rings) r.dispose();
    rings.length = 0;
    const mine = me();
    const byKey = new Map(view.tiles.map((t) => [hexKey(t), t] as const));
    const owned = new Set(view.tiles.filter((t) => t.ownerUserId === mine).map(hexKey));
    if (homeName && mine) {
      const seed = view.tiles.find((t) => t.ownerUserId === mine && t.homeSlot !== null && t.terrain === 'meadow');
      const seedTile = seed ?? view.tiles.find((t) => t.ownerUserId === mine && t.homeSlot !== null);
      if (seedTile) {
        const node = el('div', { class: 'post-flag post-flag-connected hollowed-flag', 'aria-hidden': 'true', 'data-testid': 'home-flag' }, `🏡 ${homeName}`);
        node.hidden = true;
        root.append(node);
        const c = hollowedClusters(view, mine)[0];
        if (c) flags.set('home', { c, node, tile: seedTile, lift: -0.15 });
      }
    }
    for (const c of hollowedClusters(view, mine)) {
      const tile = byKey.get(hexKey(c.centre));
      if (!tile) continue;
      const node = el(
        'div',
        {
          class: c.joined ? 'post-flag post-flag-connected hollowed-flag' : 'post-flag hollowed-flag hollowed-flag-grey',
          'aria-hidden': 'true',
          'data-testid': 'hollowed-flag',
        },
        hollowedFlagLabel(c),
      );
      node.hidden = true;
      root.append(node);
      flags.set(c.id, { c, node, tile, lift: 0.1 });
      // Owner decision (Q3, 2026-10-19): the village seed and its ring are the
      // winner's home tiles, so the map draws the seed itself (`findHomeBases`).
      // Owner decision (Q5): the key map points at a tile outside the village.
      const keyTile = c.keyTile ? byKey.get(hexKey(c.keyTile)) : undefined;
      if (c.joined && keyTile && hollowedPreview()?.show === 'keymap') {
        const key = el(
          'div',
          { class: 'post-flag post-flag-connected hollowed-flag', 'aria-hidden': 'true', 'data-testid': 'hollowed-key-flag' },
          '🗺️ The cellar key is hidden here',
        );
        key.hidden = true;
        root.append(key);
        flags.set(`${c.id}-key`, { c, node: key, tile: keyTile, lift: 0.1 });
      }
      if (scene && !c.joined && c.reach.kind === 'touching') {
        for (const h of c.tiles) {
          if (!hexNeighbors(h).some((n) => owned.has(hexKey(n)))) continue;
          const t = byKey.get(hexKey(h));
          if (!t) continue;
          const ring = CreateTorus(
            `hollowed-ring-${hexKey(h)}`,
            { diameter: RING.diameter, thickness: RING.thickness, tessellation: 6 },
            scene,
          );
          ringMat ??= (() => {
            const m = new StandardMaterial('hollowed-ring-mat', scene);
            m.disableLighting = true;
            m.emissiveColor = Color3.FromHexString(RING.color).toLinearSpace();
            return m;
          })();
          ring.material = ringMat;
          const p = hexToWorld(h, HEX_SIZE);
          ring.position.set(p.x, topOf(t) + DOME + RING.lift, p.z);
          ring.isPickable = false;
          ring.freezeWorldMatrix();
          rings.push(ring);
        }
      }
    }
    placeAll();
  };

  return {
    attach: (next, view) => {
      scene = next;
      ringMat = null;
      draw(view);
      next.onAfterRenderObservable.add(placeAll);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        for (const f of flags.values()) f.node.remove();
        flags.clear();
        rings.length = 0;
      });
    },
    update: (view) => {
      if (scene) draw(view);
    },
    get shown() {
      return [...flags.values()].filter((f) => !f.node.hidden).length;
    },
  };
}
