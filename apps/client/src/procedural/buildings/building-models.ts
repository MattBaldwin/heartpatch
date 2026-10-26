import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import { GAME_DATA } from '@heartpatch/shared';
import { BUILDING_COLORS as C, LEVEL_SCALE, NAP_DIM, TILE_FOOTPRINT } from './building-config.js';

/** The Wild Isle works (#621): the buildings that show a nap cue while paused. */
const WORKS = new Set(GAME_DATA.buildings.filter((b) => b.kind === 'works').map((b) => b.id));

/**
 * The Wild Isle buildings that stand on a homestead (#621; the bridge and
 * the ferry dock sit on water): each is fitted to `TILE_FOOTPRINT`.
 */
export const WILD_HOMESTEAD = new Set(
  GAME_DATA.buildings
    .filter(
      (b) => b.patchTypes?.includes('wild-isle') && b.id !== 'bridge' && b.id !== 'ferry-dock',
    )
    .map((b) => b.id),
);

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
  const fit = WILD_HOMESTEAD.has(buildingId) ? footprintFit(scene, buildingId) : 1;
  return buildModel(scene, buildingId, look, level, fit);
}

/** Each fitted building's footprint scale, worked out once from its level-1 and -4 bodies. */
const fits = new Map<string, number>();

/** How much to scale a building so its reach lands inside `TILE_FOOTPRINT`. */
function footprintFit(scene: Scene, buildingId: string): number {
  const known = fits.get(buildingId);
  if (known !== undefined) return known;
  /** How far its body gets from the tile's middle along x or z. */
  const reach = (level: number) => {
    const { body, glow } = buildModel(scene, buildingId, 'plain', level, 1);
    const { minimum, maximum } = body.getBoundingInfo().boundingBox;
    body.dispose();
    glow?.dispose();
    return Math.max(-minimum.x, maximum.x, -minimum.z, maximum.z);
  };
  const first = reach(1);
  const fit = Math.min(
    Math.min(Math.max(first, TILE_FOOTPRINT.min), TILE_FOOTPRINT.max) / first,
    TILE_FOOTPRINT.maxTop / reach(LEVEL_SCALE.length),
  );
  fits.set(buildingId, fit);
  return fit;
}

function buildModel(
  scene: Scene,
  buildingId: string,
  look: BuildingLook,
  level: number,
  fit: number,
): BuildingModel {
  const name = modelKey(buildingId, look, level);
  const l = Math.max(1, level);
  const body: Mesh[] = [];
  const glow: Mesh[] = [];
  // A napping works (#621 W1-10) dims and grows a "z z" so it reads asleep
  // at phone size, not just by its dark lamp.
  const napping = look === 'out' && WORKS.has(buildingId);
  const napDusk = linear(C.napDusk);
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
    const dim = napping && list === body;
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
      if (dim) v = Color3.Lerp(v, napDusk, NAP_DIM);
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
  /**
   * A profile in the y–z plane (`[z, y]` points, in order, every point seen
   * from the first) pushed `length` along x: a bank, a sea wall's curl.
   * `taper` < 1 pulls the profile's upper points in at both ends, so the ends
   * slope too. Flat-shaded, faces wound outward the way Babylon's own
   * builders wind them (`Cross(a - b, c - b)` points out).
   */
  const prism = (
    profile: readonly (readonly [number, number])[],
    length: number,
    taper = 1,
  ): Mesh => {
    const positions: number[] = [];
    const indices: number[] = [];
    const n = profile.length;
    const low = Math.min(...profile.map(([, y]) => y));
    // Which way the profile runs (the sign of its area), for each side's outward normal.
    let area = 0;
    for (let k = 0; k < n; k++) {
      const [z0, y0] = profile[k] ?? [0, 0];
      const [z1, y1] = profile[(k + 1) % n] ?? [0, 0];
      area += z0 * y1 - z1 * y0;
    }
    const turn = area > 0 ? 1 : -1;
    const tri = (a: Vector3, b: Vector3, c: Vector3, out: Vector3) => {
      const face = Vector3.Cross(a.subtract(b), c.subtract(b));
      const [p, q] = Vector3.Dot(face, out) >= 0 ? [b, c] : [c, b];
      const i = positions.length / 3;
      positions.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
      indices.push(i, i + 1, i + 2);
    };
    const at = (k: number, end: number) => {
      const [z, y] = profile[k % n] ?? [0, 0];
      return new Vector3(((end * length) / 2) * (y > low + 0.001 ? taper : 1), y, z);
    };
    for (let k = 0; k < n; k++) {
      const [z0, y0] = profile[k] ?? [0, 0];
      const [z1, y1] = profile[(k + 1) % n] ?? [0, 0];
      const out = new Vector3(0, -(z1 - z0) * turn, (y1 - y0) * turn);
      tri(at(k, -1), at(k, 1), at(k + 1, 1), out);
      tri(at(k, -1), at(k + 1, 1), at(k + 1, -1), out);
    }
    for (const end of [-1, 1]) {
      for (let k = 1; k < n - 1; k++) {
        tri(at(0, end), at(k, end), at(k + 1, end), new Vector3(end, 0, 0));
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = [];
    data.uvs = new Array<number>((positions.length / 3) * 2).fill(0);
    VertexData.ComputeNormals(positions, indices, data.normals);
    const mesh = new Mesh(`${name}-part`, scene);
    data.applyToMesh(mesh, true);
    return mesh;
  };
  /**
   * Turns the parts added since `from` about y by `angle`, so a long
   * building shows its end profile to the camera (the Levee's bank, the
   * Seawall's curl), not only its face.
   */
  const turnSince = (from: { body: number; glow: number }, angle: number) => {
    for (const mesh of [...body.slice(from.body), ...glow.slice(from.glow)]) {
      mesh.bakeCurrentTransformIntoVertices();
      mesh.rotation.set(0, angle, 0);
      mesh.bakeCurrentTransformIntoVertices();
    }
  };
  const mark = () => ({ body: body.length, glow: glow.length });
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
    case 'water-well':
    case 'river-well': {
      // A round stone well with water inside, a little roof on two posts and
      // a bucket on its rope, by a lamp. L2: a trough. L3: a bench and a second bucket.
      // L4: a little water tower. Wild Isle's River Well (#621 revision 1) is
      // the same well on a river-side base: a ribbon of stream behind it,
      // pebbles and reeds on the bank.
      if (buildingId === 'river-well') {
        part(body, box(1.1, 0.04, 0.26), C.water, [0, 0.06, 0.46]);
        part(body, cylinder(0.08, 0.9, 0.96, 18), C.bank, [0, 0.04, 0], [1, 1, 0.8]);
        for (const x of [-0.42, -0.1, 0.3, 0.5]) {
          part(body, sphere(0.09, 8), C.rock, [x, 0.1, 0.32], [1, 0.6, 1]);
        }
        for (const x of [0.36, 0.42, 0.48]) {
          part(body, cylinder(0.26, 0.015, 0.02, 5), C.leafDark, [x, 0.13, 0.28]);
        }
      }
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
        // The River Well's tower stands beside the well, clear of its roof
        // (behind it, its cap clipped into the roof).
        const [tx, tz] = buildingId === 'river-well' ? [0.72, -0.04] : [0.46, 0.27];
        for (const [x, z] of [
          [tx - 0.08, tz - 0.05],
          [tx + 0.08, tz - 0.05],
          [tx, tz + 0.09],
        ] as const) {
          part(body, cylinder(0.5, 0.025, 0.025, 6), C.post, [x, 0.25, z]);
        }
        part(body, cylinder(0.22, 0.24, 0.24, 14), C.water, [tx, 0.6, tz]);
        part(body, cylinder(0.12, 0, 0.28, 14), C.workshopRoof, [tx, 0.77, tz]);
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
    case 'warehouse': {
      // The Warehouse (#601 PR 9): one level, so it's already the biggest
      // toy on the patch. A wide periwinkle storehouse with an arched honey
      // roller door, a heart sign over it, a loading dock stacked with
      // crates and ribboned parcels, a chute down one side with a parcel on
      // it, a lamp by the door and a little parcel cupola on the ridge. Its
      // windows, lamp and heart glow while it delivers and go dark while it
      // naps (paused for upkeep, or its homestead cut off).
      part(body, box(0.84, 0.42, 0.56), C.store, [0, 0.21, 0.04]);
      for (const x of [-0.42, 0.42]) {
        for (const z of [-0.24, 0.32]) {
          part(body, cylinder(0.42, 0.1, 0.1, 10), C.store, [x, 0.21, z]);
        }
      }
      part(
        body,
        cylinder(0.98, 0.56, 0.56, 3),
        C.storeRoof,
        [0, 0.54, 0.04],
        [1, 1, 1.3],
        [0, 0, Math.PI / 2],
      );
      // The cupola: a parcel with a ribbon, on the ridge.
      part(body, box(0.16, 0.14, 0.16), C.parcel, [0, 0.86, 0.04]);
      part(body, box(0.17, 0.03, 0.04), C.ribbon, [0, 0.86, -0.04]);
      part(body, box(0.04, 0.15, 0.17), C.ribbon, [0, 0.86, 0.04]);
      // The arched roller door on the front (−z), with its slats.
      part(body, box(0.32, 0.24, 0.04), C.storeDoor, [0, 0.12, -0.25]);
      part(
        body,
        cylinder(0.04, 0.32, 0.32, 18),
        C.storeDoor,
        [0, 0.24, -0.25],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      for (const y of [0.07, 0.14, 0.21, 0.28]) {
        part(body, box(y > 0.25 ? 0.24 : 0.3, 0.015, 0.045), C.storeTrim, [0, y, -0.255]);
      }
      // The heart sign over the door.
      const heart = awake ? glow : body;
      const heartColor = awake ? C.ribbon : C.windowOut;
      part(
        body,
        cylinder(0.03, 0.2, 0.2, 18),
        C.storeTrim,
        [0, 0.48, -0.27],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      part(heart, sphere(0.06, 8), heartColor, [-0.025, 0.495, -0.29], [1, 1, 0.5]);
      part(heart, sphere(0.06, 8), heartColor, [0.025, 0.495, -0.29], [1, 1, 0.5]);
      part(
        heart,
        box(0.06, 0.06, 0.02),
        heartColor,
        [0, 0.465, -0.29],
        [1, 1, 1],
        [0, 0, Math.PI / 4],
      );
      // Two windows either side of the door.
      for (const x of [-0.29, 0.29]) {
        part(windowList, box(0.12, 0.12, 0.03), windowColor, [x, 0.27, -0.25]);
      }
      // The loading dock out front, right, with crates and parcels.
      part(body, box(0.36, 0.06, 0.22), C.post, [0.3, 0.03, -0.42]);
      part(body, box(0.12, 0.12, 0.12), C.crate, [0.2, 0.12, -0.42]);
      part(body, box(0.12, 0.12, 0.12), C.crateMint, [0.34, 0.12, -0.4]);
      part(body, box(0.11, 0.11, 0.11), C.hay, [0.27, 0.235, -0.41]);
      part(body, box(0.1, 0.08, 0.1), C.parcel, [0.45, 0.1, -0.46]);
      part(body, box(0.105, 0.02, 0.03), C.ribbon, [0.45, 0.1, -0.505]);
      // The chute down the left side, with a parcel sliding along it.
      part(body, box(0.12, 0.03, 0.46), C.cart, [-0.56, 0.24, -0.06], [1, 1, 1], [-0.55, 0, 0]);
      part(body, box(0.09, 0.07, 0.09), C.parcel, [-0.56, 0.31, -0.08], [1, 1, 1], [-0.55, 0, 0]);
      part(body, cylinder(0.08, 0.2, 0.18, 14), C.hay, [-0.56, 0.04, -0.34]);
      // A lamp by the door.
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [-0.3, 0.21, -0.42]);
      part(windowList, sphere(0.09, 8), lampColor, [-0.3, 0.46, -0.42]);
      break;
    }
    case 'bridge': {
      // Wild Isle (#621): a plank bridge over a river tile, lying along +x
      // (the map turns it to run bank to bank). A cozy arched deck with
      // slats, rope rails on little posts, two stone piers in the water and
      // a lamp at each end that glows.
      part(body, box(1.5, 0.05, 0.38), C.post, [0, 0.15, 0]);
      for (const x of [-0.82, 0.82]) {
        part(
          body,
          box(0.3, 0.045, 0.38),
          C.post,
          [x, 0.12, 0],
          [1, 1, 1],
          [0, 0, x < 0 ? 0.22 : -0.22],
        );
      }
      for (let i = 0; i < 9; i++) {
        part(body, box(0.025, 0.014, 0.4), C.log, [-0.64 + i * 0.16, 0.18, 0]);
      }
      for (const z of [-0.2, 0.2]) {
        part(body, box(1.4, 0.03, 0.03), C.log, [0, 0.33, z]);
        for (let i = 0; i < 5; i++) {
          part(body, box(0.045, 0.17, 0.045), C.log, [-0.7 + i * 0.35, 0.25, z]);
        }
      }
      for (const x of [-0.45, 0.45]) {
        part(body, cylinder(0.14, 0.2, 0.24, 10), C.stoneDark, [x, 0.04, 0]);
      }
      for (const x of [-0.7, 0.7]) {
        part(windowList, sphere(0.08, 8), lampColor, [x, 0.4, 0.2]);
      }
      break;
    }
    case 'ferry-dock': {
      // Wild Isle (#621): a little wooden pier with a rosy rowboat moored
      // beside it in a puddle of lake: posts, slats, a rope, a crate and a
      // lamp. The boat bobs nowhere; it is a toy.
      part(body, cylinder(0.02, 0.7, 0.7, 20), C.water, [0.2, 0.01, 0.12], [1, 1, 0.75]);
      part(body, box(0.74, 0.05, 0.3), C.post, [-0.16, 0.12, -0.12]);
      for (let i = 0; i < 6; i++) {
        part(body, box(0.02, 0.014, 0.32), C.log, [-0.46 + i * 0.12, 0.15, -0.12]);
      }
      for (const [x, z] of [
        [-0.5, -0.24],
        [-0.5, 0],
        [0.18, -0.24],
        [0.18, 0],
      ] as const) {
        part(body, cylinder(0.24, 0.06, 0.06, 8), C.log, [x, 0.12, z]);
      }
      part(body, box(0.1, 0.1, 0.1), C.crateMint, [-0.38, 0.2, -0.16]);
      // The boat: a rosy hull, a honey seat, a mast with a sail and a pennant.
      part(body, sphere(0.3, 12), C.crate, [0.3, 0.07, 0.16], [1.5, 0.45, 0.8]);
      part(body, sphere(0.26, 10), C.hay, [0.3, 0.12, 0.16], [1.35, 0.25, 0.62]);
      part(body, cylinder(0.34, 0.02, 0.02, 6), C.post, [0.3, 0.3, 0.16]);
      part(body, box(0.012, 0.18, 0.16), C.storeTrim, [0.3, 0.32, 0.24]);
      part(body, box(0.1, 0.04, 0.012), C.flag, [0.35, 0.46, 0.16]);
      // The rope from the boat to the post.
      part(
        body,
        cylinder(0.16, 0.012, 0.012, 5),
        C.ribbon,
        [0.2, 0.15, 0.04],
        [1, 1, 1],
        [0, 0, 1.3],
      );
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [-0.54, 0.21, 0.06]);
      part(windowList, sphere(0.09, 8), lampColor, [-0.54, 0.46, 0.06]);
      break;
    }
    case 'fishing-pier': {
      // Wild Isle works (#621 W1-10): a short plank pier out over a puddle
      // of water, a tall fishing rod bent over it with its line and a red
      // bobber, and a bucket of caught fish by a lamp. No boat: that's the
      // Ferry Dock. L2: a little tackle shed. L3: a second rod and a net on
      // poles. L4: a tall lamp post with a pennant.
      part(body, cylinder(0.04, 0.8, 0.8, 20), C.water, [0, 0.06, -0.18], [1.1, 1, 0.7]);
      part(body, box(0.34, 0.05, 0.84), C.post, [0, 0.14, -0.08]);
      for (let i = 0; i < 7; i++) {
        part(body, box(0.36, 0.014, 0.02), C.log, [0, 0.17, -0.44 + i * 0.12]);
      }
      for (const x of [-0.15, 0.15]) {
        for (const z of [-0.46, -0.1]) {
          part(body, cylinder(0.26, 0.06, 0.06, 8), C.log, [x, 0.13, z]);
        }
      }
      // The rod: a long pole leaning out over the water, its line and bobber.
      part(body, cylinder(0.9, 0.02, 0.035, 6), C.log, [0.12, 0.5, -0.26], [1, 1, 1], [-0.7, 0, 0]);
      part(body, cylinder(0.36, 0.006, 0.006, 4), C.matTrim, [0.12, 0.6, -0.64]);
      part(body, sphere(0.07, 8), C.target, [0.12, 0.42, -0.64]);
      // The bucket of fish and the lamp.
      part(body, cylinder(0.14, 0.16, 0.13, 12), C.bucket, [-0.08, 0.24, 0.2]);
      part(body, sphere(0.1, 8), C.fish, [-0.1, 0.33, 0.2], [1.6, 0.6, 0.7], [0, 0, 0.5]);
      part(body, sphere(0.09, 8), C.fishAlt, [-0.04, 0.34, 0.22], [1.6, 0.6, 0.7], [0, 0.8, -0.4]);
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [-0.15, 0.36, -0.46]);
      part(windowList, sphere(0.08, 8), lampColor, [-0.15, 0.6, -0.46]);
      if (l >= 2) {
        part(body, box(0.3, 0.26, 0.26), C.storeTrim, [0.32, 0.13, 0.3]);
        part(body, box(0.36, 0.04, 0.32), C.millRoof, [0.32, 0.29, 0.3], [1, 1, 1], [0, 0, 0.2]);
        part(windowList, box(0.1, 0.08, 0.02), windowColor, [0.32, 0.16, 0.16]);
      }
      if (l >= 3) {
        part(
          body,
          cylinder(0.8, 0.02, 0.03, 6),
          C.log,
          [-0.14, 0.46, -0.22],
          [1, 1, 1],
          [-0.6, 0, 0.3],
        );
        for (const x of [-0.42, -0.22])
          part(body, cylinder(0.4, 0.025, 0.025, 6), C.post, [x, 0.2, 0.34]);
        part(body, box(0.2, 0.18, 0.01), C.matTrim, [-0.32, 0.26, 0.34]);
      }
      if (l >= 4) {
        part(body, cylinder(0.7, 0.035, 0.035, 6), C.post, [0.15, 0.5, 0.12]);
        part(windowList, sphere(0.1, 8), lampColor, [0.15, 0.88, 0.12]);
        part(body, box(0.16, 0.08, 0.012), C.flag, [0.24, 0.76, 0.12]);
      }
      break;
    }
    case 'salt-pans': {
      // Four shallow square pools of sea water on a flat clay floor, each
      // edged in a raised clay rim, with a little salt heap at a corner, a tall
      // salt heap, a rake leaning on it and a sack. Flat and low: pools in
      // the ground, not trays on it. L2: two more pools. L3: a wheelbarrow
      // of salt. L4: a little drying shed.
      const pools: [number, number][] = [
        [-0.3, -0.19],
        [0.06, -0.19],
        [-0.3, 0.19],
        [0.06, 0.19],
      ];
      if (l >= 2) pools.push([-0.66, -0.19], [-0.66, 0.19]);
      const west = l >= 2 ? -0.86 : -0.5;
      part(body, box(0.68 - west, 0.06, 0.92), C.clay, [(0.68 + west) / 2, 0.03, 0]);
      for (const [x, z] of pools) {
        part(body, box(0.3, 0.016, 0.32), C.brine, [x, 0.072, z]);
        for (const dz of [-0.18, 0.18]) {
          part(body, box(0.36, 0.07, 0.06), C.clay, [x, 0.095, z + dz]);
        }
        for (const dx of [-0.17, 0.17]) {
          part(body, box(0.06, 0.07, 0.36), C.clay, [x + dx, 0.095, z]);
        }
        // A little heap raked up onto the clay at the pool's corner.
        part(body, cylinder(0.1, 0, 0.13, 10), C.salt, [x - 0.17, 0.18, z + 0.18]);
      }
      // The heap: a tall, rounded white cone, and the rake leaning on it
      // (its head with six tines on the clay in front, its handle against the heap's side).
      part(body, cylinder(0.3, 0.06, 0.34, 14), C.salt, [0.47, 0.21, 0.22]);
      part(body, sphere(0.1, 8), C.salt, [0.47, 0.36, 0.22]);
      part(body, box(0.035, 0.4, 0.035), C.post, [0.33, 0.25, -0.08], [1, 1, 1], [0.6, 0, 0]);
      part(body, box(0.24, 0.045, 0.05), C.post, [0.33, 0.12, -0.2]);
      for (let i = 0; i < 6; i++) {
        part(body, box(0.035, 0.11, 0.035), C.post, [0.22 + i * 0.044, 0.08, -0.22]);
      }
      part(body, cylinder(0.26, 0.12, 0.15, 10), C.parcel, [0.56, 0.19, -0.34]);
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [-0.5, 0.27, 0.42]);
      part(windowList, sphere(0.08, 8), lampColor, [-0.5, 0.52, 0.42]);
      if (l >= 3) {
        part(body, box(0.22, 0.1, 0.16), C.cart, [-0.12, 0.15, 0.5]);
        part(body, cylinder(0.08, 0, 0.18, 10), C.salt, [-0.12, 0.24, 0.5]);
        part(
          body,
          cylinder(0.04, 0.1, 0.1, 10),
          C.post,
          [-0.24, 0.08, 0.5],
          [1, 1, 1],
          [0, 0, Math.PI / 2],
        );
      }
      if (l >= 4) {
        part(body, box(0.3, 0.3, 0.26), C.storeTrim, [-0.6, 0.18, 0.2]);
        part(body, box(0.36, 0.04, 0.32), C.millRoof, [-0.6, 0.36, 0.2], [1, 1, 1], [0, 0, 0.2]);
        part(windowList, box(0.1, 0.08, 0.02), windowColor, [-0.6, 0.21, 0.06]);
      }
      break;
    }
    case 'watermill': {
      // A creamy mill house with a blue-green roof and a big wooden wheel on
      // its side dipping into a stream: the wheel is the silhouette. A sack
      // of Flour by the door, a lit window and a lamp. L2: a second sack and
      // a chimney. L3: a little loft window. L4: a pennant on the roof.
      part(body, box(0.46, 0.46, 0.44), C.millWall, [-0.16, 0.23, 0.04]);
      part(
        body,
        cylinder(0.52, 0.42, 0.42, 3),
        C.millRoof,
        [-0.16, 0.58, 0.04],
        [1, 1, 1.25],
        [0, 0, Math.PI / 2],
      );
      part(body, box(0.14, 0.22, 0.03), C.door, [-0.24, 0.11, -0.19]);
      part(windowList, box(0.12, 0.1, 0.03), windowColor, [-0.04, 0.28, -0.19]);
      // The wheel beside the house, facing out (-z) so it reads round: a rim,
      // an inner ring, spokes, a hub on its axle and paddles dipping into a
      // stream that runs past.
      const wheel: [number, number, number] = [0.32, 0.32, -0.02];
      part(body, box(0.18, 0.04, 0.9), C.water, [wheel[0], 0.06, wheel[2]]);
      for (const [d, t] of [
        [0.56, 0.05],
        [0.3, 0.035],
      ] as const) {
        part(
          body,
          CreateTorus(`${name}-wheel`, { diameter: d, thickness: t, tessellation: 20 }, scene),
          C.wheel,
          wheel,
          [1, 1, 1],
          [Math.PI / 2, 0, 0],
        );
      }
      around(4, (a) => {
        part(body, box(0.54, 0.025, 0.025), C.wheel, wheel, [1, 1, 1], [0, 0, a / 2]);
      });
      part(body, cylinder(0.12, 0.09, 0.09, 10), C.log, wheel, [1, 1, 1], [Math.PI / 2, 0, 0]);
      part(
        body,
        cylinder(0.2, 0.04, 0.04, 8),
        C.log,
        [0.14, wheel[1], wheel[2]],
        [1, 1, 1],
        [0, 0, Math.PI / 2],
      );
      around(8, (a) => {
        part(
          body,
          box(0.12, 0.035, 0.11),
          C.wheel,
          [wheel[0] + Math.cos(a) * 0.29, wheel[1] + Math.sin(a) * 0.29, wheel[2]],
          [1, 1, 1],
          [0, 0, a],
        );
      });
      part(body, sphere(0.16, 10), C.storeTrim, [-0.38, 0.08, -0.26], [1, 0.9, 1]);
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [-0.44, 0.21, 0.36]);
      part(windowList, sphere(0.08, 8), lampColor, [-0.44, 0.46, 0.36]);
      if (l >= 2) {
        part(body, sphere(0.14, 10), C.storeTrim, [-0.24, 0.07, -0.32], [1, 0.9, 1]);
        part(body, box(0.1, 0.22, 0.1), C.chimney, [-0.24, 0.74, 0.18]);
        part(body, sphere(0.08, 8), C.puff, [-0.24, 0.9, 0.18]);
      }
      if (l >= 3) part(windowList, sphere(0.1, 10), windowColor, [-0.16, 0.6, -0.2], [1, 1, 0.3]);
      if (l >= 4) {
        part(body, cylinder(0.3, 0.02, 0.02, 6), C.post, [-0.06, 0.92, 0.04]);
        part(body, box(0.14, 0.08, 0.012), C.flag, [0.02, 1.02, 0.04]);
      }
      break;
    }
    case 'irrigated-field': {
      // A plot of tilled earth with rows of leafy Greens and a bright little
      // water channel down one side, watched by a cheery scarecrow with a
      // lantern. L2: a fourth row. L3: a watering can. L4: a sprinkler.
      part(body, box(0.84, 0.12, 0.74), C.soil, [-0.04, 0.06, 0]);
      part(body, box(0.1, 0.04, 0.78), C.water, [0.44, 0.1, 0]);
      const rows = l >= 2 ? 4 : 3;
      for (let i = 0; i < rows; i++) {
        const z = -0.27 + i * (0.54 / Math.max(1, rows - 1));
        part(body, box(0.74, 0.05, 0.08), C.soil, [-0.04, 0.14, z]);
        for (let j = 0; j < 4; j++) {
          part(
            body,
            sphere(0.12, 5),
            j % 2 ? C.leafDark : C.leaf,
            [-0.32 + j * 0.19, 0.2, z],
            [1, 0.7, 1],
          );
        }
      }
      // The scarecrow: a post, arms, a straw-coloured head and a hat.
      part(body, box(0.04, 0.6, 0.04), C.post, [-0.36, 0.3, 0.42]);
      part(body, box(0.36, 0.04, 0.04), C.post, [-0.36, 0.44, 0.42]);
      part(body, box(0.16, 0.18, 0.08), C.flag, [-0.36, 0.42, 0.42]);
      part(body, sphere(0.14, 10), C.hay, [-0.36, 0.62, 0.42]);
      part(body, cylinder(0.08, 0.1, 0.22, 12), C.barnRoof, [-0.36, 0.72, 0.42]);
      part(windowList, sphere(0.07, 8), lampColor, [-0.18, 0.4, 0.42]);
      if (l >= 3) {
        part(body, cylinder(0.12, 0.1, 0.12, 10), C.gear, [0.32, 0.12, 0.44]);
        part(
          body,
          cylinder(0.14, 0.02, 0.02, 5),
          C.gear,
          [0.4, 0.16, 0.44],
          [1, 1, 1],
          [0, 0, 0.9],
        );
      }
      if (l >= 4) {
        part(body, cylinder(0.36, 0.025, 0.025, 6), C.hoop, [0.1, 0.24, -0.05]);
        part(
          body,
          CreateTorus(
            `${name}-spray`,
            { diameter: 0.18, thickness: 0.03, tessellation: 12 },
            scene,
          ),
          C.water,
          [0.1, 0.42, -0.05],
        );
      }
      break;
    }
    case 'rain-barrel': {
      // A chubby staved barrel with three metal hoops, a wide funnel on top
      // catching raindrops, and a big brass tap on its front pouring into a
      // puddle, by a little lamp, all on a round flagstone. The smallest of the works.
      // L2: a second barrel. L3: a gutter roof feeding them. L4: a third
      // barrel on a stand.
      const barrelAt = (x: number, y: number, z: number, s: number) => {
        // A barrel's belly: a tall, round-sided body (no narrow foot), flat at the top.
        part(body, cylinder(0.42 * s, 0.3 * s, 0.3 * s, 12), C.barrel, [x, y + 0.23 * s, z]);
        part(body, sphere(0.38 * s, 8), C.barrel, [x, y + 0.23 * s, z], [1, 1.2, 1]);
        // The staves: dark lines down the belly, hugging its curve (the
        // belly is round in the middle, narrower at the hoops).
        around(6, (a) => {
          for (const [dy, r, h] of [
            [0.23, 0.188, 0.14],
            [0.11, 0.165, 0.1],
            [0.35, 0.165, 0.1],
          ] as const) {
            part(
              body,
              box(0.014, h * s, 0.014),
              C.stave,
              [x + Math.cos(a) * r * s, y + dy * s, z + Math.sin(a) * r * s],
              [1, 1, 1],
              [0, -a, 0],
            );
          }
        });
        for (const [dy, d] of [
          [0.06, 0.3],
          [0.23, 0.37],
          [0.4, 0.3],
        ] as const) {
          part(
            body,
            CreateTorus(
              `${name}-hoop`,
              { diameter: d * s, thickness: 0.03, tessellation: 10 },
              scene,
            ),
            C.hoop,
            [x, y + dy * s, z],
          );
        }
        // The funnel: wider than the barrel, so it reads from above.
        part(body, cylinder(0.2 * s, 0.44 * s, 0.18 * s, 12), C.hoop, [x, y + 0.54 * s, z]);
        // The water just above the funnel's lid (level with it, they flicker).
        part(body, cylinder(0.01, 0.38 * s, 0.38 * s, 16), C.water, [x, y + 0.646 * s, z]);
      };
      // A round flagstone it all stands on, so it fills its tile like the rest.
      part(body, cylinder(0.03, 0.84, 0.88, 12), C.wellStone, [0, 0.015, -0.08]);
      barrelAt(0, 0, 0, 1);
      // Raindrops falling into the funnel.
      for (const [x, y, z] of [
        [-0.08, 0.8, 0.02],
        [0.07, 0.87, -0.04],
        [0.01, 0.95, 0.05],
      ] as const) {
        part(body, sphere(0.06, 6), C.water, [x, y, z], [0.8, 1.3, 0.8]);
      }
      // The tap on the front (-z, facing the camera): a fat spout, a cross
      // handle and a ribbon of water down into a puddle.
      const tapZ = -0.22;
      part(
        body,
        cylinder(0.14, 0.07, 0.07, 10),
        C.brass,
        [0, 0.14, tapZ - 0.05],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      part(body, cylinder(0.06, 0.06, 0.05, 10), C.brass, [0, 0.11, tapZ - 0.11]);
      part(body, box(0.1, 0.03, 0.03), C.brass, [0, 0.21, tapZ - 0.06]);
      part(body, box(0.03, 0.05, 0.03), C.brass, [0, 0.19, tapZ - 0.06]);
      part(body, box(0.03, 0.05, 0.03), C.water, [0, 0.065, tapZ - 0.11]);
      part(body, cylinder(0.02, 0.24, 0.24, 14), C.water, [0, 0.03, tapZ - 0.13], [1.2, 1, 0.8]);
      part(body, cylinder(0.42, 0.03, 0.03, 6), C.post, [0.34, 0.21, -0.2]);
      part(windowList, sphere(0.08, 8), lampColor, [0.34, 0.46, -0.2]);
      if (l >= 2) barrelAt(-0.36, 0, 0.12, 0.8);
      if (l >= 3) {
        for (const x of [-0.56, 0.24]) part(body, box(0.04, 0.84, 0.04), C.post, [x, 0.42, 0.34]);
        part(body, box(0.9, 0.04, 0.24), C.millRoof, [-0.16, 0.86, 0.28], [1, 1, 1], [0.3, 0, 0]);
        part(body, box(0.9, 0.04, 0.06), C.hoop, [-0.16, 0.8, 0.16]);
      }
      if (l >= 4) {
        part(body, box(0.3, 0.2, 0.3), C.post, [0.36, 0.1, 0.3]);
        barrelAt(0.36, 0.2, 0.3, 0.7);
      }
      break;
    }
    case 'canal': {
      // A straight water channel along +x between two soft grassy banks,
      // edged with stone, with a lily pad, reeds and a little arched plank
      // bridge. Grass, then water, then grass: it reads as a stream. One level.
      for (const z of [-0.3, 0.3]) {
        part(body, box(1.2, 0.12, 0.22), C.bank, [0, 0.06, z]);
        part(body, box(1.2, 0.05, 0.05), C.stoneDark, [0, 0.13, z < 0 ? -0.18 : 0.18]);
      }
      part(body, box(1.2, 0.06, 0.34), C.water, [0, 0.07, 0]);
      part(body, cylinder(0.015, 0.14, 0.14, 12), C.leaf, [-0.34, 0.11, 0.04]);
      part(body, sphere(0.05, 6), C.petal, [-0.32, 0.13, 0.04]);
      for (const x of [0.4, 0.46, 0.52]) {
        part(body, cylinder(0.24, 0.015, 0.02, 5), C.leafDark, [x, 0.22, -0.3]);
      }
      part(body, box(0.2, 0.035, 0.5), C.post, [0.06, 0.2, 0], [1, 1, 1], [0, 0, 0]);
      for (const z of [-0.22, 0.22]) {
        part(
          body,
          box(0.2, 0.035, 0.12),
          C.post,
          [0.06, 0.16, z],
          [1, 1, 1],
          [z < 0 ? -0.5 : 0.5, 0, 0],
        );
      }
      break;
    }
    case 'levee': {
      // A raised earth bank holding the river back: a low trapezoid ridge of
      // brown earth with sloping sides and sloping ends (its ends show
      // the soil), grassed over the top, rounded river stones of mixed sizes
      // set along the foot of its water side (-z), a strip of river right at
      // its foot, and flowers and reeds on top. Turned a little so its
      // trapezoid end faces the camera. An earth bank, not a planter. One level.
      const start = mark();
      const bank: [number, number][] = [
        [-0.56, 0.05],
        [-0.14, 0.3],
        [0.12, 0.3],
        // The land side slopes gently, so it never meets the camera edge-on.
        [0.7, 0.05],
      ];
      part(body, box(1.3, 0.03, 0.26), C.water, [0, 0.055, -0.68]);
      part(body, prism(bank, 1.26, 0.72), C.soil, [0, 0, 0]);
      part(
        body,
        prism(
          bank.map(([z, y]) => [z * 1.04, y + 0.02]),
          1.0,
          0.8,
        ),
        C.bank,
        [0, 0, 0],
      );
      for (const [x, z, d] of [
        [-0.5, -0.55, 0.16],
        [-0.3, -0.58, 0.12],
        [-0.12, -0.54, 0.17],
        [0.08, -0.58, 0.11],
        [0.26, -0.54, 0.15],
        [0.44, -0.57, 0.12],
        [-0.4, -0.46, 0.1],
        [0.16, -0.45, 0.1],
      ] as const) {
        part(body, sphere(d, 8), C.riverStone, [x, 0.07, z], [1.2, 0.7, 1]);
      }
      for (const x of [-0.24, 0.06, 0.3]) {
        part(body, cylinder(0.14, 0.012, 0.016, 5), C.leafDark, [x, 0.38, 0.04]);
      }
      for (const x of [-0.12, 0.2]) {
        part(body, sphere(0.07, 8), C.petal, [x, 0.34, -0.04]);
        part(body, sphere(0.04, 6), C.petalAlt, [x, 0.37, -0.04]);
      }
      turnSince(start, -0.6);
      break;
    }
    case 'seawall': {
      // A straight harbour quay wall standing in the water on the sea side
      // (-z), with foam at its foot, a red-and-white striped beacon on one
      // end with its lamp on top, a bollard on the crown and an iron mooring
      // ring on its sea face. Turned a little so its end profile shows. One
      // level.
      const start = mark();
      const length = 1.3;
      part(body, box(length + 0.04, 0.03, 0.72), C.water, [0, 0.055, -0.26]);
      /** A straight stone wall with mortar courses on its sea face and ends. */
      const stoneWall = (face: number, back: number, top: number, wide: number) => {
        part(body, box(wide, top - 0.04, back - face), C.seaStone, [
          0,
          (top + 0.04) / 2,
          (back + face) / 2,
        ]);
        const courses: number[] = [];
        for (let y = 0.16; y < top - 0.06; y += 0.12) courses.push(y);
        for (const y of courses) {
          part(body, box(wide + 0.01, 0.018, 0.02), C.mortar, [0, y, face - 0.005]);
          for (const x of [-wide / 2, wide / 2]) {
            part(body, box(0.02, 0.018, back - face), C.mortar, [x, y, (back + face) / 2]);
          }
        }
        for (let row = 0; row <= courses.length; row++) {
          const y0 = row ? (courses[row - 1] ?? 0) : 0.07;
          const y1 = courses[row] ?? top;
          for (let i = 0; i < 4; i++) {
            const x = -wide / 2 + 0.17 + i * 0.32 + (row % 2) * 0.16;
            if (Math.abs(x) > wide / 2 - 0.04) continue;
            part(body, box(0.018, y1 - y0, 0.02), C.mortar, [x, (y0 + y1) / 2, face - 0.005]);
          }
        }
      };
      const foam = (spots: readonly (readonly [number, number, number])[]) => {
        for (const [x, z, d] of spots) {
          part(
            body,
            CreateTorus(`${name}-foam`, { diameter: d, thickness: 0.04, tessellation: 12 }, scene),
            C.foam,
            [x, 0.075, z],
            [1.4, 0.5, 0.7],
          );
        }
      };
      const face = -0.1;
      const back = 0.16;
      const top = 0.44;
      stoneWall(face, back, top, length);
      const stripes = 5;
      for (let i = 0; i < stripes; i++) {
        const h = 0.1;
        const d0 = 0.26 - i * 0.025;
        part(body, cylinder(h, d0 - 0.025, d0, 14), i % 2 ? C.beaconWhite : C.beaconRed, [
          -0.46,
          top + h / 2 + i * h,
          0.03,
        ]);
      }
      const crown = top + stripes * 0.1;
      part(body, cylinder(0.02, 0.2, 0.2, 14), C.hoop, [-0.46, crown + 0.01, 0.03]);
      part(body, cylinder(0.12, 0, 0.17, 14), C.beaconRed, [-0.46, crown + 0.23, 0.03]);
      part(body, cylinder(0.11, 0.008, 0.008, 4), C.hoop, [-0.46, crown + 0.07, 0.03]);
      part(body, cylinder(0.08, 0.06, 0.07, 10), C.hoop, [0.24, top + 0.04, 0.03]);
      part(body, cylinder(0.025, 0.1, 0.1, 10), C.hoop, [0.24, top + 0.09, 0.03]);
      part(
        body,
        CreateTorus(`${name}-ring`, { diameter: 0.12, thickness: 0.025, tessellation: 14 }, scene),
        C.hoop,
        [0.24, top - 0.12, face - 0.015],
        [1, 1, 1],
        [Math.PI / 2, 0, 0],
      );
      foam([
        [-0.38, face - 0.12, 0.22],
        [-0.05, face - 0.12, 0.16],
        [0.3, face - 0.12, 0.2],
      ]);
      part(windowList, sphere(0.13, 8), lampColor, [-0.46, crown + 0.1, 0.03]);
      turnSince(start, 0.6);
      break;
    }
    case 'weather-vane': {
      // A tall post on a stone step with one big arrow on top (a pink head
      // and a heart-tail fin) and a lamp-ball finial: the tallest, thinnest
      // Wild Isle silhouette, on a step wide enough to fill its tile. One level.
      part(body, cylinder(0.14, 0.7, 0.8, 18), C.wellStone, [0, 0.07, 0]);
      part(body, cylinder(1.06, 0.05, 0.06, 8), C.post, [0, 0.67, 0]);
      part(body, box(0.62, 0.04, 0.04), C.hoop, [0, 1.18, 0]);
      part(
        body,
        cylinder(0.2, 0, 0.18, 4),
        C.target,
        [0.38, 1.18, 0],
        [1, 1, 0.4],
        [0, 0, -Math.PI / 2],
      );
      for (const z of [-0.035, 0.035]) {
        part(body, sphere(0.12, 8), C.target, [-0.3, 1.2, z * 0.2], [1, 1, 0.25], [0, 0, z * 12]);
      }
      part(body, box(0.1, 0.16, 0.02), C.target, [-0.33, 1.16, 0], [1, 1, 1], [0, 0, 0.4]);
      part(windowList, sphere(0.08, 8), lampColor, [0, 1.25, 0]);
      break;
    }
    case 'waystation': {
      // A cozy roadside stop: a peaked roof on four posts over a bench, a
      // signpost with two arrows and a lamp, on a flagstone. One level.
      part(body, box(1.0, 0.03, 0.62), C.wellStone, [0.16, 0.015, -0.08]);
      for (const [x, z] of [
        [-0.28, -0.2],
        [0.28, -0.2],
        [-0.28, 0.2],
        [0.28, 0.2],
      ] as const) {
        part(body, box(0.05, 0.5, 0.05), C.post, [x, 0.25, z]);
      }
      part(
        body,
        cylinder(0.7, 0.36, 0.36, 3),
        C.cabinRoof,
        [0, 0.6, 0],
        [1, 1, 1.3],
        [0, 0, Math.PI / 2],
      );
      part(body, box(0.46, 0.05, 0.16), C.log, [0, 0.18, 0.1]);
      // The signpost: two arrow boards nailed across the front of the post,
      // one pointing each way, so both clearly hang on it.
      part(body, box(0.05, 0.66, 0.05), C.post, [0.52, 0.33, -0.3]);
      part(body, box(0.24, 0.08, 0.02), C.storeTrim, [0.6, 0.54, -0.335]);
      part(
        body,
        cylinder(0.02, 0.1, 0.1, 3),
        C.storeTrim,
        [0.72, 0.54, -0.335],
        [1, 1, 0.8],
        [Math.PI / 2, 0, -Math.PI / 2],
      );
      part(body, box(0.24, 0.08, 0.02), C.flag, [0.44, 0.42, -0.335]);
      part(
        body,
        cylinder(0.02, 0.1, 0.1, 3),
        C.flag,
        [0.32, 0.42, -0.335],
        [1, 1, 0.8],
        [Math.PI / 2, 0, Math.PI / 2],
      );
      part(body, box(0.07, 0.04, 0.07), C.post, [0.52, 0.68, -0.3]);
      part(windowList, sphere(0.08, 8), lampColor, [-0.28, 0.42, -0.24]);
      break;
    }
    default:
      part(body, CreateBox(`${name}-box`, { size: 0.5 }, scene), C.plain, [0, 0.25, 0]);
  }
  // Fitted to its tile (`TILE_FOOTPRINT`): shrunk as a whole, or widened only.
  if (fit !== 1) {
    const by = new Vector3(fit, Math.min(fit, 1), fit);
    for (const mesh of [...body, ...glow]) {
      mesh.position.multiplyInPlace(by);
      mesh.scaling.multiplyInPlace(by);
    }
  }
  if (napping) {
    // Two lilac z's rising over its top, drawn unlit so they read at phone size.
    let top = 0;
    for (const mesh of body) {
      mesh.computeWorldMatrix(true);
      top = Math.max(top, mesh.getBoundingInfo().boundingBox.maximumWorld.y);
    }
    const zee = (x: number, y: number, size: number) => {
      const t = size * 0.18;
      for (const dy of [-size / 2, size / 2])
        part(glow, box(size, t, t), C.napZ, [x, y + dy, -0.2]);
      part(glow, box(size * 1.35, t, t), C.napZ, [x, y, -0.2], [1, 1, 1], [0, 0, Math.PI / 4]);
    };
    zee(0.1, top + 0.12, 0.12);
    zee(0.28, top + 0.3, 0.16);
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
