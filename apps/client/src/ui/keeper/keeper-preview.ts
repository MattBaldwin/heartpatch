import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { KEEPER_DATA, type KeeperConfig } from '@heartpatch/shared';
import type { SceneContent } from '../../engine/stage.js';
import type { SquishyLod } from '../../procedural/config.js';
import { KEEPER_PLACES } from '../../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../../procedural/keeper/keeper-field.js';
import type { KeeperItem } from '../../procedural/keeper/keeper-items.js';
import { keeperHash, keeperParams } from '../../procedural/keeper/keeper-params.js';

// The picker's 3D preview (design doc §23): the Keeper being picked, close
// up on a little pastel stage, above the picker card. The wardrobe (#43)
// shows it dressed, and turned round to see capes and wings. It only draws
// when the pick changes or the Keeper hops (render on demand, tech spec §6).

/** Room left above and below the Keeper inside its band (CSS px): the hop and the shadow. */
const FIT_PAD = { top: 24, bottom: 10 }; // TUNE

/** Where on screen the Keeper may stand (CSS px from the top of the viewport). */
export interface PreviewBand {
  readonly top: number;
  readonly bottom: number;
}

const FEET = new Vector3();
const HEAD = new Vector3();
const UP = new Vector3();
const TURN = new Quaternion();
const PROJECTED = new Vector3();

export class KeeperPreview {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #field: KeeperField;
  #band: PreviewBand | null = null;
  #fitted: { feet: number; head: number; top: number; bottom: number } | null = null;
  #shown: { config: KeeperConfig; items: readonly KeeperItem[]; turned: boolean } | null = null;
  #handle: KeeperHandle | null = null;
  readonly #floor: ReturnType<typeof CreateCylinder>;

  constructor(scene: Scene, lod: SquishyLod) {
    this.#scene = scene;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    this.#field = new KeeperField(scene, { data: KEEPER_DATA, lod });
    this.#floor = CreateCylinder(
      'keeper-preview-floor',
      { diameter: 9, height: 0.4, tessellation: 64 },
      scene,
    );
    this.#floor.position.y = -0.2;
    const grass = new PBRMaterial('keeper-preview-floor-mat', scene);
    grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
    grass.metallic = 0;
    grass.roughness = 0.85;
    this.#floor.material = grass;
    this.#floor.isPickable = false;
    this.#floor.freezeWorldMatrix();
    // Pan is as good as locked (like the battle arena); pinch still zooms.
    const z = KEEPER_PLACES.preview.lookAtZ;
    this.content = {
      bounds: { minX: -0.3, maxX: 0.3, minZ: z - 0.3, maxZ: z + 0.3 },
      start: { x: 0, z },
    };
  }

  /**
   * Shows `config` wearing `items`; `hop` makes the new look jump for joy.
   * `turned` shows its back, tipped towards the camera (the front view's lean
   * mirrored) so the back shows rather than the top of the head.
   */
  show(
    config: KeeperConfig,
    now: number,
    hop: boolean,
    items: readonly KeeperItem[] = [],
    turned = false,
  ): void {
    if (this.#handle) this.#field.remove(this.#handle);
    this.#shown = { config, items, turned };
    const { lean, fitHeight } = KEEPER_PLACES.preview;
    // A Keeper taller than fits (a tall body with a big face and hair) shrinks to fit.
    const height = keeperParams(config, KEEPER_DATA, items).height;
    const largest = KEEPER_PLACES.preview.scale * Math.min(1, fitHeight / height);
    const turn = turned ? { lean: -lean, yaw: Math.PI } : { lean, yaw: 0 };
    const { scale, z } = this.#fit(height, largest, turn);
    this.#handle = this.#field.add(config, { x: 0, z, scale, ...turn }, items);
    if (hop) this.#field.play(this.#handle, 'bounce', now);
  }

  /**
   * Keeps the whole Keeper in `band` (the screen above the picker card,
   * #372): it stands further back until its feet clear the card, and only
   * shrinks if its head would still pass the top. Null: the fixed placement.
   */
  setBand(band: PreviewBand | null): void {
    const same =
      band && this.#band && band.top === this.#band.top && band.bottom === this.#band.bottom;
    if (same || (!band && !this.#band)) return;
    this.#band = band;
    const shown = this.#shown;
    if (shown) this.show(shown.config, performance.now(), false, shown.items, shown.turned);
  }

  /** The scale and distance that fit the band, by projecting the feet and the top of the hair. */
  #fit(
    height: number,
    largest: number,
    turn: { lean: number; yaw: number },
  ): { scale: number; z: number } {
    const camera = this.#scene.activeCamera;
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    const band = this.#band;
    this.#fitted = null;
    if (!band || !camera || !canvas) return { scale: largest, z: 0 };
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return { scale: largest, z: 0 };
    const viewport = camera.viewport.toGlobal(box.width, box.height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    Quaternion.RotationYawPitchRollToRef(turn.yaw, turn.lean, 0, TURN);
    const screenY = (p: Vector3) =>
      box.top + Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, transform, viewport, PROJECTED).y;
    const feetY = (z: number) => screenY(FEET.set(0, 0, z));
    const headY = (scale: number, z: number) => {
      UP.set(0, height * scale, 0).rotateByQuaternionToRef(TURN, HEAD);
      return screenY(HEAD.set(HEAD.x, HEAD.y, HEAD.z + z));
    };
    const floor = band.bottom - FIT_PAD.bottom;
    const ceiling = band.top + FIT_PAD.top;
    // Further back stands higher on screen. Where the feet already clear the
    // card it stays put; otherwise it steps back until they do.
    let near = 0;
    // No further back than the stage's edge (the floor is 9 across). TUNE
    let far = 4;
    let z = 0;
    if (feetY(0) > floor) {
      for (let i = 0; i < 24; i++) {
        const mid = (near + far) / 2;
        if (feetY(mid) > floor) near = mid;
        else far = mid;
      }
      z = far;
    }
    // Then shrink until the top of the hair is under the ceiling.
    let scale = largest;
    for (let i = 0; i < 30 && headY(scale, z) < ceiling; i++) scale *= 0.96;
    this.#fitted = { feet: feetY(z), head: headY(scale, z), top: band.top, bottom: band.bottom };
    return { scale, z };
  }

  /** Advances the hop; true while it plays (keep drawing). */
  update(now: number): boolean {
    return this.#field.update(now);
  }

  setLod(lod: SquishyLod): void {
    this.#field.setLod(lod);
  }

  /** Where the last fit put the feet and the top of the hair (CSS px), and the band. */
  get fitted(): { feet: number; head: number; top: number; bottom: number } | null {
    return this.#fitted;
  }

  /** The shown Keeper's fingerprint (the dev hook compares these, not pixels). */
  get hash(): string | null {
    return this.#handle ? keeperHash(this.#handle.params) : null;
  }

  isPlaying(now: number): boolean {
    return this.#handle !== null && this.#field.isPlaying(this.#handle, now);
  }

  dispose(): void {
    this.#field.dispose();
    this.#floor.material?.dispose(true, true);
    this.#floor.dispose();
  }
}
