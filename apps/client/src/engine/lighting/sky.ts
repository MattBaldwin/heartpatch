/**
 * Procedural pastel sky used as the image-based-lighting environment
 * (design doc §19). Generated in code, so there's no HDR/ENV asset to
 * download or license. Pure: no Babylon, no DOM.
 */

export type Rgb = readonly [number, number, number];

interface Dir {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function hex(h: number): Rgb {
  return [
    srgbToLinear(((h >> 16) & 0xff) / 255),
    srgbToLinear(((h >> 8) & 0xff) / 255),
    srgbToLinear((h & 0xff) / 255),
  ];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export const SKY_COLORS = {
  zenith: hex(0xb9d3f5), // TUNE: soft sky blue
  horizon: hex(0xffe4d4), // TUNE: peach haze
  ground: hex(0xe8c3d2), // TUNE: warm pink bounce from the pastel ground
  sun: hex(0xfff6e6), // TUNE: warm white
} as const;

/**
 * Linear radiance of the sky in direction `d` (any length). `toSun` points at
 * the sun (the opposite of the light's direction).
 */
export function skyRadiance(d: Dir, toSun: Dir): Rgb {
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  const y = d.y / len;
  const base =
    y >= 0
      ? mix(SKY_COLORS.horizon, SKY_COLORS.zenith, smoothstep(0, 0.65, y))
      : mix(SKY_COLORS.horizon, SKY_COLORS.ground, smoothstep(0, 0.3, -y));

  const sLen = Math.hypot(toSun.x, toSun.y, toSun.z) || 1;
  const cos = (d.x * toSun.x + d.y * toSun.y + d.z * toSun.z) / (len * sLen);
  // A broad soft glow plus a tighter "softbox" so glossy toys get a highlight.
  const glow = 0.35 * Math.pow(Math.max(0, cos), 8) + 0.6 * Math.pow(Math.max(0, cos), 128);
  return mix(base, SKY_COLORS.sun, Math.min(1, glow));
}

/**
 * Babylon's cube face layout (+X, -X, +Y, -Y, +Z, -Z): for texel (u, v) in
 * [-1, 1], direction = normal + u·axisX + v·axisY. Matches
 * CubeMapToSphericalPolynomialTools so the texture and its harmonics agree.
 */
export const CUBE_FACES = [
  { name: 'right', normal: [1, 0, 0], axisX: [0, 0, -1], axisY: [0, -1, 0] },
  { name: 'left', normal: [-1, 0, 0], axisX: [0, 0, 1], axisY: [0, -1, 0] },
  { name: 'up', normal: [0, 1, 0], axisX: [1, 0, 0], axisY: [0, 0, 1] },
  { name: 'down', normal: [0, -1, 0], axisX: [1, 0, 0], axisY: [0, 0, -1] },
  { name: 'front', normal: [0, 0, 1], axisX: [1, 0, 0], axisY: [0, -1, 0] },
  { name: 'back', normal: [0, 0, -1], axisX: [-1, 0, 0], axisY: [0, -1, 0] },
] as const;

export type FaceName = (typeof CUBE_FACES)[number]['name'];

/** RGBA8 sRGB faces, `size`×`size` each, in Babylon's face order. */
export function buildSkyFaces(size: number, toSun: Dir): Record<FaceName, Uint8Array> {
  const faces = {} as Record<FaceName, Uint8Array>;
  for (const face of CUBE_FACES) {
    const data = new Uint8Array(size * size * 4);
    for (let row = 0; row < size; row++) {
      const v = ((row + 0.5) / size) * 2 - 1;
      for (let col = 0; col < size; col++) {
        const u = ((col + 0.5) / size) * 2 - 1;
        const dir = {
          x: face.normal[0] + face.axisX[0] * u + face.axisY[0] * v,
          y: face.normal[1] + face.axisX[1] * u + face.axisY[1] * v,
          z: face.normal[2] + face.axisX[2] * u + face.axisY[2] * v,
        };
        const c = skyRadiance(dir, toSun);
        const i = (row * size + col) * 4;
        data[i] = Math.round(linearToSrgb(c[0]) * 255);
        data[i + 1] = Math.round(linearToSrgb(c[1]) * 255);
        data[i + 2] = Math.round(linearToSrgb(c[2]) * 255);
        data[i + 3] = 255;
      }
    }
    faces[face.name] = data;
  }
  return faces;
}
