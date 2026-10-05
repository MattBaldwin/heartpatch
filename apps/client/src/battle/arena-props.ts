import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged, painted } from '../map/map-scene.js';
import type { ArenaPropKind } from './arena-config.js';

// Small procedural props only the arena uses (vinyl-toy style, design doc
// §19), made like the map's (`buildProp`): builder parts painted with vertex
// colours and merged into one mesh, drawn with thin instances. Sizes are at
// scale 1, in world units; the arena's groups scale them.

/** `color`: the terrain's tone, for grass tufts and hills; others keep their own. */
export function buildArenaProp(
  scene: Scene,
  kind: ArenaPropKind,
  color: string,
): { mesh: Mesh; shadow: number } {
  const at = (m: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh => {
    m.position.set(x, y, z);
    m.scaling.set(sx, sy, sz);
    return m;
  };
  const sphere = (d: number, segments = 10) =>
    CreateSphere(`${kind}-part`, { diameter: d, segments }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 8) =>
    CreateCylinder(
      `${kind}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
      scene,
    );
  // TUNE: every size and colour below.
  switch (kind) {
    case 'tuft': {
      // Three soft blades of grass, leaning out.
      const blade = (x: number, z: number, lean: number, h: number) => {
        const b = at(cylinder(h, 0.01, 0.07, 6), x, h / 2, z);
        b.rotation.set(lean * Math.sign(z || 1), 0, -lean * Math.sign(x || 1));
        return painted(b, color);
      };
      return {
        mesh: merged(kind, [
          blade(0, 0, 0.05, 0.36),
          blade(0.06, 0.02, 0.35, 0.28),
          blade(-0.06, -0.02, 0.35, 0.3),
        ]),
        shadow: 0,
      };
    }
    case 'flower':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.26, 0.02, 0.025, 6), 0, 0.13, 0), '#7fc489'),
          painted(at(sphere(0.12, 8), 0, 0.28, 0, 1.3, 0.55, 1.3), '#ffd1e6'),
          painted(at(sphere(0.06, 6), 0, 0.31, 0), '#ffd86b'),
        ]),
        shadow: 0,
      };
    case 'reed':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.9, 0.02, 0.04, 6), 0, 0.45, 0), '#86b97a'),
          painted(at(cylinder(0.7, 0.02, 0.035, 6), 0.08, 0.35, 0.03), '#95c587'),
          painted(at(sphere(0.09, 6), 0, 0.92, 0, 1, 2.2, 1), '#a9805e'),
        ]),
        shadow: 0.25,
      };
    case 'mushroom':
      return {
        mesh: merged(kind, [
          painted(at(cylinder(0.24, 0.1, 0.13, 10), 0, 0.12, 0), '#fff1dc'),
          painted(at(sphere(0.36, 12), 0, 0.26, 0, 1, 0.6, 1), '#ff8f8f'),
          painted(at(sphere(0.07, 6), 0.08, 0.36, 0.05), '#ffffff'),
          painted(at(sphere(0.06, 6), -0.09, 0.34, -0.04), '#ffffff'),
        ]),
        shadow: 0.4,
      };
    case 'glow-tree':
      // Juniper's Gap's tree (the map's landmark), at arena size.
      return {
        mesh: merged(kind, [
          painted(at(cylinder(3, 0.5, 0.95, 12), 0, 1.5, 0), '#c9a27e'),
          painted(at(sphere(3.6, 16), 0, 3.7, 0, 1, 0.9, 1), '#f3b6ff'),
          painted(at(sphere(2.2, 14), 0, 5.4, 0), '#ffd1f0'),
        ]),
        shadow: 2.6,
      };
    case 'mound':
      // A rolling hill: a squashed dome sunk into the ground.
      return {
        mesh: merged(kind, [painted(at(sphere(2, 16), 0, -0.25, 0, 1.3, 0.55, 1), color)]),
        shadow: 0,
      };
  }
}
