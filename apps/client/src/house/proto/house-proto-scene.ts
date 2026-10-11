import { defaultKeeperConfig, GAME_DATA, KEEPER_DATA, visualRegistry } from '@heartpatch/shared';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../../engine/config.js';
import type { SceneContent, Stage } from '../../engine/stage.js';
import { ExploreSky } from '../../explore/explore-sky.js';
import { SKY_LOOKS } from '../../explore/explore-sky-look.js';
import { buildFarTree, buildTree } from '../../explore/land-kit.js';
import { linear, merged, painted } from '../../map/map-props.js';
import { buildHeartSeed } from '../../map/map-scene.js';
import { KeeperField } from '../../procedural/keeper/keeper-field.js';
import type { SquishySpecies } from '../../procedural/params.js';
import { lodFor } from '../../procedural/motion.js';
import { SquishyField } from '../../procedural/squishy-field.js';
import { VINYL } from '../../procedural/config.js';

/**
 * Prototype interior for the Keeper's house (#381): a dollhouse-style room
 * seen from its open front, built from the same kit as the rest of the game
 * (merged, vertex-painted vinyl parts; thin-instanced squishies and Keeper;
 * the explore sky through the windows and door; the stage's lighting, bloom
 * and tone mapping). It exists to judge the look and the budget by eye and
 * by the numbers; the real HouseScene (PR B) grows from what works here.
 *
 * Every number below is a `// TUNE:` guess for the prototype.
 */

export type HouseProtoRoom = 'snug' | 'hall';

export interface HouseProtoOptions {
  readonly room: HouseProtoRoom;
  readonly tier: QualityTier;
  /** Where the camera starts looking (the floor point). */
  readonly focus: { readonly x: number; readonly z: number };
}

export interface HouseProtoStats {
  readonly room: HouseProtoRoom;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly meshes: number;
  readonly lights: number;
  readonly shadows: boolean;
}

const species = (id: string): SquishySpecies => {
  const s = GAME_DATA.species.find((x) => x.id === id);
  if (!s) throw new Error(`no species ${id}`);
  return s;
};

/** A box part at `at` (centre), size `[w, h, d]`, painted `hex`. */
function box(
  scene: Scene,
  size: [number, number, number],
  at: [number, number, number],
  hex: string,
  rotY = 0,
): Mesh {
  const m = CreateBox('p', { width: size[0], height: size[1], depth: size[2] }, scene);
  m.position.set(...at);
  m.rotation.y = rotY;
  return painted(m, hex);
}

function ball(
  scene: Scene,
  d: number,
  at: [number, number, number],
  hex: string,
  s: [number, number, number] = [1, 1, 1],
): Mesh {
  const m = CreateSphere('p', { diameter: d, segments: 10 }, scene);
  m.position.set(...at);
  m.scaling.set(...s);
  return painted(m, hex);
}

function tube(
  scene: Scene,
  h: number,
  dTop: number,
  dBottom: number,
  at: [number, number, number],
  hex: string,
  tess = 12,
): Mesh {
  const m = CreateCylinder(
    'p',
    { height: h, diameterTop: dTop, diameterBottom: dBottom, tessellation: tess },
    scene,
  );
  m.position.set(...at);
  return painted(m, hex);
}

/** The pieces of a wall with a rectangular opening in it (a window or a door). */
function wallWithHole(
  scene: Scene,
  width: number,
  height: number,
  thick: number,
  hole: { x: number; y: number; w: number; h: number },
  hex: string,
): Mesh[] {
  const parts: Mesh[] = [];
  const left = hole.x - hole.w / 2 + width / 2; // width of the piece left of the hole
  const right = width / 2 - (hole.x + hole.w / 2);
  const below = hole.y - hole.h / 2;
  const above = height - (hole.y + hole.h / 2);
  if (left > 0)
    parts.push(box(scene, [left, height, thick], [-width / 2 + left / 2, height / 2, 0], hex));
  if (right > 0)
    parts.push(box(scene, [right, height, thick], [width / 2 - right / 2, height / 2, 0], hex));
  if (below > 0) parts.push(box(scene, [hole.w, below, thick], [hole.x, below / 2, 0], hex));
  if (above > 0)
    parts.push(box(scene, [hole.w, above, thick], [hole.x, height - above / 2, 0], hex));
  return parts;
}

/** Darkens a kit mesh for dusk: its vertex colours blend toward `foot` at the base and `top` up high. */
function duskTint(mesh: Mesh, foot: string, top: string): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const colors = mesh.getVerticesData(VertexBuffer.ColorKind);
  if (!colors) return;
  const a = linear(foot);
  const b = linear(top);
  const k = 0.75; // TUNE: how far toward the dusk ramp
  let maxY = 0;
  for (let i = 0; i < pos.length / 3; i++) maxY = Math.max(maxY, pos[i * 3 + 1] ?? 0);
  for (let i = 0; i < pos.length / 3; i++) {
    const t = Math.min(1, (pos[i * 3 + 1] ?? 0) / (maxY || 1));
    colors[i * 4] = (colors[i * 4] ?? 0) * (1 - k) + (a.r + (b.r - a.r) * t) * k;
    colors[i * 4 + 1] = (colors[i * 4 + 1] ?? 0) * (1 - k) + (a.g + (b.g - a.g) * t) * k;
    colors[i * 4 + 2] = (colors[i * 4 + 2] ?? 0) * (1 - k) + (a.b + (b.b - a.b) * t) * k;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

/** Repaints a kit tree's canopy (vertices above `fromY`, local units) from `bottom` to `top`. */
function blushCanopy(tree: Mesh, fromY: number, bottom: string, top: string): void {
  const pos = tree.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const colors = tree.getVerticesData(VertexBuffer.ColorKind);
  if (!colors) return;
  const a = linear(bottom);
  const b = linear(top);
  let maxY = 0;
  for (let i = 0; i < pos.length / 3; i++) maxY = Math.max(maxY, pos[i * 3 + 1] ?? 0);
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1] ?? 0;
    if (y < fromY) continue;
    const t = Math.min(1, (y - fromY) / (maxY - fromY || 1));
    colors[i * 4] = a.r + (b.r - a.r) * t;
    colors[i * 4 + 1] = a.g + (b.g - a.g) * t;
    colors[i * 4 + 2] = a.b + (b.b - a.b) * t;
  }
  tree.setVerticesData(VertexBuffer.ColorKind, colors);
}

/** Mia's Keeper: the default base with the mockups' lilac hair, when the data has that colour. */
function miaConfig(
  base: (typeof KEEPER_DATA.bases)[number],
): ReturnType<typeof defaultKeeperConfig> {
  const config = defaultKeeperConfig(base);
  const lilac = KEEPER_DATA.hairColors.find((c) => c.id === 'lilac');
  return lilac ? { ...config, hairColor: lilac.id } : config;
}

/** The floor runs this far past the open front, so a low camera never sees the void. */
const FRONT_APRON = 6; // TUNE

interface RoomSpec {
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly floor: string;
  readonly wall: string;
  readonly wallTop: string;
  readonly trim: string;
}

export class HouseProtoScene {
  readonly content: SceneContent;
  readonly #scene: Scene;
  readonly #room: HouseProtoRoom;
  readonly #sky: ExploreSky;
  readonly #squishies: SquishyField;
  readonly #keepers: KeeperField;
  readonly #vinyl: PBRMaterial;
  readonly #shadows: ShadowGenerator | null;
  readonly #instrumentation: SceneInstrumentation;
  readonly #glowMaterials = new Map<string, StandardMaterial>();
  #ready = false;

  constructor(scene: Scene, options: HouseProtoOptions) {
    this.#scene = scene;
    this.#room = options.room;
    this.#instrumentation = new SceneInstrumentation(scene);

    // One matte-ish vinyl for every painted part (art bible §4: world props
    // are the same family as squishies, a little matter). Vertex colours do
    // the painting, so the whole room's furniture is a handful of draw calls.
    const vinyl = new PBRMaterial('house-vinyl', scene);
    vinyl.albedoColor = Color3.White();
    vinyl.metallic = 0;
    vinyl.roughness = 0.6; // TUNE: matte-er than squishies (0.42)
    vinyl.clearCoat.isEnabled = true;
    vinyl.clearCoat.intensity = VINYL.clearCoatIntensity * 0.5; // TUNE
    vinyl.clearCoat.roughness = 0.35; // TUNE
    this.#vinyl = vinyl;

    const sun = scene.lights.find((l): l is DirectionalLight => l instanceof DirectionalLight);
    // Dusk light comes in low through the windows at the back, so it pools
    // on the floor and leaves the rest to the lamps and the fire.
    if (sun) {
      sun.direction = new Vector3(-0.35, -0.55, -0.75).normalize(); // TUNE
      // The shadow map's frustum centres on the light's position: put it
      // well back along its direction so the whole house is in front of it.
      sun.position = sun.direction.scale(-24);
      sun.intensity = 2.5; // TUNE: a warm shaft; the sky look scales it by 0.8
      sun.diffuse = linear('#ffd0a8'); // TUNE
    }
    // Dusk outside: the explore sky dome, seen through the windows and door.
    // It scales the sun and the environment by the dusk look (×0.8).
    this.#sky = new ExploreSky(scene, SKY_LOOKS.dusk);
    scene.environmentIntensity = 0.62; // TUNE: indoors is dimmer than the sky says

    // Soft shadows from the window light on the medium and high tiers; the
    // low tier keeps the contact shadows only (rule 8).
    this.#shadows = null;
    if (sun && options.tier !== 'low') {
      const size = options.tier === 'high' ? 2048 : 1024; // TUNE
      const sg = new ShadowGenerator(size, sun);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality =
        options.tier === 'high' ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
      sg.darkness = 0.35; // TUNE
      sg.bias = 0.0012;
      sg.normalBias = 0.02;
      sun.shadowMinZ = 1;
      sun.shadowMaxZ = 60;
      sun.autoCalcShadowZBounds = false;
      sun.shadowFrustumSize = options.room === 'hall' ? 30 : 22; // TUNE
      sun.shadowOrthoScale = 0;
      this.#shadows = sg;
    }

    const registry = visualRegistry(GAME_DATA);
    this.#squishies = new SquishyField(scene, {
      registry,
      lod: lodFor('closeUp', options.tier),
      breathing: true,
    });
    this.#keepers = new KeeperField(scene, {
      data: KEEPER_DATA,
      lod: lodFor('closeUp', options.tier),
    });

    const spec: RoomSpec =
      options.room === 'hall'
        ? {
            w: 14,
            d: 11,
            h: 7,
            floor: '#c48a5c',
            wall: '#f7e9d6',
            wallTop: '#fbf3e6',
            trim: '#d9a441',
          }
        : {
            w: 8.4,
            d: 7,
            h: 4.0,
            floor: '#c98b5a',
            wall: '#f6e4d2',
            wallTop: '#fbeee2',
            trim: '#8d5a3b',
          };

    this.#buildOutside(spec);
    this.#buildShell(spec);
    if (options.room === 'hall') this.#furnishHall(spec);
    else this.#furnishSnug(spec);

    const half = { x: spec.w / 2, z: spec.d / 2 };
    this.content = {
      bounds: { minX: -half.x + 1, maxX: half.x - 1, minZ: -half.z, maxZ: half.z - 1 },
      start: options.focus,
      maxDistance: 40,
    };
    this.#ready = true;
  }

  get ready(): boolean {
    return this.#ready;
  }

  get stats(): HouseProtoStats {
    const scene = this.#scene;
    return {
      room: this.#room,
      drawCalls: this.#instrumentation.drawCallsCounter.current,
      triangles: Math.round(scene.getActiveIndices() / 3),
      meshes: scene.getActiveMeshes().length,
      lights: scene.lights.length,
      shadows: this.#shadows !== null,
    };
  }

  /** Wires the fields' clocks to the stage so breathing draws (render on demand). */
  start(stage: Stage): void {
    const tick = (): void => {
      const now = performance.now();
      const moving = this.#squishies.update(now) || this.#keepers.update(now);
      const cam = this.#scene.activeCamera;
      if (cam) this.#sky.follow(cam.position, 0);
      if (moving) stage.invalidate();
    };
    this.#scene.onBeforeRenderObservable.add(tick);
    stage.invalidate();
  }

  // ── Materials ───────────────────────────────────────────────────────

  /** An unlit glow colour (lamps, flames, lanterns); `k` over 1 blooms. */
  #glow(hex: string, k = 1): StandardMaterial {
    const key = `${hex}:${String(k)}`;
    let m = this.#glowMaterials.get(key);
    if (m) return m;
    m = new StandardMaterial(`glow-${key}`, this.#scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = linear(hex).scale(k);
    m.freeze();
    this.#glowMaterials.set(key, m);
    return m;
  }

  /** Merges painted parts into one vinyl mesh that casts and catches shadows. */
  #solid(name: string, parts: Mesh[], opts: { cast?: boolean; receive?: boolean } = {}): Mesh {
    const mesh = merged(name, parts);
    mesh.material = this.#vinyl;
    mesh.receiveShadows = opts.receive ?? true;
    if ((opts.cast ?? true) && this.#shadows) this.#shadows.addShadowCaster(mesh);
    return mesh;
  }

  #glowMesh(name: string, parts: Mesh[], hex: string, k = 1): Mesh {
    const mesh = merged(name, parts);
    mesh.material = this.#glow(hex, k);
    return mesh;
  }

  #lamp(name: string, at: Vector3, hex: string, intensity: number, range: number): PointLight {
    const light = new PointLight(name, at, this.#scene);
    light.diffuse = linear(hex);
    light.specular = linear(hex).scale(0.5);
    light.intensity = intensity;
    light.range = range;
    light.shadowEnabled = false;
    return light;
  }

  // ── The world beyond the windows ─────────────────────────────────────

  #buildOutside(spec: RoomSpec): void {
    const scene = this.#scene;
    // A patch of dusk ground and a few far trees past the back wall, so the
    // windows look out on something (the real house looks out on the patch).
    // A lawn around the house only: past it the sky's horizon glow shows through the
    // windows (the house sits on a rise, so a low camera never looks at flat ground).
    const ground = CreateDisc('outside-ground', { radius: 9, tessellation: 48 }, scene);
    ground.rotation.x = Math.PI / 2;
    ground.position.set(0, -0.32, 0);
    const gm = new PBRMaterial('outside-ground', scene);
    gm.albedoColor = linear('#4e6a4c'); // TUNE: dusk lawn
    gm.roughness = 0.9;
    gm.metallic = 0;
    ground.material = gm;
    ground.isPickable = false;

    const trees: Mesh[] = [];
    const far = buildFarTree(scene);
    const spots: [number, number, number][] = [
      [-6.5, 3.2, 1.0],
      [-3, 4.2, 1.15],
      [1.5, 4.0, 0.95],
      [5, 3.6, 1.1],
      [-8.5, 1.5, 0.9],
      [7.5, 1.8, 0.95],
    ];
    duskTint(far, '#2f4a3c', '#8a6d5a'); // dusk: a dark foot, a warm-lit top
    for (const [x, dz, s] of spots) {
      const t = far.clone('far-tree');
      t.position.set(x, 0, spec.d / 2 + dz);
      t.scaling.setAll(s);
      t.material = this.#vinyl;
      trees.push(t);
    }
    far.dispose();
    const oak = buildTree(scene, 'oak');
    oak.position.set(-4.8, 0, spec.d / 2 + 3.4);
    oak.scaling.setAll(0.85);
    oak.material = this.#vinyl;
    duskTint(oak, '#2f4a3c', '#8a6d5a');
  }

  // ── Floor and walls ──────────────────────────────────────────────────

  #buildShell(spec: RoomSpec): void {
    const scene = this.#scene;
    const { w, d, h } = spec;
    const thick = 0.3;
    const hall = this.#room === 'hall';

    // Floor: planks (alternating tones) on a slab.
    const planks: Mesh[] = [];
    const plankW = 0.6;
    for (let i = 0; i < Math.ceil(w / plankW); i++) {
      const x = -w / 2 + plankW / 2 + i * plankW;
      const tone = i % 3 === 0 ? spec.floor : i % 3 === 1 ? '#d2956a' : '#bf7f52';
      planks.push(
        box(scene, [plankW - 0.02, 0.2, d + FRONT_APRON], [x, -0.1, -FRONT_APRON / 2], tone),
      );
    }
    this.#solid('floor', planks, { cast: false });
    // The stone footing under the open front (a dollhouse base) and a step.
    this.#solid(
      'footing',
      [box(scene, [w + 0.6, 0.3, d + FRONT_APRON + 0.6], [0, -0.17, -FRONT_APRON / 2], '#8f8279')],
      { cast: false, receive: true },
    );

    // Back wall with the big window; side walls; skirting and a picture rail.
    const windowHole = hall
      ? { x: 0, y: 3.15, w: 5.2, h: 3.0 }
      : { x: -0.2, y: 2.15, w: 2.6, h: 1.8 };
    const back = wallWithHole(scene, w, h, thick, windowHole, spec.wall);
    for (const p of back) p.position.z += d / 2 + thick / 2;
    this.#solid('wall-back', back);
    // Window frame and mullions: a cream frame, a cross, and a sill.
    const fx = windowHole.x;
    const fy = windowHole.y;
    const fw = windowHole.w;
    const fh = windowHole.h;
    const fz = d / 2 + thick / 2;
    const frameHex = '#fff6ec';
    this.#solid('window-frame', [
      box(scene, [fw + 0.3, 0.14, thick + 0.1], [fx, fy + fh / 2 + 0.07, fz], frameHex),
      box(scene, [fw + 0.3, 0.22, thick + 0.3], [fx, fy - fh / 2 - 0.11, fz - 0.1], frameHex),
      box(scene, [0.14, fh, thick + 0.1], [fx - fw / 2 - 0.07, fy, fz], frameHex),
      box(scene, [0.14, fh, thick + 0.1], [fx + fw / 2 + 0.07, fy, fz], frameHex),
      box(scene, [0.08, fh, 0.08], [fx, fy, fz], frameHex),
      box(scene, [fw, 0.08, 0.08], [fx, fy, fz], frameHex),
      ...(hall
        ? [
            box(scene, [0.08, fh, 0.08], [fx - fw / 3, fy, fz], frameHex),
            box(scene, [0.08, fh, 0.08], [fx + fw / 3, fy, fz], frameHex),
          ]
        : []),
    ]);

    // Left wall: solid (the hearth stands against it).
    const left = box(
      scene,
      [thick, h, d + thick],
      [-w / 2 - thick / 2, h / 2, thick / 2],
      spec.wall,
    );
    // Right wall with the front door; the door stands open onto the dusk.
    const doorHole = hall
      ? { x: -d / 2 + 2.2, y: 1.6, w: 1.5, h: 3.2 }
      : { x: -d / 2 + 1.7, y: 1.2, w: 1.15, h: 2.4 };
    const right = wallWithHole(scene, d + thick, h, thick, doorHole, spec.wall);
    for (const p of right) {
      p.rotation.y = Math.PI / 2;
      // the piece's x along the wall becomes z
      const z = p.position.x + thick / 2;
      p.position.set(w / 2 + thick / 2, p.position.y, z);
    }
    this.#solid('walls-side', [left, ...right]);

    // Door frame, the open door (swung outward), and the welcome mat.
    const dz = doorHole.x + thick / 2;
    const dw = doorHole.w;
    const dh = doorHole.h;
    const dx = w / 2 + thick / 2;
    this.#solid('door', [
      box(scene, [thick + 0.1, 0.14, dw + 0.3], [dx, dh + 0.07, dz], spec.trim),
      box(scene, [thick + 0.1, dh, 0.14], [dx, dh / 2, dz - dw / 2 - 0.07], spec.trim),
      box(scene, [thick + 0.1, dh, 0.14], [dx, dh / 2, dz + dw / 2 + 0.07], spec.trim),
      // the door itself, open 70° outward
      (() => {
        const door = box(
          scene,
          [0.08, dh - 0.1, dw - 0.06],
          [0, dh / 2, (dw - 0.06) / 2],
          '#b5654a',
        );
        const pivot = new Mesh('door-pivot', scene);
        door.parent = pivot;
        pivot.position.set(dx + 0.2, 0, dz - dw / 2);
        pivot.rotation.y = (-70 * Math.PI) / 180;
        door.computeWorldMatrix(true);
        door.bakeTransformIntoVertices(door.getWorldMatrix());
        door.parent = null;
        pivot.dispose();
        door.position.setAll(0);
        door.rotation.setAll(0);
        return door;
      })(),
      box(scene, [0.9, 0.04, dw + 0.2], [dx - 0.6, 0.02, dz], '#e9a0b4'), // welcome mat
    ]);

    // Skirting board and a rail, warm trim.
    this.#solid(
      'trim',
      [
        box(scene, [w, 0.22, 0.06], [0, 0.11, d / 2 - 0.03], spec.trim),
        box(scene, [0.06, 0.22, d], [-w / 2 + 0.03, 0.11, 0], spec.trim),
        box(scene, [0.06, 0.22, d], [w / 2 - 0.03, 0.11, 0], spec.trim),
      ],
      { cast: false },
    );

    // A lighter band up top so the walls read as tall, not flat.
    this.#solid(
      'wall-band',
      [
        box(scene, [w, 0.5, 0.04], [0, h - 0.25, d / 2 - 0.02], spec.wallTop),
        box(scene, [0.04, 0.5, d], [-w / 2 + 0.02, h - 0.25, 0], spec.wallTop),
        box(scene, [0.04, 0.5, d], [w / 2 - 0.02, h - 0.25, 0], spec.wallTop),
      ],
      { cast: false },
    );

    // Ceiling beams (no ceiling: the camera looks in over the front).
    const beams: Mesh[] = [];
    const beamCount = hall ? 5 : 0;
    for (let i = 0; i < beamCount; i++) {
      const z = -d / 2 + (d / (beamCount + 1)) * (i + 1);
      beams.push(box(scene, [w, 0.22, 0.22], [0, h - 0.11, z], hall ? '#9a6a46' : '#8d5a3b'));
    }
    if (beams.length > 0) this.#solid('beams', beams, { cast: false, receive: false });

    // The visitors' wall by the door: hearts and stickers left by friends,
    // stuck flat on the right wall (facing −x, into the room).
    const stickers: Mesh[] = [];
    const sx = w / 2 - 0.05;
    const marks: [number, number, number, string][] = [
      [1.9, -0.9, 1, '#ff7aa2'],
      [2.25, -0.55, 0.8, '#ffb347'],
      [1.65, -0.5, 0.7, '#9ad8ff'],
      [2.0, -0.2, 0.9, '#ff7aa2'],
      [2.4, -0.95, 0.6, '#c9a0ff'],
      [1.55, -0.15, 0.6, '#ffd166'],
    ];
    for (const [y, dzz, s, hex] of marks) {
      const z = dz + dzz - dw / 2 - 0.9;
      const lobe = (off: number) =>
        ball(scene, 0.16 * s, [sx, y + 0.03 * s, z + off * s], hex, [0.4, 1, 1]);
      const tip = box(scene, [0.05, 0.18 * s, 0.18 * s], [sx, y - 0.05 * s, z + 0.05 * s], hex);
      tip.rotation.x = Math.PI / 4;
      stickers.push(lobe(0), lobe(0.1), tip);
    }
    this.#solid('stickers', stickers, { cast: false, receive: false });
  }

  // ── Furniture ────────────────────────────────────────────────────────

  #bed(x: number, z: number, yaw: number, blanket: string, big = false, y = 0): void {
    const scene = this.#scene;
    const s = big ? 1.25 : 1;
    const parts = [
      box(scene, [1.5 * s, 0.32, 1.1 * s], [0, 0.16, 0], '#8a5a39'),
      box(scene, [1.42 * s, 0.14, 1.02 * s], [0, 0.38, 0], '#fff2e3'),
      box(scene, [1.42 * s, 0.1, 0.62 * s], [0, 0.48, -0.14 * s], blanket),
      ball(scene, 0.42 * s, [0, 0.5, 0.33 * s], '#ffffff', [1.6, 0.5, 0.9]),
      box(scene, [1.5 * s, 0.6, 0.12], [0, 0.3, 0.55 * s - 0.06], '#8a5a39'), // headboard
    ];
    const mesh = this.#solid('bed', parts);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
  }

  #tableLamp(x: number, z: number, y: number, shade: string): void {
    const scene = this.#scene;
    const base = this.#solid('lamp-base', [
      tube(scene, 0.06, 0.34, 0.34, [0, 0.03, 0], '#7a4a2e'),
      tube(scene, 0.55, 0.05, 0.07, [0, 0.33, 0], '#7a4a2e'),
    ]);
    base.position.set(x, y, z);
    const shadeMesh = this.#glowMesh(
      'lamp-shade',
      [tube(scene, 0.4, 0.3, 0.5, [0, 0.8, 0], shade)],
      shade,
      1.25,
    );
    shadeMesh.position.set(x, y, z);
    const bulb = this.#glowMesh(
      'lamp-bulb',
      [ball(scene, 0.14, [0, 0.62, 0], '#fff2c8')],
      '#fff2c8',
      1.6,
    );
    bulb.position.set(x, y, z);
    this.#lamp('lamp-light', new Vector3(x, y + 0.75, z), '#ffcf8a', 9, 7); // TUNE
  }

  #hearth(x: number, z: number, facing: number, wide = false): void {
    const scene = this.#scene;
    const w = wide ? 3.2 : 2.2;
    const h = wide ? 2.6 : 1.9;
    const stone = '#a79a90';
    const surround = this.#solid('hearth', [
      box(scene, [w, h, 0.55], [0, h / 2, 0], stone),
      box(scene, [w + 0.3, 0.16, 0.75], [0, h + 0.08, 0.1], '#8d5a3b'), // mantel
      box(scene, [w * 0.55, h * 0.55, 0.3], [0, h * 0.3, 0.25], '#3a2a2a'), // firebox (dark)
      box(scene, [w + 0.4, 0.08, 1.2], [0, 0.04, 0.4], '#8f8279'), // hearthstone
      (() => {
        const l = tube(scene, 0.7, 0.18, 0.18, [0, 0.12, 0.42], '#6b4a30', 7);
        l.rotation.z = Math.PI / 2;
        return l;
      })(), // logs
      (() => {
        const l = tube(scene, 0.6, 0.16, 0.16, [0.05, 0.27, 0.46], '#7a563a', 7);
        l.rotation.z = Math.PI / 2;
        l.rotation.y = 0.4;
        return l;
      })(),
    ]);
    const heart = buildHeartSeed(scene);
    heart.position.set(w * 0.3, h + 0.16, 0.1);
    heart.scaling.setAll(0.9);
    heart.parent = surround;
    // Flames: three glowing tongues, two glow tones.
    const flames = this.#glowMesh(
      'flames',
      [
        ball(scene, 0.38, [0, 0.55, 0.42], '#ffcf7a', [1, 1.7, 0.8]),
        ball(scene, 0.28, [-0.2, 0.45, 0.44], '#ffcf7a', [1, 1.4, 0.8]),
        ball(scene, 0.28, [0.2, 0.47, 0.4], '#ffcf7a', [1, 1.5, 0.8]),
      ],
      '#ffcf7a',
      1.15,
    );
    const core = this.#glowMesh(
      'flame-core',
      [ball(scene, 0.2, [0, 0.45, 0.47], '#fff6c8', [1, 1.6, 0.8])],
      '#fff6c8',
      1.5,
    );
    for (const m of [surround, flames, core]) {
      m.position.set(x, 0, z);
      m.rotation.y = facing;
    }
    // Firelight: warm, wide, breathing in the real scene (a flicker later).
    const forward = new Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.#lamp(
      'fire-light',
      new Vector3(x, 0.7, z).add(forward.scale(0.9)),
      '#ff9a4a',
      wide ? 18 : 12,
      wide ? 11 : 8,
    ); // TUNE
  }

  #rug(x: number, z: number, rx: number, rz: number, hex: string, border: string): void {
    const scene = this.#scene;
    const outer = CreateDisc('rug', { radius: 1, tessellation: 36 }, scene);
    outer.rotation.x = Math.PI / 2;
    outer.scaling.set(rx, rz, 1);
    outer.position.set(0, 0.012, 0);
    painted(outer, border);
    const inner = CreateDisc('rug', { radius: 1, tessellation: 36 }, scene);
    inner.rotation.x = Math.PI / 2;
    inner.scaling.set(rx - 0.18, rz - 0.18, 1);
    inner.position.set(0, 0.02, 0);
    painted(inner, hex);
    const mesh = this.#solid('rug', [outer, inner], { cast: false });
    mesh.position.set(x, 0, z);
  }

  #shelf(
    x: number,
    y: number,
    z: number,
    w: number,
    yaw: number,
    frames: string[],
    trophies = 0,
  ): void {
    const scene = this.#scene;
    const parts = [box(scene, [w, 0.08, 0.3], [0, 0, 0], '#8d5a3b')];
    const step = w / (frames.length + trophies + 1);
    let i = 1;
    for (const hex of frames) {
      const fx = -w / 2 + step * i++;
      parts.push(box(scene, [0.34, 0.3, 0.05], [fx, 0.2, 0], '#fff6ec'));
      parts.push(box(scene, [0.26, 0.22, 0.02], [fx, 0.2, -0.03], hex));
    }
    const mesh = this.#solid('shelf', parts);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    if (trophies > 0) {
      const cups: Mesh[] = [];
      for (let t = 0; t < trophies; t++) {
        const fx = -w / 2 + step * i++;
        cups.push(tube(scene, 0.06, 0.2, 0.22, [fx, 0.07, 0], '#e2b43c', 10));
        cups.push(tube(scene, 0.22, 0.24, 0.12, [fx, 0.22, 0], '#ffd166', 10));
      }
      const gold = this.#glowMesh('trophies', cups, '#ffd166', 0.9);
      gold.position.set(x, y, z);
      gold.rotation.y = yaw;
    }
  }

  #sign(text: string, x: number, y: number, z: number, yaw: number, width: number): void {
    const scene = this.#scene;
    const board = this.#solid(
      'sign-board',
      [
        box(scene, [width, 0.5, 0.08], [0, 0, 0], '#fff6ec'),
        box(scene, [width + 0.08, 0.58, 0.05], [0, 0, 0.02], '#8d5a3b'),
      ],
      { cast: false },
    );
    board.position.set(x, y, z);
    board.rotation.y = yaw;
    const tex = new DynamicTexture('sign-text', { width: 512, height: 128 }, scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = 'bold 72px "Nunito", "Arial Rounded MT Bold", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8d3d5a';
    ctx.fillText(text, 256, 68);
    tex.update();
    const plane = CreatePlane(
      'sign-text',
      { width: width - 0.1, height: (width - 0.1) / 4 },
      scene,
    );
    const m = new StandardMaterial('sign-text', scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.opacityTexture = tex;
    m.disableLighting = true;
    m.backFaceCulling = false;
    plane.material = m;
    plane.parent = board;
    plane.position.set(0, 0, -0.05);
  }

  #teaAndSteam(x: number, y: number, z: number): void {
    const scene = this.#scene;
    const mug = this.#solid(
      'mug',
      [
        tube(scene, 0.22, 0.2, 0.17, [0, 0.11, 0], '#ff9ab8'),
        CreateTorus('handle', { diameter: 0.16, thickness: 0.035, tessellation: 10 }, scene),
      ].map((p, i) =>
        i === 1
          ? (() => {
              p.rotation.y = Math.PI / 2;
              p.position.set(0.12, 0.11, 0);
              return painted(p, '#ff9ab8');
            })()
          : p,
      ),
    );
    mug.position.set(x, y, z);
    const steam = merged('steam', [
      ball(scene, 0.1, [0, 0.3, 0], '#ffffff'),
      ball(scene, 0.13, [0.04, 0.45, 0], '#ffffff'),
      ball(scene, 0.16, [-0.03, 0.62, 0], '#ffffff'),
    ]);
    const sm = new StandardMaterial('steam', scene);
    sm.disableLighting = true;
    sm.emissiveColor = Color3.White();
    sm.alpha = 0.22; // TUNE
    steam.material = sm;
    steam.position.set(x, y, z);
  }

  #toys(x: number, z: number): void {
    const scene = this.#scene;
    const toys = this.#solid('toys', [
      ball(scene, 0.34, [0, 0.17, 0], '#ff7aa2'), // a bouncy ball
      box(scene, [0.5, 0.08, 0.38], [0.6, 0.04, 0.1], '#8fc5ff'), // a picture book
      box(scene, [0.46, 0.03, 0.34], [0.6, 0.095, 0.1], '#fff6ec'),
      box(scene, [0.3, 0.3, 0.3], [-0.6, 0.15, 0.2], '#ffd166', 0.4), // a block
    ]);
    toys.position.set(x, 0, z);
  }

  #pumpkin(x: number, z: number, s = 1): void {
    const scene = this.#scene;
    const p = this.#solid('pumpkin', [
      ball(scene, 0.5 * s, [0, 0.22 * s, 0], '#ff9a3c', [1.1, 0.85, 1.1]),
      ball(scene, 0.5 * s, [0, 0.22 * s, 0], '#f08a2c', [0.95, 0.88, 1.15]),
      tube(scene, 0.16 * s, 0.05 * s, 0.08 * s, [0, 0.5 * s, 0], '#5f8f3a', 6),
    ]);
    p.position.set(x, 0, z);
  }

  #string(from: Vector3, to: Vector3, sag: number, bulbs: number, hex: string): void {
    const scene = this.#scene;
    const cord: Mesh[] = [];
    const glows: Mesh[] = [];
    const segs = 14;
    let prev = from.clone();
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const p = Vector3.Lerp(from, to, t);
      p.y -= 4 * sag * t * (1 - t);
      const mid = Vector3.Center(prev, p);
      const len = Vector3.Distance(prev, p);
      const c = CreateCylinder('cord', { height: len, diameter: 0.025, tessellation: 4 }, scene);
      c.position.copyFrom(mid);
      const dir = p.subtract(prev).normalize();
      c.rotation.z = -Math.atan2(dir.x, dir.y);
      c.rotation.x = Math.atan2(dir.z, Math.sqrt(dir.x * dir.x + dir.y * dir.y));
      cord.push(painted(c, '#5a3f2c'));
      prev = p;
    }
    for (let i = 0; i < bulbs; i++) {
      const t = (i + 0.5) / bulbs;
      const p = Vector3.Lerp(from, to, t);
      p.y -= 4 * sag * t * (1 - t) + 0.12;
      glows.push(ball(scene, 0.16, [p.x, p.y, p.z], hex, [1, 1.25, 1]));
    }
    this.#solid('garland-cord', cord, { cast: false, receive: false });
    this.#glowMesh('garland-bulbs', glows, hex, 1.5);
  }

  // ── The Snug (level 1) ───────────────────────────────────────────────

  #furnishSnug(spec: RoomSpec): void {
    const { w, d } = spec;
    const scene = this.#scene;
    this.#rug(0.2, 0.3, 2.3, 1.7, '#e97a9b', '#fff0e6');
    // The hearth on the left wall, facing into the room (+x).
    this.#hearth(-w / 2 + 0.28, 0.6, Math.PI / 2);
    // Two beds against the back wall, either side of the window light.
    this.#bed(-2.6, d / 2 - 0.85, 0, '#9fd0ff');
    this.#bed(2.4, d / 2 - 0.85, 0, '#c9a0ff');
    // The Keeper's corner, front-right: a little table, tea, and a lamp.
    const table = this.#solid('table', [
      tube(scene, 0.08, 1.0, 1.0, [0, 0.62, 0], '#a06a44', 16),
      tube(scene, 0.6, 0.1, 0.16, [0, 0.3, 0], '#8a5a39', 8),
      tube(scene, 0.06, 0.5, 0.5, [0, 0.03, 0], '#8a5a39', 12),
    ]);
    table.position.set(2.7, 0, -1.3);
    this.#teaAndSteam(2.5, 0.66, -1.1);
    this.#tableLamp(3.05, -1.5, 0.66, '#ffd9a8');
    const stool = this.#solid('stool', [
      tube(scene, 0.08, 0.5, 0.5, [0, 0.4, 0], '#e97a9b', 12),
      tube(scene, 0.36, 0.08, 0.12, [0, 0.18, 0], '#8a5a39', 8),
    ]);
    stool.position.set(2.0, 0, -2.1);
    // Memories shelf on the back wall, right of the window; a trophy on it.
    this.#shelf(2.5, 2.6, d / 2 - 0.17, 1.8, 0, ['#ffb3c8', '#bfe3ff', '#ffe29a'], 1);
    // The name sign over the window.
    this.#sign('Mia’s Nook', -0.2, 3.65, d / 2 - 0.1, 0, 2.2);
    // A little gift a resident left overnight (a daily return reason).
    const gift = this.#solid('gift', [
      box(scene, [0.36, 0.3, 0.36], [0, 0.15, 0], '#9ad8ff'),
      box(scene, [0.38, 0.32, 0.08], [0, 0.15, 0], '#ff7aa2'),
      box(scene, [0.08, 0.32, 0.38], [0, 0.15, 0], '#ff7aa2'),
      ball(scene, 0.16, [-0.07, 0.36, 0], '#ff7aa2', [1.2, 0.7, 0.8]),
      ball(scene, 0.16, [0.07, 0.36, 0], '#ff7aa2', [1.2, 0.7, 0.8]),
    ]);
    gift.position.set(1.4, 0, d / 2 - 1.9);
    gift.rotation.y = 0.5;
    // Toys on the rug, a pumpkin by the door (it's October).
    this.#toys(-0.6, -1.4);
    this.#pumpkin(w / 2 - 0.9, -2.4, 0.9);
    // A plant in the far corner.
    const plant = this.#solid('plant', [
      tube(scene, 0.4, 0.42, 0.3, [0, 0.2, 0], '#d9a26b', 10),
      ball(scene, 0.7, [0, 0.72, 0], '#5fa85a', [1, 1.1, 1]),
      ball(scene, 0.5, [0.25, 0.9, 0.1], '#7cc46f'),
      ball(scene, 0.45, [-0.22, 0.95, -0.1], '#6db863'),
    ]);
    plant.position.set(-w / 2 + 0.75, 0, d / 2 - 0.7);

    // Residents and the Keeper.
    // Puddlepuff napping in the left bed, squashed into the pillow.
    this.#squishies.add(species('puddlepuff'), 'resident-1', {
      x: -2.6,
      z: d / 2 - 0.95,
      y: 0.46,
      yaw: 0.3,
      scale: 0.75,
      squash: 0.8,
      shadow: 0.6,
      shadowAlpha: 0.35,
    });
    // Flurrypup hopping at the window, excited (the favourite).
    this.#squishies.add(species('flurrypup'), 'resident-2', {
      x: 0.9,
      z: 0.6,
      y: 0,
      yaw: -0.5,
      scale: 0.8,
      lift: 0.25,
      shadowAlpha: 0.6,
    });
    // Emberbun curled up by the fire.
    this.#squishies.add(species('emberbun'), 'resident-3', {
      x: -2.2,
      z: -1.5,
      y: 0,
      yaw: Math.PI / 2,
      scale: 0.75,
      squash: 0.92,
    });
    const base = KEEPER_DATA.bases[0];
    if (!base) throw new Error('no keeper base');
    this.#keepers.add(miaConfig(base), {
      x: 0.9,
      z: -1.8,
      yaw: 0.7,
      scale: 0.75,
      lean: 0.05,
    });
  }

  // ── The Heart Hall (level 4, the final level) ────────────────────────

  #furnishHall(spec: RoomSpec): void {
    const { w, d, h } = spec;
    const scene = this.#scene;
    this.#rug(0, -0.2, 3.6, 2.6, '#f2a0bd', '#ffe7c2');
    // A grand hearth on the left wall.
    this.#hearth(-w / 2 + 0.28, 1.2, Math.PI / 2, true);
    // The heart-tree, grown through the hall floor, under a ring of lanterns.
    const tree = buildTree(scene, 'oak');
    tree.position.set(-1.2, 0, d / 2 - 2.4);
    tree.scaling.setAll(1.3);
    tree.material = this.#vinyl;
    blushCanopy(tree, 1.1, '#ff9ec4', '#ffd4e4'); // the Heart Tree: a pink canopy
    if (this.#shadows) this.#shadows.addShadowCaster(tree);
    const seed = buildHeartSeed(scene);
    seed.position.set(-1.2, 4.15, d / 2 - 2.4);
    seed.scaling.setAll(2.0);
    this.#lamp('tree-light', new Vector3(-1.2, 3.9, d / 2 - 2.4), '#ffb6d0', 16, 10); // TUNE
    // Lantern garlands from the beams.
    this.#string(
      new Vector3(-w / 2 + 0.5, h - 0.3, 3.0),
      new Vector3(w / 2 - 0.5, h - 0.3, 3.0),
      0.45,
      9,
      '#ff9ab8',
    );
    // A gallery along the right wall, above the door, with stairs at the back.
    const gy = 2.6;
    const gw = 2.6;
    const gx = w / 2 - gw / 2;
    this.#solid('gallery', [
      box(scene, [gw, 0.25, d - 3.0], [gx, gy, 1.5], '#9a6a46'),
      ...Array.from({ length: 13 }, (_, i) =>
        box(
          scene,
          [0.08, 0.8, 0.08],
          [gx - gw / 2, gy + 0.52, 1.5 - (d - 3.2) / 2 + i * ((d - 3.2) / 12)],
          '#d9a441',
        ),
      ),
      box(scene, [0.1, 0.1, d - 3.0], [gx - gw / 2, gy + 0.92, 1.5], '#d9a441'),
      ...Array.from({ length: 8 }, (_, i) =>
        box(
          scene,
          [0.5, 0.25, 1.0],
          [gx - gw / 2 - 2.2 + i * 0.5, 0.125 + i * 0.4, d / 2 - 0.6],
          '#9a6a46',
        ),
      ),
    ]);
    // Four beds: two on the balcony, two below, with golden blankets.
    this.#bed(-4.6, d / 2 - 1.2, 0, '#ffd166', true);
    this.#bed(2.6, d / 2 - 1.2, 0, '#c9a0ff', true);
    this.#bed(w / 2 - 1.3, 1.6, -Math.PI / 2, '#ffb3c8', true, 2.72);
    this.#bed(-5.2, -2.2, Math.PI / 2, '#9fd0ff', true);
    // The Keeper's corner: an alcove on the right with a table, tea and lamps.
    const table = this.#solid('table', [
      tube(scene, 0.1, 1.5, 1.5, [0, 0.66, 0], '#a06a44', 20),
      tube(scene, 0.64, 0.14, 0.24, [0, 0.32, 0], '#8a5a39', 8),
      tube(scene, 0.08, 0.8, 0.8, [0, 0.04, 0], '#8a5a39', 12),
    ]);
    table.position.set(3.9, 0, -2.4);
    this.#teaAndSteam(3.6, 0.7, -2.1);
    this.#tableLamp(4.5, -2.7, 0.7, '#ffd9a8');
    this.#tableLamp(-4.2, 0.4, 0.0, '#ffb3c8');
    // The trophy shelf and the memories wall.
    this.#shelf(
      -3.6,
      2.2,
      -d / 2 + 0.2,
      2.6,
      Math.PI,
      ['#ffb3c8', '#bfe3ff', '#ffe29a', '#c9ffd0'],
      3,
    );
    this.#shelf(-w / 2 + 0.2, 2.0, -2.2, 2.4, Math.PI / 2, ['#ffb3c8', '#bfe3ff'], 2);
    this.#sign('Mia’s Heart Hall', -0.2, 5.02, d / 2 - 0.1, 0, 3.4);
    this.#toys(-1.6, -2.4);
    this.#pumpkin(w / 2 - 1.2, -3.8, 1.1);
    this.#pumpkin(w / 2 - 1.9, -3.5, 0.8);
    // Gold trim: the final level looks the part.
    this.#glowMesh(
      'gold-trim',
      [
        box(scene, [w, 0.06, 0.08], [0, 0.26, d / 2 - 0.04], '#ffd166'),
        box(scene, [0.08, 0.06, d], [-w / 2 + 0.04, 0.26, 0], '#ffd166'),
        box(scene, [0.08, 0.06, d], [w / 2 - 0.04, 0.26, 0], '#ffd166'),
      ],
      '#ffd166',
      0.8,
    );

    // Residents: a full house.
    const r = (id: string, n: number, p: Parameters<SquishyField['add']>[2]) =>
      this.#squishies.add(species(id), `resident-${String(n)}`, p);
    r('puddlepuff', 1, {
      x: -4.6,
      z: d / 2 - 1.2,
      y: 0.46,
      yaw: 0.2,
      scale: 0.9,
      squash: 0.8,
      shadowAlpha: 0.3,
    });
    r('flurrypup', 2, {
      x: 1.4,
      z: -0.6,
      y: 0,
      yaw: -0.4,
      scale: 0.95,
      lift: 0.3,
      shadowAlpha: 0.6,
    });
    r('emberbun', 3, { x: -3.6, z: 0.4, y: 0, yaw: 2.0, scale: 0.9, squash: 0.93 });
    r('pebblesnooze', 4, {
      x: 2.6,
      z: d / 2 - 1.3,
      y: 0.46,
      yaw: -0.2,
      scale: 0.9,
      squash: 0.85,
      shadowAlpha: 0.3,
    });
    r('thistlepip', 5, { x: -1.2, z: 0.9, y: 0, yaw: 0.6, scale: 0.9 });
    r('glowgourd', 6, { x: 0.6, z: 2.6, y: 0, yaw: 0.1, scale: 0.9 });
    r('candlekit', 7, {
      x: w / 2 - 1.3,
      z: 1.5,
      y: 3.18,
      yaw: -1.4,
      scale: 0.9,
      squash: 0.85,
      shadowAlpha: 0.3,
    });
    r('gourdon', 8, { x: 2.6, z: 1.4, y: 0, yaw: -1.2, scale: 0.95, squash: 0.96 });
    const base = KEEPER_DATA.bases[0];
    if (!base) throw new Error('no keeper base');
    this.#keepers.add(miaConfig(base), {
      x: 1.7,
      z: -2.7,
      yaw: 1.0,
      scale: 0.9,
      lean: 0.05,
    });
  }

  dispose(): void {
    this.#squishies.dispose();
    this.#keepers.dispose();
    this.#instrumentation.dispose();
  }
}
