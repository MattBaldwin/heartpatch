import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  EXPLORE_RULES,
  hexKey,
  KEEPER_DATA,
  type ExploreTileResponse,
  type KeeperConfig,
  type PublicSearchSpot,
  type PublicTile,
  type Species,
  type VisualRegistry,
  type WorldPoint,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { spotWorld } from '../home/home-layout.js';
import {
  FALLBACK_LOOK,
  HEX_SIZE,
  ISLAND,
  TERRAIN_LOOKS,
  TILE_FILL,
  type PropKind,
} from '../map/map-config.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { linear, merged, painted } from '../map/map-props.js';
import {
  buildProp,
  CORNER,
  DOME,
  meshFrom,
  overlayMaterial,
  placeAt,
  SEGMENTS,
  setInstances,
  TOP_RINGS,
  vinyl,
} from '../map/map-scene.js';
import { BuildingField } from '../procedural/buildings/building-field.js';
import type { SquishyLod } from '../procedural/config.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { EXPLORE_VIEW } from './explore-config.js';

// The explore view (#199, owner design 2026-10-07): one of my tiles up
// close, its search spots drawn from the terrain's prop kit, its buildings,
// my Keeper walking about and my team trailing behind. Positions come from
// the server (CLAUDE.md rule 1); the screen moves the Keeper and asks this
// scene to draw it. Render on demand (tech spec §6): nothing moves while the
// Keeper stands still, so an idle tile draws nothing.

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface ExploreSceneStats {
  readonly spots: number;
  readonly done: number;
  readonly buildings: number;
  readonly keeper: boolean;
  readonly followers: number;
  /** Prop draw calls (one per kind of spot on the tile). */
  readonly propMeshes: number;
  /** The spot ringed as the one in reach, or null. */
  readonly highlighted: number | null;
}

export interface ExploreSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  readonly keeperWearing?: readonly string[];
  /** The squishies on my team that follow the Keeper, in team order. */
  readonly team: readonly { readonly id: string; readonly species: Species }[];
  /** The tile as the map knows it: its buildings. */
  readonly mapTile: PublicTile | null;
}

/**
 * What each kind of spot looks like: a map prop where one fits, else one of
 * the explore-only shapes built below (a mound, a pond, a ledge, a cave).
 */
const SPOT_PROPS: Readonly<Record<string, PropKind | ExploreShape>> = {
  rock: 'rock',
  tree: 'tree',
  'hollow-log': 'log',
  'flower-bed': 'flowers',
  'pumpkin-row': 'pumpkin',
  reeds: 'reeds',
  mound: 'mound',
  pond: 'pond',
  ledge: 'ledge',
  cave: 'cave',
};

type ExploreShape = 'mound' | 'pond' | 'ledge' | 'cave';

/** The island under the tile: shallow, so the tile reads as a little diorama. TUNE */
const ISLAND_DEPTH = 0.12;
const SHAPES: ReadonlySet<string> = new Set<ExploreShape>(['mound', 'pond', 'ledge', 'cave']);

/** The Keeper's trail: followers stand on its points, one gap apart. */
interface Follower {
  readonly handle: SquishyHandle;
  at: WorldPoint;
}

export class ExploreScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #size = EXPLORE_VIEW.hexSize;
  readonly #k = EXPLORE_VIEW.hexSize / HEX_SIZE;
  readonly #ground: number;
  /** Markers sit just over the tile's rounded top (it peaks in the middle). */
  readonly #markY: number;
  /** A spot's ring fits between two spots (`placement.minGap` apart). */
  readonly #markSize = EXPLORE_RULES.placement.minGap * EXPLORE_VIEW.hexSize;
  readonly #props = new Map<string, Mesh>();
  readonly #sparkle: Mesh;
  readonly #doneMark: Mesh;
  readonly #ring: Mesh;
  readonly #buildings: BuildingField;
  readonly #keepers: KeeperField;
  readonly #squishies: SquishyField;
  #keeper: KeeperHandle | null = null;
  readonly #followers: Follower[] = [];
  /** Tile-local points the Keeper walked through, newest first. */
  #trail: WorldPoint[] = [];
  #tile: ExploreTileResponse;
  #at: WorldPoint = EXPLORE_VIEW.start;
  #yaw = 0;
  #highlighted: number | null = null;

  constructor(scene: Scene, tile: ExploreTileResponse, options: ExploreSceneOptions) {
    this.#scene = scene;
    this.#tile = tile;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    const look = TERRAIN_LOOKS[tile.terrain] ?? FALLBACK_LOOK;
    this.#ground = (look.height + DOME * 0.5) * this.#k;
    this.#markY = (look.height + DOME) * this.#k + 0.02;

    this.#buildGround(tile.terrain);
    this.#buildProps(tile);

    // Spots still to search sparkle (a soft pink ring); searched ones keep a
    // pale ring, so a kid sees at a glance what's left.
    this.#sparkle = CreateTorus(
      'explore-sparkle',
      { diameter: this.#markSize, thickness: 0.06, tessellation: 28 },
      scene,
    );
    const sparkleMat = overlayMaterial(scene, 'explore-sparkle-mat');
    sparkleMat.emissiveColor = linear('#ff6f9f');
    this.#sparkle.material = sparkleMat;
    this.#sparkle.isPickable = false;
    this.#doneMark = CreateDisc(
      'explore-done',
      { radius: this.#markSize * 0.45, tessellation: 24 },
      scene,
    );
    this.#doneMark.rotation.x = Math.PI / 2;
    this.#doneMark.bakeCurrentTransformIntoVertices();
    const doneMat = overlayMaterial(scene, 'explore-done-mat');
    doneMat.emissiveColor = linear('#fff6e0');
    doneMat.alpha = 0.55;
    this.#doneMark.material = doneMat;
    this.#doneMark.isPickable = false;
    this.#ring = CreateTorus(
      'explore-ring',
      { diameter: this.#markSize * 1.25, thickness: 0.09, tessellation: 36 },
      scene,
    );
    this.#ring.material = vinyl(scene, 'explore-ring-mat', { color: '#ff6f9f' });
    this.#ring.isPickable = false;
    this.#ring.setEnabled(false);

    // The tile's own buildings (a fire out on the land, #202), on their spots.
    this.#buildings = new BuildingField(scene);
    this.#buildings.set(
      (options.mapTile?.buildings ?? []).map((b) => {
        const at = spotWorld({ q: 0, r: 0 }, b.spot, this.#size);
        return {
          buildingId: b.buildingId,
          level: b.level,
          lit: b.lit,
          x: at.x,
          z: at.z,
          y: this.#ground,
          scale: EXPLORE_VIEW.buildingScale,
        };
      }),
    );

    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    this.#squishies = new SquishyField(scene, {
      registry: options.registry,
      lod: options.lod,
      breathing: false,
    });
    if (options.keeper) {
      this.#keeper = this.#keepers.add(
        options.keeper,
        this.#keeperPlacement(),
        keeperItems(options.keeperWearing ?? []),
      );
    }
    options.team.forEach((member, i) => {
      const at = this.#trailPoint(i + 1);
      const handle = this.#squishies.add(member.species, member.id, this.#squishyPlacement(at, 0));
      this.#followers.push({ handle, at });
    });

    // The camera stays put: the whole tile is on screen.
    // Aimed a little past the middle, so the tile sits below the header.
    const aim = EXPLORE_VIEW.cameraAim * this.#size;
    this.content = { bounds: { minX: 0, maxX: 0, minZ: aim, maxZ: aim }, start: { x: 0, z: aim } };
    this.update(tile);
  }

  get stats(): ExploreSceneStats {
    return {
      spots: this.#tile.spots.length,
      done: this.#tile.spots.filter((s) => s.done).length,
      buildings: this.#buildings.stats.buildings,
      keeper: this.#keeper !== null,
      followers: this.#followers.length,
      propMeshes: this.#props.size,
      highlighted: this.#highlighted,
    };
  }

  /** Where the Keeper stands now, tile-local. */
  get keeperAt(): WorldPoint {
    return this.#at;
  }

  /** Redraws which spots are done from a fresh view of the tile. */
  update(tile: ExploreTileResponse): void {
    this.#tile = tile;
    const lift = this.#markY;
    const local = (s: PublicSearchSpot) => this.#world(s);
    setInstances(
      this.#sparkle,
      tile.spots.filter((s) => !s.done).map((s) => placeAt(local(s).x, lift, local(s).z)),
      true,
    );
    setInstances(
      this.#doneMark,
      tile.spots.filter((s) => s.done).map((s) => placeAt(local(s).x, lift, local(s).z)),
      true,
    );
    if (this.#highlighted !== null && tile.spots.find((s) => s.index === this.#highlighted)?.done) {
      this.highlight(null);
    }
  }

  /** Rings the spot in reach (null: none). */
  highlight(index: number | null): void {
    this.#highlighted = index;
    const spot = index === null ? undefined : this.#tile.spots.find((s) => s.index === index);
    if (!spot) {
      this.#highlighted = null;
      this.#ring.setEnabled(false);
      return;
    }
    const at = this.#world(spot);
    this.#ring.position.set(at.x, this.#markY + 0.02, at.z);
    this.#ring.setEnabled(true);
  }

  /**
   * Moves the Keeper (tile-local) and the team along its trail. `yaw` faces
   * the way it walks; left out, it keeps its heading.
   */
  moveKeeper(at: WorldPoint, yaw?: number): void {
    this.#at = at;
    if (yaw !== undefined) this.#yaw = yaw;
    if (this.#keeper) this.#keepers.move(this.#keeper, this.#keeperPlacement());
    const head = this.#trail[0];
    const gap = EXPLORE_VIEW.followGap;
    if (!head || (head.x - at.x) ** 2 + (head.z - at.z) ** 2 >= gap * gap) {
      this.#trail = [at, ...this.#trail].slice(0, this.#followers.length + 2);
    }
    this.#followers.forEach((f, i) => {
      const to = this.#trailPoint(i + 1);
      if (to.x === f.at.x && to.z === f.at.z) return;
      const ahead = i === 0 ? at : (this.#followers[i - 1]?.at ?? at);
      const yawTo = Math.atan2(ahead.x - to.x, -(ahead.z - to.z));
      f.at = to;
      this.#squishies.move(f.handle, this.#squishyPlacement(to, yawTo));
    });
  }

  /** A little hop for the Keeper and the team when a search starts or finds something. */
  cheer(now: number): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, 'bounce', now);
    for (const f of this.#followers) this.#squishies.play(f.handle, 'wobble', now);
  }

  /** Steps animations; true while anything still moves (keep drawing). */
  step(now: number): boolean {
    const keeper = this.#keepers.update(now);
    const squishies = this.#squishies.update(now);
    return keeper || squishies;
  }

  setLod(lod: SquishyLod): void {
    this.#keepers.setLod(lod);
    this.#squishies.setLod(lod);
  }

  /** The ground under a point on the canvas (CSS pixels), tile-local, or null. */
  groundAt(x: number, y: number): WorldPoint | null {
    const camera = this.#scene.activeCamera;
    if (!camera) return null;
    const ray = CreatePickingRay(this.#scene, x, y, null, camera);
    if (ray.direction.y >= 0) return null;
    const t = (this.#ground - ray.origin.y) / ray.direction.y;
    return {
      x: (ray.origin.x + ray.direction.x * t) / this.#size,
      z: (ray.origin.z + ray.direction.z * t) / this.#size,
    };
  }

  /**
   * Where a tile-local point is on screen (CSS pixels from the canvas's top
   * left), or null if the camera can't see it. The dev hook's taps use it.
   */
  screenOf(p: WorldPoint): { x: number; y: number } | null {
    const camera = this.#scene.activeCamera;
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const at = this.#world(p);
    const s = Vector3.Project(
      new Vector3(at.x, this.#ground, at.z),
      Matrix.IdentityReadOnly,
      camera.getTransformationMatrix(),
      camera.viewport.toGlobal(box.width, box.height),
    );
    if (s.z < 0 || s.z > 1) return null;
    return { x: box.left + s.x, y: box.top + s.y };
  }

  #world(p: WorldPoint): WorldPoint {
    return { x: p.x * this.#size, z: p.z * this.#size };
  }

  #trailPoint(n: number): WorldPoint {
    const point = this.#trail[n];
    if (point) return point;
    // Before the Keeper has walked: the team waits in a little line behind it.
    const behind = n * EXPLORE_VIEW.followGap;
    return { x: this.#at.x + (n % 2 === 0 ? 0.05 : -0.05), z: this.#at.z - behind };
  }

  #keeperPlacement() {
    const at = this.#world(this.#at);
    return {
      x: at.x,
      z: at.z,
      y: this.#ground,
      yaw: this.#yaw,
      scale: EXPLORE_VIEW.keeperScale,
      lean: 0.12,
    };
  }

  #squishyPlacement(p: WorldPoint, yaw: number) {
    const at = this.#world(p);
    return { x: at.x, z: at.z, y: this.#ground, yaw, scale: EXPLORE_VIEW.squishyScale };
  }

  #buildGround(terrain: string): void {
    const look = TERRAIN_LOOKS[terrain] ?? FALLBACK_LOOK;
    const k = this.#k;
    const s = new Vector3(k, k, k);
    const h = look.height;
    const tile = meshFrom(
      this.#scene,
      'explore-tile',
      loftRoundedHex(
        HEX_SIZE * TILE_FILL,
        [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
        { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
      ),
    );
    tile.material = vinyl(this.#scene, 'explore-tile-mat', { ...look, clearCoat: false });
    tile.isPickable = false;
    setInstances(tile, [placeAt(0, 0, 0, s)]);

    const island = CreateCylinder(
      'explore-island',
      { diameter: this.#size * 2.3, height: ISLAND_DEPTH * k, tessellation: 64 },
      this.#scene,
    );
    island.position.y = (-ISLAND_DEPTH * k) / 2;
    island.material = vinyl(this.#scene, 'explore-island-mat', { color: ISLAND.color });
    island.isPickable = false;
  }

  #buildProps(tile: ExploreTileResponse): void {
    const byKind = new Map<string, Matrix[]>();
    const scale = this.#k * EXPLORE_VIEW.propScale;
    for (const spot of tile.spots) {
      const shape = SPOT_PROPS[spot.kind] ?? 'rock';
      // Old forests grow their own old trees.
      const kind = shape === 'tree' && tile.terrain === 'old-forest' ? 'old-tree' : shape;
      const at = this.#world(spot);
      // Each spot turned its own way, the same for everyone.
      const turn = Quaternion.RotationYawPitchRoll(spinOf(tile, spot.index), 0, 0);
      const list = byKind.get(kind) ?? [];
      list.push(placeAt(at.x, this.#ground, at.z, new Vector3(scale, scale, scale), turn));
      byKind.set(kind, list);
    }
    const material = vinyl(this.#scene, 'explore-prop-mat', { color: '#ffffff' });
    for (const [kind, matrices] of byKind) {
      const mesh = SHAPES.has(kind)
        ? buildShape(this.#scene, kind as ExploreShape)
        : buildProp(this.#scene, kind as PropKind).mesh;
      mesh.material = material;
      setInstances(mesh, matrices);
      this.#props.set(kind, mesh);
    }
  }
}

/** A spot's own turn, hashed from the tile and spot (stable, no RNG state). */
function spinOf(tile: { q: number; r: number }, index: number): number {
  let h = 2166136261;
  for (const c of `${hexKey(tile)}:${String(index)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * The explore-only spot shapes, in map-prop units (a rock is about 0.25
 * across) and vinyl-toy style: soft, rounded, a little chunky.
 */
function buildShape(scene: Scene, shape: ExploreShape): Mesh {
  const sphere = (d: number) => CreateSphere(`${shape}-part`, { diameter: d, segments: 10 }, scene);
  const cylinder = (h: number, top: number, bottom: number) =>
    CreateCylinder(
      `${shape}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation: 16 },
      scene,
    );
  const at = (m: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  switch (shape) {
    case 'mound':
      // Soft earth with a little sprout on top: "dig here".
      return merged(`explore-${shape}`, [
        painted(at(sphere(0.3), 0, 0, 0, 1.1, 0.45, 1), '#b88a5e'),
        painted(at(sphere(0.12), 0.05, 0.06, -0.03, 1, 0.6, 1), '#a57850'),
        painted(at(cylinder(0.08, 0.01, 0.02), -0.03, 0.12, 0.02), '#7ac27a'),
      ]);
    case 'pond':
      return merged(`explore-${shape}`, [
        painted(at(cylinder(0.02, 0.38, 0.38), 0, 0.005, 0), '#7cc6f0'),
        painted(at(cylinder(0.015, 0.44, 0.44), 0, 0, 0), '#cfe9c4'),
        painted(at(cylinder(0.01, 0.09, 0.09), 0.08, 0.02, -0.05), '#6fbf73'),
      ]);
    case 'ledge':
      // A chunky cliff step with a flat top to climb to.
      return merged(`explore-${shape}`, [
        painted(
          at(
            CreateBox(`${shape}-part`, { width: 0.32, height: 0.22, depth: 0.2 }, scene),
            0,
            0.11,
            0,
          ),
          '#c9b79a',
        ),
        painted(
          at(
            CreateBox(`${shape}-part`, { width: 0.22, height: 0.12, depth: 0.16 }, scene),
            0.04,
            0.28,
            0.02,
          ),
          '#d8c8ab',
        ),
        painted(at(sphere(0.08), -0.1, 0.24, -0.05, 1, 0.6, 1), '#9fd6a0'),
      ]);
    case 'cave':
      // A rounded hill with a dark doorway facing the camera.
      return merged(`explore-${shape}`, [
        painted(at(sphere(0.36), 0, 0.02, 0, 1, 0.75, 0.9), '#bfb3cf'),
        painted(at(sphere(0.16), 0, 0.03, -0.15, 1, 1.1, 0.5), '#3a2f4a'),
      ]);
  }
}
