import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { Material } from '@babylonjs/core/Materials/material';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { TerrainClock } from '../map/terrain-plugin.js';

/**
 * Caustic light on a lake bed (#335, owner: "light ripples on the sand"):
 * one fragment term on the seabed's own material, from the world position
 * and the explore clock, so no texture, mesh or draw call is added. With
 * ambient life off (low tier, reduced motion, a slow device) the clock
 * stands still and the ripples hold still too. GLSL only, like the terrain
 * plugin: under WebGPU the bed is plain sand.
 */
const FRAGMENT_BEFORE_FOG = /* glsl */ `
{
  vec2 cP = vPositionW.xz * causticsScale;
  float cT = causticsTime;
  float cA = sin(cP.x * 1.9 + cT * 0.9 + sin(cP.y * 1.3 + cT * 0.6));
  float cB = sin(cP.y * 2.3 - cT * 0.7 + sin(cP.x * 1.1 - cT * 0.5));
  float cC = 1.0 - abs(cA + cB) * 0.5;
  float cUp = clamp(normalW.y, 0.0, 1.0);
  finalColor.rgb += causticsColor.rgb * causticsColor.a * smoothstep(0.72, 0.98, cC) * cUp;
}
`;

export class CausticsPlugin extends MaterialPluginBase {
  private readonly clock: TerrainClock;
  private readonly color: readonly [number, number, number, number];
  private readonly scale: number;

  constructor(
    material: Material,
    clock: TerrainClock,
    options: { color: readonly [number, number, number]; strength: number; scale: number },
  ) {
    super(material, 'Caustics', 220, {});
    this.clock = clock;
    this.color = [...options.color, options.strength];
    this.scale = options.scale;
    this._enable(true);
  }

  override getClassName(): string {
    return 'CausticsPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'causticsTime', size: 1, type: 'float' },
        { name: 'causticsScale', size: 1, type: 'float' },
        { name: 'causticsColor', size: 4, type: 'vec4' },
      ],
      fragment:
        'uniform float causticsTime;\nuniform float causticsScale;\nuniform vec4 causticsColor;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('causticsTime', this.clock.time);
    uniformBuffer.updateFloat('causticsScale', this.scale);
    const [r, g, b, a] = this.color;
    uniformBuffer.updateFloat4('causticsColor', r, g, b, a);
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    return shaderType === 'fragment' ? { CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_BEFORE_FOG } : null;
  }
}

/** Attaches the caustics to `material` under GLSL; null under WebGPU (WGSL). */
export function attachCaustics(
  material: Material,
  clock: TerrainClock,
  options: { color: readonly [number, number, number]; strength: number; scale: number },
): CausticsPlugin | null {
  return material.shaderLanguage === ShaderLanguage.GLSL
    ? new CausticsPlugin(material, clock, options)
    : null;
}
