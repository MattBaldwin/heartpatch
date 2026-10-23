import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { isBigChest, type PublicSearchSpot, type WorldPoint } from '@heartpatch/shared';
import { cylinderPart, kitMesh, merged, type Part } from '../explore/kit-mesh.js';
import { overlayMaterial, vinyl } from '../map/map-scene.js';
import { buildBigLid, buildSmallLid, hingeOf } from './cellar-kit.js';
import { isChest } from './cellar-look.js';
import { beamAt, chestSparkAt, lidAngle, momentMs, sparkStart } from './cellar-chests-view.js';
import { CELLAR_CHESTS } from './hollowed-config.js';
import { sparkShape } from './hollowed-explore.js';

/*
 * The hidden cellar's chests in the explore scene (#306, owner decision of
 * 2026-10-22). A chest's body is its spot's prop (drawn by the scene, its
 * glint saying "open me"); this draws the lids on their hinges: shut, or
 * back once the server says the chest is open (`done`). A chest opened just
 * now pops its lid and lets out a sparkle; the big chest wobbles first, then
 * swings slower with a fountain of sparkles and a beam of warm light. Two
 * thin-instanced lid meshes (two draw calls), and the sparkles and beam only
 * while they play, all built and compiled with the scene so an open
 * compiles nothing (#501 D1). Nothing here is sent anywhere.
 */

export interface CellarSceneContext {
  /** Tile-local to world (x, z). */
  readonly world: (p: WorldPoint) => WorldPoint;
  /** The ground's height under a tile-local point, world units. */
  readonly groundAt: (p: WorldPoint) => number;
}

/** Read-only numbers for the dev hook (Playwright asserts on these). */
export interface CellarStats {
  readonly chests: number;
  /** Lids open (back on their hinges), and the big chest's. */
  readonly open: number;
  readonly bigOpen: boolean;
  /** Moments played since the cellar opened (one a chest opened here). */
  readonly moments: number;
  /** Sparkles in the air, and whether the beam shows. */
  readonly sparks: number;
  readonly beam: boolean;
}

interface Chest {
  readonly index: number;
  readonly big: boolean;
  readonly at: Vector3;
  /** When it was opened here (ms); null shut, -Infinity open before the cellar opened. */
  since: number | null;
}

// Scratch (no allocations per frame).
const SPARK = { dx: 0, dy: 0, dz: 0, s: 0, a: 0 };
const TURN = new Quaternion();
const SCALE = new Vector3();
const AT = new Vector3();
const M = new Matrix();
const ONE = Vector3.One();

export class CellarChests {
  readonly #chests: Chest[];
  readonly #lids: { readonly small: Mesh; readonly big: Mesh };
  readonly #lidMatrices: { readonly small: Float32Array; readonly big: Float32Array };
  readonly #sparks: Mesh;
  readonly #sparkMatrices: Float32Array;
  readonly #beam: Mesh;
  /** The chest whose moment plays now, or null. */
  #moment: Chest | null = null;
  #moments = 0;
  #sparkCount = 0;

  constructor(scene: Scene, ctx: CellarSceneContext, spots: readonly PublicSearchSpot[]) {
    this.#chests = spots.filter(isChest).map((s) => {
      const w = ctx.world(s);
      return {
        index: s.index,
        big: isBigChest(s),
        at: new Vector3(w.x, ctx.groundAt(s), w.z),
        since: null,
      };
    });
    // The lids: matte like the chests (the land's props), lent every place now.
    const mat = vinyl(scene, 'cellar-lid-mat', { color: '#ffffff' });
    mat.roughness = 0.8;
    mat.clearCoat.isEnabled = false;
    const small = buildSmallLid(scene);
    const big = buildBigLid(scene);
    small.material = mat;
    big.material = mat;
    const count = (b: boolean) => this.#chests.filter((c) => c.big === b).length;
    this.#lidMatrices = {
      small: new Float32Array(Math.max(1, count(false)) * 16),
      big: new Float32Array(Math.max(1, count(true)) * 16),
    };
    small.thinInstanceSetBuffer('matrix', this.#lidMatrices.small, 16, false);
    big.thinInstanceSetBuffer('matrix', this.#lidMatrices.big, 16, false);
    small.thinInstanceCount = count(false);
    big.thinInstanceCount = count(true);
    // A lid with no chests stays off: with no thin instances Babylon draws the plain mesh.
    small.setEnabled(count(false) > 0);
    big.setEnabled(count(true) > 0);
    this.#lids = { small, big };

    // Sparkles: the joy spark (so kids know it), unlit, the big burst's count.
    const sparks = kitMesh(scene, 'cellar-spark', sparkShape);
    sparks.hasVertexAlpha = true;
    sparks.material = overlayMaterial(scene, 'cellar-spark-mat');
    sparks.alwaysSelectAsActiveMesh = true;
    this.#sparkMatrices = new Float32Array(CELLAR_CHESTS.big.sparks * 16);
    sparks.thinInstanceSetBuffer('matrix', this.#sparkMatrices, 16, false);
    sparks.setEnabled(false);
    this.#sparks = sparks;

    // The beam: a soft column of warm light, brightest at its foot.
    const beam = kitMesh(scene, 'cellar-beam', beamShape);
    beam.hasVertexAlpha = true;
    beam.material = overlayMaterial(scene, 'cellar-beam-mat');
    beam.alwaysSelectAsActiveMesh = true;
    beam.setEnabled(false);
    this.#beam = beam;

    this.update(spots, null);
  }

  /**
   * A fresh view of the cellar: a chest newly open plays its moment (the
   * newest, if two arrive at once). `now` null: the cellar just opened, so
   * what's open is already open.
   */
  update(spots: readonly PublicSearchSpot[], now: number | null): void {
    const done = new Set(spots.filter((s) => s.done).map((s) => s.index));
    for (const c of this.#chests) {
      if (!done.has(c.index)) {
        c.since = null;
        continue;
      }
      if (c.since !== null) continue;
      c.since = now ?? -Infinity;
      if (now !== null) {
        this.#moment = c;
        this.#moments++;
      }
    }
    this.#writeLids(now ?? 0);
  }

  /** Swings the lids, flies the sparkles and fades the beam; true while any of it still moves. */
  step(now: number): boolean {
    const m = this.#moment;
    if (!m || m.since === null) return false;
    const ms = now - m.since;
    const size = m.big ? 'big' : 'small';
    this.#writeLids(now);
    this.#writeSparks(m, size, ms);
    if (m.big) this.#writeBeam(m, ms);
    if (ms >= momentMs(size)) {
      this.#moment = null;
      this.#sparks.setEnabled(false);
      this.#beam.setEnabled(false);
      this.#sparkCount = 0;
      return false;
    }
    return true;
  }

  /**
   * Shows or hides the lids, and any moment playing (a place that draws its
   * chest only some of the time: the Crooked House's attic, #306 6f).
   */
  setEnabled(on: boolean): void {
    this.#lids.small.setEnabled(on && this.#lids.small.thinInstanceCount > 0);
    this.#lids.big.setEnabled(on && this.#lids.big.thinInstanceCount > 0);
    if (!on) {
      this.#sparks.setEnabled(false);
      this.#beam.setEnabled(false);
    }
  }

  /** The lids, for a scene whose lights light only the meshes they name. */
  get lidMeshes(): readonly Mesh[] {
    return [this.#lids.small, this.#lids.big];
  }

  get stats(): CellarStats {
    const open = this.#chests.filter((c) => c.since !== null);
    return {
      chests: this.#chests.length,
      open: open.length,
      bigOpen: open.some((c) => c.big),
      moments: this.#moments,
      sparks: this.#sparkCount,
      beam: this.#beam.isEnabled(),
    };
  }

  #writeLids(now: number): void {
    let small = 0;
    let big = 0;
    for (const c of this.#chests) {
      const size = c.big ? 'big' : 'small';
      const angle =
        c.since === null
          ? 0
          : c.since === -Infinity
            ? CELLAR_CHESTS[size].open
            : lidAngle(size, now - c.since);
      const hinge = hingeOf(c.big);
      // Tipped back about its hinge (the back of the top): its front lifts.
      Quaternion.RotationYawPitchRollToRef(0, angle, 0, TURN);
      Matrix.ComposeToRef(ONE, TURN, AT.set(c.at.x, c.at.y + hinge.y, c.at.z + hinge.z), M);
      if (c.big) M.copyToArray(this.#lidMatrices.big, big++ * 16);
      else M.copyToArray(this.#lidMatrices.small, small++ * 16);
    }
    this.#lids.small.thinInstanceBufferUpdated('matrix');
    this.#lids.big.thinInstanceBufferUpdated('matrix');
  }

  #writeSparks(c: Chest, size: 'small' | 'big', ms: number): void {
    const { sparks, sparkMs } = CELLAR_CHESTS[size];
    const t = (ms - sparkStart(size)) / sparkMs;
    if (t <= 0 || t >= 1) {
      this.#sparks.setEnabled(false);
      this.#sparkCount = 0;
      return;
    }
    const mouth = hingeOf(c.big).y;
    for (let i = 0; i < sparks; i++) {
      chestSparkAt(size, i, t, SPARK);
      Quaternion.RotationYawPitchRollToRef(0, 0, SPARK.a + t * 4, TURN);
      Matrix.ComposeToRef(
        SCALE.set(SPARK.s, SPARK.s, SPARK.s),
        TURN,
        AT.set(c.at.x + SPARK.dx, c.at.y + mouth + SPARK.dy, c.at.z + SPARK.dz),
        M,
      );
      M.copyToArray(this.#sparkMatrices, i * 16);
    }
    this.#sparks.thinInstanceCount = sparks;
    this.#sparks.thinInstanceBufferUpdated('matrix');
    this.#sparks.setEnabled(true);
    this.#sparkCount = sparks;
  }

  #writeBeam(c: Chest, ms: number): void {
    const { grow, alpha } = beamAt(ms);
    if (alpha <= 0) {
      this.#beam.setEnabled(false);
      return;
    }
    const { height, width } = CELLAR_CHESTS.big.beam;
    this.#beam.position.set(c.at.x, c.at.y + hingeOf(true).y, c.at.z);
    this.#beam.scaling.set(width, height * grow, width);
    this.#beam.visibility = alpha;
    this.#beam.setEnabled(true);
  }
}

/** Colours as they show on screen (sRGB), with alpha fading up the part. */
function fading(part: Part, hex: string, foot: number, top: number): Part {
  const c = Color3.FromHexString(hex);
  const pos = part.data.positions ?? [];
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = Math.min(1, Math.max(0, pos[i * 3 + 1] ?? 0));
    colors.set([c.r, c.g, c.b, foot + (top - foot) * y], i * 4);
  }
  part.data.colors = colors;
  return part;
}

/** The beam, 1 across and 1 tall from its foot: a soft cone of warm light, an inner bright core. */
function beamShape(): Part {
  const outer = cylinderPart({
    height: 1,
    diameterTop: 1.5,
    diameterBottom: 0.8,
    tessellation: 16,
  });
  outer.position.y = 0.5;
  outer.bakeCurrentTransformIntoVertices();
  const inner = cylinderPart({
    height: 1,
    diameterTop: 0.7,
    diameterBottom: 0.4,
    tessellation: 12,
  });
  inner.position.y = 0.5;
  inner.bakeCurrentTransformIntoVertices();
  return merged([fading(outer, '#ffe2a0', 0.45, 0), fading(inner, '#fff6dc', 0.7, 0)]);
}
