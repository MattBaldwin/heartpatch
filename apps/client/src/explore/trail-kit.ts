import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged } from '../map/map-props.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';

// The mountain trail's shapes (#335 art reset), on the meadow's kit: the same
// vinyl-toy primitives, vertex-coloured from a darker foot to a sunlit top
// (art bible §4), one merged mesh each. The search spots that live on the
// trail are drawn here at world size; the meadow's own helpers do the work.

/** What a spot prop gives back: its mesh, and how high its glint floats (world units). */
export interface SpotShape {
  readonly mesh: Mesh;
  readonly glint: number;
}

/** A lookout: a chunky stone step with a mossy top and a little pink flag. */
export function buildLookout(scene: Scene): SpotShape {
  const mesh = merged('land-spot-lookout', [
    shaded(sphere(scene, 1.0, 8, [0, 0.22, 0], [1.15, 0.6, 1]), '#9a93a6', '#d9d3e0', 0, 0.55),
    shaded(sphere(scene, 0.62, 6, [0.42, 0.14, 0.18], [1.1, 0.65, 1]), '#948da0', '#d2ccd9', 0, 0.35),
    shaded(sphere(scene, 0.66, 6, [-0.08, 0.5, 0], [1.1, 0.3, 0.95]), '#86b27a', '#b6dc96', 0.42, 0.62),
    flat(cylinder(scene, 0.62, 0.025, 0.03, 5, [0.12, 0.88, 0.02]), '#7d5a3f'),
    // The flag: a flat, rounded pennant.
    flat(sphere(scene, 0.3, 4, [0.27, 1.08, 0.02], [1, 0.55, 0.12]), '#ff8fb8'),
  ]);
  return { mesh, glint: 1.35 };
}

/** A snow drift: a soft heap with a twig poking out, ready for the stick. */
export function buildSnowDrift(scene: Scene): SpotShape {
  const mesh = merged('land-spot-snow-drift', [
    shaded(sphere(scene, 0.9, 8, [0, 0.0, 0], [1.15, 0.5, 1]), '#dfe6f6', '#ffffff', -0.1, 0.3),
    shaded(sphere(scene, 0.48, 6, [-0.22, 0.08, 0.12], [1, 0.7, 1]), '#e4eaf8', '#ffffff', 0, 0.3),
    shaded(sphere(scene, 0.34, 5, [0.3, 0.05, -0.1], [1, 0.65, 1]), '#e4eaf8', '#ffffff', 0, 0.2),
    flat(cylinder(scene, 0.34, 0.012, 0.03, 4, [0.1, 0.34, -0.02], [0.2, 0, -0.35]), '#8a5f3a'),
  ]);
  return { mesh, glint: 0.65 };
}

/** A cairn: smooth stones stacked by trail walkers, the smallest on top. */
export function buildCairn(scene: Scene): SpotShape {
  const stones: readonly [number, number, number, string, string][] = [
    [0.62, 0.17, 0.0, '#8f8896', '#cfc9d6'],
    [0.46, 0.4, 0.02, '#9a94a2', '#d9d3e0'],
    [0.33, 0.58, -0.02, '#a49eac', '#e3deea'],
    [0.2, 0.72, 0.01, '#b0aab8', '#ece8f1'],
  ];
  const mesh = merged(
    'land-spot-cairn',
    stones.map(([d, y, x, lo, hi]) =>
      shaded(sphere(scene, d, 6, [x, y, 0], [1, 0.62, 1]), lo, hi, y - d * 0.3, y + d * 0.3),
    ),
  );
  return { mesh, glint: 1.0 };
}
