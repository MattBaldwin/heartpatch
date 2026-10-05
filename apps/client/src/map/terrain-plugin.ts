import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import { DRIFT_MODE } from './ambient-layout.js';
import { AMBIENT, MUTED } from './map-config.js';

/**
 * Ambient life for the map's terrain (the terrain visual pass), all on the
 * GPU from one time uniform, so the CPU does nothing per frame:
 *
 * - Props (`terrainAmbient` per thin instance: sway, phase, muted, bob): tops
 *   sway in a soft breeze (the higher the vertex, the more), lily pads bob
 *   with the water, and props on wild land are drawn muted, like their tile.
 * - Water (`water` option, the lake tiles): the top bobs in slow waves and
 *   soft glints drift across it.
 * - Motes (`terrainDrift` per thin instance: mode, phase, range, speed):
 *   pollen and sparkles wander, leaves tumble down, fireflies blink, bats
 *   circle and flap, fog and clouds float (`DRIFT_MODE`).
 *
 * GLSL only, like squish-plugin.ts: under the opt-in WebGPU renderer the
 * plugin isn't attached, so props stand still in full colour and the motes
 * aren't drawn (the tiles are still muted, that's CPU-side).
 */

export const AMBIENT_ATTRIBUTE = 'terrainAmbient';
export const DRIFT_ATTRIBUTE = 'terrainDrift';

/** The one clock every terrain material reads: seconds of ambient time. */
export class TerrainClock {
  time = 0;
}

const num = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

const VERTEX_DEFINITIONS = /* glsl */ `
#ifdef TERRAIN_SWAY
attribute vec4 terrainAmbient;
varying float vTerrainMute;
#endif
#ifdef TERRAIN_DRIFT
attribute vec4 terrainDrift;
#endif
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
#ifdef TERRAIN_SWAY
varying float vTerrainMute;
#endif
`;

// Water and lily pads share one wave, a function of world position, so pads ride the water.
const WAVE = (pos: string) => `sin(terrainTime * 0.9 + ${pos}.x * 1.7 + ${pos}.z * 1.3)`;

const VERTEX_WORLDPOS = /* glsl */ `
#ifdef TERRAIN_SWAY
{
  float tsH = max(positionUpdated.y, 0.0);
  float tsK = terrainAmbient.x * tsH * tsH;
  float tsP = terrainAmbient.y;
  vec2 tsWave = vec2(
    sin(terrainTime * 1.3 + tsP) + 0.35 * sin(terrainTime * 2.9 + tsP * 1.7),
    0.6 * cos(terrainTime * 1.1 + tsP * 1.3)
  );
  worldPos.xz += tsK * tsWave;
  worldPos.y += terrainAmbient.w * terrainWater.x * ${WAVE('worldPos')};
  vTerrainMute = terrainAmbient.z;
  vPositionW = worldPos.xyz;
}
#endif
#ifdef TERRAIN_WATER
{
  // Only the top moves; the side wall's foot stays on the island.
  float twTop = step(0.05, positionUpdated.y);
  worldPos.y += twTop * terrainWater.x * ${WAVE('worldPos')};
  vPositionW = worldPos.xyz;
}
#endif
#ifdef TERRAIN_DRIFT
{
  float tdMode = terrainDrift.x;
  float tdR = terrainDrift.z;
  float tdT = terrainTime * terrainDrift.w + terrainDrift.y;
  vec3 tdLocal = positionUpdated;
  vec3 tdOff = vec3(0.0);
  float tdScale = 1.0;
  if (tdMode < ${num(DRIFT_MODE.wander)} + 0.5) {
    tdOff = tdR * vec3(sin(tdT * 0.7), 0.5 * sin(tdT * 1.13 + 1.7), cos(tdT * 0.91 + 0.4));
    tdScale = 0.75 + 0.25 * sin(tdT * 2.3);
  } else if (tdMode < ${num(DRIFT_MODE.fall)} + 0.5) {
    // Down from the top of the range, tumbling, fading in and out by size.
    float tdF = fract(tdT * 0.1);
    tdOff = vec3(0.18 * sin(tdT * 1.7), -tdR * tdF, 0.12 * cos(tdT * 1.3));
    float tdC = cos(tdT * 2.0);
    float tdS = sin(tdT * 2.0);
    tdLocal.xy = vec2(tdC * tdLocal.x - tdS * tdLocal.y, tdS * tdLocal.x + tdC * tdLocal.y);
    tdScale = sin(3.14159265 * tdF);
  } else if (tdMode < ${num(DRIFT_MODE.firefly)} + 0.5) {
    tdOff = tdR * vec3(sin(tdT * 0.53), 0.6 * sin(tdT * 0.77 + 2.0), cos(tdT * 0.61 + 1.0));
    tdScale = 0.3 + 0.7 * smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(tdT * 1.9));
  } else if (tdMode < ${num(DRIFT_MODE.orbit)} + 0.5) {
    // Round and round the base point, facing along the path, wings flapping.
    tdOff = tdR * vec3(cos(tdT), 0.0, sin(tdT)) + vec3(0.0, 0.12 * sin(tdT * 2.3), 0.0);
    tdLocal.x *= 0.55 + 0.45 * abs(sin(terrainTime * 9.0 + terrainDrift.y * 5.0));
    float tdC = cos(tdT);
    float tdS = sin(tdT);
    tdLocal.xz = vec2(tdC * tdLocal.x - tdS * tdLocal.z, tdS * tdLocal.x + tdC * tdLocal.z);
  } else {
    tdOff = tdR * vec3(sin(tdT * 0.31), 0.0, cos(tdT * 0.27 + 1.3));
    tdScale = 0.9 + 0.1 * sin(tdT * 0.7);
  }
  worldPos = finalWorld * vec4(tdLocal * tdScale, 1.0);
  worldPos.xyz += tdOff;
  vPositionW = worldPos.xyz;
}
#endif
`;

// Muting works on the albedo, so muted props keep their light and shade.
const FRAGMENT_BEFORE_LIGHTS = /* glsl */ `
#ifdef TERRAIN_SWAY
{
  float tmL = dot(surfaceAlbedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 tmC = mix(vec3(tmL), surfaceAlbedo, terrainMute.w) * terrainMuteMix.y;
  tmC = mix(tmC, terrainMute.rgb, terrainMuteMix.x);
  surfaceAlbedo = mix(surfaceAlbedo, tmC, vTerrainMute);
}
#endif
`;

const FRAGMENT_BEFORE_FOG = /* glsl */ `
#ifdef TERRAIN_WATER
{
  vec2 twP = vPositionW.xz;
  float twUp = clamp(normalW.y, 0.0, 1.0);
  float twG = sin(twP.x * 7.0 + terrainTime * 1.6) * sin(twP.y * 6.0 - terrainTime * 1.2)
    * sin((twP.x + twP.y) * 4.0 + terrainTime * 0.7);
  finalColor.rgb += terrainWater.y * smoothstep(0.6, 0.98, twG) * twUp;
  finalColor.rgb *= 1.0 + 0.05 * sin(twP.x * 2.1 + twP.y * 1.7 + terrainTime * 0.8) * twUp;
}
#endif
`;

export interface TerrainPluginOptions {
  /** The lake tiles: bob and glint. */
  readonly water?: boolean;
}

/** Attaches the terrain plugin to `material` under GLSL; null under WebGPU (WGSL). */
export function attachTerrainPlugin(
  material: Material,
  clock: TerrainClock,
  options: TerrainPluginOptions = {},
): TerrainPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL
    ? new TerrainPlugin(material, clock, options)
    : null;
}

export class TerrainPlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;
  private readonly water: boolean;
  private readonly muteTint = Color3.FromHexString(MUTED.tint).toLinearSpace();

  constructor(material: Material, clock: TerrainClock, options: TerrainPluginOptions = {}) {
    super(material, 'Terrain', 210, {
      TERRAIN_SWAY: false,
      TERRAIN_WATER: false,
      TERRAIN_DRIFT: false,
    });
    this.clock = clock;
    this.water = options.water === true;
    this._enable(true);
  }

  override getClassName(): string {
    return 'TerrainPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines['TERRAIN_SWAY'] = mesh.isVerticesDataPresent(AMBIENT_ATTRIBUTE);
    defines['TERRAIN_DRIFT'] = mesh.isVerticesDataPresent(DRIFT_ATTRIBUTE);
    defines['TERRAIN_WATER'] = this.water;
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(AMBIENT_ATTRIBUTE)) attributes.push(AMBIENT_ATTRIBUTE);
    if (mesh.isVerticesDataPresent(DRIFT_ATTRIBUTE)) attributes.push(DRIFT_ATTRIBUTE);
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'terrainTime', size: 1, type: 'float' },
        { name: 'terrainMuteMix', size: 2, type: 'vec2' },
        { name: 'terrainWater', size: 2, type: 'vec2' },
        { name: 'terrainMute', size: 4, type: 'vec4' },
      ],
      vertex: 'uniform float terrainTime;\nuniform vec2 terrainWater;',
      fragment:
        'uniform float terrainTime;\nuniform vec2 terrainMuteMix;\nuniform vec2 terrainWater;\nuniform vec4 terrainMute;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('terrainTime', this.clock.time);
    uniformBuffer.updateFloat2('terrainMuteMix', MUTED.wash, MUTED.shade);
    uniformBuffer.updateFloat2('terrainWater', AMBIENT.water.bob, AMBIENT.water.glint);
    const t = this.muteTint;
    uniformBuffer.updateFloat4('terrainMute', t.r, t.g, t.b, MUTED.saturation);
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
        CUSTOM_FRAGMENT_BEFORE_LIGHTS: FRAGMENT_BEFORE_LIGHTS,
        CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_BEFORE_FOG,
      };
    }
    return null;
  }
}
