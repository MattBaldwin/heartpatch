import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import {
  KEEPER_DATA,
  type BattleSideId,
  type KeeperConfig,
  type VisualRegistry,
} from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import type { SquishMove, SquishyLod, SquishyLook } from '../procedural/config.js';
import { KEEPER_PLACES } from '../procedural/keeper/keeper-config.js';
import { KeeperField, type KeeperHandle } from '../procedural/keeper/keeper-field.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import {
  SquishyField,
  type SquishyHandle,
  type SquishyPlacement,
} from '../procedural/squishy-field.js';
import { ARENA, TUCKERED_POSE } from './battle-config.js';
import type { BattleContent } from './battle-view.js';

// The battle arena (#13, design doc §6 and §19): a pastel floor and the two
// squishies that are out, drawn with #9's squishy field at close-up detail.
// Every squishy is a `(species, instanceId)` look, so the wild squishy is the
// same squishy on every refresh and the player's is the one from their map.
// The player's Keeper (#42) stands behind their squishy and reacts to what
// happens (keeper-reaction.ts). In a rescue the other side are the Hollow's
// shadows, drawn with the field's shadow look (owner decision 7).

export interface BattleSceneStats {
  readonly squishies: number;
  readonly meshes: number;
  readonly instances: number;
  /** Squishies out with the shadow look (a rescue's guardians). */
  readonly shadowLook: number;
  readonly lod: SquishyLod;
  /** The player's Keeper is in the arena. */
  readonly keeper: boolean;
}

interface Fighter {
  readonly handle: SquishyHandle;
  readonly placement: SquishyPlacement;
  /** Flopped over (tuckered out). */
  down: boolean;
}

export interface BattleSceneOptions {
  readonly registry: VisualRegistry;
  readonly lod: SquishyLod;
  readonly content: BattleContent;
  /** The player's side stands at the front. */
  readonly mySide: BattleSideId;
  /** The player's Keeper, standing behind their squishy; null if not known. */
  readonly keeper: KeeperConfig | null;
  /** What the Keeper wears (#43): clothing ids. */
  readonly keeperWearing?: readonly string[];
  /**
   * How the other side's squishies look: `shadow` in a rescue, the Hollow's
   * shadows (owner decision 7). The player's own always look like themselves.
   */
  readonly opponentLook?: SquishyLook;
}

export class BattleScene {
  readonly content: SceneContent;
  readonly #field: SquishyField;
  readonly #options: BattleSceneOptions;
  readonly #fighters = new Map<BattleSideId, Fighter>();
  readonly #floor: ReturnType<typeof CreateCylinder>;
  readonly #keepers: KeeperField;
  readonly #keeper: KeeperHandle | null;

  constructor(scene: Scene, options: BattleSceneOptions) {
    this.#options = options;
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    this.#field = new SquishyField(scene, { registry: options.registry, lod: options.lod });
    this.#keepers = new KeeperField(scene, { data: KEEPER_DATA, lod: options.lod });
    const mine = this.#placement(options.mySide);
    const place = KEEPER_PLACES.battle;
    this.#keeper = options.keeper
      ? this.#keepers.add(
          options.keeper,
          {
            x: mine.x + place.offset.x,
            z: mine.z + place.offset.z,
            yaw: place.yaw,
            lean: place.lean,
            scale: place.scale,
          },
          keeperItems(options.keeperWearing ?? []),
        )
      : null;

    this.#floor = CreateCylinder(
      'battle-floor',
      { diameter: ARENA.floorDiameter, height: 0.4, tessellation: 96 },
      scene,
    );
    this.#floor.position.y = -0.2;
    const grass = new PBRMaterial('battle-floor-mat', scene);
    grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
    grass.metallic = 0;
    grass.roughness = 0.85;
    this.#floor.material = grass;
    this.#floor.isPickable = false;
    this.#floor.freezeWorldMatrix();

    // Pan is as good as locked; pinch still zooms (design doc §20).
    const z = ARENA.lookAtZ;
    this.content = {
      bounds: { minX: -0.5, maxX: 0.5, minZ: z - 0.5, maxZ: z + 0.5 },
      start: { x: 0, z },
    };
  }

  /** Where a side's squishy stands: mine at the front left, theirs across. */
  #placement(side: BattleSideId): SquishyPlacement {
    const mine = side === this.#options.mySide;
    return {
      x: mine ? -ARENA.halfGap : ARENA.halfGap,
      z: mine ? -ARENA.depth : ARENA.depth,
      // Turned a little towards each other, faces still to the camera.
      yaw: mine ? -ARENA.faceOff : ARENA.faceOff,
      scale: ARENA.scale,
    };
  }

  /** Puts `speciesId` out for `side` (replacing whoever was out). */
  sendOut(side: BattleSideId, speciesId: string, instanceId: string): void {
    const current = this.#fighters.get(side);
    if (current) this.#field.remove(current.handle);
    const species = this.#options.content.species.get(speciesId);
    if (!species) {
      this.#fighters.delete(side);
      return; // unknown species: nothing to draw, the HUD still names it
    }
    const placement = this.#placement(side);
    const look =
      side === this.#options.mySide ? 'normal' : (this.#options.opponentLook ?? 'normal');
    const handle = this.#field.add(species, instanceId, placement, look);
    this.#fighters.set(side, { handle, placement, down: false });
  }

  /** The Keeper cheers or reacts (`keeperReaction`); a no-op without one. */
  cheer(move: SquishMove, now: number, strength = 1): void {
    if (this.#keeper) this.#keepers.play(this.#keeper, move, now, strength);
  }

  /** Plays a squish move on the squishy that's out for `side`. */
  play(side: BattleSideId, move: SquishMove, now: number, strength = 1): void {
    const fighter = this.#fighters.get(side);
    if (!fighter || fighter.down) return;
    this.#field.play(fighter.handle, move, now, strength);
  }

  /**
   * Tuckered out (style guide: never hurt): a big wobble, then it flops over,
   * sunk a little into the grass and turned on its side. A few `move` calls at
   * keyframes, not one per frame, since each re-uploads the batch buffers.
   */
  tuckerOut(side: BattleSideId, now: number): void {
    const fighter = this.#fighters.get(side);
    if (!fighter) return;
    this.#field.play(fighter.handle, 'wobble', now, 1.4);
    fighter.down = true;
  }

  /** The flopped-over pose (call once the wobble has played). */
  lieDown(side: BattleSideId): void {
    const fighter = this.#fighters.get(side);
    if (!fighter?.down) return;
    const height = fighter.handle.params.height * ARENA.scale;
    this.#field.move(fighter.handle, {
      ...fighter.placement,
      y: -height * TUCKERED_POSE.sink,
      yaw: (fighter.placement.yaw ?? 0) + TUCKERED_POSE.turn,
    });
  }

  /** Back on its feet (a new battle shows the same squishy again). */
  standUp(side: BattleSideId): void {
    const fighter = this.#fighters.get(side);
    if (!fighter?.down) return;
    fighter.down = false;
    this.#field.move(fighter.handle, fighter.placement);
  }

  /** Advances the squishy clock; true while anything moves (keep drawing). */
  update(now: number): boolean {
    const keeper = this.#keepers.update(now);
    return this.#field.update(now) || keeper;
  }

  /** True while a squish move plays on either squishy (not just breathing). */
  isPlaying(now: number): boolean {
    for (const f of this.#fighters.values()) if (this.#field.isPlaying(f.handle, now)) return true;
    return this.#keeper !== null && this.#keepers.isPlaying(this.#keeper, now);
  }

  setLod(lod: SquishyLod): void {
    this.#field.setLod(lod);
    this.#keepers.setLod(lod);
  }

  get stats(): BattleSceneStats {
    return { ...this.#field.stats, keeper: this.#keeper !== null };
  }

  get hasKeeper(): boolean {
    return this.#keeper !== null;
  }

  dispose(): void {
    this.#keepers.dispose();
    this.#field.dispose();
    this.#floor.material?.dispose(true, true);
    this.#floor.dispose();
  }
}
