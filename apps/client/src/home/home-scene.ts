import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  deriveSeed,
  GAME_DATA,
  hexToWorld,
  KEEPER_DATA,
  Rng,
  type HomeResponse,
  type KeeperConfig,
  type Species,
  type VisualRegistry,
  type WorldPoint,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { HEX_SIZE, HOME_LOOK, ISLAND, TILE_FILL, type PropKind } from '../map/map-config.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import {
  buildHeartSeed,
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
import { KeeperField } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { HOME_VIEW, SPOT_SIZE, WANDER } from './home-config.js';
import { centreOf, spotWorld } from './home-layout.js';
import type { HomeSpot } from './home-view.js';

// The home-base view (#18, design doc §13, §20): the player's seven home
// tiles up close, with their buildings, their squishies living in their
// habitats and their Keeper by the Heart Seed. Tiles, props and the Heart
// Seed reuse the map's meshes at a bigger scale. Render on demand (tech spec
// §6): squishies don't breathe here, and a wander hop is an event the screen
// drives frame by frame only while it plays, so an idle home draws nothing.

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface HomeSceneStats {
  readonly tiles: number;
  readonly buildings: number;
  readonly litFires: number;
  readonly squishies: number;
  /** Squishies drawn at a habitat (the rest wait by the Heart Seed). */
  readonly housed: number;
  readonly keeper: boolean;
  /** Clothing ids the Keeper wears (#43). */
  readonly keeperWearing: readonly string[];
  /** Free spots glowing while the player picks where to build. */
  readonly spots: number;
  /** Building draw calls (one per look, not per building). */
  readonly buildingMeshes: number;
}

/** What a tap hit. */
export type HomePick =
  | { readonly kind: 'spot'; readonly spot: HomeSpot }
  | { readonly kind: 'squishy'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string }
  | null;

/** A tap this close to a squishy's feet counts as on it (they're small), in hex sizes. */
const SQUISHY_REACH = 0.2; // TUNE

export interface HomeSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  /** What the Keeper wears (#43): clothing ids. */
  readonly keeperWearing?: readonly string[];
}

/** Node resources drawn as the map's props in the middle of their tile. */
const NODE_PROPS: Readonly<Record<string, PropKind>> = {
  timber: 'tree',
  stone: 'rock',
  emberwood: 'old-tree',
  treats: 'pumpkin',
  pumpkins: 'pumpkin',
};

interface Resident {
  readonly handle: SquishyHandle;
  /** Where it wanders around (its habitat's spot), or null by the Heart Seed. */
  readonly home: WorldPoint | null;
  at: WorldPoint;
  hop: { from: WorldPoint; to: WorldPoint; start: number } | null;
  hops: number;
}

export class HomeScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #options: HomeSceneOptions;
  readonly #k = HOME_VIEW.hexSize / HEX_SIZE;
  readonly #seed: { q: number; r: number };
  readonly #ground: number;
  readonly #buildings: BuildingField;
  readonly #squishies: SquishyField;
  readonly #keepers: KeeperField;
  readonly #spotMarkers: Mesh;
  readonly #selection: Mesh;
  readonly #residents = new Map<string, Resident>();
  #home: HomeResponse;
  #spots: HomeSpot[] = [];
  #counts = { housed: 0 };

  constructor(scene: Scene, home: HomeResponse, options: HomeSceneOptions) {
    this.#scene = scene;
    this.#options = options;
    this.#home = home;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    this.#seed = home.tiles.find((t) => t.heartSeed) ?? centreOf(home.tiles);
    this.#ground = (HOME_LOOK.height + DOME * 0.5) * this.#k;

    this.#buildGround(home);
    this.#buildings = new BuildingField(scene);
    this.#squishies = new SquishyField(scene, {
      registry: options.registry,
      lod: options.lod,
      breathing: false,
    });
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });

    this.#spotMarkers = CreateTorus(
      'home-spots',
      { diameter: 0.9, thickness: 0.1, tessellation: 32 },
      scene,
    );
    this.#spotMarkers.material = overlayMaterial(scene, 'home-spots-mat');
    this.#spotMarkers.isPickable = false;
    this.#spotMarkers.alwaysSelectAsActiveMesh = true;
    this.#spotMarkers.setEnabled(false);
    this.#selection = CreateTorus(
      'home-selection',
      { diameter: 1.4, thickness: 0.09, tessellation: 40 },
      scene,
    );
    this.#selection.material = vinyl(scene, 'home-selection-mat', { color: '#ff6f9f' });
    this.#selection.isPickable = false;
    this.#selection.setEnabled(false);

    const radius = HOME_VIEW.hexSize * 3;
    this.content = {
      bounds: { minX: -radius, maxX: radius, minZ: -radius, maxZ: radius },
      start: { x: 0, z: 0 },
    };
    this.update(home);
  }

  get stats(): HomeSceneStats {
    return {
      tiles: this.#home.tiles.length,
      buildings: this.#buildings.stats.buildings,
      litFires: this.#buildings.stats.lit,
      squishies: this.#residents.size,
      housed: this.#counts.housed,
      keeper: this.#keepers.handles.length > 0,
      keeperWearing: this.#keepers.handles[0]?.params.worn ?? [],
      spots: this.#spots.length,
      buildingMeshes: this.#buildings.stats.meshes,
    };
  }

  /** Total wander hops started so far (tests check squishies move). */
  get hops(): number {
    let n = 0;
    for (const r of this.#residents.values()) n += r.hops;
    return n;
  }

  /** World position of a spot (home tiles are drawn around the Heart Seed). */
  spotAt(spot: { q: number; r: number; spot: number }): WorldPoint {
    return spotWorld(
      { q: spot.q - this.#seed.q, r: spot.r - this.#seed.r },
      spot.spot,
      HOME_VIEW.hexSize,
    );
  }

  /** Redraws buildings, squishies and the Keeper from a fresh home reply. */
  update(home: HomeResponse): void {
    this.#home = home;
    const scale = HOME_VIEW.buildingScale;
    this.#buildings.set(
      home.buildings.map((b) => {
        const at = this.spotAt(b);
        return { buildingId: b.buildingId, lit: b.lit, x: at.x, z: at.z, y: this.#ground, scale };
      }),
    );

    // Squishies: at their habitat, or waiting by the Heart Seed.
    const habitats = new Map(
      home.buildings.filter((b) => b.kind === 'habitat').map((b) => [b.id, this.spotAt(b)]),
    );
    const species = new Map<string, Species>();
    for (const s of this.#speciesList()) species.set(s.id, s);
    const keep = new Set<string>();
    let waiting = 0;
    let housed = 0;
    for (const squishy of home.squishies) {
      const kind = species.get(squishy.speciesId);
      if (!kind) continue; // a species this client can't draw: it still shows in the list
      const anchor = squishy.habitatId ? (habitats.get(squishy.habitatId) ?? null) : null;
      // Every squishy without a habitat gets its own place by the Heart Seed, in list order.
      const waitAt = anchor ? null : this.#waitingPoint(waiting++);
      const existing = this.#residents.get(squishy.id);
      keep.add(squishy.id);
      if (anchor) housed++;
      if (
        existing &&
        sameAnchor(existing.home, anchor) &&
        (anchor || sameAnchor(existing.at, waitAt))
      ) {
        continue;
      }
      if (existing) this.#squishies.remove(existing.handle);
      const at = anchor ? this.#wanderPoint(anchor, squishy.id, 0) : (waitAt ?? { x: 0, z: 0 });
      const handle = this.#squishies.add(kind, squishy.id, this.#placement(at, 0));
      this.#residents.set(squishy.id, { handle, home: anchor, at, hop: null, hops: 0 });
    }
    for (const [id, resident] of this.#residents) {
      if (keep.has(id)) continue;
      this.#squishies.remove(resident.handle);
      this.#residents.delete(id);
    }
    this.#counts = { housed };

    this.#keepers.clear();
    if (this.#options.keeper) {
      const k = HOME_VIEW.keeper;
      this.#keepers.add(
        this.#options.keeper,
        {
          x: k.offset.x * HOME_VIEW.hexSize,
          z: k.offset.z * HOME_VIEW.hexSize,
          y: this.#ground,
          scale: k.scale,
          lean: k.lean,
        },
        keeperItems(this.#options.keeperWearing ?? []),
      );
    }
  }

  /** Lights up free spots to tap while placing or moving (empty: off). */
  showSpots(spots: readonly HomeSpot[]): void {
    this.#spots = [...spots];
    setInstances(
      this.#spotMarkers,
      spots.map((s) => {
        const at = this.spotAt(s);
        return placeAt(at.x, this.#ground + 0.03, at.z);
      }),
      true,
    );
  }

  /** Rings the selected building, or clears the ring (null). */
  select(id: string | null): void {
    const b = id ? this.#home.buildings.find((x) => x.id === id) : undefined;
    if (!b) {
      this.#selection.setEnabled(false);
      return;
    }
    const at = this.spotAt(b);
    this.#selection.position.set(at.x, this.#ground + 0.02, at.z);
    this.#selection.setEnabled(true);
  }

  /**
   * What's under a point on the canvas (CSS pixels): a lit spot first, then
   * a squishy (opens its close-up, #20), then a building.
   */
  pick(x: number, y: number): HomePick {
    const camera = this.#scene.activeCamera;
    if (!camera) return null;
    if (this.#spots.length === 0) {
      const hit = this.#squishies.pick(x, y);
      const id = hit ? this.#residentOf(hit) : null;
      if (id) return { kind: 'squishy', id };
    }
    const ray = CreatePickingRay(this.#scene, x, y, null, camera);
    if (ray.direction.y >= 0) return null;
    const t = (this.#ground - ray.origin.y) / ray.direction.y;
    const p = { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    const reach = HOME_VIEW.hexSize * SPOT_SIZE * 0.95;
    const near = <T>(items: readonly T[], at: (item: T) => WorldPoint): T | null => {
      let best: T | null = null;
      let bestD = reach * reach;
      for (const item of items) {
        const w = at(item);
        const d = (w.x - p.x) * (w.x - p.x) + (w.z - p.z) * (w.z - p.z);
        if (d < bestD) {
          best = item;
          bestD = d;
        }
      }
      return best;
    };
    const spot = near(this.#spots, (s) => this.spotAt(s));
    if (spot) return { kind: 'spot', spot };
    if (this.#spots.length === 0) {
      const reach = HOME_VIEW.hexSize * SQUISHY_REACH;
      let best: string | null = null;
      let bestD = reach * reach;
      for (const [id, r] of this.#residents) {
        const d = (r.at.x - p.x) ** 2 + (r.at.z - p.z) ** 2;
        if (d < bestD) {
          best = id;
          bestD = d;
        }
      }
      if (best) return { kind: 'squishy', id: best };
    }
    const building = near(this.#home.buildings, (b) => this.spotAt(b));
    return building ? { kind: 'building', id: building.id } : null;
  }

  #residentOf(handle: SquishyHandle): string | null {
    for (const [id, r] of this.#residents) if (r.handle.id === handle.id) return id;
    return null;
  }

  /** Squishies that live in a habitat (only they wander). */
  get wanderers(): string[] {
    return [...this.#residents].filter(([, r]) => r.home !== null).map(([id]) => id);
  }

  /** Starts one wander hop for a housed squishy (`now`: wall-clock ms). */
  hop(squishyId: string, now: number): void {
    const r = this.#residents.get(squishyId);
    if (!r?.home) return;
    r.hops += 1;
    r.hop = { from: r.at, to: this.#wanderPoint(r.home, squishyId, r.hops), start: now };
  }

  /** Moves hops along; true while anything still moves (keep drawing). */
  step(now: number): boolean {
    let moving = false;
    for (const r of this.#residents.values()) {
      if (!r.hop) continue;
      const t = Math.min(1, (now - r.hop.start) / WANDER.hopMs);
      const { from, to } = r.hop;
      const at = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      const lift = 4 * t * (1 - t) * WANDER.hopHeight;
      const yaw = Math.atan2(to.x - from.x, -(to.z - from.z));
      this.#squishies.move(r.handle, this.#placement(at, yaw, lift));
      if (t >= 1) {
        r.at = to;
        r.hop = null;
        this.#squishies.play(r.handle, 'wobble', now);
      } else {
        moving = true;
      }
    }
    return this.#squishies.update(now) || moving;
  }

  setLod(lod: SquishyLod): void {
    this.#squishies.setLod(lod);
  }

  #speciesList(): Species[] {
    return [...GAME_DATA.species, ...this.#home.speciesDefs];
  }

  #placement(at: WorldPoint, yaw: number, lift = 0) {
    return { x: at.x, z: at.z, y: this.#ground + lift, yaw, scale: HOME_VIEW.squishyScale };
  }

  /** A seeded spot near a habitat: the same squishy wanders the same way for everyone. */
  #wanderPoint(anchor: WorldPoint, squishyId: string, n: number): WorldPoint {
    const rng = Rng.fromSeed(deriveSeed('home-wander', squishyId, n));
    const angle = rng.next() * Math.PI * 2;
    const distance = (0.45 + rng.next() * 0.55) * HOME_VIEW.wanderRadius;
    return { x: anchor.x + Math.cos(angle) * distance, z: anchor.z + Math.sin(angle) * distance };
  }

  /**
   * Where the n-th squishy without a habitat waits (0-based): around the
   * Heart Seed between the building spots, in widening rings of six.
   */
  #waitingPoint(n: number): WorldPoint {
    const ring = Math.floor(n / 6);
    const angle = ((30 + 60 * (n % 6) + 30 * (ring % 2)) * Math.PI) / 180;
    const d = HOME_VIEW.hexSize * (0.32 + 0.16 * ring);
    return { x: Math.cos(angle) * d, z: Math.sin(angle) * d };
  }

  #buildGround(home: HomeResponse): void {
    const k = this.#k;
    const s = new Vector3(k, k, k);
    const local = (t: { q: number; r: number }) =>
      hexToWorld({ q: t.q - this.#seed.q, r: t.r - this.#seed.r }, HOME_VIEW.hexSize);

    const h = HOME_LOOK.height;
    const tile = meshFrom(
      this.#scene,
      'home-tiles',
      loftRoundedHex(
        HEX_SIZE * TILE_FILL,
        [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
        { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
      ),
    );
    tile.material = vinyl(this.#scene, 'home-tiles-mat', HOME_LOOK);
    setInstances(
      tile,
      home.tiles.map((t) => {
        const p = local(t);
        return placeAt(p.x, 0, p.z, s);
      }),
    );

    const island = CreateCylinder(
      'home-island',
      { diameter: HOME_VIEW.hexSize * 6.4, height: ISLAND.thickness * k, tessellation: 64 },
      this.#scene,
    );
    island.position.y = (-ISLAND.thickness * k) / 2;
    island.material = vinyl(this.#scene, 'home-island-mat', { color: ISLAND.color });
    island.isPickable = false;

    const seed = buildHeartSeed(this.#scene);
    setInstances(seed, [placeAt(0, (HOME_LOOK.height + 0.15) * k, 0, s)]);

    // Each home node (Timber, Stone, Emberwood, the farm plot) in its tile's middle.
    const byKind = new Map<PropKind, Matrix[]>();
    for (const t of home.tiles) {
      const kind = t.nodeResource ? NODE_PROPS[t.nodeResource] : undefined;
      if (!kind) continue;
      const p = local(t);
      const list = byKind.get(kind) ?? [];
      list.push(placeAt(p.x, this.#ground, p.z, s));
      byKind.set(kind, list);
    }
    const propMat = vinyl(this.#scene, 'home-prop-mat', { color: '#ffffff' });
    for (const [kind, matrices] of byKind) {
      const { mesh } = buildProp(this.#scene, kind);
      mesh.material = propMat;
      setInstances(mesh, matrices);
    }
  }
}

function sameAnchor(a: WorldPoint | null, b: WorldPoint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.z === b.z;
}
