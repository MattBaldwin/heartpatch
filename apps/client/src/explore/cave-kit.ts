import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';
import type { SpotShape } from './trail-kit.js';

// The hills cave's shapes (#335 art reset), on the meadow's kit: soft purple
// vinyl stone, glowing crystals and caps. Each is one merged, vertex-coloured
// mesh. The cave has no roof to model: the sky dome is the dark ceiling, and
// these wall it in.

/** A big boulder for the cave wall: a heap of rounded stones, about 3 across. */
export function buildWallRock(scene: Scene): Mesh {
  return merged('cave-wall-rock', [
    shaded(sphere(scene, 3.2, 8, [0, 1.0, 0], [1.2, 0.95, 1]), '#4d3d68', '#8a76a8', 0, 2.4),
    shaded(sphere(scene, 2.0, 7, [1.5, 0.6, 0.5], [1.1, 0.9, 1]), '#52416e', '#8f7bae', 0, 1.6),
    shaded(sphere(scene, 1.7, 6, [-1.4, 0.55, -0.3], [1.1, 0.95, 1]), '#4d3d68', '#8a76a8', 0, 1.4),
    shaded(sphere(scene, 1.5, 6, [0.2, 2.0, 0.1], [1.1, 0.8, 1]), '#5d4a7a', '#9a86b8', 1.2, 2.8),
  ]);
}

/** A stalagmite: a rounded cone of stone, a smaller one beside it. */
export function buildStalagmite(scene: Scene): Mesh {
  return merged('cave-stalagmites', [
    shaded(cylinder(scene, 1.6, 0.12, 0.7, 8, [0, 0.8, 0]), '#55447a', '#a592c4', 0, 1.6),
    shaded(sphere(scene, 0.2, 4, [0, 1.6, 0]), '#a592c4', '#b6a4d4', 1.5, 1.7),
    shaded(cylinder(scene, 0.9, 0.08, 0.45, 7, [0.55, 0.45, 0.2]), '#5a487f', '#a08dc0', 0, 0.9),
  ]);
}

/** A crystal cluster: a few pastel points that glow (the material is lit by the land's glow). */
export function buildCrystals(scene: Scene): Mesh {
  const points: readonly [number, number, number, number, number, string][] = [
    [0, 0, 0.85, 0.2, 0.0, '#9af0ff'],
    [0.2, 0.08, 0.55, 0.15, 0.3, '#ff9cd6'],
    [-0.18, 0.1, 0.5, 0.14, -0.35, '#c9a8ff'],
  ];
  return merged(
    'cave-crystals',
    points.map(([x, z, h, d, lean, hex]) =>
      flat(cylinder(scene, h, 0.01, d, 5, [x, h / 2, z], [lean, 0, lean * 0.5]), hex),
    ),
  );
}

/** A ring of glowing caps, for the cave's glow mushrooms. */
export function buildGlowCaps(scene: Scene): Mesh {
  const caps: readonly [number, number, number, string][] = [
    [0, 0, 1, '#8ef0ff'],
    [0.2, 0.1, 0.8, '#ff9cd6'],
    [-0.18, 0.12, 0.75, '#8ef0ff'],
    [0.05, -0.2, 0.7, '#ff9cd6'],
  ];
  return merged(
    'cave-glow-caps',
    caps.flatMap(([x, z, s, cap]) => [
      flat(cylinder(scene, 0.2 * s, 0.06 * s, 0.075 * s, 6, [x, 0.1 * s, z]), '#f6e9d8'),
      shaded(sphere(scene, 0.26 * s, 6, [x, 0.22 * s, z], [1, 0.58, 1]), cap, cap, 0, 1),
    ]),
  );
}

/** A dark nook for the Lantern: a rock hump with a black doorway and a crystal peeking out. */
export function buildNook(scene: Scene): SpotShape {
  const mesh = merged('land-spot-nook', [
    shaded(sphere(scene, 1.0, 8, [0, 0.25, 0], [1.1, 0.72, 0.95]), '#8c78b4', '#cdbde8', 0, 0.7),
    // The doorway: a dark arch with a pale rim, so it reads as a doorway, not a mouth.
    flat(cylinder(scene, 0.03, 0.62, 0.62, 14, [0, 0.27, -0.44], [Math.PI / 2, 0, 0]), '#d9cdf0'),
    flat(cylinder(scene, 0.03, 0.48, 0.48, 14, [0, 0.27, -0.455], [Math.PI / 2, 0, 0]), '#1b1230'),
    flat(cylinder(scene, 0.32, 0.01, 0.1, 5, [0.3, 0.55, -0.15]), '#e6cdfc'),
  ]);
  return { mesh, glint: 0.9 };
}

/** Glow mushrooms to boop: the same ring of caps, at spot size. */
export function buildGlowMushroomSpot(scene: Scene): SpotShape {
  const mesh = buildGlowCaps(scene);
  mesh.scaling.setAll(1.5);
  mesh.bakeCurrentTransformIntoVertices();
  mesh.name = 'land-spot-glow-mushrooms';
  return { mesh, glint: 0.7 };
}

/** The cave's rock to lift: rounded purple-grey stone, no moss, a crystal peeking out. */
export function buildCaveRock(scene: Scene): SpotShape {
  const mesh = merged('land-spot-cave-rock', [
    shaded(sphere(scene, 0.78, 8, [0, 0.2, 0], [1.1, 0.72, 1]), '#6f6290', '#b9aed6', 0, 0.5),
    shaded(
      sphere(scene, 0.36, 5, [0.36, 0.1, -0.12], [1.1, 0.7, 1]),
      '#695c8a',
      '#ada2cc',
      0,
      0.22,
    ),
    shaded(
      sphere(scene, 0.42, 6, [-0.08, 0.42, 0.05], [1.1, 0.5, 0.95]),
      '#7a6c9c',
      '#c6bce0',
      0.3,
      0.6,
    ),
    flat(cylinder(scene, 0.26, 0.01, 0.08, 5, [-0.3, 0.3, 0.12], [0.3, 0, 0.4]), '#9af0ff'),
  ]);
  return { mesh, glint: 0.85 };
}
