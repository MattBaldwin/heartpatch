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
  /** Meshes drawn: one per Keeper with land (one draw call each). The open-home outline's mesh isn't counted. */
  readonly meshes: number;
  readonly triangles: number;
  /** Home tiles saved for a Keeper who hasn't joined yet, outlined (#318; one mesh for all). */
  readonly openHomeTiles: number;
}

/**
 * Land borders on the map (#278): one merged mesh per home slot
 * (border-layout.ts), so six Keepers are six draw calls however much land
 * they hold. A Keeper's mesh is rebuilt only when the tiles they hold
 * change; it's drawn before the map's other overlays (`alphaIndex`), so the
 * safe glow and the selection ring sit on top of it.
 */
export class BorderField {
  private readonly meshes = new Map<number, Mesh>();
  /** Each slot's land as last drawn, to skip rebuilding what hasn't changed. */
  private readonly drawn = new Map<number, string>();
  /** Every open home's outline (#318), and its tiles as last drawn. */
  private open: Mesh | null = null;
  private openDrawn = '';
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
    const openHomeTiles = this.openDrawn === '' ? 0 : this.openDrawn.split(';').length;
    return { meshes, triangles, openHomeTiles };
  }

  /** Tiles drawn in a Keeper's colour. */
  get tinted(): number {
    let n = 0;
    for (const land of this.drawn.values()) n += land === '' ? 0 : land.split(';').length;
    return n;
  }

  /** Redraws each Keeper's border from the tiles and members on the map now. */
  set(tiles: Iterable<PublicTile>, members: readonly MapMember[]): void {
    const all = [...tiles];
    const slots = slotsByUser(members);
    const bySlot = new Map<number, PublicTile[]>();
    for (const tile of all) {
      const slot = tintSlot(tile, slots);
      if (slot === null) continue;
      let list = bySlot.get(slot);
      if (!list) bySlot.set(slot, (list = []));
      list.push(tile);
    }
    for (const slot of new Set([...bySlot.keys(), ...this.drawn.keys()])) {
      const land = bySlot.get(slot) ?? [];
      // Which tiles they hold is all that changes a border in play: a tile's
      // terrain and home slot (its height and badge) are fixed for a map.
      const key = land.map(hexKey).sort().join(';');
      if ((this.drawn.get(slot) ?? '') === key) continue;
      this.drawn.set(slot, key);
      this.draw(slot, land);
    }
    this.drawOpenHomes(all.filter((t) => t.homeSlot !== null && t.ownerUserId === null));
  }

  /**
   * Homes nobody has joined yet (#318): a soft dashed outline round each,
   * no wash and no badges, all in one mesh. Only a joiner can take one.
   */
  private drawOpenHomes(tiles: readonly PublicTile[]): void {
    const key = tiles.map(hexKey).sort().join(';');
    if (key === this.openDrawn) return;
    this.openDrawn = key;
    const color = linear(BORDER.openHome.color);
    const arrays = borderArrays(this.borderTiles(tiles), this.options.shape, {
      rgb: [color.r, color.g, color.b],
      line: BORDER.openHome.line,
      icon: 'heart',
      wash: false,
      badges: false,
    });
    this.open = this.upsert(this.open, 'border-open', arrays);
  }

  private borderTiles(land: readonly PublicTile[]): BorderTile[] {
    return land.map((t) => ({
      q: t.q,
      r: t.r,
      top: this.options.topOf(t),
      home: t.homeSlot !== null,
    }));
  }

  /** Writes `arrays` into `mesh`, or makes it; switched off when there's nothing to draw. */
  private upsert(mesh: Mesh | null, name: string, arrays: MeshArrays): Mesh | null {
    if (arrays.positions.length === 0) {
      mesh?.setEnabled(false);
      return mesh;
    }
    if (mesh) {
      const data = new VertexData();
      data.positions = arrays.positions;
      data.indices = arrays.indices;
      data.colors = arrays.colors;
      const normals: number[] = [];
      VertexData.ComputeNormals(arrays.positions, arrays.indices, normals);
      data.normals = normals;
      data.applyToMesh(mesh);
      mesh.setEnabled(true);
      return mesh;
    }
    const made = this.options.meshFrom(this.scene, name, arrays);
    made.material = this.options.material;
    // Before the safe glow, selection and blob shadows (all alpha-blended).
    made.alphaIndex = 0;
    return made;
  }

  /** Dims the borders at night (0 = as by day, 1 = gone), so the fire light reads (#277). */
  setNight(dim: number): void {
    // Unlit: the colour is emissive × vertex colour, so the emissive dims it.
    const keep = 1 - Math.min(1, Math.max(0, dim));
    this.options.material.emissiveColor.set(keep, keep, keep);
  }

  private draw(slot: number, land: readonly PublicTile[]): void {
    const old = this.meshes.get(slot) ?? null;
    if (land.length === 0) {
      old?.setEnabled(false);
      return;
    }
    const color = linear(PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? '#ffffff');
    const arrays = borderArrays(this.borderTiles(land), this.options.shape, {
      rgb: [color.r, color.g, color.b],
      line: BORDER.lines[slot % BORDER.lines.length] ?? 'solid',
      icon: BORDER.icons[slot % BORDER.icons.length] ?? 'heart',
    });
    const mesh = this.upsert(old, `border-${String(slot)}`, arrays);
    if (mesh) this.meshes.set(slot, mesh);
  }
}
