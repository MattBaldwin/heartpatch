import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { CHRISTMAS } from './map-config.js';
import type { TerrainClock } from './terrain-plugin.js';
import { ornamentLayout, type Ornament } from './tree-layout.js';

// The Patch Tree on the map (#37 2d): a vinyl-toy fir in a red tub, its
// ornaments and its star all in one mesh with one material, so the whole
// tree is one draw call (plan §1). Every vertex carries a glow code (`treeGlow`:
// 0 the body, 1–1.4 an ornament and its twinkle phase, 2 the star); a small
// GLSL plugin on the vinyl material adds each glowing part's own colour back
// after lighting, so ornaments read as lit bulbs on a December night and the
// star shines once it's lit, with no bloom (phones at medium and low tier
// have none). Lit ornaments twinkle on the map's one terrain clock (no
// per-frame JS) and stand steady under reduced motion or with ambient life
// off, as the Twinkle Lights do (#909). The mesh is rebuilt only when what
// it shows changes (a gift hangs an ornament, the star lights). Under the
// opt-in WebGPU renderer the plugin isn't attached: the tree still stands,
// unlit.

const T = CHRISTMAS.tree;

export const GLOW_ATTRIBUTE = 'treeGlow';

/** A GLSL float literal (`1` would be an int there). */
const f = (n: number) => (Number.isInteger(n) ? `${String(n)}.0` : String(n));

/** What the tree's glow shows now: ornaments lit, the star's glow, the twinkle (0: steady). */
class TreeLight {
  ornaments = 0;
  star = 0;
  twinkle = 0;
}

const VERTEX_DEFINITIONS = /* glsl */ `
attribute float treeGlow;
varying float vTreeGlow;
`;

const VERTEX_MAIN_END = /* glsl */ `
vTreeGlow = treeGlow;
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
varying float vTreeGlow;
`;

// After lighting: a glowing part gets its own colour back, scaled. An
// ornament's code carries its twinkle phase (1.0–1.4); the star's is 2.
const FRAGMENT_BEFORE_FOG = /* glsl */ `
{
  float tg = vTreeGlow;
  float tOrn = step(0.5, tg) * (1.0 - step(1.7, tg));
  float tStar = step(1.7, tg);
  float tPhase = (tg - 1.0) * 2.5 * 6.2831853;
  float tTw = 1.0 - treeLight.z * (0.5 + 0.5 * sin(treeTime * ${f(T.twinkle.speed)} + tPhase));
  finalColor.rgb += surfaceAlbedo * (tOrn * treeLight.x * tTw + tStar * treeLight.y);
}
`;

class TreePlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;
  private readonly light: TreeLight;

  constructor(material: Material, clock: TerrainClock, light: TreeLight) {
    super(material, 'Tree', 230, { TREE_GLOW: false });
    this.clock = clock;
    this.light = light;
    this._enable(true);
  }

  override getClassName(): string {
    return 'TreePlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['TREE_GLOW'] = true;
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(GLOW_ATTRIBUTE)) attributes.push(GLOW_ATTRIBUTE);
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'treeTime', size: 1, type: 'float' },
        { name: 'treeLight', size: 3, type: 'vec3' },
      ],
      vertex: '',
      fragment: 'uniform float treeTime;\nuniform vec3 treeLight;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('treeTime', this.clock.time);
    uniformBuffer.updateFloat3(
      'treeLight',
      this.light.ornaments,
      this.light.star,
      this.light.twinkle,
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_MAIN_END: VERTEX_MAIN_END,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_BEFORE_FOG,
      };
    }
    return null;
  }
}

/** Where the tree stands and what it shows. */
export interface TreePlacement {
  readonly x: number;
  /** Ground height. */
  readonly y: number;
  readonly z: number;
  readonly ornaments: number;
  readonly starLit: boolean;
}

/** One part of the model and its glow code. */
interface Part {
  readonly mesh: Mesh;
  readonly glow: number;
}

/** Paints every vertex of `mesh` one sRGB colour (vertex colours multiply the white vinyl). */
function paint(mesh: Mesh, hex: string): Mesh {
  const c = Color3.FromHexString(hex).toLinearSpace();
  const n = mesh.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/** A five-pointed star prism facing the camera (−z), centred on its middle. */
function starMesh(scene: Scene): Mesh {
  const { radius, depth } = T.star;
  const inner = radius * 0.45;
  const ring: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : inner;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  const half = depth / 2;
  // Front (−z) and back faces: a fan round the middle.
  for (const z of [-half, half]) {
    const base = positions.length / 3;
    positions.push(0, 0, z);
    for (const [x, y] of ring) positions.push(x, y, z);
    for (let i = 0; i < 10; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % 10);
      if (z < 0) indices.push(base, b, a);
      else indices.push(base, a, b);
    }
  }
  // The sides, each edge its own quad so its normal is flat.
  for (let i = 0; i < 10; i++) {
    const [x0, y0] = ring[i] ?? [0, 0];
    const [x1, y1] = ring[(i + 1) % 10] ?? [0, 0];
    const base = positions.length / 3;
    positions.push(x0, y0, -half, x1, y1, -half, x1, y1, half, x0, y0, half);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
  const mesh = new Mesh('patch-tree-star', scene);
  data.applyToMesh(mesh);
  return mesh;
}

/** The tree's parts, its foot at the origin, before they're merged into one mesh. */
function treeParts(scene: Scene, ornaments: readonly Ornament[], starLit: boolean): Part[] {
  const parts: Part[] = [];
  const add = (mesh: Mesh, hex: string, glow = 0) => parts.push({ mesh: paint(mesh, hex), glow });
  const tub = CreateCylinder(
    'patch-tree-tub',
    {
      height: T.tub.height,
      diameterTop: T.tub.radius * 2,
      diameterBottom: T.tub.radius * 1.7,
      tessellation: 14,
    },
    scene,
  );
  tub.position.y = T.tub.height / 2;
  add(tub, T.tub.color);
  const trunk = CreateCylinder(
    'patch-tree-trunk',
    { height: T.trunk.height, diameter: T.trunk.radius * 2, tessellation: 8 },
    scene,
  );
  trunk.position.y = T.tub.height + T.trunk.height / 2 - 0.01;
  add(trunk, T.trunk.color);
  T.tiers.forEach((tier, i) => {
    const cone = CreateCylinder(
      'patch-tree-tier',
      { height: tier.height, diameterTop: 0, diameterBottom: tier.radius * 2, tessellation: 16 },
      scene,
    );
    cone.position.y = tier.y + tier.height / 2;
    add(cone, T.greens[i % T.greens.length] ?? '#3f9a5c');
  });
  for (const o of ornaments) {
    const ball = CreateSphere(
      'patch-tree-ornament',
      { diameter: T.ornamentRadius * 2, segments: 4 },
      scene,
    );
    ball.position.set(o.x, o.y, o.z);
    add(ball, T.ornamentColors[o.color] ?? '#ff5d52', 1 + 0.4 * o.phase);
  }
  const star = starMesh(scene);
  star.position.y = T.star.y;
  add(star, starLit ? T.star.lit : T.star.unlit, 2);
  return parts;
}

/**
 * The Patch Tree (#37 2d): `set` puts it at its post with this many
 * ornaments (none: a bare tree) and the star lit or not, or takes it away
 * (`null`, not planted yet); `setLight` switches night and the twinkle
 * (uniforms only: nothing recompiles or rebuilds).
 */
export class TreeField {
  private readonly scene: Scene;
  private readonly material: PBRMaterial;
  private readonly light = new TreeLight();
  private mesh: Mesh | null = null;
  /** What the mesh shows: ornaments drawn and the star, so an unchanged tree isn't rebuilt. */
  private built: { ornaments: number; starLit: boolean } | null = null;
  private placed: TreePlacement | null = null;
  private lit = false;
  private twinkling = false;
  /** False under WebGPU: the glow plugin is GLSL only. */
  private readonly glows: boolean;

  constructor(scene: Scene, clock: TerrainClock) {
    this.scene = scene;
    const m = new PBRMaterial('patch-tree-vinyl', scene);
    m.albedoColor = Color3.White(); // vertex colours multiply this
    m.metallic = 0;
    m.roughness = 0.45; // TUNE: same soft vinyl as the buildings
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 0.8;
    m.clearCoat.roughness = 0.2;
    this.glows = m.shaderLanguage === ShaderLanguage.GLSL;
    if (this.glows) new TreePlugin(m, clock, this.light);
    this.material = m;
  }

  /** The tree as drawn now, or null with none. */
  get state(): {
    readonly ornaments: number;
    readonly starLit: boolean;
    readonly lit: boolean;
    readonly twinkle: boolean;
  } | null {
    if (!this.placed || !this.built) return null;
    return {
      ornaments: this.built.ornaments,
      starLit: this.built.starLit,
      lit: this.lit,
      twinkle: this.lit && this.twinkling,
    };
  }

  /** Night (ornaments lit) and whether they twinkle (ambient life live). */
  setLight(lit: boolean, twinkle: boolean): void {
    this.lit = lit;
    this.twinkling = twinkle;
    this.applyLight();
  }

  private applyLight(): void {
    const starLit = this.built?.starLit === true;
    this.light.ornaments = this.lit ? T.glow.ornament : 0;
    this.light.star = starLit ? (this.lit ? T.glow.star : T.glow.dayStar) : 0;
    this.light.twinkle = this.lit && this.twinkling ? T.twinkle.amount : 0;
  }

  set(tree: TreePlacement | null): void {
    this.placed = tree;
    if (!tree) {
      this.mesh?.setEnabled(false);
      return;
    }
    const ornaments = ornamentLayout(tree.ornaments);
    const want = { ornaments: ornaments.length, starLit: tree.starLit };
    if (
      !this.mesh ||
      this.built?.ornaments !== want.ornaments ||
      this.built.starLit !== want.starLit
    ) {
      this.mesh?.dispose(false, false);
      this.mesh = this.build(ornaments, tree.starLit);
      this.built = want;
      this.applyLight();
    }
    this.mesh.position.set(tree.x, tree.y, tree.z);
    this.mesh.computeWorldMatrix(true);
    this.mesh.setEnabled(true);
  }

  private build(ornaments: readonly Ornament[], starLit: boolean): Mesh {
    const parts = treeParts(this.scene, ornaments, starLit);
    const glow: number[] = [];
    for (const p of parts) {
      const n = p.mesh.getTotalVertices();
      for (let i = 0; i < n; i++) glow.push(p.glow);
    }
    const mesh = Mesh.MergeMeshes(
      parts.map((p) => p.mesh),
      true,
      true,
    );
    if (!mesh) throw new Error('could not build the Patch Tree');
    mesh.name = 'patch-tree';
    mesh.setVerticesData(GLOW_ATTRIBUTE, new Float32Array(glow), false, 1);
    mesh.material = this.material;
    mesh.isPickable = false;
    return mesh;
  }

  /**
   * The drawn tree's box on screen (CSS px), or null with none or out of
   * view: for the e2e test that it never covers a label.
   */
  screenRect(): { x: number; y: number; width: number; height: number } | null {
    const mesh = this.mesh;
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!mesh || !this.placed || !mesh.isEnabled() || !camera || !canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const viewport = camera.viewport.toGlobal(box.width, box.height);
    const transform = camera.getTransformationMatrix();
    mesh.computeWorldMatrix(true);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      const s = Vector3.Project(corner, Matrix.IdentityReadOnly, transform, viewport);
      if (s.z < 0 || s.z > 1) return null;
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x);
      y1 = Math.max(y1, s.y);
    }
    return { x: box.left + x0, y: box.top + y0, width: x1 - x0, height: y1 - y0 };
  }

  dispose(): void {
    this.mesh?.dispose(false, false);
    this.material.dispose();
  }
}
