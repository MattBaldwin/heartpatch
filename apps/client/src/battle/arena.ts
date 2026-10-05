import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3, type Matrix } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import type { PropKind } from '../map/map-config.js';
import { buildProp, painted, placeAt, setInstances, vinyl } from '../map/map-scene.js';
import { createContactShadowMesh } from '../procedural/contact-shadow.js';
import { ARENA_STAGE, type ArenaPropKind } from './arena-config.js';
import {
  arenaProps,
  groundColor,
  hexRgb,
  mixRgb,
  rgbHex,
  skyAt,
  skyColors,
  type ArenaPlan,
  type Rgb,
} from './arena-layout.js';
import { buildArenaProp } from './arena-props.js';

// The battle arena (owner decision 2026-10-04): a little diorama of the
// terrain the battle happens on, under its sky at the patch's time of day.
// Built once when the battle scene is built and never changed mid-turn:
// the ground, a sky dome, the terrain's props (the map's own builders, one
// thin-instanced mesh per kind), soft prop shadows, the lake's water and, at
// night, a moon and stars. The stage's sun and sky light are re-tinted for
// the time of day; no post-process is added (CLAUDE.md rule 8).

const MAP_PROPS: ReadonlySet<string> = new Set<PropKind>([
  'tree',
  'old-tree',
  'rock',
  'peak',
  'pumpkin',
]);

/** Read-only numbers for the dev hook (Playwright asserts on these, not pixels). */
export interface ArenaStats {
  readonly terrain: string;
  readonly timeOfDay: ArenaPlan['timeOfDay'];
  /** False when the client didn't know the terrain and drew the fallback arena. */
  readonly known: boolean;
  readonly props: number;
  /** Meshes the arena draws: its draw calls. */
  readonly meshes: number;
}

function linear(rgb: Rgb): Color3 {
  return new Color3(rgb[0], rgb[1], rgb[2]).toLinearSpace();
}

/** Unlit and vertex-coloured (sky, stars, moon): bright whatever the light. */
function unlit(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = Color3.White();
  m.specularColor = Color3.Black();
  m.fogEnabled = false;
  return m;
}

export class BattleArena {
  readonly stats: ArenaStats;
  readonly #meshes: Mesh[] = [];
  readonly #materials: Material[] = [];

  constructor(scene: Scene, plan: ArenaPlan, options: { seed: number; propShare: number }) {
    const sky = skyColors(plan);
    const horizon = linear(sky.horizon);
    scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);
    this.#mood(scene, plan, horizon);
    this.#sky(scene, sky);
    this.#ground(scene, plan);
    const props = this.#props(scene, plan, options);
    if (plan.spec.water) this.#water(scene, plan.spec.water, plan);
    if (plan.mood.night) this.#night(scene);
    for (const m of this.#materials) m.freeze();
    this.stats = {
      terrain: plan.terrain,
      timeOfDay: plan.timeOfDay,
      known: plan.known,
      props,
      meshes: this.#meshes.filter((m) => m.isEnabled()).length,
    };
  }

  dispose(): void {
    for (const m of this.#meshes) m.dispose();
    for (const m of this.#materials) m.dispose(true, true);
    this.#meshes.length = 0;
    this.#materials.length = 0;
  }

  #keep<T extends Mesh>(mesh: T): T {
    mesh.isPickable = false;
    this.#meshes.push(mesh);
    return mesh;
  }

  /** The stage's sun and sky light, re-tinted for the time of day; a soft haze far off. */
  #mood(scene: Scene, plan: ArenaPlan, horizon: Color3): void {
    const { mood } = plan;
    const sun = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
    if (sun) {
      sun.intensity = mood.lightIntensity;
      sun.diffuse = linear(hexRgb(mood.light));
      sun.specular = sun.diffuse;
    }
    scene.environmentIntensity = mood.environment;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = ARENA_STAGE.fogStart;
    scene.fogEnd = ARENA_STAGE.fogEnd;
    scene.fogColor = horizon;
  }

  /** A dome with the sky's gradient in its vertex colours: one draw call, no texture. */
  #sky(scene: Scene, sky: ReturnType<typeof skyColors>): void {
    const dome = this.#keep(
      CreateSphere(
        'arena-sky',
        { diameter: ARENA_STAGE.skyRadius * 2, segments: 24, sideOrientation: Mesh.BACKSIDE },
        scene,
      ),
    );
    const positions = dome.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0; i < positions.length / 3; i++) {
      const c = linear(skyAt(sky, (positions[i * 3 + 1] ?? 0) / ARENA_STAGE.skyRadius));
      colors.set([c.r, c.g, c.b, 1], i * 4);
    }
    dome.setVerticesData(VertexBuffer.ColorKind, colors);
    const mat = unlit(scene, 'arena-sky-mat');
    mat.backFaceCulling = false;
    this.#materials.push(mat);
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    dome.freezeWorldMatrix();
  }

  /** The ground: a thick disc in the terrain's colour and finish (its edge shows, like a diorama). */
  #ground(scene: Scene, plan: ArenaPlan): void {
    const { groundRadius: r, groundDepth: depth } = ARENA_STAGE;
    const ground = this.#keep(
      CreateCylinder(
        'arena-ground',
        { diameter: r * 2, height: depth, tessellation: 72, cap: Mesh.CAP_ALL },
        scene,
      ),
    );
    ground.position.y = -depth / 2;
    const color = groundColor(plan);
    const mat = vinyl(scene, 'arena-ground-mat', {
      ...plan.look,
      color: rgbHex(color),
      // The map's lake is glossy water; a shore is sand.
      clearCoat: plan.spec.ground ? false : plan.look.clearCoat,
    });
    // Rougher than a tile: it fills the screen, so keep highlights soft.
    mat.roughness = Math.max(mat.roughness ?? 0, 0.75);
    this.#materials.push(mat);
    ground.material = mat;
    ground.freezeWorldMatrix();
  }

  /** The terrain's props: one mesh per kind (the map's builders), plus soft shadows. */
  #props(scene: Scene, plan: ArenaPlan, options: { seed: number; propShare: number }): number {
    const placements = arenaProps(plan.spec, options.seed, options.propShare);
    const ground = groundColor(plan);
    const byKey = new Map<
      string,
      { kind: PropKind | ArenaPropKind; color: string; at: Matrix[] }
    >();
    const shadows: Matrix[] = [];
    const turn = new Quaternion();
    for (const p of placements) {
      const color = p.color ?? defaultColor(p.kind, ground);
      const key = MAP_PROPS.has(p.kind) ? p.kind : `${p.kind}:${color}`;
      let group = byKey.get(key);
      if (!group) byKey.set(key, (group = { kind: p.kind, color, at: [] }));
      Quaternion.RotationYawPitchRollToRef(p.turn, 0, 0, turn);
      group.at.push(placeAt(p.x, 0, p.z, new Vector3(p.scale, p.scale, p.scale), turn.clone()));
    }
    const propMat = vinyl(scene, 'arena-prop-mat', { color: '#ffffff' });
    this.#materials.push(propMat);
    let glowMat: PBRMaterial | null = null;
    for (const group of byKey.values()) {
      const built = MAP_PROPS.has(group.kind)
        ? buildProp(scene, group.kind as PropKind)
        : buildArenaProp(scene, group.kind as ArenaPropKind, group.color);
      const mesh = this.#keep(built.mesh);
      if (group.kind === 'glow-tree') {
        if (!glowMat) {
          glowMat = vinyl(scene, 'arena-glow-mat', { color: '#ffffff' });
          glowMat.emissiveColor = linear(hexRgb('#f3b6ff')).scale(0.45); // TUNE: the glowing valley
          this.#materials.push(glowMat);
        }
        mesh.material = glowMat;
      } else {
        mesh.material = propMat;
      }
      setInstances(mesh, group.at);
      mesh.freezeWorldMatrix();
      if (built.shadow > 0) {
        for (const m of group.at) {
          const s = m.m[0] ?? 1; // uniform scale, no tilt
          const d = built.shadow * s * 1.6;
          shadows.push(placeAt(m.m[12] ?? 0, 0.012, m.m[14] ?? 0, new Vector3(d, 1, d)));
        }
      }
    }
    if (shadows.length > 0) {
      const shadow = this.#keep(createContactShadowMesh(scene));
      shadow.name = 'arena-prop-shadows';
      if (shadow.material) this.#materials.push(shadow.material);
      setInstances(shadow, shadows);
      shadow.freezeWorldMatrix();
    }
    return placements.length;
  }

  /** The lake behind the fighters: a glossy pool sunk just under the shore. */
  #water(scene: Scene, color: string, plan: ArenaPlan): void {
    const r = ARENA_STAGE.groundRadius;
    const from = ARENA_STAGE.waterFrom;
    const water = this.#keep(
      CreateCylinder('arena-water', { diameter: r * 1.5, height: 0.1, tessellation: 64 }, scene),
    );
    // A big disc whose near edge sits `from` behind the middle.
    water.position.set(0, 0.02, from + r * 0.75);
    const tinted = mixRgb(hexRgb(color), hexRgb(plan.mood.tintColor), plan.mood.tint);
    const mat = vinyl(scene, 'arena-water-mat', {
      color: rgbHex(tinted),
      height: 0,
      roughness: 0.15,
      clearCoat: true,
      glow: 0.08,
      prop: null,
      propsPerTile: [0, 0],
    });
    this.#materials.push(mat);
    water.material = mat;
    water.freezeWorldMatrix();
  }

  /** A soft moon and a sprinkle of stars (one thin-instanced mesh). */
  #night(scene: Scene): void {
    const mat = unlit(scene, 'arena-night-mat');
    this.#materials.push(mat);
    const moon = this.#keep(CreateSphere('arena-moon', { diameter: 7, segments: 16 }, scene));
    moon.material = mat;
    painted(moon, '#fff6d6');
    moon.position.set(-26, 34, 62);
    moon.applyFog = false;
    moon.freezeWorldMatrix();

    const star = this.#keep(CreateSphere('arena-stars', { diameter: 0.55, segments: 4 }, scene));
    star.material = mat;
    painted(star, '#fff1b8');
    star.applyFog = false;
    const at: Matrix[] = [];
    const d = ARENA_STAGE.skyRadius * 0.9;
    for (let i = 0; i < ARENA_STAGE.stars; i++) {
      // Golden-angle spiral over the upper sky, so stars spread evenly.
      const y = 0.18 + 0.8 * ((i + 0.5) / ARENA_STAGE.stars);
      const a = i * 2.39996;
      const ring = Math.sqrt(1 - y * y);
      const s = 0.6 + 0.8 * (((i * 37) % 11) / 10);
      at.push(placeAt(Math.cos(a) * ring * d, y * d, Math.sin(a) * ring * d, new Vector3(s, s, s)));
    }
    setInstances(star, at);
    star.freezeWorldMatrix();
  }
}

/** Grass tufts a little deeper than the ground; hills a little lighter. */
function defaultColor(kind: PropKind | ArenaPropKind, ground: Rgb): string {
  if (kind === 'tuft') return rgbHex(mixRgb(ground, hexRgb('#4f9a62'), 0.35));
  if (kind === 'mound') return rgbHex(mixRgb(ground, hexRgb('#ffffff'), 0.08));
  return '#ffffff';
}
