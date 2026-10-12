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
  RARE_GLOW,
  RARE_GLOW_STYLE,
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
 *   ART_BIBLE §1.4): sparkle flecks, an iridescent rim, Mythic shimmer,
 *   light from inside.
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
  if (squishMotion.w > ${num(RARE_GLOW.moteLook)} - 0.5) {
    // PROTOTYPE #391: motes orbit the squishy's upright axis and bob.
    float moA = 6.2831853 * ${num(RARE_GLOW.motes.speed)} * squishTime;
    float moC = cos(moA);
    float moS = sin(moA);
    sqRel.xz = vec2(moC * sqRel.x - moS * sqRel.z, moS * sqRel.x + moC * sqRel.z);
    sqRel.y += 0.06 * sqH * sin(squishTime * 1.3 + sqRel.x * 3.0);
    sqS = 1.0;
  }
  float sqSide = inversesqrt(sqS);
  sqRel.y *= sqS;
  sqRel.xz *= sqSide;
  sqRel.x += sqLean * sqRel.y;
  sqRel.y += sqLift;
  worldPos.xyz = sqOrigin + sqRel;
  vSquishLook = squishMotion.w;
  vSquishFinish = squishEvent.w;
  // The mesh's own position, before its instance matrix, squash, lean,
  // bounce and turn, so sparkle flecks and the rainbow rim stick to the
  // vinyl however the squishy moves. Scaled by the instance's own axes (the
  // thin-instance matrix only, not the battle rig's animated squash above
  // it) and divided by the squishy's height, so every mesh (body, head, a
  // thin horn, a long tail) measures in body heights and flecks match in size.
#ifdef INSTANCES
  vec3 sqAxes = vec3(length(world0.xyz), length(world1.xyz), length(world2.xyz));
#else
  vec3 sqAxes = vec3(1.0);
#endif
  vSquishLocal = positionUpdated * sqAxes / sqH;
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
// PROTOTYPE #391: code = finish + glow + 16 × rarity level + 128 × glow hue (36 steps).
float fiHueI = floor(vSquishFinish / ${num(RARE_GLOW.hueStep)} + 0.001);
float fiRest = vSquishFinish - ${num(RARE_GLOW.hueStep)} * fiHueI;
float fiRare = floor(fiRest / ${num(RARE_GLOW.codeStep)} + 0.001);
float fiCode = fiRest - ${num(RARE_GLOW.codeStep)} * fiRare;
// Each part glows in its OWN colour: chroma pushed away from grey (which keeps
// its hue exactly), renormalised, and dimmed for dark parts so brown stays
// brown. Pale parts (cream, pale lilac) keep their own faint hue, pushed to a
// readable minimum. Only a truly white part has no hue, so it borrows the
// squishy's most colourful palette colour (encoded per squishy).
vec3 fiHue6 = clamp(abs(mod(fiHueI / 36.0 * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
vec3 fiPal = pow(mix(vec3(1.0), fiHue6, ${num(RARE_GLOW.hueSaturation)}), vec3(2.2));
float fiMx = max(max(surfaceAlbedo.r, surfaceAlbedo.g), max(surfaceAlbedo.b, 0.001));
float fiMn = min(min(surfaceAlbedo.r, surfaceAlbedo.g), surfaceAlbedo.b);
float fiSat = (fiMx - fiMn) / fiMx;
vec3 fiN = surfaceAlbedo / fiMx;
float fiL = dot(fiN, vec3(0.2126, 0.7152, 0.0722));
float fiK = clamp(max(${num(RARE_GLOW.halo.saturate)}, ${num(RARE_GLOW.minSaturation)} / max(fiSat, 0.001)), 1.0, 12.0);
vec3 fiRich = max(vec3(fiL) + fiK * (fiN - vec3(fiL)), 0.0);
fiRich /= max(max(fiRich.r, fiRich.g), max(fiRich.b, 0.001));
fiRich *= clamp(fiMx * ${num(RARE_GLOW.darkLift)}, ${num(RARE_GLOW.darkFloor)}, 1.0);
vec3 fiOwn = mix(fiPal, fiRich, smoothstep(0.015, 0.04, fiSat));
if (vSquishLook > ${num(RARE_GLOW.moteLook)} - 0.5) {
  float moTw = 0.75 + 0.25 * sin(dot(viewDirectionW, vec3(9.0, 7.0, 5.0)) + vSquishLocal.x * 20.0);
  finalColor.rgb = mix(vec3(1.0), fiOwn, 0.85) * ${num(RARE_GLOW.motes.bright)} * moTw;
}
if (fiRare > 0.5 && vSquishLook < 0.5) {
  vec4 fiKs = vec4(${RARE_GLOW.halo[RARE_GLOW_STYLE === 'off' ? 'halo' : RARE_GLOW_STYLE].map(num).join(', ')});
  float fiS = fiRare < 1.5 ? fiKs.x : fiRare < 2.5 ? fiKs.y : fiRare < 3.5 ? fiKs.z : fiKs.w;
  float fiEdge = 1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
  float fiR = pow(fiEdge, ${num(RARE_GLOW.halo.falloff)});
  // Legendary's rainbow edge and mythic's shimmer keep the outer edge: their
  // glow is a band just inside it.
  float fiTierOf = fiCode - ${num(FINISH_CODE.glow)} * step(${num(FINISH_CODE.glow)} - 0.5, fiCode);
  if (fiTierOf > 1.5) fiR = ${num(RARE_GLOW.halo.bandBoost)} * smoothstep(0.12, 0.38, fiEdge) * (1.0 - smoothstep(0.42, 0.62, fiEdge));
  // Light added in each part's own colour, so the glow can only brighten.
  // Near-white, pale vinyl already shines, so it takes less (keeps it from
  // clipping to white and losing its colour).
  float fiLumWas = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float fiCalm = 1.0 - ${num(RARE_GLOW.halo.paleCalm)} * smoothstep(0.6, 1.0, fiLumWas) * (1.0 - smoothstep(0.1, 0.4, fiSat));
  finalColor.rgb += fiOwn * (fiS * fiR * fiCalm);
  float fiLum = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722));
${RARE_GLOW_STYLE === 'inner' ? `  // Lit from inside in its own colour, capped: more where the vinyl is dim, so pale kinds never wash out.
  vec4 fiI = vec4(${RARE_GLOW.inner.map(num).join(', ')});
  float fiIn = fiRare < 1.5 ? fiI.x : fiRare < 2.5 ? fiI.y : fiRare < 3.5 ? fiI.z : fiI.w;
  finalColor.rgb += fiOwn * fiIn * (1.0 - smoothstep(0.15, 0.85, fiLum));` : ''}
}
if (fiCode > 0.5 && vSquishLook < 0.5) {
  // Material tiers (ART_BIBLE §1.4). One code per instance, so a whole
  // squishy takes the same branches.
  float fiGlow = step(${num(FINISH_CODE.glow)} - 0.5, fiCode);
  float fiTier = fiCode - ${num(FINISH_CODE.glow)} * fiGlow;
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
  if (fiTier > 2.5) {
    // Mythic shimmer: pearly bands slide over the vinyl as the view turns
    // (never on a timer, so an idle scene stays idle). The soft variant
    // (Mythic costumes) is the same bands with its own numbers.
    bool fiSoft = fiTier > ${num(FINISH_CODE.shimmerSoft)} - 0.5;
    float fiBands = fiSoft ? ${num(FINISH.shimmerSoft.bands)} : ${num(FINISH.shimmer.bands)};
    float fiWidth = fiSoft ? ${num(FINISH.shimmerSoft.width)} : ${num(FINISH.shimmer.width)};
    float fiPower = fiSoft ? ${num(FINISH.shimmerSoft.strength)} : ${num(FINISH.shimmer.strength)};
    vec3 fiTint = fiSoft ? ${vec3(FINISH.shimmerSoft.tint)} : ${vec3(FINISH.shimmer.tint)};
    float fiBand = fract(dot(vSquishLocal, vec3(0.55, 1.0, 0.35)) * fiBands + dot(viewDirectionW, vec3(0.9, 0.6, 0.7)));
    float fiSheen = smoothstep(0.0, fiWidth, fiBand) * (1.0 - smoothstep(fiWidth, fiWidth * 2.0, fiBand));
    finalColor.rgb += fiTint * fiSheen * fiPower;
  }
}
if (vSquishLook > ${num(SQUISH_LOOK_CODE.shadow)} - 0.5 && vSquishLook < ${num(RARE_GLOW.moteLook)} - 0.5) {
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
