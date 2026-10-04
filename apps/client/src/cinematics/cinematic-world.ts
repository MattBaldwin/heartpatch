import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexFromKey,
  hexKey,
  hexSpiral,
  hexToWorld,
  worldToHex,
  type Cinematic,
  type CinematicGround,
  type HexKey,
} from '@heartpatch/shared';
import { TILE_FILL, ISLAND, type PropKind, type TerrainLook } from '../map/map-config.js';
import { propPlacementsAt } from '../map/map-layout.js';
import {
  buildProp,
  CORNER,
  DOME,
  meshFrom,
  merged,
  painted,
  placeAt,
  SEGMENTS,
  setInstances,
  TOP_RINGS,
  vinyl,
} from '../map/map-scene.js';
import { loftRoundedHex } from '../map/hex-mesh.js';
import { GROUND_LOOKS, SNOW, type CinematicProp } from './cinematic-config.js';

// The story's world (#46): hex tiles painted by the data's regions, with the
// map's own terrain looks and props (CLAUDE.md "art is procedural"), the
// glowing Heartpatch, and the seasons' leaf piles and snow. One draw call per
// ground look and per prop kind, however many tiles (CLAUDE.md rule 8).

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

/** Every tile and the ground it shows: later regions paint over earlier ones. */
export function paintWorld(world: Cinematic['world']): Map<HexKey, CinematicGround> {
  const tiles = new Map<HexKey, CinematicGround>();
  for (const region of world.regions) {
    for (const h of hexSpiral(region.center, region.radius)) tiles.set(hexKey(h), region.ground);
  }
  return tiles;
}

function extraProp(scene: Scene, kind: CinematicProp): Mesh {
  const blob = (d: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const m = CreateSphere(`${kind}-part`, { diameter: d, segments: 10 }, scene);
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  // TUNE: every size and colour below.
  if (kind === 'leaf-pile') {
    return merged(kind, [
      painted(blob(0.36, 0, 0.05, 0, 1.3, 0.55, 1.1), '#e58a4e'),
      painted(blob(0.22, 0.08, 0.13, -0.04, 1.1, 0.6, 1), '#f2b04f'),
      painted(blob(0.16, -0.1, 0.12, 0.05, 1, 0.6, 1), '#d9653f'),
    ]);
  }
  return merged(kind, [
    painted(blob(0.34, 0, 0.06, 0, 1.2, 0.7, 1.1), '#ffffff'),
    painted(blob(0.2, 0.06, 0.16, 0, 1, 0.9, 1), '#f3f6ff'),
  ]);
}

export interface WorldStats {
  readonly tiles: number;
  readonly groundMeshes: number;
  readonly props: number;
}

/** Builds the world once. Nothing in it moves except the snow and the Heartpatch's glow. */
export class CinematicWorld {
  readonly stats: WorldStats;
  readonly #tiles: Map<HexKey, CinematicGround>;
  readonly #hexSize: number;
  readonly #heartpatch: PBRMaterial | null = null;
  readonly #heartpatchColor: Color3;
  readonly #snow: Mesh | null = null;
  readonly #snowCentres: { x: number; y: number; z: number }[] = [];
  readonly #snowMatrices: Float32Array;
  #snowUploaded = false;

  constructor(scene: Scene, world: Cinematic['world']) {
    this.#hexSize = world.hexSize;
    this.#tiles = paintWorld(world);
    const radius = world.hexSize * TILE_FILL;
    this.#heartpatchColor = linear(GROUND_LOOKS.heartpatch.color);

    // The soft island everything sits on.
    let far = 0;
    for (const key of this.#tiles.keys()) {
      const p = hexToWorld(hexFromKey(key), world.hexSize);
      far = Math.max(far, Math.hypot(p.x, p.z));
    }
    const islandRadius = far + world.hexSize * 1.4;
    const island = CreateCylinder(
      'cinematic-island',
      { diameter: islandRadius * 2, height: ISLAND.thickness, tessellation: 96 },
      scene,
    );
    island.position.y = -ISLAND.thickness / 2;
    const rim = CreateTorus(
      'cinematic-island-rim',
      { diameter: islandRadius * 2, thickness: ISLAND.thickness, tessellation: 96 },
      scene,
    );
    rim.position.y = -ISLAND.thickness / 2;
    const islandMat = vinyl(scene, 'cinematic-island-mat', {
      ...GROUND_LOOKS.meadow,
      color: ISLAND.color,
      roughness: 0.85,
      clearCoat: false,
    });
    for (const m of [island, rim]) {
      m.material = islandMat;
      m.isPickable = false;
      m.freezeWorldMatrix();
    }

    // One mesh per ground look.
    const byGround = new Map<CinematicGround, Matrix[]>();
    const props = new Map<PropKind | CinematicProp, Matrix[]>();
    const turn = new Quaternion();
    for (const [key, ground] of this.#tiles) {
      const h = hexFromKey(key);
      const p = hexToWorld(h, world.hexSize);
      let list = byGround.get(ground);
      if (!list) byGround.set(ground, (list = []));
      list.push(placeAt(p.x, 0, p.z));
      const look = GROUND_LOOKS[ground];
      const placements = look.extraProp
        ? propPlacementsAt(h, { ...look, prop: 'rock' }, world.hexSize)
        : propPlacementsAt(h, look, world.hexSize);
      for (const prop of placements) {
        const kind = look.extraProp ?? prop.kind;
        let at = props.get(kind);
        if (!at) props.set(kind, (at = []));
        Quaternion.RotationYawPitchRollToRef(prop.turn, 0, 0, turn);
        // Props are sized for the map's tiles: scale them with this world's.
        const s = prop.scale * (world.hexSize / 0.65);
        at.push(
          placeAt(
            prop.at.x,
            look.height + DOME * 0.5,
            prop.at.z,
            new Vector3(s, s, s),
            turn.clone(),
          ),
        );
      }
      if (ground === 'snow') this.#snowCentres.push({ x: p.x, y: look.height, z: p.z });
    }
    for (const [ground, matrices] of byGround) {
      const look: TerrainLook = GROUND_LOOKS[ground];
      const h = look.height;
      const mesh = meshFrom(
        scene,
        `cinematic-tiles-${ground}`,
        loftRoundedHex(
          radius,
          [...TOP_RINGS.map((r) => ({ scale: r.scale, y: r.y + h })), { scale: 1, y: 0 }],
          { corner: CORNER, segments: SEGMENTS, centre: { y: h + DOME } },
        ),
      );
      // Not frozen: the drain and the night change image-processing uniforms each frame.
      const mat = vinyl(scene, `cinematic-tiles-${ground}-mat`, look);
      mesh.material = mat;
      if (ground === 'heartpatch') this.#heartpatch = mat;
      setInstances(mesh, matrices);
      mesh.freezeWorldMatrix();
    }
    let propCount = 0;
    for (const [kind, matrices] of props) {
      const mesh =
        kind === 'leaf-pile' || kind === 'snow-mound'
          ? extraProp(scene, kind)
          : buildProp(scene, kind).mesh;
      mesh.material = vinyl(scene, `cinematic-prop-${kind}-mat`, { color: '#ffffff' });
      setInstances(mesh, matrices);
      mesh.freezeWorldMatrix();
      propCount += matrices.length;
    }

    // Snow drifting down over the snowy patch.
    this.#snowMatrices = new Float32Array(SNOW.flakes * 16);
    if (this.#snowCentres.length > 0) {
      const flake = CreateSphere('cinematic-snow', { diameter: SNOW.size, segments: 4 }, scene);
      const mat = vinyl(scene, 'cinematic-snow-mat', { color: '#ffffff' });
      mat.emissiveColor = new Color3(0.6, 0.62, 0.7);
      flake.material = mat;
      flake.isPickable = false;
      flake.alwaysSelectAsActiveMesh = true;
      this.#snow = flake;
      this.snowAt(0);
    }

    this.stats = { tiles: this.#tiles.size, groundMeshes: byGround.size, props: propCount };
  }

  /** The top of the ground at a point (0 off the tiles). */
  groundAt(x: number, z: number): number {
    const ground = this.#tiles.get(hexKey(worldToHex({ x, z }, this.#hexSize)));
    return ground ? GROUND_LOOKS[ground].height + DOME : 0;
  }

  /** How brightly the Heartpatch's ground shines (0–1). */
  setGlow(glow: number): void {
    const m = this.#heartpatch;
    if (!m) return;
    this.#heartpatchColor.scaleToRef(GROUND_LOOKS.heartpatch.glow * glow, m.emissiveColor);
  }

  /** Snowflakes at `t` seconds: each falls through its box and wraps round. */
  snowAt(t: number): void {
    const mesh = this.#snow;
    const centre = this.#snowCentres[Math.floor(this.#snowCentres.length / 2)];
    if (!mesh || !centre) return;
    const m = Matrix.Identity();
    for (let i = 0; i < SNOW.flakes; i += 1) {
      // Fixed scatter (golden-ratio steps), so every viewing looks the same.
      const u = (i * 0.618034) % 1;
      const v = (i * 0.754877) % 1;
      const w = (i * 0.56984) % 1;
      const fall = (w * SNOW.height + t * SNOW.fallPerS * (0.7 + 0.6 * u)) % SNOW.height;
      const sway = Math.sin(t * 0.9 + i) * 0.12;
      Matrix.TranslationToRef(
        centre.x + (u - 0.5) * 2 * SNOW.spread + sway,
        centre.y + SNOW.height - fall,
        centre.z + (v - 0.5) * 2 * SNOW.spread,
        m,
      );
      m.copyToArray(this.#snowMatrices, i * 16);
    }
    if (this.#snowUploaded) {
      mesh.thinInstanceBufferUpdated('matrix');
    } else {
      mesh.thinInstanceSetBuffer('matrix', this.#snowMatrices, 16, false);
      this.#snowUploaded = true;
    }
  }
}
