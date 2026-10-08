import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type MapMember, type PublicTile } from '@heartpatch/shared';
import { borderArrays, type BorderShape, type BorderTile } from './border-layout.js';
import type { MeshArrays } from './hex-mesh.js';
import { BORDER, PLAYER_COLORS } from './map-config.js';
import { slotsByUser, tintSlot } from './map-layout.js';
import { linear } from './map-props.js';

export interface BorderFieldOptions {
  readonly shape: BorderShape;
  /** The height of a tile's top, as the map draws it. */
  readonly topOf: (tile: PublicTile) => number;
  /**
   * Unlit, vertex-coloured and alpha-blended (an `overlayMaterial`), used by
   * the borders alone: `setNight` dims it, so sharing it would dim others too.
   */
  readonly material: StandardMaterial;
  readonly meshFrom: (scene: Scene, name: string, arrays: MeshArrays) => Mesh;
}

/** Read-only numbers for the dev hook and tests. */
export interface BorderStats {
  /** Meshes drawn: one per Keeper with land (one draw call each). */
  readonly meshes: number;
  readonly triangles: number;
}

/**
 * Land borders on the map (#278): one merged mesh per home slot
 * (border-layout.ts), so four Keepers are four draw calls however much land
 * they hold. A Keeper's mesh is rebuilt only when the tiles they hold
 * change; it's drawn before the map's other overlays (`alphaIndex`), so the
 * safe glow and the selection ring sit on top of it.
 */
export class BorderField {
  private readonly meshes = new Map<number, Mesh>();
  /** Each slot's land as last drawn, to skip rebuilding what hasn't changed. */
  private readonly drawn = new Map<number, string>();
  private readonly scene: Scene;
  private readonly options: BorderFieldOptions;

  constructor(scene: Scene, options: BorderFieldOptions) {
    this.scene = scene;
    this.options = options;
  }

  get stats(): BorderStats {
    let meshes = 0;
    let triangles = 0;
    for (const mesh of this.meshes.values()) {
      if (!mesh.isEnabled()) continue;
      meshes++;
      triangles += mesh.getTotalIndices() / 3;
    }
    return { meshes, triangles };
  }

  /** Tiles drawn in a Keeper's colour. */
  get tinted(): number {
    let n = 0;
    for (const land of this.drawn.values()) n += land === '' ? 0 : land.split(';').length;
    return n;
  }

  /** Redraws each Keeper's border from the tiles and members on the map now. */
  set(tiles: Iterable<PublicTile>, members: readonly MapMember[]): void {
    const slots = slotsByUser(members);
    const bySlot = new Map<number, PublicTile[]>();
    for (const tile of tiles) {
      const slot = tintSlot(tile, slots);
      if (slot === null) continue;
      let list = bySlot.get(slot);
      if (!list) bySlot.set(slot, (list = []));
      list.push(tile);
    }
    for (const slot of new Set([...bySlot.keys(), ...this.drawn.keys()])) {
      const land = bySlot.get(slot) ?? [];
      const key = land.map(hexKey).sort().join(';');
      if ((this.drawn.get(slot) ?? '') === key) continue;
      this.drawn.set(slot, key);
      this.draw(slot, land);
    }
  }

  /** Dims the borders at night (0 = as by day, 1 = gone), so the fire light reads (#277). */
  setNight(dim: number): void {
    // Unlit: the colour is emissive × vertex colour, so the emissive dims it.
    const keep = 1 - Math.min(1, Math.max(0, dim));
    this.options.material.emissiveColor.set(keep, keep, keep);
  }

  private draw(slot: number, land: readonly PublicTile[]): void {
    const old = this.meshes.get(slot);
    if (land.length === 0) {
      old?.setEnabled(false);
      return;
    }
    const color = linear(PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? '#ffffff');
    const arrays = borderArrays(
      land.map((t): BorderTile => ({
        q: t.q,
        r: t.r,
        top: this.options.topOf(t),
        home: t.homeSlot !== null,
      })),
      this.options.shape,
      {
        rgb: [color.r, color.g, color.b],
        line: BORDER.lines[slot % BORDER.lines.length] ?? 'solid',
        icon: BORDER.icons[slot % BORDER.icons.length] ?? 'heart',
      },
    );
    if (old) {
      const data = new VertexData();
      data.positions = arrays.positions;
      data.indices = arrays.indices;
      data.colors = arrays.colors;
      const normals: number[] = [];
      VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
      data.normals = normals;
      data.applyToMesh(old);
      old.setEnabled(true);
      return;
    }
    const mesh = this.options.meshFrom(this.scene, `border-${String(slot)}`, arrays);
    mesh.material = this.options.material;
    // Before the safe glow, selection and blob shadows (all alpha-blended).
    mesh.alphaIndex = 0;
    this.meshes.set(slot, mesh);
  }
}
