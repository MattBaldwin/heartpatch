import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { WEATHER_LOOK } from './weather-config.js';

/** Per-vertex light on a cloud: height up the cloud (0 flat belly, 1 top), sunny side, unused, unused. */
export const CLOUD_ATTRIBUTE = 'weatherCloud';

const { belly, paleBelly, top, key, rim, rimStrength, rimPower } = WEATHER_LOOK.clouds.shade;
const sun = WEATHER_LOOK.clouds.sun;
const sunLength = Math.hypot(...sun);
const flash = WEATHER_LOOK.clouds.flash;
const f = (n: number): string => n.toFixed(3);
/**
 * The rim's gold as it should look on screen: this unlit material's colour
 * reaches the screen as it is (no gamma step after it), so it is given in
 * sRGB, not linear.
 */
const gold = rim;

/** How lit the sky is by lightning now, 0 to 1; the weather layer sets it each frame. */
export interface CloudFlash {
  value: number;
}

// The clouds' material is unlit (one flat emissive colour), so the light is
// worked out from the cloud's own shape and handed down as a vertex attribute:
// a dark flat belly, a bright top, and a warm gold edge light round the tops
// (a fresnel term from the cloud's own normal, strongest on the sunny side),
// laid on last as its own light so the slate under it can't mute it.
// Doing it here, in the fragment, rather than in vertex colours keeps one
// fused shape shaded as one. A lightning flash (`weatherFlash`) lights the
// bellies from below. GLSL only, like the rain plugin.
const VERTEX_DEFINITIONS = /* glsl */ `
attribute vec4 weatherCloud;
#ifndef NORMAL
attribute vec3 normal;
#endif
varying vec2 vWeatherCloud;
varying vec3 vWeatherNormal;
varying vec3 vWeatherPos;
`;

const VERTEX_MAIN_END = /* glsl */ `
vWeatherCloud = weatherCloud.xy;
vWeatherNormal = normalize(mat3(finalWorld) * normal);
vWeatherPos = worldPos.xyz;
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
varying vec2 vWeatherCloud;
varying vec3 vWeatherNormal;
varying vec3 vWeatherPos;
`;

const FRAGMENT_BEFORE_FOG = /* glsl */ `
{
  vec3 wcN = normalize(vWeatherNormal);
  // Height up the cloud and which way the surface faces both count: the
  // belly and any face turned down are dark, each lump's sunny side is lit.
  float wcUp = smoothstep(0.0, 1.0, vWeatherCloud.x) * (0.55 + 0.45 * clamp(wcN.y, 0.0, 1.0));
  vec3 wcSun = vec3(${f(sun[0] / sunLength)}, ${f(sun[1] / sunLength)}, ${f(sun[2] / sunLength)});
  float wcKey = clamp(dot(wcN, wcSun), 0.0, 1.0);
  // A pale rain cloud keeps a light underside (soft white, not charcoal);
  // a slate storm bank gets the full dark belly.
  float wcPale = smoothstep(0.45, 0.8, dot(color.rgb, vec3(0.3333)));
  float wcStorm = mix(${f(belly)}, ${f(top)}, wcUp) * (1.0 - ${f(key)} * 0.5 + ${f(key)} * wcKey);
  float wcSoft = mix(${f(paleBelly)}, ${f(top)}, wcUp) * (0.9 + 0.1 * wcKey);
  color.rgb *= mix(wcStorm, wcSoft, wcPale);
  vec3 wcV = normalize(vEyePosition.xyz - vWeatherPos);
  float wcEdge = pow(1.0 - clamp(dot(wcN, wcV), 0.0, 1.0), ${f(rimPower)});
  float wcRim = wcEdge * smoothstep(0.02, 0.3, vWeatherCloud.x) * (0.35 + 0.65 * wcKey);
  color.rgb += vec3(${f(flash.colour[0])}, ${f(flash.colour[1])}, ${f(flash.colour[2])})
    * (weatherFlash * mix(${f(flash.belly)}, ${f(flash.top)}, wcUp));
  // The gold edge, after the slate and the light: the edge turns to gold
  // (a mix, so it stays gold rather than washing out to white) and glows a
  // little over it.
  vec3 wcGold = vec3(${f(gold[0])}, ${f(gold[1])}, ${f(gold[2])});
  // A hard-edged band: half-mixed slate and gold reads as tan, so the band
  // goes from none to all gold over a short step.
  float wcGlow = smoothstep(0.3, 0.5, wcRim * ${f(rimStrength)});
  color.rgb = mix(color.rgb, wcGold, wcGlow) + wcGold * (wcGlow * 0.1);
}
`;

export class CloudPlugin extends MaterialPluginBase {
  private readonly flash: CloudFlash;

  constructor(material: Material, flash: CloudFlash) {
    super(material, 'WeatherCloud', 231, { WEATHER_CLOUD: false });
    this.flash = flash;
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
    if (!mesh.isVerticesDataPresent(CLOUD_ATTRIBUTE)) return;
    attributes.push(CLOUD_ATTRIBUTE);
    if (!attributes.includes('normal')) attributes.push('normal');
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    fragment: string;
  } {
    return {
      ubo: [{ name: 'weatherFlash', size: 1, type: 'float' }],
      fragment: 'uniform float weatherFlash;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('weatherFlash', this.flash.value);
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
export function attachCloudShade(material: Material, flash: CloudFlash): CloudPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL ? new CloudPlugin(material, flash) : null;
}
