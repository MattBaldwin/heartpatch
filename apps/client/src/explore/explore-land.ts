import { Constants } from '@babylonjs/core/Engines/constants';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import type { WorldPoint } from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import { DRIFT_MODE, type AmbientMode } from '../map/ambient-layout.js';
import { linear } from '../map/map-props.js';
import {
  AMBIENT_ATTRIBUTE,
  attachTerrainPlugin,
  DRIFT_ATTRIBUTE,
  TerrainClock,
} from '../map/terrain-plugin.js';
import type { Collider } from './explore-world.js';
import type { SkyLook } from './explore-sky-look.js';
import {
  LAND_GRID,
  LAND_LIGHT,
  LAND_RADIUS,
  LAND_SWAY,
  LAND_TIERS,
  type LandLook,
} from './land-config.js';
import {
  buildBush,
  buildButterfly,
  buildFarTree,
  buildFlowers,
  buildLamp,
  buildLog,
  buildMote,
  buildMushrooms,
  buildPebbles,
  buildRocks,
  buildTree,
  buildTuft,
} from './land-kit.js';
import { landLayout, type Growth, type LandLayout, type MoteHome } from './land-layout.js';
import { paintGround } from './land-paint.js';
import { landField, unwarp, type LandField } from './land-shape.js';

// The explore land (#335 art reset, hero biome first): the sculpted ground
// with its painted grass and path, layered growth (grass and flowers you walk
// through, a hedge along the tile's edge, trees, rocks and logs round it,
// groves on the far hills), warm light with soft shadows painted into the
// ground along the sun (every tier, no shadow map), a hemispheric fill
// and haze for depth, and gentle life (swaying grass, butterflies, pollen,
// fireflies) on the map's terrain plugin: one time uniform, no CPU work per
// frame. One draw call a kind; the tier sets the grass share.

/** Read-only numbers for the dev hook. */
export interface LandStats {
  readonly tier: QualityTier;
  /** Instances drawn per layer. */
  readonly layers: Readonly<Record<string, number>>;
  readonly ambient: AmbientMode;
  /** Ground mesh vertices a side, and the painted texture's size. */
  readonly grid: number;
  readonly texture: number;
}

export interface LandOptions {
  readonly look: LandLook;
  readonly seed: number;
  /** The tile's size: middle to corner, world units. */
  readonly size: number;
  /** The spots' and buildings' colliders and the Keeper's start, world units. */
  readonly colliders: readonly Collider[];
  readonly start: WorldPoint;
  readonly tier: QualityTier;
  readonly sky: SkyLook;
}

/** One thin-instanced layer: its mesh, how many there are, and whether the tier thins it. */
interface Layer {
  readonly mesh: Mesh;
  readonly count: number;
  readonly thins: boolean;
  /** Shown only by day (`day`), at dusk and night (`night`), or always. */
  readonly when?: 'day' | 'night';
  readonly mote?: boolean;
}

const matrix = (g: Growth, y: number): Matrix =>
  Matrix.Compose(
    new Vector3(g.scale, g.scale, g.scale),
    Quaternion.RotationYawPitchRoll(g.yaw, 0, 0),
    new Vector3(g.x, y, g.z),
  );

/** Unlit and vertex-coloured, times `color` (motes and the lanterns' glass). */
function glow(scene: Scene, name: string, color: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = linear(color);
  m.fogEnabled = false;
  return m;
}

/** The land's matte vinyl (art bible §4: no clearcoat on the world). */
function matte(scene: Scene, name: string, roughness: number): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = roughness;
  return m;
}

export class ExploreLand {
  readonly field: LandField;
  readonly layout: LandLayout;
  readonly clock = new TerrainClock();
  readonly #scene: Scene;
  readonly #layers = new Map<string, Layer>();
  /** The land's materials, with their own colour (night tints them; spots and the team keep theirs). */
  readonly #tinted: { readonly mat: PBRMaterial; readonly base: Color3 }[] = [];
  readonly #fill: HemisphericLight;
  readonly #lampGlass: StandardMaterial;
  readonly #sun: DirectionalLight | null;
  #tier: QualityTier;
  #ambient: AmbientMode = 'off';
  #night = false;
  #grid: number;
  #texels: number;

  constructor(scene: Scene, options: LandOptions) {
    this.#scene = scene;
    this.#tier = options.tier;
    const { look, seed, size, colliders, start } = options;
    this.field = landField(look.shape, seed, size, start);
    // Shadows fall where the sun throws them (it never moves while exploring).
    const sd = LAND_LIGHT.sunDirection;
    this.layout = landLayout({
      growth: look.growth,
      land: this.field,
      seed,
      size,
      colliders,
      start,
      sun: { x: sd.x / -sd.y, z: sd.z / -sd.y },
      shadow: LAND_LIGHT.shadow,
    });

    // ── The ground: a warped grid (fine near the tile, coarse far out) and its painted texture ─
    this.#grid = LAND_GRID.cells[this.#tier];
    this.#texels = LAND_GRID.texture[this.#tier];
    this.#buildGround(look, seed);

    // ── Growth: one material for the whole land, swaying on the terrain plugin ─
    const landMat = matte(scene, 'land-mat', 0.82);
    attachTerrainPlugin(landMat, this.clock);
    this.#tinted.push({ mat: landMat, base: landMat.albedoColor.clone() });
    const grassMat = matte(scene, 'land-grass-mat', 0.9);
    grassMat.backFaceCulling = false;
    attachTerrainPlugin(grassMat, this.clock);
    this.#tinted.push({ mat: grassMat, base: grassMat.albedoColor.clone() });

    const L = this.layout;
    this.#grow('tufts', buildTuft(scene), L.tufts, grassMat, {
      sway: LAND_SWAY.tufts,
      thins: true,
    });
    for (const kind of ['daisy', 'tulip', 'bell'] as const) {
      this.#grow(`flowers-${kind}`, buildFlowers(scene, kind), L.flowers[kind], landMat, {
        sway: LAND_SWAY.flowers,
        thins: true,
      });
    }
    this.#grow('pebbles', buildPebbles(scene), L.pebbles, landMat, {});
    this.#grow('bushes', buildBush(scene, false), L.bushes, landMat, { sway: LAND_SWAY.bushes });
    this.#grow('berry-bushes', buildBush(scene, true), L.berryBushes, landMat, {
      sway: LAND_SWAY.bushes,
    });
    for (const kind of ['oak', 'birch', 'pine'] as const) {
      this.#grow(`trees-${kind}`, buildTree(scene, kind), L.trees[kind], landMat, {
        sway: LAND_SWAY.trees,
      });
    }
    this.#grow('far-trees', buildFarTree(scene), L.farTrees, landMat, {});
    this.#grow('rocks', buildRocks(scene), L.rocks, landMat, {});
    this.#grow('logs', buildLog(scene), L.logs, landMat, {});
    this.#grow('mushrooms', buildMushrooms(scene), L.mushrooms, landMat, {});
    const lamp = buildLamp(scene);
    this.#grow('lamps', lamp.post, L.lamps, landMat, {});
    this.#lampGlass = glow(scene, 'land-lamp-glass-mat', LAND_LIGHT.lamp.color);
    this.#grow('lamp-glass', lamp.glass, L.lamps, this.#lampGlass, {});

    // ── Life: drifting motes on the terrain plugin ─
    this.#drift(
      'butterflies',
      buildButterfly(scene),
      L.butterflies,
      DRIFT_MODE.orbit,
      [0.5, 1.1],
      [0.5, 0.9],
      '#ffffff',
      'day',
    );
    this.#drift(
      'pollen',
      buildMote(scene, 'land-pollen'),
      L.pollen,
      DRIFT_MODE.wander,
      [0.15, 0.35],
      [0.3, 0.55],
      '#fff6cf',
      'day',
    );
    this.#drift(
      'fireflies',
      buildMote(scene, 'land-fireflies'),
      L.fireflies,
      DRIFT_MODE.firefly,
      [0.2, 0.45],
      [0.4, 0.75],
      '#f4ffa8',
      'night',
    );

    // ── Light: a hemispheric fill under the sun, and haze for depth ─
    this.#fill = new HemisphericLight('land-fill', new Vector3(0, 1, 0), scene);
    this.#fill.specular = Color3.Black();
    this.#sun =
      scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight) ?? null;
    if (this.#sun) {
      const { x, y, z } = LAND_LIGHT.sunDirection;
      this.#sun.direction = new Vector3(x, y, z).normalize();
    }
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = LAND_LIGHT.haze.start;
    scene.fogEnd = LAND_LIGHT.haze.end;

    this.setSky(options.sky);
    this.#applyTier();
  }

  /** The ground's height under a world point. */
  heightAt(x: number, z: number): number {
    return this.field.height(x, z);
  }

  get stats(): LandStats {
    const layers: Record<string, number> = {};
    for (const [name, layer] of this.#layers) {
      layers[name] = layer.mesh.isEnabled() ? layer.mesh.thinInstanceCount : 0;
    }
    return {
      tier: this.#tier,
      layers,
      ambient: this.#ambient,
      grid: this.#grid,
      texture: this.#texels,
    };
  }

  /** The quality tier changed: the grass and flowers thin out or fill in. */
  setTier(tier: QualityTier): void {
    if (tier === this.#tier) return;
    this.#tier = tier;
    this.#applyTier();
  }

  /** How ambient life runs (the explore scene's `AmbientTarget`): motes show only while live. */
  setAmbient(mode: AmbientMode): void {
    this.#ambient = mode;
    this.#applyLife();
  }

  /** The time of day: haze, fill, the lanterns, the night tint and which motes fly. */
  setSky(look: SkyLook): void {
    const horizon = Color3.FromHexString(look.horizon).toLinearSpace();
    const zenith = Color3.FromHexString(look.zenith).toLinearSpace();
    const { haze } = LAND_LIGHT;
    this.#scene.fogColor = Color3.Lerp(horizon, linear(haze.tint), haze.mix);
    const tint = Color3.FromHexString(look.groundTint);
    for (const t of this.#tinted) t.mat.albedoColor = t.base.multiply(tint);
    this.#fill.diffuse = Color3.Lerp(Color3.White(), zenith, LAND_LIGHT.fillSky).scale(
      look.light.environment,
    );
    this.#fill.groundColor = linear(LAND_LIGHT.bounce).multiply(tint);
    this.#fill.intensity = LAND_LIGHT.fill;
    this.#scene.environmentIntensity *= LAND_LIGHT.environment;
    // The sky has just set the sun for the time of day; the land's key is stronger.
    if (this.#sun) this.#sun.intensity *= LAND_LIGHT.sun;
    // Lanterns light up as the day goes.
    const dark = look.light.sun < LAND_LIGHT.lamp.dusk;
    this.#lampGlass.emissiveColor = linear(LAND_LIGHT.lamp.color).scale(
      dark ? LAND_LIGHT.lamp.glow : 0.75,
    );
    this.#night = dark;
    this.#applyLife();
  }

  // ── Building ─────────────────────────────────────────────────────────────

  #buildGround(look: LandLook, seed: number): Mesh {
    const n = this.#grid;
    const w = LAND_GRID.warp;
    const R = LAND_RADIUS;
    const positions = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    const at = Array.from({ length: n }, (_, i) => unwarp((i / (n - 1)) * 2 - 1, w) * R);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = at[i] ?? 0;
        const z = at[j] ?? 0;
        positions.set([x, this.field.height(x, z), z], k * 3);
        uvs.set([i / (n - 1), j / (n - 1)], k * 2);
      }
    }
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let o = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        indices.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], o);
        o += 6;
      }
    }
    const normals = new Float32Array(positions.length);
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh('land-ground', this.#scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.uvs = uvs;
    data.applyToMesh(mesh);
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();

    const t = this.#texels;
    // UVs run along the grid, so the texture's texels sit where the grid's warp puts them.
    const pixels = paintGround({
      palette: look.palette,
      land: this.field,
      shades: this.layout.shades,
      seed,
      texels: t,
      radius: R,
      warp: w,
    });
    const texture = new RawTexture(
      pixels,
      t,
      t,
      Constants.TEXTUREFORMAT_RGBA,
      this.#scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.name = 'land-ground-paint';
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const mat = matte(this.#scene, 'land-ground-mat', 0.95);
    mat.albedoTexture = texture;
    mesh.material = mat;
    this.#tinted.push({ mat, base: mat.albedoColor.clone() });
    return mesh;
  }

  #grow(
    name: string,
    mesh: Mesh,
    list: readonly Growth[],
    material: Material,
    options: { sway?: number; thins?: boolean },
  ): void {
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    if (list.length === 0) {
      mesh.setEnabled(false);
      this.#layers.set(name, { mesh, count: 0, thins: false });
      return;
    }
    const matrices = new Float32Array(list.length * 16);
    list.forEach((g, i) => {
      matrix(g, this.field.height(g.x, g.z)).copyToArray(matrices, i * 16);
    });
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
    if (options.sway !== undefined) {
      const ambient = new Float32Array(list.length * 4);
      list.forEach((g, i) => {
        // Sway per unit height², phase from where it grows (neighbours move together, like a breeze).
        ambient.set([options.sway ?? 0, g.x * 0.7 + g.z * 0.4, 0, 0], i * 4);
      });
      mesh.thinInstanceSetBuffer(AMBIENT_ATTRIBUTE, ambient, 4, true);
    }
    mesh.freezeWorldMatrix();
    this.#layers.set(name, { mesh, count: list.length, thins: options.thins === true });
  }

  #drift(
    name: string,
    mesh: Mesh,
    homes: readonly MoteHome[],
    mode: number,
    range: [number, number],
    speed: [number, number],
    color: string,
    when: 'day' | 'night',
  ): void {
    const material = glow(this.#scene, `${name}-mat`, color);
    // Fireflies glow past the bloom threshold (art bible §3), so they shine at night.
    if (when === 'night') material.emissiveColor.scaleInPlace(LAND_LIGHT.firefly);
    attachTerrainPlugin(material, this.clock);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    const matrices = new Float32Array(homes.length * 16);
    const drift = new Float32Array(homes.length * 4);
    homes.forEach((h, i) => {
      Matrix.Compose(
        new Vector3(h.size, h.size, h.size),
        Quaternion.Identity(),
        new Vector3(h.x, h.y, h.z),
      ).copyToArray(matrices, i * 16);
      const t = (h.phase / (Math.PI * 2)) % 1;
      drift.set(
        [
          mode,
          h.phase,
          range[0] + (range[1] - range[0]) * t,
          speed[0] + (speed[1] - speed[0]) * (1 - t),
        ],
        i * 4,
      );
    });
    if (homes.length > 0) {
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
      mesh.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 4, true);
    }
    mesh.freezeWorldMatrix();
    this.#layers.set(name, { mesh, count: homes.length, thins: false, when, mote: true });
  }

  /** Shows the motes for the time of day while ambient life runs; hides them otherwise. */
  #applyLife(): void {
    const live = this.#ambient === 'live';
    for (const layer of this.#layers.values()) {
      if (!layer.mote) continue;
      const time = layer.when === 'night' ? this.#night : !this.#night;
      layer.mesh.setEnabled(live && time && layer.count > 0);
    }
  }

  #applyTier(): void {
    const { grass } = LAND_TIERS[this.#tier];
    for (const layer of this.#layers.values()) {
      if (!layer.thins || layer.count === 0) continue;
      layer.mesh.thinInstanceCount = Math.max(1, Math.round(layer.count * grass));
    }
  }
}
