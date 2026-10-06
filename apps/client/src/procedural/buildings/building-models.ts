import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { BUILDING_COLORS as C, LEVEL_SCALE } from './building-config.js';

// Procedural building models (design doc §13, §19): primitives merged into
// one vertex-coloured mesh per look, so every building of a kind is one draw
// call (CLAUDE.md rule 8). Glowing parts (flames, a lit grin) are a second
// mesh drawn with an unlit material. No textures, no third-party art.

/** One look of a building: its body and, if it has one, its glowing parts. */
export interface BuildingModel {
  readonly body: Mesh;
  readonly glow: Mesh | null;
}

/** Which look a building shows: lit or out for fires; one look for the rest. */
export type BuildingLook = 'lit' | 'out' | 'plain';

/** The model key for a building, its look and its level (each level has its own model). */
export function modelKey(buildingId: string, look: BuildingLook, level = 1): string {
  return `${buildingId}:${look}:${String(level)}`;
}

/** How much bigger a level stands (`LEVEL_SCALE`; past the table, its last entry). */
export function levelScale(level: number): { across: number; up: number } {
  const i = Math.max(0, Math.min(level, LEVEL_SCALE.length) - 1);
  return LEVEL_SCALE[i] ?? { across: 1, up: 1 };
}

function linear(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}

/**
 * Builds one look at one level. Each level adds detail (owner decision
 * 2026-10-06), and `levelScale` makes it a little bigger. Unknown ids get a
 * plain marker so new data never breaks the scene.
 */
export function buildBuildingModel(
  scene: Scene,
  buildingId: string,
  look: BuildingLook,
  level = 1,
): BuildingModel {
  const name = modelKey(buildingId, look, level);
  const l = Math.max(1, level);
  const body: Mesh[] = [];
  const glow: Mesh[] = [];
  /**
   * Adds one primitive in one colour, or shaded per vertex: `shade` gets the
   * vertex's model-space position and returns its colour (flame gradients,
   * firelight on stones).
   */
  const part = (
    list: Mesh[],
    mesh: Mesh,
    color: string,
    at: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0],
    shade?: (p: Vector3) => Color3,
  ): void => {
    mesh.position.set(...at);
    mesh.scaling.set(...scale);
    mesh.rotation.set(...rotation);
    const c = linear(color);
    const count = mesh.getTotalVertices();
    const colors = new Float32Array(count * 4);
    const local = shade ? mesh.getVerticesData(VertexBuffer.PositionKind) : null;
    const world = shade ? mesh.computeWorldMatrix(true) : null;
    const p = new Vector3();
    for (let i = 0; i < count; i++) {
      let v = c;
      if (shade && local && world) {
        Vector3.TransformCoordinatesFromFloatsToRef(
          local[i * 3] ?? 0,
          local[i * 3 + 1] ?? 0,
          local[i * 3 + 2] ?? 0,
          world,
          p,
        );
        v = shade(p);
      }
      colors.set([v.r, v.g, v.b, 1], i * 4);
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    list.push(mesh);
  };
  /** A flame lick: a white-gold heart at its base fading to orange at its tip. */
  const flameShade =
    (base: number, top: number, from: string, to: string) =>
    (p: Vector3): Color3 => {
      const t = Math.min(1, Math.max(0, (p.y - base) / Math.max(0.01, top - base)));
      return Color3.Lerp(linear(from), linear(to), t);
    };
  const sphere = (d: number, segments = 12) =>
    CreateSphere(`${name}-part`, { diameter: d, segments }, scene);
  const cylinder = (h: number, top: number, bottom: number, tessellation = 12) =>
    CreateCylinder(
      `${name}-part`,
      { height: h, diameterTop: top, diameterBottom: bottom, tessellation },
      scene,
    );
  /** Calls `make` for `count` angles evenly around a circle. */
  const around = (count: number, make: (angle: number, i: number) => void) => {
    for (let i = 0; i < count; i++) make((i / count) * Math.PI * 2, i);
  };

  // TUNE: every size and colour below.
  switch (buildingId) {
    case 'hearthfire': {
      // Level 1: a ring of stones round a log pile. Level 2: a second, higher
      // course of stones and a taller fire. Level 3: three lantern posts too,
      // and the biggest, brightest flame.
      const stones = 7 + 2 * (l - 1);
      // A lit fire warms the stones' inner faces (its light falling on them).
      const warmed = (color: string) =>
        look === 'lit'
          ? (p: Vector3) => {
              const inward = Math.min(1, Math.max(0, (0.46 - Math.hypot(p.x, p.z)) / 0.2));
              return Color3.Lerp(linear(color), linear(C.fireWarm), inward * 0.7);
            }
          : undefined;
      around(stones, (a, i) => {
        const color = i % 2 === 0 ? C.stone : C.stoneDark;
        part(
          body,
          sphere(0.24, 8),
          color,
          [Math.cos(a) * 0.38, 0.08, Math.sin(a) * 0.38],
          [1.1, 0.75, 1],
          [0, 0, 0],
          warmed(color),
        );
      });
      if (l >= 2) {
        around(stones - 2, (a, i) => {
          const turn = a + Math.PI / stones;
          const color = i % 2 === 0 ? C.stoneDark : C.stone;
          part(
            body,
            sphere(0.16, 8),
            color,
            [Math.cos(turn) * 0.33, 0.16, Math.sin(turn) * 0.33],
            [1.1, 0.7, 1],
            [0, 0, 0],
            warmed(color),
          );
        });
      }
      for (const turn of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        part(
          body,
          cylinder(0.5, 0.09, 0.1),
          C.log,
          [0, 0.08, 0],
          [1, 1, 1],
          [Math.PI / 2, turn, 0],
        );
      }
      if (l >= 3) {
        around(3, (a) => {
          const at = (r: number, y: number): [number, number, number] => [
            Math.cos(a + Math.PI / 6) * r,
            y,
            Math.sin(a + Math.PI / 6) * r,
          ];
          part(body, cylinder(0.5, 0.05, 0.07), C.post, at(0.52, 0.25));
          part(look === 'lit' ? glow : body, sphere(0.12, 8), C.lantern, at(0.52, 0.53));
        });
      }
      if (look === 'lit') {
        const f = 1 + 0.25 * (l - 1); // TUNE: a bigger, brighter fire each level
        const top = 0.95 * f;
        // Outer flame: gold at the base to orange-red at the tips; the inner
        // core is a white-gold heart (bright enough for the bloom pass).
        const outer = flameShade(0.05, top, C.flameCore, C.flameTip);
        const inner = flameShade(0.1, 0.7 * f, C.flameHeart, C.flame);
        part(glow, sphere(0.4 * f, 16), C.flame, [0, 0.32 * f, 0], [1, 1.5, 1], [0, 0, 0], outer);
        part(
          glow,
          sphere(0.24 * f, 12),
          C.flameCore,
          [0, 0.36 * f, -0.06],
          [1, 1.5, 1],
          [0, 0, 0],
          inner,
        );
        part(
          glow,
          sphere(0.14 * f),
          C.flame,
          [0.12, 0.62 * f, 0.02],
          [1, 1.6, 1],
          [0, 0, 0],
          outer,
        );
        if (l >= 2) {
          part(
            glow,
            sphere(0.13 * f),
            C.flame,
            [-0.12, 0.6 * f, -0.02],
            [1, 1.6, 1],
            [0, 0, 0],
            outer,
          );
          part(glow, sphere(0.1 * f), C.flameCore, [0, 0.74 * f, 0], [1, 1.7, 1], [0, 0, 0], outer);
        }
      } else {
        part(body, sphere(0.3), C.ash, [0, 0.12, 0], [1, 0.45, 1]);
      }
      break;
    }
    case 'jack-o-lantern-hearthfire': {
      around(6, (a) => {
        part(
          body,
          sphere(0.38, 12),
          C.pumpkin,
          [Math.cos(a) * 0.12, 0.3, Math.sin(a) * 0.12],
          [0.85, 1, 0.85],
        );
      });
      part(body, sphere(0.6, 16), C.pumpkinDark, [0, 0.3, 0], [1.05, 0.95, 1.05]);
      part(body, cylinder(0.16, 0.05, 0.08), C.stem, [0, 0.64, 0], [1, 1, 1], [0.15, 0, 0.1]);
      // The grin faces the camera (−z).
      const faceList = look === 'lit' ? glow : body;
      const face = look === 'lit' ? C.face : C.faceOut;
      part(faceList, sphere(0.12, 8), face, [-0.12, 0.38, -0.29], [1, 1.2, 0.35]);
      part(faceList, sphere(0.12, 8), face, [0.12, 0.38, -0.29], [1, 1.2, 0.35]);
      part(faceList, sphere(0.26, 10), face, [0, 0.22, -0.28], [1.3, 0.45, 0.35]);
      break;
    }
    case 'ember-den': {
      part(body, cylinder(0.08, 0.98, 1, 24), C.denTrim, [0, 0.04, 0]);
      part(body, sphere(0.86, 20), C.den, [0, 0.08, 0], [1, 0.82, 1]);
      part(body, sphere(0.34, 12), C.door, [0, 0.16, -0.38], [0.85, 1, 0.3]);
      // Level 2: a taller chimney, a second cosy room and a lit window.
      const chimney = l >= 2 ? 0.4 : 0.24;
      part(body, cylinder(chimney, 0.1, 0.12), C.denTrim, [0.22, 0.48 + chimney / 3, 0.1]);
      part(glow, sphere(0.1, 8), C.flame, [0.22, 0.6 + chimney / 2, 0.1], [1, 1.3, 1]);
      if (l >= 2) {
        part(body, sphere(0.5, 16), C.den, [-0.42, 0.06, 0.2], [1, 0.8, 1]);
        part(glow, sphere(0.14, 8), C.window, [-0.42, 0.24, -0.03], [1, 0.9, 0.3]);
      }
      break;
    }
    case 'cozy-meadow': {
      part(body, cylinder(0.06, 1, 1, 24), C.grass, [0, 0.03, 0]);
      // Level 2: a flower arch at the gate and twice the flowers.
      if (l >= 2) {
        part(
          body,
          CreateTorus(`${name}-arch`, { diameter: 0.4, thickness: 0.05, tessellation: 20 }, scene),
          C.fence,
          [0, 0.2, -0.46],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
        for (const [x, y] of [
          [-0.17, 0.3],
          [0, 0.4],
          [0.17, 0.3],
        ] as const) {
          part(body, sphere(0.08, 8), C.petal, [x, y, -0.46]);
        }
        for (const [x, z, color] of [
          [0.28, 0.2, C.petalAlt],
          [-0.3, 0.05, C.petal],
          [0.12, -0.3, C.petal],
          [-0.05, 0.05, C.petalAlt],
        ] as const) {
          part(body, sphere(0.09, 8), color, [x, 0.08, z], [1, 0.7, 1]);
        }
      }
      around(9, (a) => {
        part(body, cylinder(0.18, 0.06, 0.07, 8), C.fence, [
          Math.cos(a) * 0.46,
          0.12,
          Math.sin(a) * 0.46,
        ]);
      });
      part(
        body,
        CreateTorus(`${name}-rail`, { diameter: 0.92, thickness: 0.04, tessellation: 24 }, scene),
        C.fence,
        [0, 0.16, 0],
      );
      for (const [x, z, color] of [
        [-0.2, 0.15, C.petal],
        [0.18, -0.1, C.petalAlt],
        [0.05, 0.28, C.petal],
        [-0.12, -0.24, C.petalAlt],
      ] as const) {
        part(body, sphere(0.09, 8), color, [x, 0.08, z], [1, 0.7, 1]);
      }
      break;
    }
    case 'training-grounds': {
      // A soft round practice mat with bouncy bollards, and a cushioned
      // target on a stand to boop. Level 2: a bigger mat, a second target and
      // a pennant.
      const mat = l >= 2 ? 1.04 : 0.96;
      part(body, cylinder(0.06, mat, mat, 28), C.matTrim, [0, 0.03, 0]);
      part(body, cylinder(0.07, mat - 0.12, mat - 0.12, 28), C.mat, [0, 0.04, 0]);
      around(l >= 2 ? 8 : 6, (a) => {
        const r = mat / 2 - 0.02;
        part(body, cylinder(0.12, 0.05, 0.06, 8), C.post, [Math.cos(a) * r, 0.1, Math.sin(a) * r]);
        part(body, sphere(0.09, 8), C.target, [Math.cos(a) * r, 0.19, Math.sin(a) * r]);
      });
      const target = (x: number, z: number) => {
        part(body, cylinder(0.32, 0.05, 0.06, 8), C.post, [x, 0.2, z]);
        part(
          body,
          cylinder(0.08, 0.36, 0.36, 20),
          C.target,
          [x, 0.45, z],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
        part(
          body,
          cylinder(0.09, 0.22, 0.22, 20),
          C.targetRing,
          [x, 0.45, z - 0.005],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
        part(
          body,
          cylinder(0.1, 0.09, 0.09, 16),
          C.target,
          [x, 0.45, z - 0.01],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
      };
      // The target faces the camera (−z), at the front of the mat.
      // Level 2's two stand close together, so trainees hop about either side.
      target(l >= 2 ? 0.13 : 0, l >= 2 ? -0.26 : -0.2);
      if (l >= 2) {
        target(-0.13, -0.18);
        part(body, cylinder(0.8, 0.035, 0.035, 8), C.post, [0.36, 0.4, 0.25]);
        part(
          body,
          CreateBox(`${name}-flag`, { width: 0.22, height: 0.14, depth: 0.02 }, scene),
          C.flag,
          [0.47, 0.72, 0.25],
        );
      }
      break;
    }
    default:
      part(body, CreateBox(`${name}-box`, { size: 0.5 }, scene), C.plain, [0, 0.25, 0]);
  }
  // Each level stands a little bigger.
  const { across, up } = levelScale(l);
  if (across !== 1 || up !== 1) {
    for (const mesh of [...body, ...glow]) {
      mesh.position.multiplyInPlace(new Vector3(across, up, across));
      mesh.scaling.multiplyInPlace(new Vector3(across, up, across));
    }
  }

  const merge = (parts: Mesh[], suffix: string): Mesh | null => {
    if (parts.length === 0) return null;
    const mesh = Mesh.MergeMeshes(parts, true, true);
    if (!mesh) throw new Error(`could not build ${name}`);
    mesh.name = `${name}${suffix}`;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  };
  const merged = merge(body, '');
  if (!merged) throw new Error(`${name} has no body`);
  return { body: merged, glow: merge(glow, '-glow') };
}
