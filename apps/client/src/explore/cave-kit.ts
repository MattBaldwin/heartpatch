import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { kitMesh, merged, type Part } from './kit-mesh.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';
import type { SpotShape } from './trail-kit.js';

// The hills cave's shapes (#335 art reset), on the meadow's kit: soft purple
// vinyl stone, glowing crystals and caps. Each is one merged, vertex-coloured
// mesh. The cave has no roof to model: the sky dome is the dark ceiling, and
// these wall it in.

/** A big boulder for the cave wall: a heap of rounded stones, about 3 across. */
export function buildWallRock(scene: Scene): Mesh {
  return kitMesh(scene, 'cave-wall-rock', () =>
    merged([
      shaded(sphere(3.2, 8, [0, 1.0, 0], [1.2, 0.95, 1]), '#4d3d68', '#8a76a8', 0, 2.4),
      shaded(sphere(2.0, 7, [1.5, 0.6, 0.5], [1.1, 0.9, 1]), '#52416e', '#8f7bae', 0, 1.6),
      shaded(sphere(1.7, 6, [-1.4, 0.55, -0.3], [1.1, 0.95, 1]), '#4d3d68', '#8a76a8', 0, 1.4),
      shaded(sphere(1.5, 6, [0.2, 2.0, 0.1], [1.1, 0.8, 1]), '#5d4a7a', '#9a86b8', 1.2, 2.8),
    ]),
  );
}

/** A stalagmite: a rounded cone of stone, a smaller one beside it. */
export function buildStalagmite(scene: Scene): Mesh {
  return kitMesh(scene, 'cave-stalagmites', () =>
    merged([
      shaded(cylinder(1.6, 0.12, 0.7, 8, [0, 0.8, 0]), '#55447a', '#a592c4', 0, 1.6),
      shaded(sphere(0.2, 4, [0, 1.6, 0]), '#a592c4', '#b6a4d4', 1.5, 1.7),
      shaded(cylinder(0.9, 0.08, 0.45, 7, [0.55, 0.45, 0.2]), '#5a487f', '#a08dc0', 0, 0.9),
    ]),
  );
}

/** A crystal cluster: a few pastel points that glow (the material is lit by the land's glow). */
export function buildCrystals(scene: Scene): Mesh {
  const points: readonly [number, number, number, number, number, string][] = [
    [0, 0, 0.85, 0.2, 0.0, '#9af0ff'],
    [0.2, 0.08, 0.55, 0.15, 0.3, '#ff9cd6'],
    [-0.18, 0.1, 0.5, 0.14, -0.35, '#c9a8ff'],
  ];
  return kitMesh(scene, 'cave-crystals', () =>
    merged(
      points.map(([x, z, h, d, lean, hex]) =>
        flat(cylinder(h, 0.01, d, 5, [x, h / 2, z], [lean, 0, lean * 0.5]), hex),
      ),
    ),
  );
}

/** A ring of glowing caps, for the cave's glow mushrooms. */
export function buildGlowCaps(scene: Scene): Mesh {
  return kitMesh(scene, 'cave-glow-caps', glowCaps);
}

function glowCaps(): Part {
  const caps: readonly [number, number, number, string][] = [
    [0, 0, 1, '#8ef0ff'],
    [0.2, 0.1, 0.8, '#ff9cd6'],
    [-0.18, 0.12, 0.75, '#8ef0ff'],
    [0.05, -0.2, 0.7, '#ff9cd6'],
  ];
  return merged(
    caps.flatMap(([x, z, s, cap]) => [
      flat(cylinder(0.2 * s, 0.06 * s, 0.075 * s, 6, [x, 0.1 * s, z]), '#f6e9d8'),
      shaded(sphere(0.26 * s, 6, [x, 0.22 * s, z], [1, 0.58, 1]), cap, cap, 0, 1),
    ]),
  );
}

/** A dark nook for the Lantern: a rock hump with a black doorway and a crystal peeking out. */
export function buildNook(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'land-spot-nook', () =>
    merged([
      // The cave's own stone, so it reads as solid against the dark floor, not a pale ghost.
      shaded(sphere(1.0, 8, [0, 0.25, 0], [1.1, 0.72, 0.95]), '#5e4f82', '#a597c8', 0, 0.7),
      // The doorway: a dark arch with a pale rim, so it reads as a doorway, not a mouth.
      flat(cylinder(0.03, 0.62, 0.62, 14, [0, 0.27, -0.44], [Math.PI / 2, 0, 0]), '#d9cdf0'),
      flat(cylinder(0.03, 0.48, 0.48, 14, [0, 0.27, -0.455], [Math.PI / 2, 0, 0]), '#1b1230'),
      flat(cylinder(0.32, 0.01, 0.1, 5, [0.3, 0.55, -0.15]), '#e6cdfc'),
    ]),
  );
  return { mesh, glint: 0.9 };
}

/** Glow mushrooms to boop: the same ring of caps, at spot size. */
export function buildGlowMushroomSpot(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'land-spot-glow-mushrooms', () => {
    const part = glowCaps();
    part.scaling.setAll(1.15); // TUNE: big enough to spot, small enough not to crowd the joystick
    return part.bakeCurrentTransformIntoVertices();
  });
  return { mesh, glint: 0.55 };
}

/** The cave's rock to lift: rounded purple-grey stone, no moss, a crystal peeking out. */
export function buildCaveRock(scene: Scene): SpotShape {
  const mesh = kitMesh(scene, 'land-spot-cave-rock', () =>
    merged([
      shaded(sphere(0.78, 8, [0, 0.2, 0], [1.1, 0.72, 1]), '#6f6290', '#b9aed6', 0, 0.5),
      shaded(sphere(0.36, 5, [0.36, 0.1, -0.12], [1.1, 0.7, 1]), '#695c8a', '#ada2cc', 0, 0.22),
      shaded(
        sphere(0.42, 6, [-0.08, 0.42, 0.05], [1.1, 0.5, 0.95]),
        '#7a6c9c',
        '#c6bce0',
        0.3,
        0.6,
      ),
      flat(cylinder(0.26, 0.01, 0.08, 5, [-0.3, 0.3, 0.12], [0.3, 0, 0.4]), '#9af0ff'),
    ]),
  );
  return { mesh, glint: 0.85 };
}
