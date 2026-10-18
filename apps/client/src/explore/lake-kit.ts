import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { kitMesh, merged, type Part } from './kit-mesh.js';
import { WATER_COLORS } from './lake-config.js';
import { cylinder, flat, shaded, sphere } from './land-kit.js';

// The lake's shapes on the meadow's kit (#335 art reset): the same
// vinyl-toy language (smooth icospheres, a darker foot rising to a sunlit
// tip, baked into vertex colours), thin-instanced, one draw call a kind,
// world units with the foot at the origin. Only what the meadow doesn't
// have: kelp, coral, a fish, a bubble, and the two lake search spots.

/**
 * A kelp clump: three tapering, leaning stalks of flattened blobs, each with
 * a little float bulb at the tip, 1.3 to 2.1 tall. Sways from its tip on the
 * terrain plugin.
 */
export function buildKelp(scene: Scene): Mesh {
  return kitMesh(scene, 'lake-kelp', kelp);
}

function kelp(): Part {
  const parts: Part[] = [];
  const stalks: { height: number; lean: [number, number]; at: [number, number] }[] = [
    { height: 2.1, lean: [0.18, 0.05], at: [0, 0] },
    { height: 1.7, lean: [-0.15, 0.12], at: [0.22, 0.1] },
    { height: 1.3, lean: [0.05, -0.16], at: [-0.2, -0.08] },
  ];
  stalks.forEach(({ height, lean, at }, i) => {
    const [foot, tip] = WATER_COLORS.kelp[i % WATER_COLORS.kelp.length] ?? ['#2c7f66', '#6fd09a'];
    const links = 5;
    for (let k = 0; k < links; k++) {
      const t = k / (links - 1);
      const y = 0.1 + t * (height - 0.2);
      const d = 0.3 - t * 0.14;
      const blob = sphere(
        d,
        6,
        [at[0] + lean[0] * t * t * height, y, at[1] + lean[1] * t * t * height],
        [1, (height / links) * 3.4, 0.4],
      );
      parts.push(shaded(blob, foot, tip, 0, height));
    }
    const bulb = sphere(0.14, 3, [
      at[0] + lean[0] * height,
      height - 0.04,
      at[1] + lean[1] * height,
    ]);
    parts.push(flat(bulb, '#ffd9a0'));
  });
  return merged(parts);
}

/** A coral cluster: rounded fingers in pink, orange and lilac, 0.3 to 0.7 tall. */
export function buildCoral(scene: Scene): Mesh {
  return kitMesh(scene, 'lake-coral', coral);
}

function coral(): Part {
  const fingers: [number, number, number, number, number][] = [
    // x, z, height, lean x, lean z
    [0, 0, 0.7, 0.06, 0],
    [0.2, 0.1, 0.5, 0.2, 0.05],
    [-0.2, 0.06, 0.55, -0.18, 0],
    [0.04, -0.2, 0.4, 0, -0.18],
    [-0.08, 0.22, 0.34, -0.04, 0.2],
    [0.28, -0.12, 0.3, 0.2, -0.1],
  ];
  const parts: Part[] = [];
  fingers.forEach(([x, z, h, lx, lz], i) => {
    const hex = WATER_COLORS.coral[i % WATER_COLORS.coral.length] ?? '#ff8fb0';
    const finger = cylinder(h, 0.1, 0.17, 7, [x + lx * 0.5, h / 2, z + lz * 0.5], [lz, 0, -lx]);
    parts.push(shaded(finger, '#b0607e', hex, 0, h));
    parts.push(shaded(sphere(0.1, 6, [x + lx, h, z + lz]), hex, hex, 0, 1));
  });
  parts.push(shaded(sphere(0.62, 6, [0, 0.02, 0], [1, 0.4, 1]), '#a8587a', '#e98aa8', -0.1, 0.2));
  return merged(parts);
}

/**
 * A fish, white so each instance can carry its own colour (an instance
 * colour times the vertex colours), with dark eyes and pale fins. Faces +z.
 */
export function buildFish(scene: Scene): Mesh {
  return kitMesh(scene, 'lake-fish', fish);
}

function fish(): Part {
  const parts: Part[] = [
    shaded(sphere(0.34, 7, [0, 0, 0], [0.62, 0.9, 1.5]), '#d9d9d9', '#ffffff', -0.15, 0.15),
    flat(sphere(0.22, 5, [0, 0, -0.27], [0.18, 1, 1.1]), '#ffe6c8'),
    flat(sphere(0.16, 5, [0, 0.12, 0.02], [0.14, 1, 1.5]), '#ffe6c8'),
    flat(sphere(0.05, 3, [0.095, 0.04, 0.17]), '#24323f'),
    flat(sphere(0.05, 3, [-0.095, 0.04, 0.17]), '#24323f'),
  ];
  return merged(parts);
}

/** A bubble: a small pale ball (unlit; the drift shader grows and pops it). */
export function buildBubble(scene: Scene): Mesh {
  return kitMesh(scene, 'lake-bubbles', () => merged([flat(sphere(1, 6, [0, 0, 0]), '#ffffff')]));
}

/**
 * The lake's two search spots, sized to their colliders, with how high the
 * glint floats (world units). Null: not a lake spot.
 */
export function buildLakeSpotProp(
  scene: Scene,
  kind: string,
): { mesh: Mesh; glint: number } | null {
  switch (kind) {
    case 'pond':
      return { mesh: kitMesh(scene, 'lake-spot-spring', spring), glint: 1.05 };
    case 'reeds':
      return { mesh: kitMesh(scene, 'lake-spot-reeds', reeds), glint: 1.55 };
    default:
      return null;
  }
}

/** A bubble spring: a ring of pale pebbles round a dip in the sand, bubbles rising. */
function spring(): Part {
  const parts: Part[] = [
    shaded(sphere(0.8, 8, [0, -0.02, 0], [1, 0.22, 1]), '#6fa3a0', '#a8d6cf', -0.05, 0.1),
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(
      shaded(
        sphere(0.15, 6, [Math.cos(a) * 0.42, 0.04, Math.sin(a) * 0.42], [1.2, 0.6, 1]),
        '#b9b09f',
        '#eee6d6',
        0,
        0.1,
      ),
    );
  }
  for (const [x, y, z, d] of [
    [0.02, 0.2, 0, 0.16],
    [-0.04, 0.42, 0.02, 0.12],
    [0.03, 0.62, -0.02, 0.1],
    [-0.01, 0.8, 0.01, 0.07],
  ] as const) {
    parts.push(flat(sphere(d, 6, [x, y, z]), '#e6fbff'));
  }
  return merged(parts);
}

/** A reed bed: slim, leaning blades with a few brown tips, tied at the foot with sand. */
function reeds(): Part {
  const [foot, tip] = WATER_COLORS.reed;
  const parts: Part[] = [
    shaded(sphere(0.6, 6, [0, 0, 0], [1, 0.3, 1]), '#b8a47a', '#e0cf9e', -0.05, 0.12),
  ];
  const blades = 9;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.4;
    const h = 1.0 + (i % 3) * 0.22;
    const lean = 0.1 + (i % 2) * 0.1;
    const blade = cylinder(
      h,
      0.02,
      0.07,
      5,
      [Math.cos(a) * (0.1 + lean * h * 0.5), h / 2, Math.sin(a) * (0.1 + lean * h * 0.5)],
      [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
    );
    parts.push(shaded(blade, foot, tip, 0, h));
    if (i % 3 === 0) {
      parts.push(
        flat(
          sphere(
            0.12,
            4,
            [Math.cos(a) * (0.1 + lean * h), h - 0.1, Math.sin(a) * (0.1 + lean * h)],
            [1, 2.4, 1],
          ),
          '#8a5a3c',
        ),
      );
    }
  }
  return merged(parts);
}
