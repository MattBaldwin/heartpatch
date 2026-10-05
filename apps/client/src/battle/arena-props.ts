import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { merged, painted } from '../map/map-scene.js';
import type { ArenaPropKind } from './arena-config.js';

// The two props only the arena uses (vinyl-toy style, design doc §19), made
// like the map's (`buildProp`): builder parts painted with vertex colours and
// merged into one mesh, drawn with thin instances. Every other arena prop is
// the map's own. Sizes are at scale 1, in world units; the arena's groups
// scale them.

/** `color`: the terrain's tone, for hill mounds; the Gap's tree keeps its own. */
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
