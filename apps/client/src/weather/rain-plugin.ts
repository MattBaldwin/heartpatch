import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import type { TerrainClock } from '../map/terrain-plugin.js';

/**
 * Per-streak data: phase, speed, range (how far it falls), slant (how far it
 * drifts sideways per unit fallen). A lightning bolt shares the plugin: its
 * fourth value is negative, -1 to hold still (motion off) or -2 to flash.
 */
export const RAIN_ATTRIBUTE = 'weatherRain';

// The existing `fall` drift tumbles; rain wants straight, fast streaks that
// repeat. Each streak drops `range` over one cycle of `fract(time * speed +
// phase)` and fades in and out across it, all in the vertex shader from the
// shared terrain clock: with the clock still (reduced motion) the rain holds
// still, and no CPU work or draw call is added per frame. GLSL only, like the
// terrain plugin; under WebGPU the layer draws no rain.
const VERTEX_DEFINITIONS = /* glsl */ `
attribute vec4 weatherRain;
varying float vWeatherFade;
`;

const VERTEX_WORLDPOS = /* glsl */ `
{
  float wrCycle = fract(weatherTime * weatherRain.y + weatherRain.x);
  worldPos.y -= weatherRain.z * wrCycle;
  // Slant: the path leans and so does the streak (sheared by its own height).
  worldPos.x += max(weatherRain.w, 0.0) * (weatherRain.z * wrCycle - position.y);
  vWeatherFade = sin(3.14159 * wrCycle);
  if (weatherRain.w < -0.5) {
    // A bolt: a quick double flash, then dark; or held lit when motion is off.
    float wrFlash = pow(max(0.0, 1.0 - wrCycle * 7.0), 2.0)
      + 0.6 * pow(max(0.0, 1.0 - abs(wrCycle - 0.2) * 14.0), 2.0);
    vWeatherFade = weatherRain.w < -1.5 ? min(1.0, wrFlash) : 1.0;
  }
}
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
varying float vWeatherFade;
`;

const FRAGMENT_BEFORE_FOG = /* glsl */ `
color.a *= vWeatherFade;
`;

export class RainPlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;

  constructor(material: Material, clock: TerrainClock) {
    super(material, 'WeatherRain', 230, { WEATHER_RAIN: false });
    this.clock = clock;
    this._enable(true);
  }

  override getClassName(): string {
    return 'RainPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines['WEATHER_RAIN'] = mesh.isVerticesDataPresent(RAIN_ATTRIBUTE);
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(RAIN_ATTRIBUTE)) attributes.push(RAIN_ATTRIBUTE);
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    return {
      ubo: [{ name: 'weatherTime', size: 1, type: 'float' }],
      vertex: 'uniform float weatherTime;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('weatherTime', this.clock.time);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_UPDATE_WORLDPOS: VERTEX_WORLDPOS,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_BEFORE_FOG,
    };
  }
}

/** Attaches the rain fall to `material` under GLSL; null under WebGPU (WGSL). */
export function attachRain(material: Material, clock: TerrainClock): RainPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL ? new RainPlugin(material, clock) : null;
}
