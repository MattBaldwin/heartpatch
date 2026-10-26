import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { WEATHER_LOOK } from './weather-config.js';

/** Per-vertex light on a cloud: height up the cloud (0 flat belly, 1 top), sunny side, unused, unused. */
export const CLOUD_ATTRIBUTE = 'weatherCloud';

const { belly, top, rim, rimStrength } = WEATHER_LOOK.clouds.shade;
const f = (n: number): string => n.toFixed(3);

// The clouds' material is unlit (one flat emissive colour), so the light is
// worked out from the cloud's own shape and handed down as a vertex attribute:
// a dark flat belly, a bright top, and a warm rim on the sunny side. Doing it
// here, in the fragment, rather than in vertex colours keeps one fused shape
// shaded as one: the puffs share a single "height up the cloud" so no seam
// shows where they overlap. GLSL only, like the rain plugin.
const VERTEX_DEFINITIONS = /* glsl */ `
attribute vec4 weatherCloud;
varying vec2 vWeatherCloud;
`;

const VERTEX_MAIN_END = /* glsl */ `
vWeatherCloud = weatherCloud.xy;
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
varying vec2 vWeatherCloud;
`;

const FRAGMENT_BEFORE_FOG = /* glsl */ `
{
  float wcUp = smoothstep(0.0, 1.0, vWeatherCloud.x);
  color.rgb *= mix(${f(belly)}, ${f(top)}, wcUp);
  color.rgb += vec3(${f(rim[0])}, ${f(rim[1])}, ${f(rim[2])}) * (vWeatherCloud.y * ${f(rimStrength)});
}
`;

export class CloudPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'WeatherCloud', 231, { WEATHER_CLOUD: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'CloudPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: unknown, mesh: AbstractMesh): void {
    defines['WEATHER_CLOUD'] = mesh.isVerticesDataPresent(CLOUD_ATTRIBUTE);
  }

  override getAttributes(attributes: string[], _scene: unknown, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(CLOUD_ATTRIBUTE)) attributes.push(CLOUD_ATTRIBUTE);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: VERTEX_DEFINITIONS,
        CUSTOM_VERTEX_MAIN_END: VERTEX_MAIN_END,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: FRAGMENT_DEFINITIONS,
      CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_BEFORE_FOG,
    };
  }
}

/** Shades `material`'s clouds under GLSL; null under WebGPU, where they stay one flat colour. */
export function attachCloudShade(material: Material): CloudPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL ? new CloudPlugin(material) : null;
}
