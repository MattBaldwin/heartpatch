import { Constants } from '@babylonjs/core/Engines/constants';
import { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Bulb } from './bulb-layout.js';
import { CHRISTMAS } from './map-config.js';
import type { TerrainClock } from './terrain-plugin.js';

// Twinkle Lights' bulbs on the map (#37 2a), cloned from `FenceField`: one
// mesh, a thin instance per bulb (a quad, 2 triangles), so every bulb on the
// patch is one draw call. The quad turns to face the camera on the GPU and
// draws a round glass bulb with its glow baked in (a soft halo), so it reads
// as a light with no bloom (phones at medium and low tier have none). Lit at
// night, coloured glass by day; at night each bulb twinkles on a sine of the
// map's one terrain clock (no per-frame JS), and stands steady under reduced
// motion or with ambient life off. Depth-tested, so a house hides the bulbs
// behind it; it writes no depth, so its halo never cuts a hole in the snow.
// GLSL only, like terrain-plugin.ts: under the opt-in WebGPU renderer the
// bulbs aren't drawn (the Twinkle Lights' post still stands).

const B = CHRISTMAS.bulbs;

/** A GLSL float literal (`1` would be an int there). */
const f = (n: number) => (Number.isInteger(n) ? `${String(n)}.0` : String(n));

/** What the bulbs show now: lit (night) or glass (day), and how far they twinkle (0: steady). */
export class BulbLight {
  lit = 0;
  twinkle = 0;
}

const VERTEX_DEFINITIONS = /* glsl */ `
varying vec2 vBulbUv;
varying float vBulbGlow;
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
varying vec2 vBulbUv;
varying float vBulbGlow;
`;

// The quad faces the camera: its corners spread along the view's right and
// up from the instance's middle. Each bulb's phase comes from where it
// hangs, so no per-bulb attribute is needed for the twinkle.
const VERTEX_WORLDPOS = /* glsl */ `
{
  vec3 bulbMid = finalWorld[3].xyz;
  float bulbSize = length(finalWorld[0].xyz);
  vec3 bulbRight = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 bulbUp = vec3(view[0][1], view[1][1], view[2][1]);
  worldPos = vec4(bulbMid + (bulbRight * positionUpdated.x + bulbUp * positionUpdated.y) * bulbSize, 1.0);
  vPositionW = worldPos.xyz;
  vBulbUv = positionUpdated.xy;
  float bulbPhase = fract(sin(dot(bulbMid.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  vBulbGlow = 1.0 - bulbLight.y * (0.5 + 0.5 * sin(bulbTime * ${f(B.twinkle.speed)} + bulbPhase));
}
`;

// The glass is a disc of `core` radius; lit, its middle runs white-hot and a
// halo fades out to the quad's edge; unlit, it's darker coloured glass with
// a small shine and no halo. `color` already holds the instance colour.
const FRAGMENT_BEFORE_FRAGCOLOR = /* glsl */ `
{
  float bulbD = length(vBulbUv);
  float bulbAa = 0.02;
  float bulbCore = 1.0 - smoothstep(${f(B.core)} - bulbAa, ${f(B.core)} + bulbAa, bulbD);
  vec3 bulbTint = color.rgb;
  float bulbLit = bulbLight.x;
  float bulbGlow = mix(1.0, vBulbGlow, bulbLit);
  // Lit: the glass bright with a white-hot middle; the halo round it.
  float bulbHotK = (1.0 - smoothstep(0.0, ${f(B.core)}, bulbD)) * ${f(B.hot)} * bulbGlow;
  vec3 bulbOn = mix(bulbTint, vec3(1.0), bulbHotK) * (0.75 + 0.25 * bulbGlow);
  float bulbHalo = pow(max(0.0, 1.0 - bulbD / 0.5), 1.6) * ${f(B.halo)} * bulbGlow;
  // Unlit: darker glass with a little shine up and to the left.
  float bulbShine = 1.0 - smoothstep(0.0, ${f(B.core * 0.45)}, length(vBulbUv - vec2(-0.04, 0.05)));
  // …and a pale rim, so it reads as glass, not a bead.
  float bulbRim = smoothstep(${f(B.core * 0.55)}, ${f(B.core)}, bulbD) * 0.35;
  vec3 bulbOff = mix(bulbTint * ${f(B.glass)}, vec3(1.0), max(bulbShine * 0.7, bulbRim));
  vec3 bulbRgb = mix(bulbOff, bulbOn, bulbLit);
  float bulbAlpha = max(bulbCore, bulbHalo * bulbLit);
  // The halo is the bulb's own colour, so a warm white glows warm, a red glows red.
  color = vec4(mix(bulbTint, bulbRgb, bulbCore), bulbAlpha);
  if (color.a < 0.01) discard;
}
`;

class BulbPlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;
  private readonly light: BulbLight;

  constructor(material: Material, clock: TerrainClock, light: BulbLight) {
    super(material, 'Bulb', 220, { BULB: false });
    this.clock = clock;
    this.light = light;
    this._enable(true);
  }

  override getClassName(): string {
    return 'BulbPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines['BULB'] = true;
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'bulbTime', size: 1, type: 'float' },
        { name: 'bulbLight', size: 2, type: 'vec2' },
      ],
      vertex: 'uniform float bulbTime;\nuniform vec2 bulbLight;',
      fragment: 'uniform vec2 bulbLight;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('bulbTime', this.clock.time);
    uniformBuffer.updateFloat2('bulbLight', this.light.lit, this.light.twinkle * this.light.lit);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: VERTEX_WORLDPOS,
      };
    }
    if (shaderType === 'fragment') {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
        CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: FRAGMENT_BEFORE_FRAGCOLOR,
      };
    }
    return null;
  }
}

/** One quad, ±0.5 across in x and y (the shader turns it to the camera). */
function bulbQuad(scene: Scene): Mesh {
  const mesh = new Mesh('twinkle-bulbs', scene);
  const data = new VertexData();
  data.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  data.indices = [0, 1, 2, 0, 2, 3];
  data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  data.applyToMesh(mesh, false);
  mesh.isPickable = false;
  // Its bounds are a 1-unit quad at the origin: the bulbs are all over the map.
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/**
 * The patch's Twinkle Lights bulbs (#37 2a): `set` redraws them all from the
 * latest layout; `setLight` switches night and the twinkle (uniforms, and
 * the glass colours once at the switch: nothing recompiles, no per-frame JS).
 */
export class BulbField {
  private readonly mesh: Mesh;
  private readonly light = new BulbLight();
  /** Lit colours at night, unlit glass by day (`glassColors`), linear. */
  private readonly colors = B.colors.map((hex) => Color3.FromHexString(hex).toLinearSpace());
  private readonly glass = B.glassColors.map((hex) => Color3.FromHexString(hex).toLinearSpace());
  private shown: readonly Bulb[] = [];
  /** False under WebGPU: the bulb plugin is GLSL only, so nothing is drawn there. */
  private readonly drawable: boolean;
  private drawn = 0;

  constructor(scene: Scene, clock: TerrainClock) {
    this.mesh = bulbQuad(scene);
    const m = new StandardMaterial('twinkle-bulb-mat', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = Color3.White(); // the instance colour tints it
    m.backFaceCulling = false;
    m.transparencyMode = Material.MATERIAL_ALPHABLEND;
    m.alphaMode = Constants.ALPHA_COMBINE;
    m.disableDepthWrite = true;
    this.drawable = m.shaderLanguage === ShaderLanguage.GLSL;
    if (this.drawable) new BulbPlugin(m, clock, this.light);
    this.mesh.material = m;
    this.mesh.setEnabled(false);
  }

  /** How many bulbs are drawn. */
  get count(): number {
    return this.drawn;
  }

  /** Lit now (night in December), and twinkling (ambient life live). */
  get state(): { readonly lit: boolean; readonly twinkle: boolean } {
    return { lit: this.light.lit > 0, twinkle: this.light.lit > 0 && this.light.twinkle > 0 };
  }

  setLight(lit: boolean, twinkle: boolean): void {
    const was = this.light.lit;
    this.light.lit = lit ? 1 : 0;
    this.light.twinkle = twinkle ? B.twinkle.amount : 0;
    // Day and night colour the glass differently: one buffer write at the switch.
    if (was !== this.light.lit && this.shown.length > 0) this.paint();
  }

  /** Each bulb's colour for now: lit, or unlit glass. */
  private paint(): void {
    const palette = this.light.lit > 0 ? this.colors : this.glass;
    const colors = new Float32Array(this.shown.length * 4);
    this.shown.forEach((b, i) => {
      const c = palette[b.color] ?? palette[0];
      colors.set([c?.r ?? 1, c?.g ?? 1, c?.b ?? 1, 1], i * 4);
    });
    this.mesh.thinInstanceSetBuffer('color', colors, 4, false);
  }

  set(bulbs: readonly Bulb[]): void {
    const shown = this.drawable ? bulbs : [];
    this.shown = shown;
    this.drawn = shown.length;
    if (shown.length === 0) {
      // Hidden by disabling, never by a count of 0 (`MapAmbient.set`).
      this.mesh.setEnabled(false);
      return;
    }
    const matrices = new Float32Array(shown.length * 16);
    const m = new Matrix();
    shown.forEach((b, i) => {
      const size = B.size * (b.scale ?? 1);
      Matrix.ScalingToRef(size, size, size, m);
      m.setTranslationFromFloats(b.x, b.y, b.z);
      m.copyToArray(matrices, i * 16);
    });
    this.mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    this.paint();
    this.mesh.setEnabled(true);
  }

  dispose(): void {
    this.mesh.dispose(false, true);
  }
}
