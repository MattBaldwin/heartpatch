import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';
import { hexToWorld, type PublicTile } from '@heartpatch/shared';
import { edgeTransform, fenceLength } from './fence-layout.js';
import { HEX_SIZE } from './map-config.js';

// What the Build sheet lights on the 3D tile (#371): each open edge as a
// glowing bar where its fence would stand (brighter once picked), or the
// tile's middle as a ring for a one-spot building. Six bars and a ring,
// made once and switched on and off, so building costs no extra draw calls
// worth counting.

export interface BuildAreaView {
  readonly tile: PublicTile;
  /** The top of the tile, where the bars lie. */
  readonly top: number;
  /** Edges that can be picked, and whether each is picked now. */
  readonly edges: readonly { readonly edge: number; readonly on: boolean }[];
  /** The middle: null when the building isn't a one-spot one. */
  readonly centre: 'on' | null;
}

/** Bar looks: lit (can be picked) and on (picked). TUNE */
const LOOK = {
  lit: { rgb: [1, 0.78, 0.88], alpha: 0.55 },
  on: { rgb: [1, 0.36, 0.62], alpha: 0.95 },
} as const;

const BAR_DEPTH = 0.2; // across the edge, as a share of the hex size TUNE
const BAR_HEIGHT = 0.045; // TUNE
const LIFT = 0.04; // above the tile's top TUNE

export class BuildAreaField {
  private readonly bars: Mesh[] = [];
  private readonly ring: Mesh;
  private readonly lit: StandardMaterial;
  private readonly on: StandardMaterial;
  /** The tile the field is lit on now. */
  shown: PublicTile | null = null;

  constructor(scene: Scene, makeMaterial: (name: string) => StandardMaterial) {
    const material = (name: string, look: { rgb: readonly number[]; alpha: number }) => {
      const m = makeMaterial(name);
      m.emissiveColor = new Color3(look.rgb[0], look.rgb[1], look.rgb[2]);
      m.alpha = look.alpha;
      return m;
    };
    this.lit = material('build-edge-lit', LOOK.lit);
    this.on = material('build-edge-on', LOOK.on);
    for (let e = 0; e < 6; e++) {
      const bar = CreateBox(
        `build-edge-${String(e)}`,
        { width: fenceLength(HEX_SIZE), height: BAR_HEIGHT, depth: BAR_DEPTH * HEX_SIZE },
        scene,
      );
      bar.isPickable = false;
      bar.alwaysSelectAsActiveMesh = true;
      bar.setEnabled(false);
      this.bars.push(bar);
    }
    this.ring = CreateTorus(
      'build-centre',
      { diameter: HEX_SIZE * 0.7, thickness: 0.07, tessellation: 40 },
      scene,
    );
    this.ring.scaling.y = 0.5;
    this.ring.material = this.on;
    this.ring.isPickable = false;
    this.ring.alwaysSelectAsActiveMesh = true;
    this.ring.setEnabled(false);
  }

  /** Lights the view's edges or middle, or puts everything out (null). */
  set(view: BuildAreaView | null): void {
    this.shown = view?.tile ?? null;
    const byEdge = new Map((view?.edges ?? []).map((e) => [e.edge, e.on]));
    this.bars.forEach((bar, edge) => {
      const on = byEdge.get(edge);
      if (!view || on === undefined) {
        bar.setEnabled(false);
        return;
      }
      const at = edgeTransform(view.tile, edge, HEX_SIZE);
      bar.position.set(at.x, view.top + LIFT, at.z);
      bar.rotation.y = at.yaw;
      bar.material = on ? this.on : this.lit;
      bar.setEnabled(true);
    });
    if (view?.centre) {
      const c = hexToWorld(view.tile, HEX_SIZE);
      this.ring.position.set(c.x, view.top + LIFT, c.z);
      this.ring.setEnabled(true);
    } else {
      this.ring.setEnabled(false);
    }
  }
}
