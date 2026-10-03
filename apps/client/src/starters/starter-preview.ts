import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry, type Species } from '@heartpatch/shared';
import type { SceneContent } from '../engine/stage.js';
import type { SquishyLod } from '../procedural/config.js';
import { SquishyField, type SquishyHandle } from '../procedural/squishy-field.js';
import { starterSpots } from './starter-view.js';

// The starter screen's 3D row: the three starters side by side on a little
// pastel stage, above the cards in the same order. Like the Keeper preview,
// it only draws when a squishy hops (render on demand, tech spec §6).

/** Stage layout. */
const PLACES = {
  spacing: 2.6, // TUNE: three fit across a phone held upright
  scale: 1.5, // TUNE
  /** Where the camera looks (+z is away from it): the row sits above the card. */
  lookAtZ: -2.3, // TUNE
} as const;

export class StarterPreview {
  readonly content: SceneContent;
  readonly #field: SquishyField;
  readonly #handles = new Map<string, SquishyHandle>();
  readonly #floor: ReturnType<typeof CreateCylinder>;

  constructor(scene: Scene, species: readonly Species[], lod: SquishyLod) {
    scene.clearColor = new Color4(0.992, 0.91, 0.941, 1);
    // Still until tapped: breathing would keep the renderer awake.
    this.#field = new SquishyField(scene, {
      registry: visualRegistry(GAME_DATA),
      lod,
      breathing: false,
    });
    const spots = starterSpots(species.length, PLACES.spacing);
    for (const [i, s] of species.entries()) {
      // A fixed instance id, so each starter looks the same every time.
      const handle = this.#field.add(s, `starter-${s.id}`, {
        x: spots[i] ?? 0,
        z: 0,
        scale: PLACES.scale,
      });
      this.#handles.set(s.id, handle);
    }
    this.#floor = CreateCylinder(
      'starter-preview-floor',
      { diameter: 11, height: 0.4, tessellation: 64 },
      scene,
    );
    this.#floor.position.y = -0.2;
    const grass = new PBRMaterial('starter-preview-floor-mat', scene);
    grass.albedoColor = Color3.FromHexString('#c8eebc').toLinearSpace();
    grass.metallic = 0;
    grass.roughness = 0.85;
    this.#floor.material = grass;
    this.#floor.isPickable = false;
    this.#floor.freezeWorldMatrix();
    // Pan is as good as locked (like the Keeper preview); pinch still zooms.
    const z = PLACES.lookAtZ;
    this.content = {
      bounds: { minX: -0.3, maxX: 0.3, minZ: z - 0.3, maxZ: z + 0.3 },
      start: { x: 0, z },
    };
  }

  /** The tapped starter hops hello. */
  hop(speciesId: string, now: number): void {
    const handle = this.#handles.get(speciesId);
    if (handle) this.#field.play(handle, 'bounce', now);
  }

  /** Advances the hop; true while it plays (keep drawing). */
  update(now: number): boolean {
    return this.#field.update(now);
  }

  setLod(lod: SquishyLod): void {
    this.#field.setLod(lod);
  }

  /** Which starters stand on the stage (the dev hook checks these, not pixels). */
  get shown(): string[] {
    return [...this.#handles.keys()];
  }

  isPlaying(speciesId: string, now: number): boolean {
    const handle = this.#handles.get(speciesId);
    return handle !== undefined && this.#field.isPlaying(handle, now);
  }

  dispose(): void {
    this.#field.dispose();
    this.#floor.material?.dispose(true, true);
    this.#floor.dispose();
  }
}
