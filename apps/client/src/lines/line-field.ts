import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import {
  hexKey,
  hexToWorld,
  type HexKey,
  type PublicLine,
  type PublicTile,
} from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import { DOME, meshFrom, setInstances, topOf, vinyl } from '../map/map-scene.js';
import { maskSides } from '../roads/road-layout.js';
import { armPlacements, linePieces, railSides, type ArmPlacement } from './line-layout.js';
import { postArrays, RAIL_TINT, railArmArrays, spanArrays, WIRE_TINT } from './line-meshes.js';

// Wires and rails on a Clockwork Isle's map (#874 C4, mockup M2): every
// wire post on the isle is one thin-instanced mesh, every half-wire another
// (tinted per instance: a warm glow when the server says it carries power,
// a cold copper cable when it doesn't), and every half-rail a third (iron or
// brass by level). So all the isle's lines are three draw calls at most,
// none for a kind nobody has laid (CLAUDE.md rule 8). A line on a tile with
// a building keeps to a ring round it, so the building stays in the middle.

const LIFT = DOME + 0.006; // TUNE: a hair above the tile's domed top (under the roads' LIFT)
/** On a tile with a building, posts and rails start this far out (a share of the way to the side). TUNE */
export const LINE_RING = 0.62;

/** What the field draws now (the dev hook and tests). */
export interface LineFieldStats {
  readonly wires: number;
  readonly litWires: number;
  readonly rails: number;
  readonly posts: number;
  readonly spans: number;
  readonly railArms: number;
}

const NONE: LineFieldStats = { wires: 0, litWires: 0, rails: 0, posts: 0, spans: 0, railArms: 0 };

export class LineField {
  private readonly posts: Mesh;
  private readonly spans: Mesh;
  private readonly rails: Mesh;
  private stats: LineFieldStats = NONE;

  constructor(scene: Scene) {
    const wood = vinyl(scene, 'line-mat', { color: '#ffffff' });
    wood.roughness = 0.6;
    wood.backFaceCulling = false;
    this.posts = meshFrom(scene, 'wire-posts', postArrays());
    this.posts.material = wood;
    this.rails = meshFrom(scene, 'rail-arms', railArmArrays());
    this.rails.material = wood;
    // The wire is drawn unlit: its tint is its colour, so a powered wire
    // glows the same by day and at night, and a dark one stays dark.
    const cable = new StandardMaterial('wire-mat', scene);
    cable.disableLighting = true;
    cable.diffuseColor = Color3.White();
    cable.emissiveColor = Color3.White();
    cable.specularColor = Color3.Black();
    cable.backFaceCulling = false;
    this.spans = meshFrom(scene, 'wire-spans', spanArrays());
    this.spans.material = cable;
    for (const mesh of [this.posts, this.spans, this.rails]) mesh.setEnabled(false);
  }

  /** Draws every line on a known tile. */
  draw(lines: readonly PublicLine[], tiles: ReadonlyMap<HexKey, PublicTile>): void {
    const posts: Matrix[] = [];
    const spans: Matrix[] = [];
    const spanTint: number[] = [];
    const rails: Matrix[] = [];
    const railTint: number[] = [];
    let wires = 0;
    let litWires = 0;
    let railCount = 0;
    const turn = new Quaternion();
    /** An arm's matrix: turned to its side, moved out to where it starts, shortened to fit. */
    const armAt = (x: number, y: number, z: number, arm: ArmPlacement): Matrix => {
      Quaternion.RotationYawPitchRollToRef(arm.yaw, 0, 0, turn);
      const ox = Math.cos(arm.yaw) * arm.from;
      const oz = -Math.sin(arm.yaw) * arm.from;
      return Matrix.Compose(
        new Vector3(arm.length, 1, 1),
        turn.clone(),
        new Vector3(x + ox, y, z + oz),
      );
    };
    for (const piece of linePieces(lines, tiles)) {
      const tile = tiles.get(hexKey(piece));
      if (!tile) continue;
      const p = hexToWorld(piece, HEX_SIZE);
      const y = topOf(tile) + LIFT;
      if (piece.kind === 'wire') {
        wires += 1;
        if (piece.lit) litWires += 1;
        const tint = piece.lit ? WIRE_TINT.lit : WIRE_TINT.dark;
        const sides = maskSides(piece.mask);
        const arms = armPlacements(sides, piece.ringed, LINE_RING, HEX_SIZE);
        if (!piece.ringed) posts.push(Matrix.Translation(p.x, y, p.z));
        else if (arms.length === 0) {
          // A lone wire by a building: one post out on the ring.
          const [lone] = armPlacements([0], true, LINE_RING, HEX_SIZE);
          if (lone) posts.push(armAt(p.x, y, p.z, { ...lone, length: 1 }));
        }
        for (const arm of arms) {
          // By a building, each arm hangs from its own post on the ring.
          if (piece.ringed) posts.push(armAt(p.x, y, p.z, { ...arm, length: 1 }));
          spans.push(armAt(p.x, y, p.z, arm));
          spanTint.push(tint[0], tint[1], tint[2], 1);
        }
      } else {
        railCount += 1;
        const tint = RAIL_TINT[Math.min(Math.max(piece.level, 1), RAIL_TINT.length) - 1] ?? RAIL_TINT[0];
        for (const arm of armPlacements(railSides(piece.mask), piece.ringed, LINE_RING, HEX_SIZE)) {
          rails.push(armAt(p.x, y, p.z, arm));
          railTint.push(tint[0], tint[1], tint[2], 1);
        }
      }
    }
    setInstances(this.posts, posts, true);
    setInstances(this.spans, spans, true);
    setInstances(this.rails, rails, true);
    if (spans.length > 0) this.spans.thinInstanceSetBuffer('color', new Float32Array(spanTint), 4, false);
    if (rails.length > 0) this.rails.thinInstanceSetBuffer('color', new Float32Array(railTint), 4, false);
    this.stats = {
      wires,
      litWires,
      rails: railCount,
      posts: posts.length,
      spans: spans.length,
      railArms: rails.length,
    };
  }

  get debug(): LineFieldStats {
    return this.stats;
  }
}
