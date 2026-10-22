import { CreatePickingRay } from '@babylonjs/core/Culling/ray.core';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  deriveSeed,
  GAME_DATA,
  hexDistance,
  hexKey,
  hexSpiral,
  hexToWorld,
  houseTile,
  KEEPER_DATA,
  Rng,
  HOUSE_DATA,
  houseLevelData,
  type HomeResponse,
  type HouseExterior,
  type KeeperConfig,
  type Species,
  type VisualRegistry,
  type WorldPoint,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import { HEX_SIZE, HOME_LOOK, ISLAND, TILE_FILL, type PropKind } from '../map/map-config.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { linear } from '../map/map-props.js';
import {
  BEVEL,
  buildHeartSeed,
  buildProp,
  CORNER,
  DOME,
  meshFrom,
  homeNodeShown,
  NODE_PROPS,
  overlayMaterial,
  placeAt,
  SEGMENTS,
  setInstances,
  TOP_RINGS,
  vinyl,
} from '../map/map-scene.js';
import { BuildingField } from '../procedural/buildings/building-field.js';
import type { SquishyLod } from '../procedural/config.js';
import { faceYaw } from '../procedural/face-yaw.js';
import { KeeperField } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { accessoryItem } from '../procedural/accessory.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { buildCottage } from '../house/house-models.js';
import type { WorkMood } from '../squishies/jobs/jobs-view.js';
import {
  HOME_FILL,
  HOME_FRAME,
  HOME_HOUSE,
  HOME_VIEW,
  MAP_OUTER_BUILDING_SCALE,
  MOOD_CUES,
  ROAM,
  SPOT_SIZE,
  WANDER,
} from './home-config.js';
import { centreOf, fillsTile, nodeAside, spotWorld } from './home-layout.js';
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
  /** Squishies drawn at a habitat or the Training Grounds (the rest roam the home tiles, #604). */
  readonly housed: number;
  /** Gatherers, guards and trainees, out on their tiles and not drawn here (#604). */
  readonly away: number;
  /** Tiles around the home base a lit fire's light reaches (owner decision 2026-10-06). */
  readonly firelit: number;
  readonly keeper: boolean;
  /** Clothing ids the Keeper wears (#43). */
  readonly keeperWearing: readonly string[];
  /** Free spots glowing while the player picks where to build. */
  readonly spots: number;
  /** Building draw calls (one per look, not per building). */
  readonly buildingMeshes: number;
  /** The cottage (#381), by its exterior; null while the house is switched off. */
  readonly house: HouseExterior | null;
  /** The ring tile the cottage fills (#604, shared `houseTile`), as a step from the Heart Seed; null: by the Heart Seed. */
  readonly houseTile: { q: number; r: number } | null;
  /** Squishies at a job they love (💕, and a bounce now and then), and ones drooping (🌧️, #393). */
  readonly happy: number;
  readonly drooping: number;
  /** Happy bounces started so far (#393). */
  readonly cheers: number;
}

/** What a tap hit. */
export type HomePick =
  | { readonly kind: 'spot'; readonly spot: HomeSpot }
  | { readonly kind: 'squishy'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string }
  /** The cottage (#381). */
  | { readonly kind: 'house' }
  | null;

/** A tap this close to a squishy's feet counts as on it (they're small), in hex sizes. */
const SQUISHY_REACH = 0.2; // TUNE

/** A tap this close to the middle of a tile-sized building counts as on it, in hex sizes (#589). */
const FILLED_REACH = HOME_VIEW.hexSize * 0.55; // TUNE

/** A tap this close to the middle of a glowing tile picks it, in world units (#589): most of the tile. */
const TILE_REACH = HOME_VIEW.hexSize * 0.85; // TUNE

export interface HomeSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly keeper: KeeperConfig | null;
  /** What the Keeper wears (#43): clothing ids. */
  readonly keeperWearing?: readonly string[];
}

interface Resident {
  readonly handle: SquishyHandle;
  /** Where it wanders around: its habitat's spot, or the home tile it roams (#604). */
  readonly home: WorldPoint;
  /** It has no habitat and roams a home tile (#604): nothing to be tucked inside. */
  readonly roams: boolean;
  /** Its habitat fills its tile (#589): it wanders round the building, not through it. */
  readonly wide: boolean;
  /**
   * It practices at the Training Grounds: its place in line there (0, 1, …),
   * which side of the target it hops about. Null for everyone else.
   */
  readonly training: number | null;
  at: WorldPoint;
  /** Which way it faces (it turns to where it last hopped). */
  yaw: number;
  /** Where it is this frame, mid-hop included (its mood bubble follows it). */
  readonly now: { x: number; z: number; lift: number };
  hop: { from: WorldPoint; to: WorldPoint; start: number } | null;
  hops: number;
  /** How it feels about its job (#393), or null: it looks as it always does. */
  mood: WorkMood | null;
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
  readonly #spotFill: Mesh;
  readonly #selection: Mesh;
  /** The fire's light on the land, one mesh per distance band (it fades going out). */
  readonly #firelight: Mesh[];
  readonly #residents = new Map<string, Resident>();
  #home: HomeResponse;
  /** The node props, one instanced mesh per kind (`#placeNodes`). */
  readonly #nodeMeshes = new Map<PropKind, Mesh>();
  #spots: HomeSpot[] = [];
  #counts = { housed: 0, away: 0, firelit: 0 };
  /** The cottage drawn now, if the house is on for this player, and the tile it fills (#604). */
  #cottage: { exterior: HouseExterior; tile: string | null; mesh: Mesh } | null = null;
  /** The ring tile the house fills (#604), or null: by the Heart Seed, or no house. */
  #houseAt: { q: number; r: number } | null = null;
  /** Each of my squishies' work mood (#393), by squishy id. */
  #moods: ReadonlyMap<string, WorkMood> = new Map();
  #cheers = 0;
  #happy: string[] = [];
  #drawOrder: string[] = [];

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

    // A glowing pink ring around a soft pink disc (#131): it has to stand
    // out from the sand-coloured tiles, not melt into them.
    this.#spotMarkers = CreateTorus(
      'home-spots',
      { diameter: 0.9, thickness: 0.06, tessellation: 32 },
      scene,
    );
    const ringMat = overlayMaterial(scene, 'home-spots-mat');
    ringMat.emissiveColor = linear(HOME_VIEW.spot.ring);
    this.#spotMarkers.material = ringMat;
    this.#spotMarkers.isPickable = false;
    this.#spotMarkers.alwaysSelectAsActiveMesh = true;
    this.#spotMarkers.setEnabled(false);
    this.#spotFill = CreateDisc('home-spot-fill', { radius: 0.42, tessellation: 32 }, scene);
    this.#spotFill.rotation.x = Math.PI / 2;
    this.#spotFill.bakeCurrentTransformIntoVertices();
    const fillMat = overlayMaterial(scene, 'home-spot-fill-mat');
    fillMat.emissiveColor = linear(HOME_VIEW.spot.fill);
    fillMat.alpha = HOME_VIEW.spot.fillAlpha;
    this.#spotFill.material = fillMat;
    this.#spotFill.isPickable = false;
    this.#spotFill.alwaysSelectAsActiveMesh = true;
    this.#spotFill.setEnabled(false);
    this.#selection = CreateTorus(
      'home-selection',
      { diameter: 1.4, thickness: 0.09, tessellation: 40 },
      scene,
    );
    this.#selection.material = vinyl(scene, 'home-selection-mat', { color: '#ff6f9f' });
    this.#selection.isPickable = false;
    this.#selection.setEnabled(false);
    // The warm light a fire throws over the land around the home base, as the
    // map draws it, a little stronger: an upgrade's bigger radius shows here.
    const k = this.#k;
    const light = HOME_VIEW.firelight;
    this.#firelight = HOME_VIEW.firelightFade.map((share, band) => {
      const mesh = meshFrom(
        scene,
        `home-firelight-${String(band)}`,
        loftRoundedHex(
          HEX_SIZE * TILE_FILL * k,
          [
            { scale: 0.5, y: DOME * 0.75 * k, alpha: light.fill * share },
            { scale: 0.8, y: DOME * 0.25 * k, alpha: light.fill * share },
            { scale: 0.92, y: -BEVEL * 0.25 * k, alpha: light.edge * share },
            { scale: 1, y: -BEVEL * k, alpha: 0 },
          ],
          {
            corner: CORNER,
            segments: SEGMENTS,
            centre: { y: DOME * k, alpha: light.fill * share },
            rgb: [...light.rgb],
          },
        ),
      );
      const material = overlayMaterial(scene, `home-firelight-mat-${String(band)}`);
      // Light adds to what's under it (it brightens the grass), rather than
      // painting orange over it, which reads as sand.
      material.alphaMode = Constants.ALPHA_ADD;
      mesh.material = material;
      mesh.isPickable = false;
      return mesh;
    });

    this.update(home);
    const radius = HOME_VIEW.hexSize * HOME_VIEW.landRings * 1.8;
    this.content = {
      bounds: { minX: -radius, maxX: radius, minZ: -radius, maxZ: radius },
      start: { x: 0, z: this.#startZ(scene.getEngine().getRenderingCanvas()?.clientHeight ?? 0) },
    };
  }

  /**
   * Where the camera starts, front to back (#604): towards the house's tile
   * by `HOME_FRAME`'s share for a canvas `height` CSS px tall, so the house
   * shows in full under the top card. No house tile: the Heart Seed.
   */
  #startZ(height: number): number {
    if (!this.#houseAt) return 0;
    const f = HOME_FRAME;
    const t = Math.min(1, Math.max(0, (height - f.shortAt) / (f.tallAt - f.shortAt)));
    const share = height > 0 ? f.short + (f.tall - f.short) * t : f.short;
    return this.spotAt({ ...this.#houseAt, spot: 0 }).z * share;
  }

  get stats(): HomeSceneStats {
    return {
      tiles: this.#home.tiles.length,
      buildings: this.#buildings.stats.buildings,
      litFires: this.#buildings.stats.lit,
      squishies: this.#residents.size,
      housed: this.#counts.housed,
      away: this.#counts.away,
      firelit: this.#counts.firelit,
      keeper: this.#keepers.handles.length > 0,
      keeperWearing: this.#keepers.handles[0]?.params.worn ?? [],
      spots: this.#spots.length,
      buildingMeshes: this.#buildings.stats.meshes,
      house: this.#cottage?.exterior ?? null,
      houseTile:
        this.#cottage && this.#houseAt
          ? { q: this.#houseAt.q - this.#seed.q, r: this.#houseAt.r - this.#seed.r }
          : null,
      happy: this.happy.length,
      drooping: [...this.#residents.values()].filter((r) => r.mood === 'meh').length,
      cheers: this.#cheers,
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

  /** Whether a building fills its home tile (#589): a habitat on a ring spot off the Heart Seed tile. */
  #fills(b: { q: number; r: number; spot: number; kind: string }): boolean {
    return fillsTile(b.spot, b.q === this.#seed.q && b.r === this.#seed.r, b.kind);
  }

  /** Where a building stands: the tile's middle if it fills the tile, else its spot. */
  #buildingAt(b: { q: number; r: number; spot: number; kind: string }): WorldPoint {
    return this.#fills(b) ? this.spotAt({ q: b.q, r: b.r, spot: 0 }) : this.spotAt(b);
  }

  /** Redraws buildings, squishies and the Keeper from a fresh home reply. */
  update(home: HomeResponse): void {
    this.#home = home;
    this.#buildings.set(
      home.buildings.map((b) => {
        const at = this.#buildingAt(b);
        return {
          buildingId: b.buildingId,
          level: b.level,
          lit: b.lit,
          x: at.x,
          z: at.z,
          y: this.#ground,
          scale: this.#fills(b)
            ? HOME_VIEW.hexSize * MAP_OUTER_BUILDING_SCALE
            : HOME_VIEW.buildingScale,
        };
      }),
    );
    // The house's own ring tile (#604): the rule the server refuses building there by.
    this.#houseAt = home.house ? houseTile(home.tiles, home.buildings) : null;
    this.#placeNodes(home);
    const firelit = this.#showFirelight(home);
    this.#showCottage(home);

    // Squishies: at their habitat or the Training Grounds they practice at,
    // or roaming a free home tile (#604). Gatherers, guards and trainees on
    // a homestead's Training Grounds are out on their tiles, so they aren't here.
    const roam = this.#roamTiles(home);
    const anchors = new Map<string, { at: WorldPoint; wide: boolean }>(
      home.buildings
        .filter((b) => b.kind === 'habitat' || b.kind === 'training-grounds')
        .map((b) => [b.id, { at: this.#buildingAt(b), wide: this.#fills(b) }]),
    );
    const species = new Map<string, Species>();
    for (const s of this.#speciesList()) species.set(s.id, s);
    const keep = new Set<string>();
    let housed = 0;
    let away = 0;
    /** Trainees seen so far per Training Grounds (each gets its own side). */
    const trainees = new Map<string, number>();
    for (const squishy of home.squishies) {
      const kind = species.get(squishy.speciesId);
      if (!kind) continue; // a species this client can't draw: it still shows in the list
      if (squishy.job === 'gatherer' || squishy.job === 'guard') {
        away++;
        continue;
      }
      const anchorId = squishy.trainingId ?? squishy.habitatId;
      const place = anchorId ? (anchors.get(anchorId) ?? null) : null;
      // A trainee is at its Training Grounds (#604), out on a homestead
      // (#277) unless they're drawn here: away, like a gatherer.
      if (squishy.trainingId !== null && !place) {
        away++;
        continue;
      }
      const roams = !place;
      // One without a habitat roams a free home tile, picked by its id (#604).
      const anchor = place?.at ?? this.#roamAnchor(roam, squishy.id);
      const wide = place?.wide ?? false;
      let training: number | null = null;
      if (!roams && squishy.trainingId !== null) {
        training = trainees.get(squishy.trainingId) ?? 0;
        trainees.set(squishy.trainingId, training + 1);
      }
      const existing = this.#residents.get(squishy.id);
      keep.add(squishy.id);
      if (!roams) housed++;
      if (
        existing &&
        existing.training === training &&
        existing.wide === wide &&
        existing.roams === roams &&
        sameAnchor(existing.home, anchor)
      ) {
        this.#squishies.setAccessory(existing.handle, accessoryItem(squishy.accessory));
        continue;
      }
      if (existing) this.#squishies.remove(existing.handle);
      const at = this.#wanderPoint(anchor, squishy.id, 0, training, wide, roams);
      const mood = this.#moods.get(squishy.id) ?? null;
      const handle = this.#squishies.add(kind, squishy.id, this.#placement(at, 0, 0, mood));
      // What it wears (#340): the same pieces as up close.
      this.#squishies.setAccessory(handle, accessoryItem(squishy.accessory));
      if (mood === 'meh') this.#squishies.setFace(handle, 'glum');
      this.#residents.set(squishy.id, {
        handle,
        home: anchor,
        roams,
        wide,
        training,
        at,
        now: { x: at.x, z: at.z, lift: 0 },
        yaw: 0,
        hop: null,
        hops: 0,
        mood,
      });
    }
    for (const [id, resident] of this.#residents) {
      if (keep.has(id)) continue;
      this.#squishies.remove(resident.handle);
      this.#residents.delete(id);
    }
    this.#counts = { housed, away, firelit };
    this.#countHappy();

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

  /**
   * Glows over the land around the home base that lit fires keep safe (their
   * radius from the fire's own tile, as nightfall counts it), out to the
   * land rings drawn here. Returns how many tiles glow.
   */
  #showFirelight(home: HomeResponse): number {
    const homeKeys = new Set(home.tiles.map((t) => hexKey(t)));
    // Each tile once, at its distance from the nearest lit fire that reaches it.
    const lit = new Map<string, { local: { q: number; r: number }; d: number }>();
    for (const b of home.buildings) {
      if (b.lit !== true || b.safeRadius === null) continue;
      for (const h of hexSpiral({ q: b.q, r: b.r }, b.safeRadius)) {
        const local = { q: h.q - this.#seed.q, r: h.r - this.#seed.r };
        const ring = Math.max(Math.abs(local.q), Math.abs(local.r), Math.abs(local.q + local.r));
        if (homeKeys.has(hexKey(h)) || ring > HOME_VIEW.landRings) continue;
        const d = hexDistance(h, { q: b.q, r: b.r });
        const seen = lit.get(hexKey(h));
        if (!seen || d < seen.d) lit.set(hexKey(h), { local, d });
      }
    }
    // Just over the land's top (its dome peaks at `HOME_LOOK.height + DOME`).
    const lift = -HOME_VIEW.landDrop + HOME_LOOK.height * this.#k + 0.02;
    const bands = this.#firelight.length;
    this.#firelight.forEach((mesh, band) => {
      const here = [...lit.values()].filter(
        (t) => Math.min(Math.max(t.d - 1, 0), bands - 1) === band,
      );
      setInstances(
        mesh,
        here.map(({ local }) => {
          const p = hexToWorld(local, HOME_VIEW.hexSize);
          return placeAt(p.x, lift, p.z);
        }),
        true,
      );
    });
    return lit.size;
  }

  /**
   * The Keeper's house (#381), sized by its level's exterior: filling its own
   * ring tile (#604, like a habitat, #589), or, with no ring tile free,
   * behind the Heart Seed between the tile's back building spots, as before.
   * None at all while the house is switched off for this player (no
   * `home.house`).
   */
  #showCottage(home: HomeResponse): void {
    const exterior = home.house ? houseLevelData(HOUSE_DATA, home.house.level).exterior : null;
    const tile = this.#houseAt ? hexKey(this.#houseAt) : null;
    if (this.#cottage?.exterior === exterior && this.#cottage.tile === tile) return;
    // Its material too: each swap makes a new one.
    this.#cottage?.mesh.dispose(false, true);
    this.#cottage = null;
    if (!exterior) return;
    const mesh = buildCottage(this.#scene, exterior);
    mesh.material = vinyl(this.#scene, 'home-cottage-mat', { color: '#ffffff' });
    if (this.#houseAt) {
      const at = this.spotAt({ ...this.#houseAt, spot: 0 });
      mesh.position.set(at.x, this.#ground, at.z);
      mesh.scaling.setAll(HOME_HOUSE.fillScale);
    } else {
      const at = HOME_HOUSE.offset;
      mesh.position.set(at.x * HOME_VIEW.hexSize, this.#ground, at.z * HOME_VIEW.hexSize);
      mesh.scaling.setAll(HOME_HOUSE.scale);
    }
    this.#cottage = { exterior, tile, mesh };
  }

  /** The middle of the tile a lit spot is on: a building fills its whole ring tile (#589). */
  #tileAt(spot: HomeSpot): WorldPoint {
    return this.spotAt({ q: spot.q, r: spot.r, spot: 0 });
  }

  /** Lights up the free tiles to tap while placing or moving (empty: off). */
  showSpots(spots: readonly HomeSpot[]): void {
    this.#spots = [...spots];
    const at = spots.map((s) => this.#tileAt(s));
    const glow = new Vector3(HOME_FILL.glowScale, 1, HOME_FILL.glowScale);
    setInstances(
      this.#spotFill,
      // Above the tile's dome everywhere, or the dome cuts wedges out of it.
      at.map((p) => placeAt(p.x, this.#ground + DOME * 0.5 * this.#k + 0.01, p.z, glow)),
      true,
    );
    setInstances(
      this.#spotMarkers,
      at.map((p) => placeAt(p.x, this.#ground + 0.03, p.z, glow)),
      true,
    );
  }

  /** Rings the tile the Build sheet will build on (#371), among the glowing ones; null clears it. */
  markSpot(spot: HomeSpot | null): void {
    if (!spot) {
      this.#selection.setEnabled(false);
      return;
    }
    const at = this.#tileAt(spot);
    this.#selection.position.set(at.x, this.#ground + 0.02, at.z);
    this.#selection.scaling.setAll(HOME_FILL.markScale);
    this.#selection.setEnabled(true);
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
    this.#selection.scaling.setAll(1);
    this.#selection.setEnabled(true);
  }

  /**
   * What's under a point on the canvas (CSS pixels): a lit spot first, then
   * a squishy (opens its close-up, #20: a direct hit, or near its feet when
   * that's nearer than a building), then a building.
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
    // A tile-sized building (#589) takes taps across its whole footprint.
    const near = <T>(
      items: readonly T[],
      at: (item: T) => WorldPoint,
      wide: (item: T) => number | null = () => null,
    ): T | null => {
      let best: T | null = null;
      let bestD = Infinity;
      for (const item of items) {
        const w = at(item);
        const d = (w.x - p.x) * (w.x - p.x) + (w.z - p.z) * (w.z - p.z);
        const far = wide(item) ?? reach;
        const limit = far * far;
        if (d < limit && d < bestD) {
          best = item;
          bestD = d;
        }
      }
      return best;
    };
    const spot = near(
      this.#spots,
      (s) => this.#tileAt(s),
      () => TILE_REACH,
    );
    if (spot) return { kind: 'spot', spot };
    const building = near(
      this.#home.buildings,
      (b) => this.#buildingAt(b),
      (b) => (this.#fills(b) ? FILLED_REACH : null),
    );
    if (this.#spots.length === 0) {
      // Near a squishy's feet counts too (they're small), unless the tap is
      // nearer the building it lives by.
      const reach = HOME_VIEW.hexSize * SQUISHY_REACH;
      const d2 = (a: WorldPoint) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2;
      let best: string | null = null;
      let bestD = Math.min(reach * reach, building ? d2(this.#buildingAt(building)) : Infinity);
      for (const [id, r] of this.#residents) {
        const d = d2(r.at);
        if (d < bestD) {
          best = id;
          bestD = d;
        }
      }
      if (best) return { kind: 'squishy', id: best };
      // The cottage (#381), after a squishy's feet, when the tap is nearer it
      // than any building it sits beside; across its whole tile once it fills one (#604).
      if (this.#cottage) {
        const c = this.#cottage.mesh.position;
        const r = this.#houseAt ? FILLED_REACH : HOME_HOUSE.tapReach * HOME_VIEW.hexSize;
        const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (d < r * r && d < (building ? d2(this.#buildingAt(building)) : Infinity)) {
          return { kind: 'house' };
        }
      }
    }
    return building ? { kind: 'building', id: building.id } : null;
  }

  #residentOf(handle: SquishyHandle): string | null {
    for (const [id, r] of this.#residents) if (r.handle.id === handle.id) return id;
    return null;
  }

  /** Squishies that wander: every one drawn, but a drooping one sits still (#393). */
  get wanderers(): string[] {
    return [...this.#residents].filter(([, r]) => r.mood !== 'meh').map(([id]) => id);
  }

  /** Squishies at a job they love (#393): they bounce now and then. Kept, not rebuilt per frame. */
  get happy(): readonly string[] {
    return this.#happy;
  }

  /** Each squishy's work mood (#393), as last set. */
  get moods(): ReadonlyMap<string, WorkMood> {
    return this.#moods;
  }

  /** Every squishy drawn, nearest the camera first (#393's bubbles keep their spots in this order). */
  get drawOrder(): readonly string[] {
    return this.#drawOrder;
  }

  /**
   * Sets how each squishy feels about its job (#393; missing: no mood). A
   * drooping one sits squashed where it stands; the rest stand up again.
   */
  setMoods(moods: ReadonlyMap<string, WorkMood>): void {
    this.#moods = moods;
    for (const [id, r] of this.#residents) {
      const mood = moods.get(id) ?? null;
      if (mood === r.mood) continue;
      r.mood = mood;
      this.#squishies.setFace(r.handle, mood === 'meh' ? 'glum' : null);
      if (!r.hop) this.#squishies.move(r.handle, this.#placement(r.at, r.yaw, 0, mood));
    }
    this.#countHappy();
  }

  #countHappy(): void {
    this.#happy = [...this.#residents].filter(([, r]) => r.mood === 'loves').map(([id]) => id);
    this.#sortDrawOrder();
  }

  /** Nearest first, again after anyone moved (a hop landed). */
  #sortDrawOrder(): void {
    // The home camera looks along +z without turning, so a smaller z is nearer (squishies face −z).
    this.#drawOrder = [...this.#residents]
      .sort(([, a], [, b]) => a.at.z - b.at.z)
      .map(([id]) => id);
  }

  /** A happy squishy does its little bounce (#393), on the spot (`now`: wall-clock ms). */
  cheer(squishyId: string, now: number): void {
    const r = this.#residents.get(squishyId);
    if (r?.mood !== 'loves') return;
    this.#cheers += 1;
    this.#squishies.play(r.handle, 'bounce', now, MOOD_CUES.bounceStrength);
  }

  /**
   * The world points at the top of a squishy's head and at its feet, where it
   * is this frame (#393's mood bubbles), written into `top` and `foot`; false
   * if it isn't drawn.
   */
  headAndFeet(squishyId: string, top: Vector3, foot: Vector3): boolean {
    const r = this.#residents.get(squishyId);
    if (!r) return false;
    const tall = this.#squishies.heightOf(r.handle) * HOME_VIEW.squishyScale;
    const squash = r.mood === 'meh' ? MOOD_CUES.droop : 1;
    const y = this.#ground + r.now.lift;
    top.set(r.now.x, y + tall * squash, r.now.z);
    foot.set(r.now.x, y, r.now.z);
    return true;
  }

  /**
   * Whether a squishy stands tucked inside its habitat building, where its
   * face can't be seen (#393: a bubble needn't keep clear of it). Wander
   * spots can fall inside the building's footprint.
   */
  tucked(squishyId: string): boolean {
    const r = this.#residents.get(squishyId);
    if (!r || r.roams || r.training !== null) return false;
    const reach = HOME_VIEW.buildingScale * MOOD_CUES.tuckedWithin;
    return (r.now.x - r.home.x) ** 2 + (r.now.z - r.home.z) ** 2 < reach * reach;
  }

  /** The face a squishy is pulling (#393; tests). */
  faceOf(squishyId: string): 'glum' | null {
    const r = this.#residents.get(squishyId);
    return r ? this.#squishies.faceOf(r.handle) : null;
  }

  /** Starts one wander hop for a squishy (`now`: wall-clock ms). */
  hop(squishyId: string, now: number): void {
    const r = this.#residents.get(squishyId);
    if (!r) return;
    r.hops += 1;
    r.hop = {
      from: r.at,
      to: this.#wanderPoint(r.home, squishyId, r.hops, r.training, r.wide, r.roams, r.at),
      start: now,
    };
  }

  /** Moves hops along; true while anything still moves (keep drawing). */
  step(now: number): boolean {
    let moving = false;
    let landed = false;
    for (const r of this.#residents.values()) {
      if (!r.hop) continue;
      const t = Math.min(1, (now - r.hop.start) / WANDER.hopMs);
      const { from, to } = r.hop;
      const at = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      r.now.x = at.x;
      r.now.z = at.z;
      const lift = 4 * t * (1 - t) * WANDER.hopHeight;
      r.now.lift = t >= 1 ? 0 : lift;
      const yaw = faceYaw(to.x - from.x, to.z - from.z);
      this.#squishies.move(r.handle, this.#placement(at, yaw, lift, r.mood));
      if (t >= 1) {
        r.at = to;
        r.yaw = yaw;
        r.hop = null;
        landed = true;
        this.#squishies.play(r.handle, 'wobble', now);
      } else {
        moving = true;
      }
    }
    if (landed) this.#sortDrawOrder();
    return this.#squishies.update(now) || moving;
  }

  setLod(lod: SquishyLod): void {
    this.#squishies.setLod(lod);
  }

  #speciesList(): Species[] {
    return [...GAME_DATA.species, ...this.#home.speciesDefs];
  }

  #placement(at: WorldPoint, yaw: number, lift = 0, mood: WorkMood | null = null) {
    return {
      x: at.x,
      z: at.z,
      y: this.#ground + lift,
      yaw,
      scale: HOME_VIEW.squishyScale,
      // Not keen on its job: it droops a little (#393).
      ...(mood === 'meh' ? { squash: MOOD_CUES.droop } : {}),
    };
  }

  /**
   * A seeded spot near a habitat: the same squishy wanders the same way for
   * everyone. A trainee keeps to the left or right of the mat, beside the
   * target at its front, so the target stays in view. One roaming a home
   * tile (#604) keeps round the tile's middle, clear of its node or the
   * Heart Seed. Round a tile's middle or a tile-sized habitat, a hop from
   * `from` turns at most `WANDER.turn` about the anchor, so it walks round
   * what's there rather than through it.
   */
  #wanderPoint(
    anchor: WorldPoint,
    squishyId: string,
    n: number,
    training: number | null = null,
    wide = false,
    roams = false,
    from: WorldPoint | null = null,
  ): WorldPoint {
    const rng = Rng.fromSeed(deriveSeed('home-wander', squishyId, n));
    if (training !== null) {
      const side = training % 2 === 0 ? 0 : Math.PI;
      const angle = side + (rng.next() - 0.5) * 0.8;
      const distance = (0.32 + rng.next() * 0.16) * HOME_VIEW.buildingScale;
      return { x: anchor.x + Math.cos(angle) * distance, z: anchor.z + Math.sin(angle) * distance };
    }
    const turn = rng.next();
    const angle =
      (roams || wide) && from
        ? Math.atan2(from.z - anchor.z, from.x - anchor.x) + (turn - 0.5) * 2 * WANDER.turn
        : turn * Math.PI * 2;
    const distance = roams
      ? (ROAM.near + rng.next() * (ROAM.far - ROAM.near)) * HOME_VIEW.hexSize
      : wide
        ? HOME_FILL.wander.near + rng.next() * (HOME_FILL.wander.far - HOME_FILL.wander.near)
        : (0.45 + rng.next() * 0.55) * HOME_VIEW.wanderRadius;
    return { x: anchor.x + Math.cos(angle) * distance, z: anchor.z + Math.sin(angle) * distance };
  }

  /**
   * The home tiles squishies without a habitat roam (#604): every home tile
   * with no building and no house on it, the Heart Seed's included (round
   * the Heart Seed). The Heart Seed's tile still, when nothing else is free.
   */
  #roamTiles(home: HomeResponse): { key: string; at: WorldPoint }[] {
    const built = new Set(home.buildings.map((b) => hexKey(b)));
    // The house fills its own tile, or stands by the Heart Seed with none free.
    if (home.house) built.add(hexKey(this.#houseAt ?? this.#seed));
    const free = home.tiles.filter((t) => !built.has(hexKey(t)));
    return (free.length > 0 ? free : [this.#seed]).map((t) => ({
      key: hexKey(t),
      at: this.spotAt({ ...t, spot: 0 }),
    }));
  }

  /**
   * The tile one roams (#604), the same for everyone: the tile its id scores
   * highest on (rendezvous hashing), so building on one tile moves only the
   * squishies that roamed there.
   */
  #roamAnchor(tiles: readonly { key: string; at: WorldPoint }[], squishyId: string): WorldPoint {
    let best: WorldPoint = { x: 0, z: 0 };
    let bestScore = -1;
    for (const t of tiles) {
      const score = Rng.fromSeed(deriveSeed('home-roam', squishyId, t.key)).next();
      if (score > bestScore) {
        bestScore = score;
        best = t.at;
      }
    }
    return best;
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
    tile.material = vinyl(this.#scene, 'home-tiles-mat', { ...HOME_LOOK, ...HOME_VIEW.tile });
    setInstances(
      tile,
      home.tiles.map((t) => {
        const p = local(t);
        return placeAt(p.x, 0, p.z, s);
      }),
    );

    // The land around the home base (#184's "floats in a void"), plain and a
    // little lower, out to `landRings`, so a fire's light has somewhere to fall.
    const land = meshFrom(
      this.#scene,
      'home-land',
      loftRoundedHex(
        HEX_SIZE * TILE_FILL,
        [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
        { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
      ),
    );
    land.material = vinyl(this.#scene, 'home-land-mat', { ...HOME_LOOK, ...HOME_VIEW.land });
    const homeKeys = new Set(home.tiles.map((t) => hexKey(t)));
    setInstances(
      land,
      hexSpiral(this.#seed, HOME_VIEW.landRings)
        .filter((t) => !homeKeys.has(hexKey(t)))
        .map((t) => {
          const p = local(t);
          return placeAt(p.x, -HOME_VIEW.landDrop, p.z, s);
        }),
    );

    const island = CreateCylinder(
      'home-island',
      {
        diameter: HOME_VIEW.hexSize * (HOME_VIEW.landRings * 2 + 1.4) * 1.75,
        height: ISLAND.thickness * k,
        tessellation: 64,
      },
      this.#scene,
    );
    island.position.y = (-ISLAND.thickness * k) / 2;
    island.material = vinyl(this.#scene, 'home-island-mat', { color: ISLAND.color });
    island.isPickable = false;

    const seed = buildHeartSeed(this.#scene);
    setInstances(seed, [placeAt(0, (HOME_LOOK.height + 0.15) * k, 0, s)]);

    // Each home node (Timber, Stone, Emberwood, the farm plot, and the seasonal
    // ones in their season): one mesh per kind, placed by `#placeNodes`.
    const seasons = new Set(home.seasons);
    const propMat = vinyl(this.#scene, 'home-prop-mat', { color: '#ffffff' });
    for (const t of home.tiles) {
      const kind =
        t.nodeResource && homeNodeShown(t.nodeResource, seasons)
          ? NODE_PROPS[t.nodeResource]
          : undefined;
      if (!kind || this.#nodeMeshes.has(kind)) continue;
      const { mesh } = buildProp(this.#scene, kind);
      mesh.material = propMat;
      this.#nodeMeshes.set(kind, mesh);
    }
    this.#placeNodes(home);
  }

  /**
   * Puts each node in its tile's middle, or, where a building fills the tile
   * (#589), as a small pile at the tile's edge. The same meshes, re-instanced.
   */
  #placeNodes(home: HomeResponse): void {
    const k = this.#k;
    const full = new Vector3(k, k, k);
    const small = new Vector3(
      HOME_FILL.nodeScale * k,
      HOME_FILL.nodeScale * k,
      HOME_FILL.nodeScale * k,
    );
    const filled = new Set(home.buildings.filter((b) => this.#fills(b)).map((b) => hexKey(b)));
    // The house fills its tile too (#604): the node pile steps aside for it.
    if (this.#houseAt) filled.add(hexKey(this.#houseAt));
    const seasons = new Set(home.seasons);
    const byKind = new Map<PropKind, Matrix[]>();
    for (const t of home.tiles) {
      const kind =
        t.nodeResource && homeNodeShown(t.nodeResource, seasons)
          ? NODE_PROPS[t.nodeResource]
          : undefined;
      if (!kind) continue;
      const centre = hexToWorld(
        { q: t.q - this.#seed.q, r: t.r - this.#seed.r },
        HOME_VIEW.hexSize,
      );
      const aside = filled.has(hexKey(t));
      const p = aside ? nodeAside(centre, HOME_VIEW.hexSize) : centre;
      const list = byKind.get(kind) ?? [];
      list.push(placeAt(p.x, this.#ground, p.z, aside ? small : full));
      byKind.set(kind, list);
    }
    for (const [kind, mesh] of this.#nodeMeshes) setInstances(mesh, byKind.get(kind) ?? []);
  }
}

function sameAnchor(a: WorldPoint, b: WorldPoint): boolean {
  return a.x === b.x && a.z === b.z;
}
