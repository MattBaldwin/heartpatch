import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { KEEPER_DATA, type KeeperConfig } from '@heartpatch/shared';
import type { SceneContent } from '../../engine/stage.js';
import type { SquishyLod } from '../../procedural/config.js';
import { KEEPER_PLACES } from '../../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../../procedural/keeper/keeper-field.js';
import type { KeeperItem } from '../../procedural/keeper/keeper-items.js';
import { keeperHash } from '../../procedural/keeper/keeper-params.js';

// The picker's 3D preview (design doc §23): the Keeper being picked, close
// up on a little pastel stage, above the picker card. The wardrobe (#43)
// shows it dressed, and turned round to see capes and wings. It only draws
// when the pick changes or the Keeper hops (render on demand, tech spec §6).

export class KeeperPreview {
  readonly content: SceneContent;
  readonly #field: KeeperField;
  #handle: KeeperHandle | null = null;
  readonly #floor: ReturnType<typeof CreateCylinder>;

  constructor(scene: Scene, lod: SquishyLod) {
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
    const { scale, lean } = KEEPER_PLACES.preview;
    const placement = turned
      ? { x: 0, z: 0, scale, lean: -lean, yaw: Math.PI }
      : { x: 0, z: 0, scale, lean };
    this.#handle = this.#field.add(config, placement, items);
    if (hop) this.#field.play(this.#handle, 'bounce', now);
  }

  /** Advances the hop; true while it plays (keep drawing). */
  update(now: number): boolean {
    return this.#field.update(now);
  }

  setLod(lod: SquishyLod): void {
    this.#field.setLod(lod);
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
