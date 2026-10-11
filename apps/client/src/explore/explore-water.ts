import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import type { WorldPoint } from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import { DRIFT_MODE, type AmbientMode } from '../map/ambient-layout.js';
import { linear } from '../map/map-props.js';
import { attachTerrainPlugin, DRIFT_ATTRIBUTE } from '../map/terrain-plugin.js';
import { attachCaustics, type CausticsPlugin } from './caustics-plugin.js';
import type { SkyLook } from './explore-sky-look.js';
import type { ExploreLand, LandOptions } from './explore-land.js';
import {
  CAUSTICS,
  FISH_COLORS,
  WATER_HAZE,
  WATER_MOTION,
  WATER_TIERS,
  type WaterLook,
} from './lake-config.js';
import { buildBubble, buildCoral, buildFish, buildKelp } from './lake-kit.js';
import {
  waterLayout,
  waterPlaces,
  type BubbleHome,
  type FishHome,
  type WaterLayout,
} from './water-layout.js';

// The lake's own layers on the meadow's land (#335 art reset): fish circling,
// bubbles rising and caustic light on the sand, with the water's haze (the
// kelp and coral are the land's `extras`, see `lakeExtras`). They share the
// land's ground, clock and terrain plugin (one time uniform, no CPU work per
// frame), one draw call a kind; the tier sets how many bubbles rise.

/** Read-only numbers for the dev hook. */
export interface WaterStats {
  /** Instances drawn per layer. */
  readonly layers: Readonly<Record<string, number>>;
}

export interface WaterOptions {
  readonly look: WaterLook;
  readonly seed: number;
  readonly size: number;
  /** The Keeper's start, world units (kept clear). */
  readonly start: WorldPoint;
  /** The bubble springs, world units. */
  readonly springs: readonly WorldPoint[];
  readonly tier: QualityTier;
  readonly sky: SkyLook;
}

interface Layer {
  readonly mesh: Mesh;
  readonly count: number;
  /** Shown only while ambient life runs. */
  readonly live: boolean;
  readonly thins: boolean;
}

/**
 * The lake's kelp and coral as the land's own extra layers (`LandOptions.extras`):
 * placed inside the land's layout, so their shade is painted into the ground,
 * and drawn on the land's matte material, tinted with it.
 */
export function lakeExtras(look: WaterLook, seed: number): NonNullable<LandOptions['extras']> {
  return {
    place: (ctx) => waterPlaces(look, ctx, seed),
    layers: {
      kelp: { build: buildKelp, sway: WATER_MOTION.kelp },
      coral: { build: buildCoral, sway: WATER_MOTION.coral },
    },
  };
}

const matrix = (x: number, y: number, z: number, scale: number, yaw: number): Matrix =>
  Matrix.Compose(
    new Vector3(scale, scale, scale),
    Quaternion.RotationYawPitchRoll(yaw, 0, 0),
    new Vector3(x, y, z),
  );

export class ExploreWater {
  readonly layout: WaterLayout;
  readonly #scene: Scene;
  readonly #land: ExploreLand;
  readonly #layers = new Map<string, Layer>();
  #caustics: CausticsPlugin | null = null;
  #tier: QualityTier;
  #ambient: AmbientMode = 'off';

  constructor(scene: Scene, land: ExploreLand, options: WaterOptions) {
    this.#scene = scene;
    this.#land = land;
    this.#tier = options.tier;
    const { look, seed, size, start, springs } = options;
    this.layout = waterLayout({
      look,
      land: land.field,
      seed,
      size,
      start,
      springs,
      fishColors: FISH_COLORS.length,
    });
    const L = this.layout;

    this.#fish(L.fish);
    this.#bubbles(L.bubbles);

    // Caustic light rippling on the sand: one term on the ground's own material.
    const bed = land.groundMaterial;
    if (bed) this.#caustics = attachCaustics(bed, land.clock, CAUSTICS);

    this.setSky(options.sky);
    this.#applyTier();
    this.#applyLife();
  }

  get stats(): WaterStats {
    const layers: Record<string, number> = {};
    for (const [name, layer] of this.#layers) {
      layers[name] = layer.mesh.isEnabled() ? layer.mesh.thinInstanceCount : 0;
    }
    return { layers };
  }

  setTier(tier: QualityTier): void {
    if (tier === this.#tier) return;
    this.#tier = tier;
    this.#applyTier();
  }

  /** Bubbles rise only while ambient life runs (the land's `setAmbient`). */
  setAmbient(mode: AmbientMode): void {
    this.#ambient = mode;
    this.#applyLife();
  }

  /** The time of day: the water's tint and haze (after the land's own, which this overrides). */
  setSky(look: SkyLook): void {
    // The ripples fade with the light: soft by day, faint by moonlight.
    this.#caustics?.setStrength(CAUSTICS.strength * look.light.sun ** 2);
    if (look.fog) {
      const scene = this.#scene;
      scene.fogMode = Scene.FOGMODE_LINEAR;
      // As the sky draws its colours (sRGB), so far things melt into the dome's horizon.
      scene.fogColor = Color3.FromHexString(look.fog);
      scene.fogStart = WATER_HAZE.start;
      scene.fogEnd = WATER_HAZE.end;
    }
  }

  // ── Building ─────────────────────────────────────────────────────────────

  #fish(list: readonly FishHome[]): void {
    const mesh = buildFish(this.#scene);
    const mat = new PBRMaterial('lake-fish-mat', this.#scene);
    mat.albedoColor = Color3.White();
    mat.metallic = 0;
    mat.roughness = 0.55;
    attachTerrainPlugin(mat, this.#land.clock);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    if (list.length === 0) {
      mesh.setEnabled(false);
      this.#layers.set('fish', { mesh, count: 0, live: true, thins: false });
      return;
    }
    const matrices = new Float32Array(list.length * 16);
    const colors = new Float32Array(list.length * 4);
    const drift = new Float32Array(list.length * 4);
    list.forEach((f, i) => {
      matrix(f.x, f.y, f.z, f.size, 0).copyToArray(matrices, i * 16);
      const c = linear(FISH_COLORS[f.color % FISH_COLORS.length] ?? '#ffb36b');
      colors.set([c.r, c.g, c.b, 1], i * 4);
      drift.set([DRIFT_MODE.orbit, f.phase, f.radius, f.speed], i * 4);
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
    mesh.thinInstanceSetBuffer('color', colors, 4, true);
    mesh.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 4, true);
    mesh.freezeWorldMatrix();
    this.#layers.set('fish', { mesh, count: list.length, live: true, thins: false });
  }

  #bubbles(list: readonly BubbleHome[]): void {
    const mesh = buildBubble(this.#scene);
    const mat = new StandardMaterial('lake-bubbles-mat', this.#scene);
    mat.disableLighting = true;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    // Pale and a little bright, so they shine through the haze at night.
    mat.emissiveColor = linear('#e8fbff').scale(WATER_MOTION.glow);
    attachTerrainPlugin(mat, this.#land.clock);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    if (list.length === 0) {
      mesh.setEnabled(false);
      this.#layers.set('bubbles', { mesh, count: 0, live: true, thins: true });
      return;
    }
    const matrices = new Float32Array(list.length * 16);
    const drift = new Float32Array(list.length * 4);
    list.forEach((b, i) => {
      matrix(b.x, b.y, b.z, b.size, 0).copyToArray(matrices, i * 16);
      // The `fall` drift with a negative range rises instead: it grows, climbs and pops.
      drift.set([DRIFT_MODE.fall, b.phase, -b.rise, b.speed], i * 4);
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
    mesh.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 4, true);
    mesh.freezeWorldMatrix();
    this.#layers.set('bubbles', { mesh, count: list.length, live: true, thins: true });
  }

  #applyLife(): void {
    const live = this.#ambient === 'live';
    for (const layer of this.#layers.values()) {
      if (layer.live) layer.mesh.setEnabled(live && layer.count > 0);
    }
  }

  #applyTier(): void {
    const { bubbles } = WATER_TIERS[this.#tier];
    for (const layer of this.#layers.values()) {
      if (!layer.thins || layer.count === 0) continue;
      layer.mesh.thinInstanceCount = Math.max(1, Math.round(layer.count * bubbles));
    }
  }
}
