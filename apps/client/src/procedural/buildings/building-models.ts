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

/**
 * Which look a building shows: lit or out for fires; for a resource building
 * `plain` while it works and `out` while it naps (#601); one look for the rest.
 */
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
  const box = (width: number, height: number, depth: number) =>
    CreateBox(`${name}-part`, { width, height, depth }, scene);
  // A resource building's windows and lamps (#601): lit while it works,
  // dark while it naps (`out`).
  const awake = look !== 'out';
  const windowList = awake ? glow : body;
  const windowColor = awake ? C.window : C.windowOut;
  const lampColor = awake ? C.lantern : C.windowOut;
  const emberColor = awake ? C.ember : C.ash;
  const iceLampColor = awake ? C.iceGlow : C.windowOut;
  // The Greenhouse's panes are part of its body (they're seen, not lights).
  const glassList = body;
  const glassColor = awake ? C.glass : C.windowOut;
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
    case 'joy-lantern': {
      // A little open lantern on a stone step: four short posts holding a
      // rosy ring and, floating above it, a big heart-shaped flame (two lobes
      // over a point). Open-topped, so the map's high camera sees the heart.
      part(body, cylinder(0.14, 0.86, 0.92, 16), C.joyBase, [0, 0.07, 0]);
      around(4, (a) => {
        part(body, cylinder(0.5, 0.07, 0.08, 8), C.joyFrame, [
          Math.cos(a + Math.PI / 4) * 0.28,
          0.39,
          Math.sin(a + Math.PI / 4) * 0.28,
        ]);
      });
      part(
        body,
        CreateTorus(`${name}-ring`, { diameter: 0.6, thickness: 0.09, tessellation: 24 }, scene),
        C.joyRoof,
        [0, 0.66, 0],
      );
      const heart = look === 'lit' ? glow : body;
      const lobe = look === 'lit' ? C.joyFlame : C.joyOut;
      const heartShade = look === 'lit' ? flameShade(0.62, 1.12, C.joyCore, C.joyFlame) : undefined;
      for (const x of [-0.12, 0.12]) {
        part(heart, sphere(0.3, 14), lobe, [x, 0.98, 0], [1, 1, 0.85], [0, 0, 0], heartShade);
      }
      part(
        heart,
        cylinder(0.34, 0.44, 0, 14),
        lobe,
        [0, 0.8, 0],
        [1, 1, 0.75],
        [0, 0, 0],
        heartShade,
      );
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
    case 'crafting-factory': {
      // A toy workshop (#294 mockup): soft peach walls, a rosy roof, a round
      // window with a gear, a chimney puffing. Level 2: a second window and
      // a little belt carrying heart crates. Level 3: a second chimney, a
      // glowing star on the roof and a string of lanterns.
      part(
        body,
        CreateBox(`${name}-walls`, { width: 0.78, height: 0.42, depth: 0.56 }, scene),
        C.workshop,
        [0, 0.21, 0],
      );
      // Rounded corners: soft posts at each corner.
      for (const x of [-0.39, 0.39]) {
        for (const z of [-0.28, 0.28]) {
          part(body, cylinder(0.42, 0.1, 0.1, 10), C.workshop, [x, 0.21, z]);
        }
      }
      // The roof: a triangular prism along the width, a little wider than the walls.
      part(
        body,
        cylinder(0.92, 0.5, 0.5, 3),
        C.workshopRoof,
        [0, 0.52, 0],
        [1, 1, 1.35],
        [0, 0, Math.PI / 2],
      );
      const chimney = (x: number, z: number) => {
        part(body, cylinder(0.3, 0.12, 0.13, 10), C.chimney, [x, 0.72, z]);
        part(body, sphere(0.1, 8), C.puff, [x, 0.92, z]);
        part(body, sphere(0.07, 8), C.puff, [x + 0.05, 1.02, z]);
      };
      chimney(0.24, 0.08);
      if (l >= 3) chimney(-0.24, 0.08);
      // The front faces the camera (−z): a round window with a gear, a door.
      const porthole = (x: number, d: number) => {
        part(
          body,
          cylinder(0.04, d, d, 18),
          C.porthole,
          [x, 0.25, -0.29],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
      };
      porthole(-0.2, 0.2);
      part(
        body,
        CreateTorus(`${name}-gear`, { diameter: 0.1, thickness: 0.03, tessellation: 12 }, scene),
        C.gear,
        [-0.2, 0.25, -0.31],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      if (l >= 2) porthole(0.22, 0.16);
      part(
        body,
        CreateBox(`${name}-door`, { width: 0.16, height: 0.24, depth: 0.04 }, scene),
        C.door,
        [0.02, 0.12, -0.29],
      );
      part(
        body,
        cylinder(0.04, 0.16, 0.16, 14),
        C.door,
        [0.02, 0.24, -0.29],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      if (l >= 2) {
        // The belt out of the side, with a crate on it.
        part(
          body,
          CreateBox(`${name}-belt`, { width: 0.32, height: 0.05, depth: 0.16 }, scene),
          C.gear,
          [0.56, 0.06, -0.08],
        );
        part(body, CreateBox(`${name}-crate`, { size: 0.1 }, scene), C.crate, [0.6, 0.14, -0.08]);
      }
      if (l >= 3) {
        part(glow, sphere(0.12, 10), C.lantern, [0, 0.82, -0.04]);
        for (const x of [-0.3, -0.1, 0.1, 0.3]) {
          part(glow, sphere(0.05, 8), C.lantern, [x, 0.4, -0.31]);
        }
      }
      break;
    }
    // Resource buildings (#601 PR 7): one soft toy per land, each level
    // adding a piece (L2, L3, L4). Their windows and lamps glow while they
    // work; asleep (paused for upkeep, a napping homestead) they go dark.
    case 'woodcutters-hut': {
      // A log cabin with a mossy roof, a chopping stump with its axe, and a
      // log pile. L2: a chimney and a bigger pile. L3: a lean-to and a
      // lantern. L4: a saw wheel and a pennant.
      part(body, box(0.56, 0.36, 0.44), C.cabin, [0, 0.18, 0.04]);
      for (const y of [0.08, 0.2, 0.32]) {
        part(
          body,
          cylinder(0.6, 0.07, 0.07, 10),
          C.stump,
          [0, y, -0.18],
          [1, 1, 1],
          [0, 0, Math.PI / 2],
        );
      }
      part(
        body,
        cylinder(0.7, 0.5, 0.5, 3),
        C.cabinRoof,
        [0, 0.46, 0.04],
        [1, 1, 1.15],
        [0, 0, Math.PI / 2],
      );
      part(body, box(0.14, 0.2, 0.04), C.door, [0.1, 0.1, -0.2]);
      part(windowList, box(0.12, 0.1, 0.03), windowColor, [-0.14, 0.22, -0.2]);
      part(body, cylinder(0.14, 0.2, 0.22, 14), C.stump, [-0.36, 0.07, -0.3]);
      part(body, box(0.04, 0.18, 0.04), C.post, [-0.36, 0.22, -0.3], [1, 1, 1], [0, 0, 0.5]);
      part(body, box(0.1, 0.07, 0.03), C.axeHead, [-0.32, 0.3, -0.3], [1, 1, 1], [0, 0, 0.5]);
      const logs = l >= 2 ? 3 : 2;
      for (let i = 0; i < logs; i++) {
        part(
          body,
          cylinder(0.34, 0.1, 0.1, 10),
          C.log,
          [0.42, 0.06 + i * 0.09, 0.2 - i * 0.02],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
      }
      if (l >= 2) {
        part(body, box(0.1, 0.24, 0.1), C.stoneDark, [0.16, 0.62, 0.14]);
        part(body, sphere(0.08, 8), C.puff, [0.16, 0.8, 0.14]);
      }
      if (l >= 3) {
        part(body, box(0.26, 0.22, 0.34), C.cabin, [-0.4, 0.11, 0.12]);
        part(body, box(0.3, 0.04, 0.38), C.cabinRoof, [-0.4, 0.25, 0.12], [1, 1, 1], [0, 0, 0.25]);
        part(body, cylinder(0.36, 0.03, 0.03, 6), C.post, [0.3, 0.18, -0.3]);
        part(windowList, sphere(0.08, 8), lampColor, [0.3, 0.38, -0.3]);
      }
      if (l >= 4) {
        part(
          body,
          CreateTorus(`${name}-saw`, { diameter: 0.26, thickness: 0.05, tessellation: 16 }, scene),
          C.axeHead,
          [0.42, 0.3, -0.12],
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
        part(body, cylinder(0.5, 0.025, 0.025, 6), C.post, [-0.2, 0.86, 0.14]);
        part(body, box(0.16, 0.1, 0.02), C.flag, [-0.12, 1.04, 0.14]);
      }
      break;
    }
    case 'ember-kiln': {
      // A round terracotta kiln with a glowing mouth and a chimney, by a
      // stack of Emberwood. L2: a second chimney. L3: a bigger stack and a
      // trim ring. L4: a crown of little lamps.
      part(body, cylinder(0.08, 0.86, 0.9, 24), C.kilnTrim, [0, 0.04, 0]);
      part(body, sphere(0.72, 20), C.kiln, [0, 0.08, 0.04], [1, 0.85, 1]);
      part(windowList, sphere(0.26, 12), emberColor, [0, 0.16, -0.27], [1, 0.9, 0.35]);
      part(body, cylinder(0.3, 0.12, 0.14, 10), C.kilnTrim, [0.16, 0.5, 0.12]);
      part(body, sphere(0.09, 8), C.puff, [0.16, 0.7, 0.12]);
      if (l >= 2) part(body, cylinder(0.24, 0.1, 0.12, 10), C.kilnTrim, [-0.18, 0.46, 0.16]);
      const stack = l >= 3 ? 3 : 2;
      for (let i = 0; i < stack; i++) {
        part(
          body,
          cylinder(0.28, 0.08, 0.08, 8),
          C.log,
          [0.44, 0.05 + i * 0.075, -0.12 + (i % 2) * 0.04],
          [1, 1, 1],
          [Math.PI / 2, 0.3, 0],
        );
      }
      if (l >= 3) {
        part(
          body,
          CreateTorus(`${name}-trim`, { diameter: 0.7, thickness: 0.05, tessellation: 24 }, scene),
          C.kilnTrim,
          [0, 0.28, 0.04],
        );
      }
      if (l >= 4) {
        around(5, (a) => {
          part(windowList, sphere(0.06, 8), lampColor, [
            Math.cos(a) * 0.2,
            0.42,
            0.04 + Math.sin(a) * 0.2,
          ]);
        });
      }
      break;
    }
    case 'stone-quarry': {
      // A heap of soft boulders with a pickaxe stuck in, and a lamp post.
      // L2: a little cart. L3: a crane with a hanging stone. L4: a second
      // heap and a pennant.
      for (const [x, z, d, c] of [
        [0, 0.08, 0.46, C.rock],
        [-0.22, -0.06, 0.3, C.rockDark],
        [0.22, -0.02, 0.34, C.rock],
        [0.04, -0.18, 0.24, C.rockDark],
        [0.02, 0.06, 0.26, C.rockDark],
      ] as const) {
        part(body, sphere(d, 10), c, [x, d * 0.36, z], [1, 0.8, 1]);
      }
      part(body, box(0.04, 0.3, 0.04), C.post, [0.1, 0.42, 0.06], [1, 1, 1], [0, 0, -0.4]);
      part(body, box(0.2, 0.05, 0.04), C.axeHead, [0.15, 0.56, 0.06], [1, 1, 1], [0, 0, -0.4]);
      part(body, cylinder(0.5, 0.03, 0.03, 6), C.post, [-0.4, 0.25, -0.24]);
      part(windowList, sphere(0.09, 8), lampColor, [-0.4, 0.52, -0.24]);
      if (l >= 2) {
        part(body, box(0.24, 0.1, 0.16), C.cart, [0.36, 0.1, -0.3]);
        for (const x of [0.28, 0.44]) {
          part(
            body,
            cylinder(0.03, 0.08, 0.08, 10),
            C.stoneDark,
            [x, 0.05, -0.39],
            [1, 1, 1],
            [Math.PI / 2, 0, 0],
          );
        }
        part(body, sphere(0.1, 8), C.rock, [0.36, 0.17, -0.3]);
      }
      if (l >= 3) {
        part(body, cylinder(0.8, 0.04, 0.05, 8), C.post, [-0.36, 0.4, 0.24]);
        part(body, box(0.5, 0.04, 0.04), C.post, [-0.16, 0.8, 0.24]);
        part(body, cylinder(0.24, 0.01, 0.01, 4), C.stoneDark, [0.06, 0.66, 0.24]);
        part(body, sphere(0.12, 8), C.rockDark, [0.06, 0.5, 0.24]);
      }
      if (l >= 4) {
        part(body, sphere(0.3, 10), C.rock, [0.42, 0.1, 0.3], [1, 0.75, 1]);
        part(body, cylinder(0.4, 0.025, 0.025, 6), C.post, [0, 0.62, 0.08]);
        part(body, box(0.14, 0.09, 0.02), C.flag, [0.07, 0.78, 0.08]);
      }
      break;
    }
    case 'ice-cutter': {
      // A round igloo of icy blocks with a frosty lamp in its doorway, and
      // cut blocks stacked by it. L2: more blocks. L3: a sled. L4: an
      // icicle crown that glows.
      part(body, cylinder(0.06, 0.9, 0.94, 24), C.iceDeep, [0, 0.03, 0]);
      part(body, sphere(0.7, 18), C.ice, [0, 0.06, 0.06], [1, 0.82, 1]);
      part(
        body,
        cylinder(0.22, 0.26, 0.28, 14),
        C.ice,
        [0, 0.12, -0.24],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      part(windowList, sphere(0.16, 10), iceLampColor, [0, 0.13, -0.36], [1, 1, 0.4]);
      const blocks = l >= 2 ? 4 : 2;
      for (let i = 0; i < blocks; i++) {
        part(body, box(0.14, 0.12, 0.14), i % 2 ? C.iceDeep : C.ice, [
          0.4 - (i % 2) * 0.05,
          0.06 + Math.floor(i / 2) * 0.12,
          -0.2 + (i % 2) * 0.16,
        ]);
      }
      if (l >= 3) {
        part(body, box(0.3, 0.04, 0.14), C.cart, [-0.4, 0.08, -0.26]);
        for (const z of [-0.32, -0.2]) {
          part(body, box(0.34, 0.03, 0.02), C.post, [-0.4, 0.03, z]);
        }
        part(body, box(0.12, 0.1, 0.1), C.ice, [-0.42, 0.15, -0.26]);
      }
      if (l >= 4) {
        around(6, (a) => {
          part(
            windowList,
            cylinder(0.14, 0.05, 0, 6),
            iceLampColor,
            [Math.cos(a) * 0.16, 0.56, 0.06 + Math.sin(a) * 0.16],
            [1, 1, 1],
            [Math.PI, 0, 0],
          );
        });
      }
      break;
    }
    case 'water-well': {
      // A round stone well with water inside, a little roof on two posts and
      // a bucket on its rope, by a lamp. L2: a trough. L3: a bench and a second bucket.
      // L4: a little water tower.
      part(body, cylinder(0.3, 0.56, 0.6, 20), C.wellStone, [0, 0.15, 0]);
      part(body, cylinder(0.04, 0.44, 0.44, 20), C.water, [0, 0.29, 0]);
      for (const x of [-0.26, 0.26]) part(body, box(0.05, 0.5, 0.05), C.post, [x, 0.5, 0]);
      part(
        body,
        cylinder(0.7, 0.34, 0.34, 3),
        C.workshopRoof,
        [0, 0.8, 0],
        [1, 1, 1.4],
        [0, 0, Math.PI / 2],
      );
      part(
        body,
        cylinder(0.5, 0.03, 0.03, 8),
        C.post,
        [0, 0.66, 0],
        [1, 1, 1],
        [0, 0, Math.PI / 2],
      );
      part(body, cylinder(0.12, 0.12, 0.09, 10), C.bucket, [0.06, 0.48, 0]);
      if (l >= 2) {
        part(body, box(0.36, 0.1, 0.14), C.log, [0.48, 0.05, -0.2]);
        part(body, box(0.3, 0.02, 0.09), C.water, [0.48, 0.1, -0.2]);
      }
      part(body, cylinder(0.44, 0.03, 0.03, 6), C.post, [-0.44, 0.22, -0.24]);
      part(windowList, sphere(0.08, 8), lampColor, [-0.44, 0.47, -0.24]);
      if (l >= 3) {
        part(body, box(0.3, 0.06, 0.1), C.log, [-0.36, 0.14, 0.3]);
        part(body, cylinder(0.12, 0.12, 0.09, 10), C.bucket, [-0.4, 0.06, 0.24]);
      }
      if (l >= 4) {
        for (const [x, z] of [
          [0.38, 0.22],
          [0.54, 0.22],
          [0.46, 0.36],
        ] as const) {
          part(body, cylinder(0.5, 0.025, 0.025, 6), C.post, [x, 0.25, z]);
        }
        part(body, cylinder(0.22, 0.24, 0.24, 14), C.water, [0.46, 0.6, 0.27]);
        part(body, cylinder(0.12, 0, 0.28, 14), C.workshopRoof, [0.46, 0.77, 0.27]);
      }
      break;
    }
    case 'greenhouse': {
      // A little glasshouse with a white frame and plants inside, the roof
      // panes glowing softly. L2: planters outside. L3: a second wing. L4: a
      // glass dome and a blooming arch.
      part(body, box(0.66, 0.08, 0.46), C.glassFrame, [0, 0.04, 0.04]);
      for (const [x, z, d] of [
        [-0.18, 0.1, 0.22],
        [0.08, 0, 0.26],
        [0.22, 0.14, 0.18],
      ] as const) {
        part(body, sphere(d, 10), C.leaf, [x, 0.14 + d * 0.3, z]);
      }
      part(body, sphere(0.08, 8), C.bloom, [0.08, 0.32, -0.06]);
      // A warm grow-lamp hanging inside.
      part(windowList, sphere(0.09, 8), lampColor, [-0.06, 0.4, 0.04]);
      part(glassList, box(0.62, 0.34, 0.42), glassColor, [0, 0.25, 0.04]);
      part(
        glassList,
        cylinder(0.64, 0.42, 0.42, 3),
        glassColor,
        [0, 0.5, 0.04],
        [1, 1, 1.05],
        [0, 0, Math.PI / 2],
      );
      for (const x of [-0.31, 0, 0.31])
        part(body, box(0.03, 0.4, 0.03), C.glassFrame, [x, 0.26, -0.17]);
      part(body, box(0.66, 0.03, 0.03), C.glassFrame, [0, 0.43, -0.17]);
      if (l >= 2) {
        for (const x of [-0.24, 0.24]) {
          part(body, box(0.18, 0.1, 0.12), C.log, [x, 0.05, -0.34]);
          part(body, sphere(0.14, 8), C.leafDark, [x, 0.14, -0.34], [1, 0.7, 1]);
        }
      }
      if (l >= 3) {
        part(glassList, box(0.24, 0.26, 0.3), glassColor, [0.46, 0.15, 0.12]);
        part(body, sphere(0.14, 8), C.leaf, [0.46, 0.12, 0.12]);
      }
      if (l >= 4) {
        part(glassList, sphere(0.26, 12), glassColor, [-0.16, 0.66, 0.04], [1, 0.8, 1]);
        part(
          body,
          CreateTorus(`${name}-arch`, { diameter: 0.3, thickness: 0.04, tessellation: 16 }, scene),
          C.leafDark,
          [-0.42, 0.14, -0.26],
          [1, 1, 1],
          [Math.PI / 2, Math.PI / 2, 0],
        );
        for (const y of [0.22, 0.3]) part(body, sphere(0.06, 8), C.bloom, [-0.42, y, -0.26]);
      }
      break;
    }
    case 'pumpkin-barn': {
      // A red barn with a cream trim cross on its doors, a big pumpkin by
      // the door and a hay bale. L2: a row of pumpkins. L3: a silo. L4: a
      // glowing grin on the big pumpkin and lanterns.
      part(body, box(0.6, 0.38, 0.46), C.barn, [0, 0.19, 0.06]);
      part(
        body,
        cylinder(0.66, 0.5, 0.5, 3),
        C.barnRoof,
        [0, 0.5, 0.06],
        [1, 1, 1.15],
        [0, 0, Math.PI / 2],
      );
      part(body, box(0.24, 0.26, 0.03), C.barnTrim, [0, 0.13, -0.18]);
      part(body, box(0.2, 0.22, 0.035), C.barn, [0, 0.13, -0.18]);
      for (const turn of [0.8, -0.8])
        part(body, box(0.03, 0.28, 0.04), C.barnTrim, [0, 0.13, -0.19], [1, 1, 1], [0, 0, turn]);
      part(windowList, box(0.12, 0.08, 0.03), windowColor, [0, 0.43, -0.18]);
      part(body, sphere(0.22, 12), C.pumpkin, [0.38, 0.1, -0.24], [1.1, 0.85, 1.1]);
      part(body, cylinder(0.06, 0.03, 0.04), C.stem, [0.38, 0.22, -0.24]);
      part(
        body,
        cylinder(0.18, 0.13, 0.13, 12),
        C.hay,
        [-0.38, 0.09, -0.24],
        [1, 1, 1],
        [0, 0, Math.PI / 2],
      );
      if (l >= 2) {
        for (const x of [-0.2, 0, 0.2])
          part(body, sphere(0.12, 10), C.pumpkinDark, [x, 0.05, -0.38], [1.1, 0.8, 1.1]);
      }
      if (l >= 3) {
        part(body, cylinder(0.6, 0.2, 0.2, 16), C.barnTrim, [-0.42, 0.3, 0.24]);
        part(body, sphere(0.2, 12), C.barnRoof, [-0.42, 0.6, 0.24]);
      }
      if (l >= 4) {
        const grin = look === 'out' ? body : glow;
        const g = look === 'out' ? C.faceOut : C.face;
        part(grin, sphere(0.06, 8), g, [0.33, 0.13, -0.335], [1, 1.1, 0.3]);
        part(grin, sphere(0.06, 8), g, [0.43, 0.13, -0.335], [1, 1.1, 0.3]);
        part(grin, sphere(0.12, 8), g, [0.38, 0.06, -0.335], [1.2, 0.4, 0.3]);
        for (const x of [-0.24, 0.24]) {
          part(body, cylinder(0.3, 0.025, 0.025, 6), C.post, [x, 0.15, -0.3]);
          part(windowList, sphere(0.06, 8), lampColor, [x, 0.33, -0.3]);
        }
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
