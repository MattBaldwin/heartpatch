import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { PublicTile } from '@heartpatch/shared';
import {
  DRIFT_MODE,
  motesFor,
  type AmbientMode,
  type Mote,
  type MoteKind,
} from './ambient-layout.js';
import { hash01 } from './map-layout.js';
import { HEX_SIZE, MOTE_KINDS, MOTES, SKY_BACKDROP } from './map-config.js';
import { linear, merged, painted } from './map-props.js';
import { attachTerrainPlugin, DRIFT_ATTRIBUTE, type TerrainClock } from './terrain-plugin.js';

// The map's ambient life (the terrain visual pass): drifting motes and the
// soft backdrop under the island. Each mote kind is one thin-instanced mesh
// (one draw call), moved entirely by the terrain plugin's time uniform.

/** Which motes show when: by day, at night, both, and only in Halloween. */
const WHEN: Readonly<Record<MoteKind, { day: boolean; night: boolean; drifts: boolean }>> = {
  pollen: { day: true, night: false, drifts: true },
  leaves: { day: true, night: false, drifts: true },
  fireflies: { day: false, night: true, drifts: false },
  sparkles: { day: true, night: true, drifts: false },
  bats: { day: true, night: true, drifts: true },
  fog: { day: true, night: true, drifts: false },
};
const HALLOWEEN_ONLY: ReadonlySet<MoteKind> = new Set(['bats', 'fog']);

interface MoteLayer {
  readonly kind: MoteKind;
  readonly mesh: Mesh;
  readonly count: number;
  readonly material: StandardMaterial;
}

export interface AmbientStats {
  /** Motes drawn now, by kind (0 when hidden). */
  readonly motes: Readonly<Partial<Record<MoteKind, number>>>;
  /** Clouds drifting under the island. */
  readonly clouds: number;
}

/** Unlit, coloured by `color` times vertex and instance colours. */
function glowMaterial(
  scene: Scene,
  name: string,
  color: string,
  blended = false,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = linear(color);
  if (blended) {
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    m.alphaMode = Constants.ALPHA_COMBINE;
    m.disableDepthWrite = true;
  }
  return m;
}

/** A soft disc, opaque in the middle and fading to nothing at the rim (fog wisps). */
function softDisc(scene: Scene, name: string, rings: readonly [number, number][]): Mesh {
  const segments = 20;
  const positions: number[] = [0, 0, 0];
  const colors: number[] = [1, 1, 1, rings[0]?.[1] ?? 1];
  const indices: number[] = [];
  rings.forEach(([radius, alpha], j) => {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      colors.push(1, 1, 1, alpha);
    }
    const ring = 1 + j * segments;
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      if (j === 0) indices.push(0, ring + next, ring + i);
      else {
        const inner = ring - segments;
        indices.push(inner + i, inner + next, ring + next, inner + i, ring + next, ring + i);
      }
    }
  });
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.colors = colors;
  data.applyToMesh(mesh, true);
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

function moteMesh(scene: Scene, kind: MoteKind): Mesh {
  switch (kind) {
    case 'pollen':
    case 'fireflies':
    case 'sparkles': {
      const m = CreateSphere(`mote-${kind}`, { diameter: 1, segments: 3 }, scene);
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      return m;
    }
    case 'leaves':
      return merged('mote-leaves', [
        painted(
          (() => {
            const leaf = CreateSphere('leaf', { diameter: 1, segments: 4 }, scene);
            leaf.scaling.set(1, 0.18, 0.6);
            return leaf;
          })(),
          '#ffffff',
        ),
      ]);
    case 'bats': {
      // Wings along x, flying along +z; about 0.16 across.
      const wing = (side: number) => {
        const w = CreateCylinder('wing', { height: 0.012, diameter: 0.1, tessellation: 3 }, scene);
        w.position.set(side * 0.045, 0, 0);
        w.scaling.set(1, 1, 0.6);
        w.rotation.y = side > 0 ? Math.PI : 0;
        return painted(w, '#8d6bb0');
      };
      return merged('mote-bats', [
        painted(CreateSphere('bat', { diameter: 0.05, segments: 6 }, scene), '#6f528f'),
        wing(1),
        wing(-1),
        painted(
          (() => {
            const ear = CreateCylinder(
              'ear',
              { height: 0.025, diameterTop: 0, diameterBottom: 0.018, tessellation: 4 },
              scene,
            );
            ear.position.set(0.012, 0.028, 0.008);
            return ear;
          })(),
          '#6f528f',
        ),
        painted(
          (() => {
            const ear = CreateCylinder(
              'ear',
              { height: 0.025, diameterTop: 0, diameterBottom: 0.018, tessellation: 4 },
              scene,
            );
            ear.position.set(-0.012, 0.028, 0.008);
            return ear;
          })(),
          '#6f528f',
        ),
      ]);
    }
    case 'fog':
      return softDisc(scene, 'mote-fog', [
        [0.18, 0.32],
        [0.38, 0.16],
        [0.55, 0],
      ]);
  }
}

/** Instance matrices and drift data for some motes. */
function moteBuffers(motes: readonly Mote[]): { matrices: Float32Array; drift: Float32Array } {
  const matrices = new Float32Array(motes.length * 16);
  const drift = new Float32Array(motes.length * 4);
  const m = new Matrix();
  motes.forEach((mote, i) => {
    Matrix.ScalingToRef(mote.size, mote.size, mote.size, m);
    m.setTranslationFromFloats(mote.x, mote.y, mote.z);
    m.copyToArray(matrices, i * 16);
    drift.set(mote.drift, i * 4);
  });
  return { matrices, drift };
}

/**
 * The map's motes and backdrop. Built once per map scene; `set` switches
 * what shows (day or night, the ambient mode and the tier's share of motes).
 */
export class MapAmbient {
  private readonly layers: MoteLayer[] = [];
  private readonly backdrop: Mesh;
  private readonly clouds: Mesh;
  private readonly cloudMaterial: StandardMaterial;
  private readonly halloween: boolean;
  private readonly rings: readonly number[];
  private night = false;
  private shown: Partial<Record<MoteKind, number>> = {};

  constructor(
    scene: Scene,
    tiles: readonly PublicTile[],
    clock: TerrainClock,
    options: { halloween: boolean; islandRadius: number },
  ) {
    this.halloween = options.halloween;
    for (const kind of MOTE_KINDS) {
      if (HALLOWEEN_ONLY.has(kind) && !options.halloween) continue;
      const motes = motesFor(kind, tiles, HEX_SIZE);
      if (motes.length === 0) continue;
      const mesh = moteMesh(scene, kind);
      const material = glowMaterial(scene, `mote-${kind}-mat`, MOTES[kind].color, kind === 'fog');
      attachTerrainPlugin(material, clock);
      mesh.material = material;
      const { matrices, drift } = moteBuffers(motes);
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, true);
      mesh.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 4, true);
      // Leaves come in autumn colours, one per leaf.
      if (kind === 'leaves') {
        const hues = ['#f2b26b', '#f6d37a', '#e88f6a', '#f4a3a8'].map(linear);
        const colors = new Float32Array(motes.length * 4);
        motes.forEach((mote, i) => {
          const c =
            hues[
              Math.floor(hash01(Math.round(mote.x * 50), Math.round(mote.z * 50), 7) * hues.length)
            ] ?? hues[0];
          colors.set([c?.r ?? 1, c?.g ?? 1, c?.b ?? 1, 1], i * 4);
        });
        mesh.thinInstanceSetBuffer('color', colors, 4, true);
        material.emissiveColor = Color3.White();
      }
      mesh.freezeWorldMatrix();
      this.layers.push({ kind, mesh, count: motes.length, material });
    }

    // The backdrop: a soft glow under the island fading into the clear colour.
    const r = options.islandRadius;
    this.rings = [0, r * 1.02, r * 1.9, r * SKY_BACKDROP.radius];
    this.backdrop = this.buildBackdrop(scene);
    this.cloudMaterial = glowMaterial(scene, 'sky-cloud-mat', SKY_BACKDROP.day.cloud);
    attachTerrainPlugin(this.cloudMaterial, clock);
    this.clouds = this.buildClouds(scene, r);
    this.clouds.material = this.cloudMaterial;
    this.paintSky();
  }

  get stats(): AmbientStats {
    return { motes: { ...this.shown }, clouds: this.clouds.thinInstanceCount };
  }

  /** What shows: night or day, the ambient mode, and the tier's share of motes (0–1). */
  set(state: { night: boolean; mode: AmbientMode; share: number }): void {
    if (state.night !== this.night) {
      this.night = state.night;
      this.paintSky();
    }
    this.shown = {};
    for (const layer of this.layers) {
      const when = WHEN[layer.kind];
      const timeOk = state.night ? when.night : when.day;
      // Reduced motion: nothing drifts across the screen; still glows stay.
      const modeOk = state.mode === 'live' || (state.mode === 'still' && !when.drifts);
      const count = timeOk && modeOk ? Math.round(layer.count * state.share) : 0;
      // Hidden by disabling, never by a count of 0: Babylon then compiles the
      // instance-colour shader without instancing (`instanceColor` undeclared).
      layer.mesh.thinInstanceCount = Math.max(1, count);
      layer.mesh.setEnabled(count > 0);
      if (count > 0) this.shown[layer.kind] = count;
    }
    // Fog thickens at night.
    const fog = this.layers.find((l) => l.kind === 'fog');
    if (fog) fog.material.alpha = state.night ? 1 : 0.6; // TUNE
  }

  private buildBackdrop(scene: Scene): Mesh {
    const segments = 64;
    const positions: number[] = [0, 0, 0];
    const indices: number[] = [];
    this.rings.slice(1).forEach((radius, j) => {
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
      const ring = 1 + j * segments;
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        if (j === 0) indices.push(0, ring + next, ring + i);
        else {
          const inner = ring - segments;
          indices.push(inner + i, inner + next, ring + next, inner + i, ring + next, ring + i);
        }
      }
    });
    const mesh = new Mesh('sky-backdrop', scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.applyToMesh(mesh);
    mesh.setVerticesData(
      VertexBuffer.ColorKind,
      new Float32Array((positions.length / 3) * 4),
      true,
    );
    mesh.hasVertexAlpha = true;
    mesh.position.y = -SKY_BACKDROP.depth;
    mesh.isPickable = false;
    mesh.material = glowMaterial(scene, 'sky-backdrop-mat', '#ffffff', true);
    mesh.freezeWorldMatrix();
    return mesh;
  }

  private buildClouds(scene: Scene, islandRadius: number): Mesh {
    // Soft cushions, flattened a little, not balls.
    const part = (d: number, x: number, y: number, z: number) => {
      const p = CreateSphere('puff', { diameter: d, segments: 8 }, scene);
      p.position.set(x, y, z);
      p.scaling.y = 0.55;
      return painted(p, '#ffffff');
    };
    const puff = merged('sky-clouds', [
      part(0.9, 0, 0, 0),
      part(0.65, 0.5, -0.03, 0.1),
      part(0.6, -0.45, -0.04, -0.05),
    ]);
    const n = SKY_BACKDROP.clouds;
    const motes: Mote[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(i, 3, 200) * 0.4;
      const d = islandRadius * (1.12 + 0.45 * hash01(i, 5, 201));
      motes.push({
        x: Math.cos(a) * d,
        y: -0.55 - 0.5 * hash01(i, 7, 202),
        z: Math.sin(a) * d,
        size: 0.8 + 0.7 * hash01(i, 9, 203),
        drift: [DRIFT_MODE.float, hash01(i, 11, 204) * Math.PI * 2, 0.6, 0.12],
      });
    }
    const { matrices, drift } = moteBuffers(motes);
    puff.thinInstanceSetBuffer('matrix', matrices, 16, true);
    puff.thinInstanceSetBuffer(DRIFT_ATTRIBUTE, drift, 4, true);
    puff.freezeWorldMatrix();
    return puff;
  }

  private paintSky(): void {
    const look = this.night
      ? this.halloween
        ? SKY_BACKDROP.halloweenNight
        : SKY_BACKDROP.night
      : SKY_BACKDROP.day;
    const inner = linear(look.inner);
    const mid = linear(look.mid);
    // Centre and the island's rim: inner; then mid; then fading out.
    const stops = [
      { c: inner, a: 1 },
      { c: inner, a: 1 },
      { c: mid, a: 0.9 },
      { c: mid, a: 0 },
    ];
    const segments = 64;
    const colors = new Float32Array((1 + (stops.length - 1) * segments) * 4);
    const put = (i: number, s: { c: Color3; a: number }): void => {
      colors.set([s.c.r, s.c.g, s.c.b, s.a], i * 4);
    };
    const centre = stops[0];
    if (centre) put(0, centre);
    for (let j = 1; j < stops.length; j++) {
      const stop = stops[j];
      if (!stop) continue;
      for (let i = 0; i < segments; i++) put(1 + (j - 1) * segments + i, stop);
    }
    this.backdrop.updateVerticesData(VertexBuffer.ColorKind, colors);
    this.cloudMaterial.emissiveColor = linear(look.cloud);
  }
}
