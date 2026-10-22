import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  box,
  cylinderPart,
  disc,
  kitMesh,
  merged,
  painted,
  uvSphere,
  type Part,
} from '../explore/kit-mesh.js';
import { keepColour } from '../map/terrain-plugin.js';

/*
 * A grey village tile's broken thing (#306 PR 2b), in the vinyl-toy kit
 * (design doc §19): a music box, a mural or a fountain, each a broken and a
 * fixed look, one merged mesh each on the land's prop material (one draw
 * call, only one shown). The broken one greys with the drain like the land;
 * the fixed one keeps its colour, so mending it shows at once. World units,
 * about the size of a search spot's rock.
 */

/** The two looks of a skin's broken thing, built once per engine (`kitMesh`). */
export interface PuzzleProp {
  readonly broken: Mesh;
  readonly fixed: Mesh;
}

export function buildPuzzleProp(scene: Scene, skin: string, material: Material): PuzzleProp {
  const shapes = SHAPES[skin] ?? SHAPES['music-box'];
  if (!shapes) throw new Error('no puzzle prop shapes');
  const broken = kitMesh(scene, `hollowed-${skin}-broken`, shapes.broken);
  const fixed = kitMesh(scene, `hollowed-${skin}-fixed`, shapes.fixed);
  for (const mesh of [broken, fixed]) {
    mesh.material = material;
    mesh.isPickable = false;
    // Placed once; never moves.
    mesh.alwaysSelectAsActiveMesh = false;
  }
  // Mended, it's the village's colour coming back.
  keepColour(fixed);
  return { broken, fixed };
}

const at = (part: Part, x: number, y: number, z: number): Part => {
  part.position.set(x, y, z);
  return part;
};

const SHAPES: Readonly<Record<string, { broken: () => Part; fixed: () => Part }>> = {
  'music-box': {
    broken: () => {
      const lid = painted(box({ width: 0.62, height: 0.07, depth: 0.44 }), '#b07a4a');
      lid.position.set(0.5, 0.05, 0.12);
      lid.rotation.y = 0.7;
      const crank = painted(cylinderPart({ height: 0.18, diameter: 0.05 }), '#c9b48a');
      crank.position.set(-0.45, 0.03, -0.25);
      crank.rotation.z = Math.PI / 2;
      return merged([
        at(painted(box({ width: 0.62, height: 0.36, depth: 0.44 }), '#8a5a3a'), 0, 0.18, 0),
        lid,
        crank,
        at(painted(uvSphere({ diameter: 0.1, segments: 6 }), '#d9c6b0'), -0.3, 0.05, 0.35),
        at(painted(uvSphere({ diameter: 0.08, segments: 6 }), '#d9c6b0'), 0.25, 0.04, -0.38),
      ]);
    },
    fixed: () => {
      const lid = painted(box({ width: 0.62, height: 0.07, depth: 0.44 }), '#d08a54');
      lid.position.set(0, 0.5, 0.2);
      lid.rotation.x = -1.1;
      const crank = painted(cylinderPart({ height: 0.18, diameter: 0.05 }), '#ffc94d');
      crank.position.set(0.38, 0.22, 0);
      crank.rotation.z = Math.PI / 2;
      return merged([
        at(painted(box({ width: 0.62, height: 0.36, depth: 0.44 }), '#b5623d'), 0, 0.18, 0),
        at(painted(box({ width: 0.66, height: 0.05, depth: 0.48 }), '#ffc94d'), 0, 0.34, 0),
        lid,
        crank,
        at(painted(cylinderPart({ height: 0.12, diameter: 0.05 }), '#fffaf0'), 0, 0.42, -0.04),
        at(painted(uvSphere({ diameter: 0.14, segments: 8 }), '#ff9fb2'), 0, 0.53, -0.04),
      ]);
    },
  },
  mural: {
    broken: () => {
      const fallen = (x: number, z: number, turn: number) => {
        const tile = painted(box({ width: 0.16, height: 0.04, depth: 0.16 }), '#c9c0b2');
        tile.position.set(x, 0.02, z);
        tile.rotation.y = turn;
        return tile;
      };
      return merged([
        at(painted(box({ width: 0.9, height: 0.62, depth: 0.14 }), '#b8ab98'), 0, 0.31, 0),
        at(painted(box({ width: 0.96, height: 0.06, depth: 0.18 }), '#a39684'), 0, 0.64, 0),
        at(painted(box({ width: 0.18, height: 0.18, depth: 0.02 }), '#6e6658'), -0.2, 0.36, -0.08),
        at(painted(box({ width: 0.18, height: 0.18, depth: 0.02 }), '#6e6658'), 0.2, 0.36, -0.08),
        fallen(-0.35, -0.3, 0.4),
        fallen(0.3, -0.35, -0.6),
      ]);
    },
    fixed: () => {
      const picture = (x: number, y: number, hex: string) =>
        at(painted(box({ width: 0.18, height: 0.18, depth: 0.02 }), hex), x, y, -0.08);
      return merged([
        at(painted(box({ width: 0.9, height: 0.62, depth: 0.14 }), '#f3e3c8'), 0, 0.31, 0),
        at(painted(box({ width: 0.96, height: 0.06, depth: 0.18 }), '#d08a54'), 0, 0.64, 0),
        picture(-0.2, 0.44, '#ffc94d'),
        picture(0.2, 0.44, '#5fae6a'),
        picture(-0.2, 0.2, '#e8746a'),
        picture(0.2, 0.2, '#8fb7ff'),
      ]);
    },
  },
  fountain: {
    broken: () => {
      const inside = painted(disc({ radius: 0.34, tessellation: 20 }), '#5f574c');
      inside.rotation.x = Math.PI / 2;
      inside.position.y = 0.2;
      const chip = painted(box({ width: 0.14, height: 0.04, depth: 0.12 }), '#a39684');
      chip.position.set(0.48, 0.02, -0.2);
      chip.rotation.y = 0.5;
      return merged([
        at(
          painted(cylinderPart({ height: 0.22, diameter: 0.86, tessellation: 20 }), '#b8ab98'),
          0,
          0.11,
          0,
        ),
        inside,
        at(
          painted(cylinderPart({ height: 0.26, diameter: 0.12, tessellation: 10 }), '#a39684'),
          0,
          0.3,
          0,
        ),
        chip,
      ]);
    },
    fixed: () => {
      const water = painted(disc({ radius: 0.36, tessellation: 20 }), '#7fc8f0');
      water.rotation.x = Math.PI / 2;
      water.position.y = 0.2;
      return merged([
        at(
          painted(cylinderPart({ height: 0.22, diameter: 0.86, tessellation: 20 }), '#e9dcc4'),
          0,
          0.11,
          0,
        ),
        water,
        at(
          painted(cylinderPart({ height: 0.34, diameter: 0.12, tessellation: 10 }), '#d08a54'),
          0,
          0.34,
          0,
        ),
        at(painted(uvSphere({ diameter: 0.2, segments: 8 }), '#bfe6ff'), 0, 0.56, 0),
      ]);
    },
  },
};
