import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  type Cinematic,
  type CinematicGround,
  type CinematicShot,
} from '@heartpatch/shared';
import { TILE_FILL } from '../map/map-config.js';
import { vinyl } from '../map/map-scene.js';
import { CLAIMED_TILE, GROUND_LOOKS } from './cinematic-config.js';
import { groundTileMesh, type CinematicWorld } from './cinematic-world.js';
import { claimScale } from './timeline.js';

// Claimed land in "Your part" (owner decision 2026-10-04): grey land turns
// colourful tile by tile as the Keeper claims it. The world's own tiles stay
// as they are (drained grey by the mood); each claimed tile gets a twin on
// top drawn with the story's "hope" image processing, which the drain never
// touches, popping up from its middle at its claim time. One thin-instanced
// mesh per ground look that's ever claimed, built with the scene.

/** No rotation (never changed). */
const NO_TURN = Quaternion.Identity();

interface Claimed {
  readonly at: number;
  readonly x: number;
  readonly z: number;
}

export class ClaimLayer {
  /** Per shot, per ground: the tiles claimed in that shot. */
  readonly #byShot: readonly Map<CinematicGround, Claimed[]>[];
  readonly #meshes = new Map<
    CinematicGround,
    { mesh: Mesh; data: Float32Array; uploaded: boolean; count: number }
  >();
  readonly #m = Matrix.Identity();
  readonly #size = new Vector3();
  readonly #at = new Vector3();
  #shown = 0;
  #last = '';

  constructor(
    scene: Scene,
    cinematic: Cinematic,
    world: CinematicWorld,
    imageProcessing: ImageProcessingConfiguration,
  ) {
    const radius = cinematic.world.hexSize * TILE_FILL;
    const most = new Map<CinematicGround, number>();
    this.#byShot = cinematic.shots.map((shot: CinematicShot) => {
      const byGround = new Map<CinematicGround, Claimed[]>();
      for (const claim of shot.claims) {
        const ground = world.groundOf(hexKey(claim.hex));
        if (!ground) continue; // checkCinematic refuses these
        const p = hexToWorld(claim.hex, cinematic.world.hexSize);
        let list = byGround.get(ground);
        if (!list) byGround.set(ground, (list = []));
        list.push({ at: claim.at, x: p.x, z: p.z });
      }
      for (const [ground, list] of byGround) {
        most.set(ground, Math.max(most.get(ground) ?? 0, list.length));
      }
      return byGround;
    });
    for (const [ground, count] of most) {
      const mesh = groundTileMesh(scene, `cinematic-claimed-${ground}`, ground, radius);
      const material = vinyl(scene, `cinematic-claimed-${ground}-mat`, GROUND_LOOKS[ground]);
      material.imageProcessingConfiguration = imageProcessing;
      mesh.material = material;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.setEnabled(false);
      this.#meshes.set(ground, {
        mesh,
        data: new Float32Array(count * 16),
        uploaded: false,
        count: 0,
      });
    }
  }

  /** Shows the land claimed so far, `local` seconds into shot `index`. */
  apply(index: number, local: number, reducedMotion: boolean): void {
    const byGround = this.#byShot[index];
    let shown = 0;
    let key = '';
    for (const [ground, entry] of this.#meshes) {
      entry.count = 0;
      for (const tile of byGround?.get(ground) ?? []) {
        const k = claimScale(tile.at, local, reducedMotion);
        if (k <= 0) continue;
        const wide = k * CLAIMED_TILE.widen;
        Matrix.ComposeToRef(
          this.#size.set(wide, 1, wide),
          NO_TURN,
          this.#at.set(tile.x, CLAIMED_TILE.lift, tile.z),
          this.#m,
        );
        this.#m.copyToArray(entry.data, entry.count * 16);
        entry.count += 1;
        key += `${ground}:${k.toFixed(3)},`;
      }
      shown += entry.count;
    }
    this.#shown = shown;
    // Nothing moved since the last frame (every claim settled): no upload.
    if (key === this.#last) return;
    this.#last = key;
    for (const entry of this.#meshes.values()) {
      entry.mesh.setEnabled(entry.count > 0);
      if (entry.count === 0) continue;
      if (entry.uploaded) {
        entry.mesh.thinInstanceBufferUpdated('matrix');
      } else {
        entry.mesh.thinInstanceSetBuffer('matrix', entry.data, 16, false);
        entry.uploaded = true;
      }
      entry.mesh.thinInstanceCount = entry.count;
    }
  }

  /** How many claimed tiles show. */
  get shown(): number {
    return this.#shown;
  }
}
