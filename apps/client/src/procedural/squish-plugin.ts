import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  FINISH,
  FINISH_CODE,
  SHADOW_LOOK,
  SQUISH,
  SQUISH_LOOK_CODE,
  SQUISH_MOVE_CODE,
  VINYL,
} from './config.js';

/**
 * Squash-and-stretch and rim light for every squishy mesh (design doc §19).
 *
 * Per thin instance (all of one squishy's body and part instances carry the
 * same values, so parts deform with the body and stay stuck on):
 * - `squishOrigin`: the squishy's ground point (xyz, in the mesh's space) and
 *   body height (w).
 * - `squishMotion`: breathing phase, rate (breaths/s) and amplitude, and the
 *   look (`SQUISH_LOOK_CODE`: normal, or a rescue guardian's shadow look).
 * - `squishEvent`: the current move's start time (s), kind code and strength,
 *   and in `w` the instance's material tier and glow (`FINISH_CODE`,
 *   ART_BIBLE §1.4): sparkle flecks, an iridescent rim, light from inside.
 *
 * The vertex shader squashes around the ground point, keeping volume
 * (x and z scale by 1/√s when y scales by s), and corrects normals with the
 * inverse scale. Everything runs on the GPU from one `squishTime` uniform,
 * so the CPU does nothing per frame.
 *
 * GLSL only, for the WebGL2 default (tech spec §6). Under the opt-in WebGPU
 * renderer the plugin isn't attached, so squishies render still and without
 * the rim; port to WGSL when WebGPU is enabled.
 */

export const SQUISH_ATTRIBUTES = ['squishOrigin', 'squishMotion', 'squishEvent'] as const;

const num = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
const vec3 = (v: readonly number[]) => `vec3(${v.map(num).join(', ')})`;
const { jiggle, wobble, bounce, duration } = SQUISH;

const VERTEX_DEFINITIONS = /* glsl */ `
#ifdef SQUISH
attribute vec4 squishOrigin;
attribute vec4 squishMotion;
attribute vec4 squishEvent;
varying float vSquishLook;
varying float vSquishFinish;
varying vec3 vSquishLocal;
#endif
`;

const FRAGMENT_DEFINITIONS = /* glsl */ `
#ifdef SQUISH
varying float vSquishLook;
varying float vSquishFinish;
varying vec3 vSquishLocal;
#endif
`;

const VERTEX_WORLDPOS = /* glsl */ `
#ifdef SQUISH
{
  float sqH = max(squishOrigin.w, 0.0001);
  // The ground point is in the mesh's space: identity for a field at the
  // origin, or a battle rig the field hangs from (the field's parent).
  vec3 sqOrigin = (world * vec4(squishOrigin.xyz, 1.0)).xyz;
  vec3 sqRel = worldPos.xyz - sqOrigin;
  float sqS = 1.0 + squishMotion.z * sin(6.2831853 * (squishMotion.y * squishTime + squishMotion.x));
  float sqLean = 0.0;
  float sqLift = 0.0;
  float sqAge = squishTime - squishEvent.x;
  float sqKind = squishEvent.y;
  float sqStr = squishEvent.z;
  if (sqKind > 0.5 && sqAge >= 0.0) {
    if (sqKind < ${num(SQUISH_MOVE_CODE.jiggle)} + 0.5) {
      if (sqAge < ${num(duration.jiggle)}) {
        float e = exp(-sqAge * ${num(jiggle.decay)}) * sqStr;
        sqS += ${num(jiggle.squash)} * e * sin(sqAge * ${num(jiggle.speed)});
        sqLean = ${num(jiggle.lean)} * e * sin(sqAge * ${num(jiggle.speed * 0.73)});
      }
    } else if (sqKind < ${num(SQUISH_MOVE_CODE.wobble)} + 0.5) {
      if (sqAge < ${num(duration.wobble)}) {
        float e = exp(-sqAge * ${num(wobble.decay)}) * sqStr;
        sqS -= ${num(wobble.squash)} * e * cos(sqAge * ${num(wobble.speed)});
      }
    } else if (sqAge < ${num(duration.bounce)}) {
      float hopTime = ${num(duration.bounce / bounce.hops)};
      float hop = fract(sqAge / hopTime);
      float air = sin(3.14159265 * hop);
      sqLift = ${num(bounce.height)} * sqH * air * sqStr;
      // Stretch in the air, squash on take-off and landing.
      sqS += sqStr * (0.08 * air - ${num(bounce.squash)} * (1.0 - air) * (1.0 - air) * (1.0 - air));
    }
  }
  sqS = max(sqS, 0.3);
  float sqSide = inversesqrt(sqS);
  sqRel.y *= sqS;
  sqRel.xz *= sqSide;
  sqRel.x += sqLean * sqRel.y;
  sqRel.y += sqLift;
  worldPos.xyz = sqOrigin + sqRel;
  vSquishLook = squishMotion.w;
  vSquishFinish = squishEvent.w;
  // The mesh's own position, before its instance matrix, squash, lean,
  // bounce and turn: sparkle flecks and the rainbow rim stick to the vinyl
  // however the squishy moves (the body's units are about its height).
  vSquishLocal = positionUpdated;
  vPositionW = worldPos.xyz;
#ifdef NORMAL
  vNormalW = normalize(vNormalW * vec3(1.0 / sqSide, 1.0 / sqS, 1.0 / sqSide));
#endif
}
#endif
`;

const FRAGMENT_RIM = /* glsl */ `
#ifdef SQUISH_RIM
{
  float rim = 1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
  finalColor.rgb += squishRim.rgb * (squishRim.a * rim * rim * rim);
}
#endif
#ifdef SQUISH
if (vSquishFinish > 0.5 && vSquishLook < 0.5) {
  // Material tiers (ART_BIBLE §1.4). One code per instance, so a whole
  // squishy takes the same branches.
  float fiGlow = step(${num(FINISH_CODE.glow)} - 0.5, vSquishFinish);
  float fiTier = vSquishFinish - ${num(FINISH_CODE.glow)} * fiGlow;
  if (fiGlow > 0.5) {
    finalColor.rgb += surfaceAlbedo * ${num(FINISH.glow)};
  }
  if (fiTier > 0.5) {
    // Sparkle: a white fleck in some cells of a 3D grid, twinkling as the view turns.
    vec3 fiP = vSquishLocal * ${num(FINISH.sparkle.cells)};
    vec3 fiCell = floor(fiP);
    float fiH = fract(sin(dot(fiCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float fiDot = smoothstep(0.32, 0.08, length(fract(fiP) - 0.5));
    float fiTwinkle = 0.5 + 0.5 * sin(fiH * 40.0 + dot(viewDirectionW, vec3(9.0, 7.0, 5.0)));
    finalColor.rgb += vec3(${num(FINISH.sparkle.strength)}) * step(1.0 - ${num(FINISH.sparkle.density)}, fiH) * fiDot * fiTwinkle;
  }
  if (fiTier > 1.5) {
    // Iridescent: a rainbow rim that shifts with the view angle and height.
    float fiRim = pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), ${num(FINISH.iridescent.falloff)});
    vec3 fiHue = 0.5 + 0.5 * cos(6.2831853 * (fiRim * 1.3 + vSquishLocal.y * 0.7 + vec3(0.0, 0.33, 0.67)));
    finalColor.rgb += fiHue * fiRim * ${num(FINISH.iridescent.strength)};
  }
}
if (vSquishLook > ${num(SQUISH_LOOK_CODE.shadow)} - 0.5) {
  // A rescue guardian from the Hollow: dark lavender that keeps the vinyl's
  // shading (so the shape still reads), soft glassy eyes in their own colour
  // washed towards the glow, and a soft glowing rim.
  float shLum = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 shGlow = ${vec3(SHADOW_LOOK.glow)};
  if (vSquishLook > ${num(SQUISH_LOOK_CODE.shadowEyes)} - 0.5) {
    finalColor.rgb = mix(finalColor.rgb, shGlow * (0.4 + 0.6 * shLum), ${num(SHADOW_LOOK.eyeGlowMix)});
  } else {
    vec3 shTint = ${vec3(SHADOW_LOOK.tint)} * (0.5 + 1.5 * shLum);
    finalColor.rgb = mix(finalColor.rgb, shTint, ${num(SHADOW_LOOK.tintMix)});
  }
  float shRim = 1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
  finalColor.rgb += shGlow * (${num(SHADOW_LOOK.glowStrength)} * pow(shRim, ${num(SHADOW_LOOK.glowFalloff)}));
}
#endif
`;

export class SquishPlugin extends MaterialPluginBase {
  /** Seconds on the squishy clock; every move's start time uses the same clock. */
  time = 0;

  constructor(material: PBRMaterial) {
    super(material, 'Squish', 200, { SQUISH: false, SQUISH_RIM: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'SquishPlugin';
  }

  override isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    const squish = mesh.isVerticesDataPresent(SQUISH_ATTRIBUTES[0]);
    defines['SQUISH'] = squish;
    defines['SQUISH_RIM'] = true;
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (mesh.isVerticesDataPresent(SQUISH_ATTRIBUTES[0])) attributes.push(...SQUISH_ATTRIBUTES);
  }

  override getUniforms(): {
    ubo: { name: string; size: number; type: string }[];
    vertex: string;
    fragment: string;
  } {
    return {
      ubo: [
        { name: 'squishTime', size: 1, type: 'float' },
        { name: 'squishRim', size: 4, type: 'vec4' },
      ],
      vertex: 'uniform float squishTime;',
      fragment: 'uniform vec4 squishRim;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('squishTime', this.time);
    const [r, g, b] = VINYL.rimColor;
    uniformBuffer.updateFloat4('squishRim', r, g, b, VINYL.rimStrength);
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
        CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT_RIM,
      };
    }
    return null;
  }
}
