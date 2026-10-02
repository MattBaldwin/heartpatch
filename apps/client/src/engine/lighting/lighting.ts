import { Constants } from '@babylonjs/core/Engines/constants';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial';
import type { Scene } from '@babylonjs/core/scene';
import { LIGHTING } from '../config.js';
import { buildSkyFaces, CUBE_FACES } from './sky.js';

/**
 * Soft, cozy lighting: a procedural pastel sky as the IBL environment (diffuse
 * from its spherical harmonics, reflections from its mips) plus one warm
 * directional key light for clear highlights on glossy toys.
 */
export function setupLighting(scene: Scene): DirectionalLight {
  const { sunDirection: sd, envSize } = LIGHTING;
  const toSun = { x: -sd.x, y: -sd.y, z: -sd.z };
  const faces = buildSkyFaces(envSize, toSun);

  const env = new RawCubeTexture(
    scene,
    CUBE_FACES.map((f) => faces[f.name]),
    envSize,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true, // mips stand in for prefiltering: the sky is smooth, so box-filtered mips blur well
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  env.name = 'procedural-sky';
  env.gammaSpace = true;
  // Computed on the CPU from the same data, so Babylon never reads the texture back.
  env.sphericalPolynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
    ...faces,
    size: envSize,
    format: Constants.TEXTUREFORMAT_RGBA,
    type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
    gammaSpace: true,
  });
  scene.environmentTexture = env;
  scene.environmentIntensity = LIGHTING.environmentIntensity;

  const sun = new DirectionalLight('sun', new Vector3(sd.x, sd.y, sd.z).normalize(), scene);
  sun.intensity = LIGHTING.sunIntensity;
  sun.diffuse = new Color3(1, 0.96, 0.9);
  sun.specular = new Color3(1, 0.97, 0.92);
  return sun;
}
