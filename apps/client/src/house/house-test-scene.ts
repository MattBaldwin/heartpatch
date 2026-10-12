import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { GAME_DATA, visualRegistry } from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import { sampleHouse, type HouseSample } from './house-fixtures.js';
import { giftPlacement } from './house-gift-view.js';
import type { HouseLightLook } from './house-light-look.js';
import { HouseScene, type HouseCastMember } from './house-scene.js';

/*
 * Test helpers for the house's unit tests (#381): a sample house built on a
 * NullEngine, as the stage builds it. The tests stand in for the 2D-canvas
 * textures (NullEngine has no canvas) with `vi.mock`.
 */

const registry = visualRegistry(GAME_DATA);

export function castOf(sample: HouseSample): Map<string, HouseCastMember> {
  const cast = new Map<string, HouseCastMember>();
  for (const s of sample.squishies) {
    const species = GAME_DATA.species.find((x) => x.id === s.speciesId);
    if (species) cast.set(s.id, { species, accessory: s.accessory });
  }
  return cast;
}

export function buildHouse(
  level: number,
  tier: QualityTier,
  sample: HouseSample = sampleHouse(level),
  /** The canvas in px (projections and face checks follow it), NullEngine's default if left out. */
  canvas?: { width: number; height: number },
  /** The time of day's light (dusk if left out). */
  look?: HouseLightLook,
): { scene: Scene; house: HouseScene } {
  const engine = canvas
    ? new NullEngine({
        renderWidth: canvas.width,
        renderHeight: canvas.height,
        textureSize: 256,
        deterministicLockstep: false,
        lockstepMaxSteps: 1,
      })
    : new NullEngine();
  const scene = new Scene(engine);
  // The stage's key light (setupLighting's sky texture needs a GPU).
  new DirectionalLight('sun', new Vector3(-0.45, -1, 0.6), scene);
  const cast = castOf(sample);
  const house = new HouseScene(scene, sample.view, {
    tier,
    registry,
    keeper: null,
    cast,
    signText: 'Mia’s house',
    // Today's gift where the screen puts it (#381 H2): none unless the sample has one.
    gift: giftPlacement(sample.view, (id) => cast.has(id)),
    ...(look && { look }),
  });
  // The stage's camera; the house puts it where its pose says.
  scene.activeCamera = new TargetCamera('map-camera', new Vector3(0, 10, -10), scene);
  return { scene, house };
}

/**
 * What a list of meshes costs to draw: one draw call per enabled mesh with
 * geometry (thin instances share it), triangles counted per instance.
 */
export function cost(meshes: readonly Mesh[]): { drawCalls: number; triangles: number } {
  let drawCalls = 0;
  let triangles = 0;
  for (const m of meshes) {
    if (!m.isEnabled() || m.getTotalIndices() === 0 || m.isDisposed()) continue;
    drawCalls += 1;
    const copies = m.hasThinInstances ? m.thinInstanceCount : 1;
    triangles += (m.getTotalIndices() / 3) * copies;
  }
  return { drawCalls, triangles: Math.round(triangles) };
}
