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
  /**
   * The free width (CSS px from the left of the viewport), when a card takes
   * a side of the screen (a phone on its side, controls D): the Keeper stands
   * in the middle of it. Without it the Keeper stands in the middle of the screen.
   */
  readonly left?: number;
  readonly right?: number;
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
  /** The canvas size the band was fitted on. */
  #bandCanvas = '';
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
    // With a band (the picker) the fit below sizes the Keeper. Without one
    // (wardrobe, boutique) a pair taller than any starting look shrinks to
    // the tallest, so every Keeper saved before #372 shows as it did.
    const height = keeperParams(config, KEEPER_DATA, items).height;
    const cap = this.#band ? 1 : Math.min(1, fitHeight / height);
    const largest = KEEPER_PLACES.preview.scale * cap;
    const turn = turned ? { lean: -lean, yaw: Math.PI } : { lean, yaw: 0 };
    const { scale, z, x } = this.#fit(height, largest, turn);
    this.#handle = this.#field.add(config, { x, z, scale, ...turn }, items);
    // The stage moves with the Keeper (it is frozen, so unfreeze to move it).
    if (this.#floor.position.x !== x) {
      this.#floor.unfreezeWorldMatrix();
      this.#floor.position.x = x;
      this.#floor.freezeWorldMatrix();
    }
    if (hop) this.#field.play(this.#handle, 'bounce', now);
  }

  /**
   * Keeps the whole Keeper in `band` (the screen above the picker card,
   * #372): it stands further back until its feet clear the card, and only
   * shrinks if its head would still pass the top. Null: the fixed placement.
   */
  setBand(band: PreviewBand | null): void {
    // A turned screen can keep the band and change the canvas (and so the
    // camera's aspect): either one means a new fit.
    const box = this.#scene.getEngine().getRenderingCanvas()?.getBoundingClientRect();
    const canvas = box ? `${String(box.width)}x${String(box.height)}` : '';
    const same =
      band &&
      this.#band &&
      band.top === this.#band.top &&
      band.bottom === this.#band.bottom &&
      band.left === this.#band.left &&
      band.right === this.#band.right &&
      canvas === this.#bandCanvas;
    if (same || (!band && !this.#band)) return;
    this.#band = band;
    this.#bandCanvas = canvas;
    const shown = this.#shown;
    if (shown) this.show(shown.config, performance.now(), false, shown.items, shown.turned);
  }

  /** The scale and distance that fit the band, by projecting the feet and the top of the hair. */
  #fit(
    height: number,
    largest: number,
    turn: { lean: number; yaw: number },
  ): { scale: number; z: number; x: number } {
    const camera = this.#scene.activeCamera;
    const canvas = this.#scene.getEngine().getRenderingCanvas();
    const band = this.#band;
    this.#fitted = null;
    if (!band || !camera || !canvas) return { scale: largest, z: 0, x: 0 };
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return { scale: largest, z: 0, x: 0 };
    const viewport = camera.viewport.toGlobal(box.width, box.height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    Quaternion.RotationYawPitchRollToRef(turn.yaw, turn.lean, 0, TURN);
    const screenY = (p: Vector3) =>
      box.top + Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, transform, viewport, PROJECTED).y;
    const screenX = (p: Vector3) =>
      box.left + Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, transform, viewport, PROJECTED).x;
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
    // Beside a card: slide along the stage to the middle of the free width.
    // The view is nearly linear across a unit, so two probes find it.
    let x = 0;
    if (band.left !== undefined && band.right !== undefined) {
      const at0 = screenX(FEET.set(0, 0, z));
      const per = screenX(FEET.set(1, 0, z)) - at0;
      if (Math.abs(per) > 1e-3) x = ((band.left + band.right) / 2 - at0) / per;
    }
    return { scale, z, x };
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
