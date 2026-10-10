import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import { linear, merged } from '../map/map-props.js';
import { setInstances } from '../map/map-scene.js';
import { EXPLORE_SKY, type SkyLook } from './explore-sky-look.js';

// The explore sky (#335): a vertex-coloured dome, the sun or moon, clouds
// and stars, drawn in 3 or 4 draw calls (art bible appendix). The camera
// never turns (#291), so the sky rides with it: its root sits on the camera
// and tilts with its pitch, and every piece is placed in degrees from the
// middle of the view. Nothing moves on its own, so render on demand stays
// idle (tech spec §6); the screen sets a new look once a minute.

const RAD = Math.PI / 180;

/** A direction `right`° and `up`° from the middle of the view (+z), as a point `distance` away. */
function toward(right: number, up: number, distance: number): Vector3 {
  const r = right * RAD;
  const u = up * RAD;
  return new Vector3(
    Math.sin(r) * Math.cos(u) * distance,
    Math.sin(u) * distance,
    Math.cos(r) * Math.cos(u) * distance,
  );
}

function unlit(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.emissiveColor = Color3.White();
  m.specularColor = Color3.Black();
  m.fogEnabled = false;
  return m;
}

/**
 * The sky is unlit and drawn as its colours are picked (sRGB, not linear):
 * converted, the night's friendly blue came out near black.
 */
const skyColour = (hex: string): Color3 => Color3.FromHexString(hex);

/** Paints every vertex of a mesh (the clouds and stars share one colour each). */
function recolour(mesh: Mesh, hex: string): void {
  const c = skyColour(hex);
  const colors = new Float32Array(mesh.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([c.r, c.g, c.b, 1], i);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

/** Read-only numbers for the dev hook. */
export interface ExploreSkyStats {
  readonly clouds: number;
  readonly stars: boolean;
  readonly moon: boolean;
  readonly underwater: boolean;
}

export class ExploreSky {
  readonly #root: TransformNode;
  readonly #dome: Mesh;
  readonly #sun: Mesh;
  readonly #cloud: Mesh;
  readonly #stars: Mesh;
  readonly #scene: Scene;
  readonly #light: { light: DirectionalLight; intensity: number; diffuse: Color3 } | null;
  readonly #environment: number;
  #look: SkyLook;

  constructor(scene: Scene, look: SkyLook) {
    this.#scene = scene;
    this.#look = look;
    const r = EXPLORE_SKY.radius;
    this.#root = new TransformNode('explore-sky', scene);
    const material = unlit(scene, 'explore-sky-mat');
    material.backFaceCulling = false;
    const keep = (mesh: Mesh): Mesh => {
      mesh.parent = this.#root;
      mesh.material = material;
      mesh.isPickable = false;
      mesh.applyFog = false;
      return mesh;
    };

    this.#dome = keep(
      CreateSphere(
        'explore-sky-dome',
        { diameter: r * 2, segments: 24, sideOrientation: Mesh.BACKSIDE },
        scene,
      ),
    );

    const sunAt = EXPLORE_SKY.sun.at;
    const d = r * 0.9;
    this.#sun = keep(
      CreateDisc(
        'explore-sky-sun',
        { radius: d * Math.tan(EXPLORE_SKY.sun.size * RAD), tessellation: 32 },
        scene,
      ),
    );
    // Faces the camera: the disc's plane turned square to its direction.
    this.#sun.position = toward(sunAt[0], sunAt[1], d);
    this.#sun.rotation.set(-sunAt[1] * RAD, sunAt[0] * RAD, 0);

    // One puff shape (the arena's), thin-instanced.
    const parts = [
      [0, 0, 0, 1.0],
      [0.9, -0.1, 0.1, 0.75],
      [-0.85, -0.12, -0.1, 0.7],
      [0.35, 0.3, 0, 0.7],
      [-0.3, 0.28, 0.05, 0.6],
    ] as const;
    this.#cloud = keep(
      merged(
        'explore-sky-cloud',
        parts.map(([x, y, z, s]) => {
          const p = CreateSphere('c', { diameter: 2.2 * s, segments: 8 }, scene);
          p.position.set(x * 2.2, y * 2.2, z * 2.2);
          p.scaling.set(1, 0.72, 0.9);
          return p;
        }),
      ),
    );

    this.#stars = keep(CreateSphere('explore-sky-stars', { diameter: 1, segments: 4 }, scene));
    recolour(this.#stars, '#fff3c4');
    const { count, right, from, to, size } = EXPLORE_SKY.stars;
    const at = r * 0.95;
    const s = at * Math.tan(size * RAD);
    setInstances(
      this.#stars,
      Array.from({ length: count }, (_, i) => {
        // A sunflower spread over the band, so stars never line up.
        const u = (i + 0.5) / count;
        const across = ((i * 0.618034) % 1) * 2 - 1;
        const twinkle = 0.6 + 0.8 * (((i * 37) % 11) / 10);
        const p = toward(across * right, from + (to - from) * u, at);
        return Matrix.Compose(new Vector3(s, s, s).scale(twinkle), Quaternion.Identity(), p);
      }),
    );

    const sun = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
    this.#light = sun
      ? { light: sun, intensity: sun.intensity, diffuse: sun.diffuse.clone() }
      : null;
    this.#environment = scene.environmentIntensity;

    this.set(look);
  }

  get stats(): ExploreSkyStats {
    return {
      clouds: this.#look.clouds,
      stars: this.#look.stars,
      moon: this.#look.moon && this.#look.sunDisc,
      underwater: this.#look.fog !== null,
    };
  }

  /** Shows a new look: the dome, sun or moon, clouds, stars and the light on the land. */
  set(look: SkyLook): void {
    this.#look = look;
    const r = EXPLORE_SKY.radius;
    const { low, high } = EXPLORE_SKY.gradient;
    const zenith = skyColour(look.zenith);
    const horizon = skyColour(look.horizon);
    const pos = this.#dome.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors = new Float32Array((pos.length / 3) * 4);
    for (let i = 0; i < pos.length / 3; i++) {
      const up = Math.asin(Math.max(-1, Math.min(1, (pos[i * 3 + 1] ?? 0) / r))) / RAD;
      const t = Math.min(1, Math.max(0, (up - low) / (high - low)));
      const c = Color3.Lerp(horizon, zenith, t * t * (3 - 2 * t));
      colors.set([c.r, c.g, c.b, 1], i * 4);
    }
    this.#dome.setVerticesData(VertexBuffer.ColorKind, colors);
    this.#scene.clearColor = new Color4(horizon.r, horizon.g, horizon.b, 1);

    recolour(this.#sun, look.sun);
    this.#sun.setEnabled(look.sunDisc);
    recolour(this.#stars, look.starColor);
    recolour(this.#cloud, look.cloud);
    const d = r * 0.85;
    setInstances(
      this.#cloud,
      EXPLORE_SKY.clouds.slice(0, look.clouds).map(([right, up, size]) => {
        const s = (d * Math.tan(size * RAD)) / 2.2;
        return Matrix.Compose(
          new Vector3(s * 1.3, s, s),
          Quaternion.Identity(),
          toward(right, up, d),
        );
      }),
    );
    this.#cloud.setEnabled(look.clouds > 0);
    this.#stars.setEnabled(look.stars);

    if (this.#light) {
      const { light, intensity, diffuse } = this.#light;
      light.intensity = intensity * look.light.sun;
      light.diffuse = diffuse.multiply(linear(look.light.color));
    }
    this.#scene.environmentIntensity = this.#environment * look.light.environment;
    // Underwater the far seabed fades into the water (#335).
    if (look.fog) {
      this.#scene.fogMode = Scene.FOGMODE_LINEAR;
      this.#scene.fogColor = skyColour(look.fog);
      this.#scene.fogStart = EXPLORE_SKY.fog.start;
      this.#scene.fogEnd = EXPLORE_SKY.fog.end;
    } else {
      this.#scene.fogMode = Scene.FOGMODE_NONE;
    }
  }

  /** Rides with the camera: on its position, tilted down by its pitch. */
  follow(camera: Vector3, pitch: number): void {
    this.#root.position.copyFrom(camera);
    this.#root.rotation.x = pitch;
  }
}
