import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CRYSTAL_GLOW, HALLOWEEN, type PropKind } from '../map/map-config.js';
import { buildProp, merged, painted, placeAt, setInstances, vinyl } from '../map/map-scene.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { ARENA_STAGE } from './arena-config.js';
import {
  arenaClouds,
  arenaHills,
  arenaMotes,
  arenaProps,
  arenaStars,
  groundColor,
  groundShade,
  moteAt,
  rgbHex,
  skyAt,
  skyColors,
  sunPlacement,
  waterColor,
  type ArenaPlan,
  type Placement,
} from './arena-layout.js';

/*
 * Lantern Hour's stage (owner decision 2026-10-05): a slice of the tile's
 * terrain (the map's own `TERRAIN_LOOKS` colours and `buildProp` props, thin
 * instanced, one draw call per kind) on a mottled diorama disc, under a
 * vertex-coloured sky dome with the sun's glow, vinyl clouds, far hills and
 * depth fog; a warm key light from behind the other side with a violet fill,
 * a soft shadow map for the fighters, and drifting motes. Built once with
 * the scene; only the motes move after that (one buffer write per frame
 * while the scene draws).
 */

export interface ArenaStats {
  readonly terrain: string;
  readonly timeOfDay: string;
  readonly known: boolean;
  readonly props: number;
  /** Meshes the arena draws (its draw calls). */
  readonly meshes: number;
  readonly shadowMap: boolean;
}

export interface Arena {
  readonly stats: ArenaStats;
  /** The key light (the stage's sun, re-aimed). */
  readonly key: DirectionalLight;
  /** Where the key light travels (unit), for stretching contact shadows. */
  readonly keyDir: Vector3;
  /** Soft shadows from the key light, or null on the low tier. */
  readonly shadows: ShadowGenerator | null;
  /** Image processing for the time of day (applied once the stage's own is set up). */
  applyImageProcessing(scene: Scene): void;
  /** Drifts the motes to `now` (ms); false when nothing moves (reduced motion). */
  update(now: number): boolean;
  dispose(): void;
}

export interface ArenaOptions {
  readonly plan: ArenaPlan;
  /** The low quality tier scatters fewer props and draws no shadow map. */
  readonly lowTier: boolean;
  /** Reduced motion: the motes hold still. */
  readonly reducedMotion: boolean;
}

const linear = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

function unlit(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = Color3.White();
  m.specularColor = Color3.Black();
  m.fogEnabled = false;
  return m;
}

function matrixOf(p: Placement, sy = p.scale, sz = p.scale, sx = p.scale): Matrix {
  const turn = Quaternion.RotationYawPitchRoll(p.turn, 0, 0);
  return placeAt(p.x, p.y, p.z, new Vector3(sx, sy, sz), turn);
}

/** A flat disc with interior vertices, each painted by `shade(x, z, d)` (d: 0 middle, 1 rim). */
function mottledDisc(
  scene: Scene,
  radius: number,
  rings: number,
  segments: number,
  shade: (x: number, z: number, d: number) => number,
): Mesh {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  const colors: number[] = [];
  const k0 = shade(0, 0, 0);
  colors.push(k0, k0, k0, 1);
  for (let i = 1; i <= rings; i++) {
    const rr = (radius * i) / rings;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      const k = shade(x, z, i / rings);
      colors.push(k, k, k, 1);
    }
  }
  const indices: number[] = [];
  const at = (ring: number, j: number) =>
    ring === 0 ? 0 : 1 + (ring - 1) * segments + (j % segments);
  for (let j = 0; j < segments; j++) indices.push(0, at(1, j), at(1, j + 1));
  for (let i = 1; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = at(i, j);
      const b = at(i, j + 1);
      const c = at(i + 1, j);
      const d = at(i + 1, j + 1);
      indices.push(a, c, d, a, d, b);
    }
  }
  const mesh = new Mesh('arena-ground', scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

export function buildArena(scene: Scene, options: ArenaOptions): Arena {
  const { plan } = options;
  const { mood, spec, seed } = plan;
  const meshes: Mesh[] = [];
  const materials: Material[] = [];
  const keep = <T extends Mesh>(m: T): T => {
    m.isPickable = false;
    meshes.push(m);
    return m;
  };
  const still = (m: AbstractMesh): void => {
    m.freezeWorldMatrix();
  };

  // ── Mood: lights, fog, the clear colour ──────────────────────────────
  const sky = skyColors(plan);
  const horizon = linear(rgbHex(sky.horizon));
  scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
  const keyDir = new Vector3(...mood.key.dir).normalize();
  let key = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
  key ??= new DirectionalLight('sun', keyDir, scene);
  key.direction = keyDir;
  key.intensity = mood.key.intensity;
  key.diffuse = linear(mood.key.color);
  key.specular = key.diffuse;
  key.position = keyDir.scale(-30);
  const fill = new DirectionalLight('arena-fill', new Vector3(...mood.fill.dir).normalize(), scene);
  fill.intensity = mood.fill.intensity;
  fill.diffuse = linear(mood.fill.color);
  fill.specular = fill.diffuse.scale(0.5);
  scene.environmentIntensity = mood.environment;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = mood.fog[0];
  scene.fogEnd = mood.fog[1];
  scene.fogColor = horizon;

  // ── Sky dome (vertex colours, one draw call), sun disc, clouds, hills ─
  {
    const r = ARENA_STAGE.skyRadius;
    const dome = keep(
      CreateSphere(
        'arena-sky',
        { diameter: r * 2, segments: 28, sideOrientation: Mesh.BACKSIDE },
        scene,
      ),
    );
    const pos = dome.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3] ?? 0;
      const y = (pos[i * 3 + 1] ?? 0) / r;
      const z = pos[i * 3 + 2] ?? 0;
      const l = linear(rgbHex(skyAt(sky, y, Math.atan2(x, z))));
      colors.set([l.r, l.g, l.b, 1], i * 4);
    }
    dome.setVerticesData(VertexBuffer.ColorKind, colors);
    const mat = unlit(scene, 'arena-sky-mat');
    mat.backFaceCulling = false;
    materials.push(mat);
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    still(dome);

    if (mood.sky.sunDisc) {
      const sun = keep(
        CreateDisc('arena-sun', { radius: mood.night ? 4.5 : 5.5, tessellation: 40 }, scene),
      );
      const at = sunPlacement(plan);
      sun.position.set(at.x, at.y, at.z);
      sun.lookAt(Vector3.Zero());
      sun.rotate(Vector3.Up(), Math.PI);
      const m = unlit(scene, 'arena-sun-mat');
      m.emissiveColor = linear(mood.night ? '#fff6d6' : mood.sky.sunColor).scale(
        mood.night ? 1 : 1.25,
      );
      materials.push(m);
      sun.material = m;
      sun.applyFog = false;
      still(sun);
    }

    if (mood.sky.clouds > 0) {
      // Vinyl clouds: one merged puff shape, thin-instanced around the horizon.
      const parts = [
        [0, 0, 0, 1.0],
        [0.9, -0.1, 0.1, 0.75],
        [-0.85, -0.12, -0.1, 0.7],
        [0.35, 0.3, 0, 0.7],
        [-0.3, 0.28, 0.05, 0.6],
      ] as const;
      const cloud = keep(
        merged(
          'arena-cloud',
          parts.map(([x, y, z, s]) => {
            const p = CreateSphere('c', { diameter: 2.2 * s, segments: 8 }, scene);
            p.position.set(x * 2.2, y * 2.2, z * 2.2);
            p.scaling.set(1, 0.72, 0.9);
            return painted(p, mood.sky.cloudColor);
          }),
        ),
      );
      const m = unlit(scene, 'arena-cloud-mat');
      m.emissiveColor = new Color3(0.93, 0.93, 0.93);
      materials.push(m);
      cloud.material = m;
      cloud.applyFog = false;
      setInstances(
        cloud,
        arenaClouds(seed, mood.sky.clouds).map((c) => matrixOf(c, c.scale, c.scale, c.scale * 1.3)),
      );
      still(cloud);
    }

    const hill = keep(
      merged('arena-hills', [
        painted(CreateSphere('h', { diameter: 2, segments: 12 }, scene), spec.hills),
      ]),
    );
    const hm = vinyl(scene, 'arena-hills-mat', { color: '#ffffff' });
    hm.roughness = 0.95;
    hm.clearCoat.isEnabled = false;
    materials.push(hm);
    hill.material = hm;
    setInstances(
      hill,
      arenaHills(seed).map((h) => matrixOf(h, h.scale * h.turn, h.scale * 0.6, h.scale)),
    );
    still(hill);
  }

  // ── Ground: a mottled disc on a thick slab, darker to the rim ────────
  const ground = groundColor(plan);
  {
    const r = ARENA_STAGE.groundRadius;
    const wall = keep(
      CreateCylinder(
        'arena-ground-wall',
        { diameter: r * 2, height: ARENA_STAGE.groundDepth, tessellation: 80, cap: Mesh.CAP_START },
        scene,
      ),
    );
    wall.position.y = -ARENA_STAGE.groundDepth / 2;
    const top = keep(mottledDisc(scene, r, 40, 120, (x, z, d) => groundShade(x, z, d, seed)));
    top.position.y = 0.004;
    const mat = vinyl(scene, 'arena-ground-mat', {
      ...plan.look,
      color: rgbHex(ground),
      clearCoat: spec.ground ? false : plan.look.clearCoat,
    });
    mat.roughness = Math.max(mat.roughness ?? 0, 0.8);
    materials.push(mat);
    top.material = mat;
    wall.material = mat;
    top.receiveShadows = true;
    still(top);
    still(wall);
  }

  // ── Props: the map's own builders, one thin-instanced mesh per kind ──
  const props = arenaProps(spec, seed, options.lowTier ? ARENA_STAGE.lowTier.props : 1);
  {
    const byKind = new Map<PropKind, Matrix[]>();
    const shadows: Matrix[] = [];
    for (const p of props) {
      let list = byKind.get(p.kind);
      if (!list) byKind.set(p.kind, (list = []));
      list.push(matrixOf(p));
    }
    const propMat = vinyl(scene, 'arena-prop-mat', { color: '#ffffff' });
    materials.push(propMat);
    const glowing = (name: string, color: string, glow: number): PBRMaterial => {
      const m = vinyl(scene, name, { color: '#ffffff' });
      m.emissiveColor = linear(color).scale(glow);
      materials.push(m);
      return m;
    };
    for (const [kind, at] of byKind) {
      const built = buildProp(scene, kind);
      const mesh = keep(built.mesh);
      mesh.name = `arena-prop-${kind}`;
      if (kind === 'jack-o-lantern') {
        mesh.material = glowing(
          'arena-lantern-mat',
          HALLOWEEN.glowColor,
          mood.night ? HALLOWEEN.glow.night : HALLOWEEN.glow.day * 2,
        );
      } else if (kind === 'crystal') {
        mesh.material = glowing('arena-crystal-mat', CRYSTAL_GLOW.color, CRYSTAL_GLOW.strength);
      } else {
        mesh.material = propMat;
      }
      setInstances(mesh, at);
      still(mesh);
      if (built.shadow > 0) {
        for (const m of at) {
          const s = m.m[0] ?? 1;
          const d = built.shadow * s * 1.6;
          shadows.push(placeAt(m.m[12] ?? 0, 0.012, m.m[14] ?? 0, new Vector3(d, 1, d)));
        }
      }
    }
    if (shadows.length > 0) {
      const shadow = keep(createContactShadowMesh(scene));
      shadow.name = 'arena-prop-shadows';
      if (shadow.material) materials.push(shadow.material);
      setInstances(shadow, shadows);
      still(shadow);
    }
  }

  // ── Water (lakes) ────────────────────────────────────────────────────
  const water = waterColor(plan);
  if (water) {
    const r = ARENA_STAGE.groundRadius;
    const pool = keep(
      CreateCylinder('arena-water', { diameter: r * 1.6, height: 0.1, tessellation: 64 }, scene),
    );
    pool.position.set(0, 0.02, ARENA_STAGE.waterFrom + r * 0.8);
    const mat = vinyl(scene, 'arena-water-mat', {
      color: rgbHex(water),
      height: 0,
      roughness: 0.38,
      clearCoat: false,
      glow: 0,
      prop: null,
      propsPerTile: [0, 0],
    });
    // A low grazing camera sees the whole sky in a glossy pool: keep it a soft blue, not a white band.
    mat.environmentIntensity = 0.35;
    materials.push(mat);
    pool.material = mat;
    still(pool);
  }

  // ── Night: moon and stars ────────────────────────────────────────────
  if (mood.night) {
    const mat = unlit(scene, 'arena-night-mat');
    materials.push(mat);
    const star = keep(CreateSphere('arena-stars', { diameter: 0.5, segments: 4 }, scene));
    star.material = mat;
    painted(star, '#fff1b8');
    star.applyFog = false;
    setInstances(
      star,
      arenaStars().map((s) => matrixOf(s)),
    );
    still(star);
  }

  // ── Motes: fireflies by night, pollen by day (one instanced mesh) ────
  const motes = arenaMotes(seed, mood.motes.count);
  const moteMatrices = new Float32Array(Math.max(1, motes.length) * 16);
  let moteMesh: Mesh | null = null;
  if (motes.length > 0) {
    moteMesh = keep(CreateSphere('arena-motes', { diameter: 0.09, segments: 4 }, scene));
    const m = unlit(scene, 'arena-mote-mat');
    m.emissiveColor = linear(mood.motes.color).scale(mood.night ? 1.3 : 1.05);
    materials.push(m);
    moteMesh.material = m;
    moteMesh.alwaysSelectAsActiveMesh = true;
    motes.forEach((mote, i) => {
      matrixOf(mote).copyToArray(moteMatrices, i * 16);
    });
    moteMesh.thinInstanceSetBuffer('matrix', moteMatrices, 16, false);
    still(moteMesh);
  }

  // ── Soft shadows from the key light (the scene adds the fighters) ────
  let shadows: ShadowGenerator | null = null;
  if (!options.lowTier) {
    const { size, darkness, frustum } = ARENA_STAGE.shadowMap;
    shadows = new ShadowGenerator(size, key);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = darkness;
    shadows.bias = 0.0015;
    shadows.normalBias = 0.03;
    key.shadowMinZ = 1;
    key.shadowMaxZ = 80;
    key.autoCalcShadowZBounds = false;
    key.shadowFrustumSize = frustum;
    key.shadowOrthoScale = 0;
  }

  for (const m of materials) m.freeze();

  const scratch = new Vector3();
  return {
    stats: {
      terrain: plan.terrain,
      timeOfDay: plan.timeOfDay,
      known: plan.known,
      props: props.length,
      meshes: meshes.filter((m) => m.isEnabled()).length,
      shadowMap: shadows !== null,
    },
    key,
    keyDir,
    shadows,
    applyImageProcessing(target) {
      const ip = target.imageProcessingConfiguration;
      ip.exposure = mood.exposure;
      ip.contrast = mood.contrast;
      ip.vignetteEnabled = mood.vignette > 0;
      ip.vignetteWeight = mood.vignette;
      ip.vignetteStretch = 0.4;
      ip.vignetteColor = new Color4(0.1, 0.05, 0.14, 0);
    },
    update(now) {
      if (!moteMesh || options.reducedMotion) return false;
      const t = now / 1000;
      motes.forEach((mote, i) => {
        const at = moteAt(mote, t);
        scratch.set(at.x, at.y, at.z);
        const o = i * 16;
        moteMatrices[o + 12] = scratch.x;
        moteMatrices[o + 13] = scratch.y;
        moteMatrices[o + 14] = scratch.z;
      });
      moteMesh.thinInstanceBufferUpdated('matrix');
      return true;
    },
    dispose() {
      shadows?.dispose();
      fill.dispose();
      for (const m of meshes) m.dispose();
      for (const m of materials) m.dispose(true, true);
    },
  };
}
