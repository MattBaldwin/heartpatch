import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { CRYSTAL_GLOW, HALLOWEEN, TERRAIN_LOOKS, FALLBACK_LOOK, type PropKind } from '../map/map-config.js';
import { hash01 } from '../map/map-layout.js';
import { buildProp, merged, painted } from '../map/map-props.js';
import { placeAt, setInstances, vinyl } from '../map/map-scene.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import type { Direction, LightRig, SkyLook } from './directions.js';
import type { TimeOfDay } from './shots.js';

/*
 * The arena for the look prototypes: a real slice of the tile's terrain (the
 * map's own `TERRAIN_LOOKS` colours and `buildProp` props, thin-instanced),
 * under a sky dome, with depth layers (foreground dressing, a mid ring, a
 * fogged treeline, far hills), the direction's lighting rig and optional
 * blurred shadow map. Built once; nothing changes mid-turn.
 */

export type Rgb = readonly [number, number, number];

export function hexRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
export function rgbHex(rgb: Rgb): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}
function saturate(c: Rgb, k: number): Rgb {
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k];
}
const linear = (hex: string) => Color3.FromHexString(hex).toLinearSpace();

/** Props on a ring around the fight. Scales are against the map prop's size (a map tree is ~0.5 tall). */
interface PropGroup {
  kind: PropKind;
  count: number;
  ring: readonly [number, number];
  scale: readonly [number, number];
  /** Also in front of the fighters (small dressing only). */
  front?: boolean;
}

interface ArenaSpec {
  ground?: string;
  props: readonly PropGroup[];
  water: string | null;
  haze: string;
  /** Far hills colour (dark silhouettes behind the treeline). */
  hills: string;
}

const ring = (a: number, b: number): readonly [number, number] => [a, b];

const SPECS: Readonly<Record<string, ArenaSpec>> = {
  meadow: {
    props: [
      { kind: 'tree', count: 14, ring: ring(12, 18), scale: [9.3, 13.6] },
      { kind: 'tall-tree', count: 6, ring: ring(14, 19), scale: [11, 15.3] },
      { kind: 'bush', count: 9, ring: ring(7, 13), scale: [4, 6] },
      { kind: 'rock', count: 3, ring: ring(7, 11), scale: [3, 4.5] },
      { kind: 'flowers', count: 22, ring: ring(4.6, 13), scale: [2.4, 3.2], front: true },
      { kind: 'grass', count: 26, ring: ring(4.2, 14), scale: [2.4, 3.4], front: true },
      { kind: 'mushroom', count: 4, ring: ring(5, 9), scale: [3.5, 4.5], front: true },
    ],
    water: null,
    haze: '#d9f2c4',
    hills: '#7fb98a',
  },
  forest: {
    props: [
      { kind: 'tree', count: 16, ring: ring(8.5, 16), scale: [9.3, 13.6] },
      { kind: 'pine', count: 16, ring: ring(12, 19), scale: [11.9, 17] },
      { kind: 'tall-tree', count: 4, ring: ring(10, 15), scale: [10.2, 13.6] },
      { kind: 'stump', count: 2, ring: ring(6, 9), scale: [4, 5] },
      { kind: 'mushroom', count: 8, ring: ring(5, 9), scale: [4, 5.5], front: true },
      { kind: 'grass', count: 18, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true },
    ],
    water: null,
    haze: '#bfe6c8',
    hills: '#5e9a78',
  },
  'old-forest': {
    props: [
      { kind: 'old-tree', count: 16, ring: ring(8, 15), scale: [9.3, 13.6] },
      { kind: 'old-tree', count: 10, ring: ring(14, 19), scale: [13.6, 20.4] },
      { kind: 'log', count: 2, ring: ring(6, 9), scale: [4, 5] },
      { kind: 'mushroom', count: 12, ring: ring(4.6, 10), scale: [4.5, 6.5], front: true },
      { kind: 'rock', count: 3, ring: ring(6, 10), scale: [3, 4] },
    ],
    water: null,
    haze: '#a9d4b8',
    hills: '#4b7f68',
  },
  hills: {
    props: [
      { kind: 'rock', count: 9, ring: ring(6, 13), scale: [3.5, 6] },
      { kind: 'stones', count: 5, ring: ring(5, 10), scale: [4, 5], front: true },
      { kind: 'bush', count: 4, ring: ring(7, 12), scale: [4, 5] },
      { kind: 'tree', count: 7, ring: ring(13, 18), scale: [8.5, 11.9] },
      { kind: 'grass', count: 16, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true },
      { kind: 'flowers', count: 8, ring: ring(5, 11), scale: [2.4, 3], front: true },
    ],
    water: null,
    haze: '#f3e4c2',
    hills: '#c9ad7a',
  },
  mountains: {
    props: [
      { kind: 'snow-peak', count: 5, ring: ring(12.5, 17), scale: [15.3, 20.4] },
      { kind: 'peak', count: 3, ring: ring(11, 14), scale: [11.9, 15.3] },
      { kind: 'rock', count: 9, ring: ring(6, 12), scale: [3.5, 6] },
      { kind: 'pine', count: 4, ring: ring(9, 13), scale: [8.5, 11] },
    ],
    water: null,
    haze: '#ddd6ec',
    hills: '#9d93bd',
  },
  lake: {
    ground: '#f2e2b8',
    props: [
      { kind: 'reeds', count: 18, ring: ring(6.5, 10), scale: [3, 4.2] },
      { kind: 'rock', count: 5, ring: ring(6, 10), scale: [3, 4.5] },
      { kind: 'stones', count: 4, ring: ring(4.8, 8), scale: [4, 5], front: true },
      { kind: 'tree', count: 9, ring: ring(14, 19), scale: [8.5, 11.9] },
      { kind: 'lily-pad', count: 8, ring: ring(9, 14), scale: [4, 6] },
    ],
    water: '#9fd6f5',
    haze: '#d6effa',
    hills: '#7fa9b8',
  },
  'pumpkin-fields': {
    props: [
      { kind: 'pumpkin', count: 20, ring: ring(5.5, 14), scale: [3.5, 6] },
      { kind: 'jack-o-lantern', count: 5, ring: ring(6, 12), scale: [4, 5.5] },
      { kind: 'hay-bale', count: 3, ring: ring(8, 13), scale: [3.5, 4.5] },
      { kind: 'tree', count: 9, ring: ring(13.5, 19), scale: [8.5, 12.8] },
      { kind: 'grass', count: 16, ring: ring(4.2, 12), scale: [2.4, 3.2], front: true },
    ],
    water: null,
    haze: '#ffe2b0',
    hills: '#b58a6a',
  },
  'junipers-gap': {
    props: [
      { kind: 'crystal', count: 7, ring: ring(6, 12), scale: [4.5, 6.5] },
      { kind: 'flowers', count: 22, ring: ring(4.6, 12), scale: [2.4, 3.2], front: true },
      { kind: 'rock', count: 4, ring: ring(7, 12), scale: [3, 4] },
      { kind: 'tree', count: 4, ring: ring(13, 17), scale: [8.5, 11.9] },
    ],
    water: null,
    haze: '#f1dcff',
    hills: '#a98bd0',
  },
};

/** Where the two fighters stand: the player's near left, the foe further right. */
export const HOMES = {
  player: { x: -2.15, z: -1.2 },
  foe: { x: 2.15, z: 1.9 },
} as const;

const STAGE = {
  groundRadius: 20,
  groundDepth: 1.1,
  clearRadius: 4.2,
  fighterClear: 2.9,
  /** Props stand behind and beside the fight: angle off the camera line, radians. */
  propArc: 2.0,
  skyRadius: 95,
  waterFrom: 5.5,
  stars: 80,
} as const;

export interface ArenaStats {
  terrain: string;
  props: number;
  /** Meshes the arena draws. */
  meshes: number;
}

export interface Arena {
  readonly stats: ArenaStats;
  readonly groundColor: string;
  readonly shadows: ShadowGenerator | null;
  readonly key: DirectionalLight;
  /** Where the key light travels (unit), for stretching contact shadows. */
  readonly keyDir: Vector3;
  readonly skyLook: SkyLook;
  dispose(): void;
}

function unlit(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = Color3.White();
  m.specularColor = Color3.Black();
  m.fogEnabled = false;
  return m;
}

export function buildArena(
  scene: Scene,
  options: { terrain: string; timeOfDay: TimeOfDay; direction: Direction; seed: number },
): Arena {
  const { direction: dir, timeOfDay } = options;
  const spec = SPECS[options.terrain] ?? SPECS['meadow']!;
  const look = TERRAIN_LOOKS[options.terrain] ?? FALLBACK_LOOK;
  const rig = dir.lights[timeOfDay];
  const sky = dir.sky[timeOfDay];
  const meshes: Mesh[] = [];
  const materials: Material[] = [];
  const keep = <T extends Mesh>(m: T): T => {
    m.isPickable = false;
    meshes.push(m);
    return m;
  };

  // ── Mood: lights, image processing, fog ───────────────────────────────
  const night = timeOfDay === 'night';
  const tint: Rgb = timeOfDay === 'dusk' ? hexRgb('#ffb08a') : night ? hexRgb('#6f7fd6') : [1, 1, 1];
  const tintK = timeOfDay === 'dusk' ? 0.16 : night ? 0.3 : 0;
  const baseGround = saturate(hexRgb(spec.ground ?? look.color), dir.ground.saturation);
  const groundRgb = mixRgb(baseGround, tint, tintK);
  const horizon = mixRgb(hexRgb(sky.horizon), hexRgb(spec.haze), night ? 0.15 : 0.35);
  const horizonLinear = linear(rgbHex(horizon));
  scene.clearColor = new Color4(horizonLinear.r, horizonLinear.g, horizonLinear.b, 1);
  const { key, keyDir } = lights(scene, rig);
  scene.environmentIntensity = rig.environment;
  const ip = scene.imageProcessingConfiguration;
  ip.exposure = rig.exposure;
  ip.contrast = rig.contrast;
  ip.vignetteEnabled = rig.vignette > 0;
  ip.vignetteWeight = rig.vignette;
  ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.1, 0.05, 0.14, 0);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = sky.fog[0];
  scene.fogEnd = sky.fog[1];
  scene.fogColor = horizonLinear;

  // ── Sky dome (vertex colours, one draw call) ─────────────────────────
  {
    const dome = keep(CreateSphere('look-sky', { diameter: STAGE.skyRadius * 2, segments: 28, sideOrientation: Mesh.BACKSIDE }, scene));
    const pos = dome.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = new Float32Array((pos.length / 3) * 4);
    const zenith = hexRgb(sky.zenith);
    const below = hexRgb(sky.below);
    const sunCol = hexRgb(sky.sunColor);
    // The sun's azimuth is where the key light comes from.
    const sunAz = Math.atan2(-keyDir.x, -keyDir.z);
    for (let i = 0; i < pos.length / 3; i++) {
      const x = pos[i * 3] ?? 0;
      const y = (pos[i * 3 + 1] ?? 0) / STAGE.skyRadius;
      const z = pos[i * 3 + 2] ?? 0;
      let c: Rgb;
      if (y >= 0) c = mixRgb(horizon, zenith, smooth(Math.min(1, y / 0.42)));
      else c = mixRgb(horizon, below, smooth(Math.min(1, -y / 0.3)));
      if (sky.sunGlow > 0 && y > -0.05) {
        const az = Math.atan2(x, z);
        let da = Math.abs(az - sunAz);
        if (da > Math.PI) da = Math.PI * 2 - da;
        const g = Math.max(0, 1 - da / 1.6) ** 2 * Math.max(0, 1 - y / 0.45) ** 1.5;
        c = mixRgb(c, sunCol, sky.sunGlow * g);
      }
      const l = linear(rgbHex(c));
      colors.set([l.r, l.g, l.b, 1], i * 4);
    }
    dome.setVerticesData(VertexBuffer.ColorKind, colors);
    const mat = unlit(scene, 'look-sky-mat');
    mat.backFaceCulling = false;
    materials.push(mat);
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    dome.freezeWorldMatrix();

    if (sky.sunDisc) {
      const sun = keep(CreateDisc('look-sun', { radius: night ? 4.5 : 5.5, tessellation: 40 }, scene));
      const d = STAGE.skyRadius * 0.92;
      const elev = Math.max(0.12, -keyDir.y) * (timeOfDay === 'day' ? 0.9 : 0.45);
      const az = sunAz;
      sun.position.set(Math.sin(az) * d * Math.cos(elev), Math.sin(elev) * d, Math.cos(az) * d * Math.cos(elev));
      sun.lookAt(Vector3.Zero());
      sun.rotate(Vector3.Up(), Math.PI);
      const m = unlit(scene, 'look-sun-mat');
      m.emissiveColor = linear(night ? '#fff6d6' : sky.sunColor).scale(night ? 1 : 1.25);
      materials.push(m);
      sun.material = m;
      sun.applyFog = false;
      sun.freezeWorldMatrix();
    }

    if (sky.clouds > 0) {
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
          'look-cloud',
          parts.map(([x, y, z, s]) => {
            const p = CreateSphere('c', { diameter: 2.2 * s, segments: 8 }, scene);
            p.position.set(x * 2.2, y * 2.2, z * 2.2);
            p.scaling.set(1, 0.72, 0.9);
            return painted(p, sky.cloudColor);
          }),
        ),
      );
      const m = unlit(scene, 'look-cloud-mat');
      m.emissiveColor = new Color3(0.93, 0.93, 0.93);
      materials.push(m);
      cloud.material = m;
      cloud.applyFog = false;
      const at: Matrix[] = [];
      for (let i = 0; i < sky.clouds; i++) {
        const a = -1.9 + (3.8 * (i + 0.5)) / sky.clouds + (hash01(options.seed, i, 3) - 0.5) * 0.4;
        const d = STAGE.skyRadius * (0.7 + 0.2 * hash01(options.seed, i, 4));
        const y = 14 + 22 * hash01(options.seed, i, 5);
        const s = 1.2 + 1.6 * hash01(options.seed, i, 6);
        at.push(placeAt(Math.sin(a) * d, y, Math.cos(a) * d, new Vector3(s * 1.3, s, s)));
      }
      setInstances(cloud, at);
      cloud.freezeWorldMatrix();
    }

    if (sky.farHills) {
      const hill = keep(merged('look-hills', [painted(CreateSphere('h', { diameter: 2, segments: 12 }, scene), spec.hills)]));
      const m = vinyl(scene, 'look-hills-mat', { color: '#ffffff' });
      m.roughness = 0.95;
      m.clearCoat.isEnabled = false;
      materials.push(m);
      hill.material = m;
      const at: Matrix[] = [];
      for (let i = 0; i < 9; i++) {
        const a = -1.75 + (3.5 * (i + 0.5)) / 9 + (hash01(options.seed, i, 7) - 0.5) * 0.3;
        const d = 34 + 14 * hash01(options.seed, i, 8);
        const w = 14 + 12 * hash01(options.seed, i, 9);
        const h = 5 + 6 * hash01(options.seed, i, 10);
        at.push(placeAt(Math.sin(a) * d, -1.5, Math.cos(a) * d, new Vector3(w, h, w * 0.6)));
      }
      setInstances(hill, at);
      hill.freezeWorldMatrix();
    }
  }

  // ── Ground: a mottled disc (never a flat lawn) on a thick slab, darker to the rim ─
  {
    const r = STAGE.groundRadius;
    const wall = keep(CreateCylinder('look-ground-wall', { diameter: r * 2, height: STAGE.groundDepth, tessellation: 80, cap: Mesh.CAP_START }, scene));
    wall.position.y = -STAGE.groundDepth / 2;
    const top = keep(mottledDisc(scene, r, 40, 120, (x, z, d) => {
      const n = 0.5 + 0.5 * (valueNoise(x * 0.3, z * 0.3, options.seed) * 0.6 + valueNoise(x * 0.9, z * 0.9, options.seed + 9) * 0.4);
      let k = 1 - dir.ground.rimDarken * smooth(Math.max(0, (d - 0.2) / 0.8));
      k *= 0.88 + 0.22 * n;
      if (dir.ground.stageRing > 0) {
        const mid = Math.hypot(x - (HOMES.player.x + HOMES.foe.x) / 2, z - (HOMES.player.z + HOMES.foe.z) / 2);
        k *= 1 + dir.ground.stageRing * smooth(Math.max(0, 1 - mid / 5.5));
      }
      return k;
    }));
    top.position.y = 0.004;
    const mat = vinyl(scene, 'look-ground-mat', { ...look, color: rgbHex(groundRgb), clearCoat: spec.ground ? false : look.clearCoat });
    mat.roughness = Math.max(mat.roughness ?? 0, 0.8);
    materials.push(mat);
    top.material = mat;
    wall.material = mat;
    top.receiveShadows = true;
    top.freezeWorldMatrix();
    wall.freezeWorldMatrix();
  }

  // ── Props: the map's own builders, one thin-instanced mesh per kind ──
  let propCount = 0;
  {
    const byKind = new Map<PropKind, Matrix[]>();
    const shadows: Matrix[] = [];
    const turn = new Quaternion();
    const seed = options.seed;
    spec.props.forEach((group, g) => {
      const count = Math.round(group.count * dir.ground.propShare);
      for (let i = 0; i < count; i++) {
        const salt = g * 1000 + i * 7;
        const roll = (n: number) => hash01(seed, salt, n);
        const [near, far] = group.ring;
        const rr = near + (far - near) * roll(1);
        const arc = group.front ? Math.PI : STAGE.propArc;
        const slot = (i + 0.5 + (roll(2) - 0.5) * 0.8) / count;
        const angle = count === 1 ? 0 : -arc + 2 * arc * slot;
        const x = Math.sin(angle) * rr;
        const z = Math.cos(angle) * rr;
        if (Math.hypot(x, z) < STAGE.clearRadius) continue;
        if (Object.values(HOMES).some((h) => Math.hypot(x - h.x, z - h.z) < STAGE.fighterClear)) continue;
        // Nothing big between the camera and the fight.
        if (!group.front && z < -2 && Math.abs(x) < 7) continue;
        const [small, big] = group.scale;
        const s = small + (big - small) * roll(3);
        Quaternion.RotationYawPitchRollToRef(roll(4) * Math.PI * 2, 0, 0, turn);
        let list = byKind.get(group.kind);
        if (!list) byKind.set(group.kind, (list = []));
        list.push(placeAt(x, 0, z, new Vector3(s, s, s), turn.clone()));
        propCount++;
      }
    });
    const propMat = vinyl(scene, 'look-prop-mat', { color: '#ffffff' });
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
      if (kind === 'jack-o-lantern') mesh.material = glowing('look-lantern-mat', HALLOWEEN.glowColor, night ? HALLOWEEN.glow.night : HALLOWEEN.glow.day * 2);
      else if (kind === 'crystal') mesh.material = glowing('look-crystal-mat', CRYSTAL_GLOW.color, CRYSTAL_GLOW.strength);
      else mesh.material = propMat;
      setInstances(mesh, at);
      mesh.freezeWorldMatrix();
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
      shadow.name = 'look-prop-shadows';
      if (shadow.material) materials.push(shadow.material);
      setInstances(shadow, shadows);
      shadow.freezeWorldMatrix();
    }
  }

  // ── Water (lakes) ────────────────────────────────────────────────────
  if (spec.water) {
    const r = STAGE.groundRadius;
    const water = keep(CreateCylinder('look-water', { diameter: r * 1.6, height: 0.1, tessellation: 64 }, scene));
    water.position.set(0, 0.02, STAGE.waterFrom + r * 0.8);
    const tinted = mixRgb(hexRgb(spec.water), tint, tintK);
    const mat = vinyl(scene, 'look-water-mat', { color: rgbHex(tinted), height: 0, roughness: 0.38, clearCoat: false, glow: 0, prop: null, propsPerTile: [0, 0] });
    // A low grazing camera sees the whole sky in a glossy pool; keep it a soft blue, not a white band.
    mat.environmentIntensity = 0.35;
    materials.push(mat);
    water.material = mat;
    water.freezeWorldMatrix();
  }

  // ── Night: moon and stars ────────────────────────────────────────────
  if (night) {
    const mat = unlit(scene, 'look-night-mat');
    materials.push(mat);
    const moon = keep(CreateSphere('look-moon', { diameter: 6, segments: 16 }, scene));
    moon.material = mat;
    painted(moon, '#fff6d6');
    moon.position.set(28, 36, 64);
    moon.applyFog = false;
    moon.freezeWorldMatrix();
    const star = keep(CreateSphere('look-stars', { diameter: 0.5, segments: 4 }, scene));
    star.material = mat;
    painted(star, '#fff1b8');
    star.applyFog = false;
    const at: Matrix[] = [];
    const d = STAGE.skyRadius * 0.9;
    for (let i = 0; i < STAGE.stars; i++) {
      const y = 0.15 + 0.8 * ((i + 0.5) / STAGE.stars);
      const a = i * 2.39996;
      const rr = Math.sqrt(1 - y * y);
      const s = 0.6 + 0.8 * (((i * 37) % 11) / 10);
      at.push(placeAt(Math.cos(a) * rr * d, y * d, Math.sin(a) * rr * d, new Vector3(s, s, s)));
    }
    setInstances(star, at);
    star.freezeWorldMatrix();
  }

  // ── Motes: fireflies by night, pollen by day (one instanced mesh) ────
  if (sky.motes > 0) {
    const mote = keep(CreateSphere('look-motes', { diameter: 0.09, segments: 4 }, scene));
    const m = unlit(scene, 'look-mote-mat');
    m.emissiveColor = linear(night ? '#f4ffa8' : timeOfDay === 'dusk' ? '#ffe6b0' : '#fff6cf').scale(night ? 1.3 : 1.05);
    materials.push(m);
    mote.material = m;
    const at: Matrix[] = [];
    for (let i = 0; i < sky.motes; i++) {
      const a = hash01(options.seed, i, 20) * Math.PI * 2;
      const rr = 3 + 14 * Math.sqrt(hash01(options.seed, i, 21));
      const y = 0.4 + 3.2 * hash01(options.seed, i, 22);
      const s = 0.6 + hash01(options.seed, i, 23);
      at.push(placeAt(Math.sin(a) * rr, y, Math.cos(a) * rr, new Vector3(s, s, s)));
    }
    setInstances(mote, at);
    mote.freezeWorldMatrix();
  }

  // ── Soft shadows from the key light (fighters are added by the scene) ─
  let shadows: ShadowGenerator | null = null;
  if (rig.shadows === 'map') {
    shadows = new ShadowGenerator(1024, key);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.darkness = 0.35;
    shadows.bias = 0.0015;
    shadows.normalBias = 0.03;
    key.shadowMinZ = 1;
    key.shadowMaxZ = 80;
    key.autoCalcShadowZBounds = false;
    key.shadowFrustumSize = 26;
    key.shadowOrthoScale = 0;
  }

  for (const m of materials) m.freeze();

  return {
    stats: { terrain: options.terrain, props: propCount, meshes: meshes.filter((m) => m.isEnabled()).length },
    groundColor: rgbHex(groundRgb),
    shadows,
    key,
    keyDir,
    skyLook: sky,
    dispose() {
      shadows?.dispose();
      for (const m of meshes) m.dispose();
      for (const m of materials) m.dispose(true, true);
    },
  };
}

/** Re-aims the stage's sun as the direction's key light and adds the second light. */
function lights(scene: Scene, rig: LightRig): { key: DirectionalLight; keyDir: Vector3 } {
  const keyDir = new Vector3(...rig.key.dir).normalize();
  let key = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
  if (!key) key = new DirectionalLight('sun', keyDir, scene);
  key.direction = keyDir;
  key.intensity = rig.key.intensity;
  key.diffuse = linear(rig.key.color);
  key.specular = key.diffuse;
  key.position = keyDir.scale(-30);
  if (rig.second) {
    const second = new DirectionalLight('look-second', new Vector3(...rig.second.dir).normalize(), scene);
    second.intensity = rig.second.intensity;
    second.diffuse = linear(rig.second.color);
    second.specular = second.diffuse.scale(0.5);
  }
  return { key, keyDir };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth value noise in [-1, 1] from the map's hash. */
function valueNoise(x: number, z: number, salt: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fz = smooth(z - zi);
  const v = (a: number, b: number) => hash01(a, b, salt) * 2 - 1;
  const top = v(xi, zi) + (v(xi + 1, zi) - v(xi, zi)) * fx;
  const bottom = v(xi, zi + 1) + (v(xi + 1, zi + 1) - v(xi, zi + 1)) * fx;
  return top + (bottom - top) * fz;
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
  const at = (ring: number, j: number) => (ring === 0 ? 0 : 1 + (ring - 1) * segments + (j % segments));
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
  const mesh = new Mesh('look-ground', scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  data.colors = colors;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}
