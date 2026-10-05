import { Constants } from '@babylonjs/core/Engines/constants';
import type { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Material } from '@babylonjs/core/Materials/material';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged, painted, vinyl } from '../map/map-scene.js';
import { STORY_EFFECTS } from './cinematic-config.js';

// "Your part" and the Scatter's little effects (owner decision 2026-10-04):
// a tossed Heart Charm, a puff of hearts (care, a new friend), and joy, a
// squishy's glow as a little warm light (pulled out by the Hollow Man, and
// brought back by care). Each kind is one thin-instanced mesh, built once
// with the scene and filled each frame from the timeline (pooled, never built
// mid-shot; one draw call per kind while any shows). Where every heart is is
// a pure function of time, so the player can seek.

/** No rotation (never changed). */
const NO_TURN = Quaternion.Identity();

/** A point and a size, as the timeline poses an actor. */
export interface EffectPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  readonly yaw: number;
  readonly glow: number;
}

/** A heart puff `s` seconds after it started, at a spot. */
export interface PuffPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly s: number;
  readonly glow: number;
}

/**
 * A soft vinyl heart, about 1 across: two capsules leaning out from where
 * they meet at the bottom point.
 */
function heartParts(scene: Scene, color: string): Mesh[] {
  return [-1, 1].map((side) => {
    const lobe = CreateCapsule(
      'story-heart-lobe',
      { height: 1.0, radius: 0.3, tessellation: 12, subdivisions: 1 },
      scene,
    );
    lobe.rotation.z = -side * (Math.PI / 4);
    lobe.position.set(side * 0.141, 0, 0);
    return painted(lobe, color);
  });
}

/** Heart `i` of a puff, `s` seconds in: rises, sways, grows in and shrinks away. Pure. */
export function heartAt(
  i: number,
  s: number,
): { dx: number; dy: number; dz: number; size: number } {
  const { count, seconds, rise, spread, size } = STORY_EFFECTS.puff;
  // Each heart starts a little after the one before, round a small circle.
  const start = (i / count) * seconds * 0.35;
  const t = Math.max(0, s - start);
  const k = Math.min(1, t / (seconds * 0.65));
  const angle = i * 2.399963; // golden angle
  const out = spread * (0.4 + 0.6 * ((i * 0.618034) % 1)) * Math.min(1, k * 2);
  const grow = t <= 0 ? 0 : Math.min(1, t / 0.25) * (1 - Math.max(0, (k - 0.7) / 0.3));
  return {
    dx: Math.cos(angle) * out + Math.sin(t * 5 + i) * 0.04,
    dy: rise * (1 - (1 - k) * (1 - k)),
    dz: Math.sin(angle) * out * 0.5,
    size: size * (0.75 + 0.25 * ((i * 0.754877) % 1)) * Math.max(0, grow),
  };
}

/** One thin-instanced mesh filled each frame: matrices, plus a colour per instance. */
class Pool {
  readonly #mesh: Mesh;
  readonly #matrices: Float32Array;
  readonly #colors: Float32Array | null;
  readonly #capacity: number;
  #count = 0;
  #uploaded = false;

  constructor(mesh: Mesh, capacity: number, colors: boolean) {
    this.#mesh = mesh;
    this.#capacity = Math.max(1, capacity);
    this.#matrices = new Float32Array(this.#capacity * 16);
    this.#colors = colors ? new Float32Array(this.#capacity * 4) : null;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
  }

  get mesh(): Mesh {
    return this.#mesh;
  }

  /** Starts a frame. */
  begin(): void {
    this.#count = 0;
  }

  /** Adds one instance; false once the pool is full. */
  push(matrix: Matrix, color?: readonly [number, number, number, number]): boolean {
    if (this.#count >= this.#capacity) return false;
    matrix.copyToArray(this.#matrices, this.#count * 16);
    if (this.#colors && color) this.#colors.set(color, this.#count * 4);
    this.#count += 1;
    return true;
  }

  /** Uploads the frame; returns how many show. */
  end(): number {
    const mesh = this.#mesh;
    if (this.#count === 0) {
      mesh.setEnabled(false);
      return 0;
    }
    if (!this.#uploaded) {
      mesh.thinInstanceSetBuffer('matrix', this.#matrices, 16, false);
      if (this.#colors) mesh.thinInstanceSetBuffer('color', this.#colors, 4, false);
      this.#uploaded = true;
    } else {
      mesh.thinInstanceBufferUpdated('matrix');
      if (this.#colors) mesh.thinInstanceBufferUpdated('color');
    }
    mesh.thinInstanceCount = this.#count;
    mesh.setEnabled(true);
    return this.#count;
  }
}

function glowing(
  scene: Scene,
  name: string,
  color: string,
  imageProcessing: ImageProcessingConfiguration,
  additive: boolean,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = Color3.FromHexString(color).toLinearSpace();
  m.imageProcessingConfiguration = imageProcessing;
  m.transparencyMode = Material.MATERIAL_ALPHABLEND;
  m.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
  m.disableDepthWrite = true;
  return m;
}

export interface StoryEffectCounts {
  readonly charms: number;
  readonly hearts: number;
  readonly joy: number;
}

/**
 * The tossed Heart Charms, heart puffs and joy lights. `capacity` is how many
 * of each the whole story ever shows at once (the scene counts its actors).
 */
export class StoryEffects {
  readonly #charms: Pool;
  readonly #hearts: Pool;
  readonly #joy: Pool;
  readonly #charmMaterial: PBRMaterial;
  readonly #charmPink = Color3.FromHexString(STORY_EFFECTS.charm.color).toLinearSpace();
  readonly #m = Matrix.Identity();
  readonly #turn = new Quaternion();
  readonly #size = new Vector3();
  readonly #at = new Vector3();
  readonly #color: [number, number, number, number] = [1, 1, 1, 1];
  #counts: StoryEffectCounts = { charms: 0, hearts: 0, joy: 0 };

  /** `imageProcessing`: these keep their colour through the drain (the story's hope). */
  constructor(
    scene: Scene,
    imageProcessing: ImageProcessingConfiguration,
    capacity: { charms: number; puffs: number; joy: number },
  ) {
    // A Heart Charm: a glossy pink heart with a little gold ring on top.
    const ring = painted(
      CreateTorus('story-charm-ring', { diameter: 0.34, thickness: 0.08, tessellation: 16 }, scene),
      STORY_EFFECTS.charm.ring,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.62;
    const charm = merged('story-heart-charm', [
      ...heartParts(scene, STORY_EFFECTS.charm.color),
      ring,
    ]);
    const charmMaterial = vinyl(scene, 'story-heart-charm-mat', { color: '#ffffff' });
    charmMaterial.imageProcessingConfiguration = imageProcessing;
    charm.material = charmMaterial;
    this.#charmMaterial = charmMaterial;
    this.#charms = new Pool(charm, capacity.charms, false);

    // Little hearts: unlit pink, fading by their instance colour's alpha.
    const heart = merged('story-hearts', heartParts(scene, '#ffffff'));
    heart.material = glowing(
      scene,
      'story-hearts-mat',
      STORY_EFFECTS.puff.color,
      imageProcessing,
      false,
    );
    heart.hasVertexAlpha = true;
    this.#hearts = new Pool(heart, capacity.puffs * STORY_EFFECTS.puff.count, true);

    // Joy: a soft warm light, added onto whatever is behind it.
    const joy = CreateSphere('story-joy', { diameter: 1, segments: 10 }, scene);
    joy.material = glowing(scene, 'story-joy-mat', STORY_EFFECTS.joy.color, imageProcessing, true);
    this.#joy = new Pool(joy, capacity.joy * 2, true);
  }

  /** Builds this frame's effects. Call `charm`, `puff` and `joy` between `begin` and `end`. */
  begin(): void {
    this.#charms.begin();
    this.#hearts.begin();
    this.#joy.begin();
  }

  /** A Heart Charm, spinning by its yaw and glowing by its glow. */
  charm(pose: EffectPose): void {
    if (pose.scale <= 0.001) return;
    const s = pose.scale * STORY_EFFECTS.charm.size;
    Quaternion.RotationYawPitchRollToRef(pose.yaw, 0, 0, this.#turn);
    Matrix.ComposeToRef(
      this.#size.set(s, s, s * 0.55),
      this.#turn,
      this.#at.set(pose.x, pose.y, pose.z),
      this.#m,
    );
    this.#charms.push(this.#m);
    // One charm on screen at a time: its glow is the material's.
    const k =
      STORY_EFFECTS.charm.glow[0] +
      (STORY_EFFECTS.charm.glow[1] - STORY_EFFECTS.charm.glow[0]) * pose.glow;
    this.#charmPink.scaleToRef(k, this.#charmMaterial.emissiveColor);
  }

  /** A puff of hearts, `s` seconds after it started. */
  puff(pose: PuffPose): void {
    if (pose.glow <= 0.001) return;
    for (let i = 0; i < STORY_EFFECTS.puff.count; i += 1) {
      const h = heartAt(i, pose.s);
      if (h.size <= 0.001) continue;
      Matrix.ComposeToRef(
        this.#size.set(h.size, h.size, h.size * 0.5),
        NO_TURN,
        this.#at.set(pose.x + h.dx, pose.y + h.dy, pose.z + h.dz),
        this.#m,
      );
      this.#color[0] = 1;
      this.#color[1] = 1;
      this.#color[2] = 1;
      this.#color[3] = pose.glow;
      this.#hearts.push(this.#m, this.#color);
    }
  }

  /** A squishy's joy: a bright little core in a soft halo, brightness by its glow. */
  joy(pose: EffectPose): void {
    if (pose.scale <= 0.001 || pose.glow <= 0.001) return;
    const { halo, core } = STORY_EFFECTS.joy;
    for (const [size, bright] of [
      [halo, 0.35],
      [core, 1],
    ] as const) {
      const s = pose.scale * size;
      Matrix.ComposeToRef(
        this.#size.set(s, s, s),
        NO_TURN,
        this.#at.set(pose.x, pose.y, pose.z),
        this.#m,
      );
      const k = bright * pose.glow;
      this.#color[0] = k;
      this.#color[1] = k;
      this.#color[2] = k;
      this.#color[3] = 1;
      this.#joy.push(this.#m, this.#color);
    }
  }

  /** Uploads the frame. */
  end(): void {
    this.#counts = {
      charms: this.#charms.end(),
      hearts: this.#hearts.end(),
      joy: this.#joy.end() / 2,
    };
  }

  get counts(): StoryEffectCounts {
    return this.#counts;
  }
}
