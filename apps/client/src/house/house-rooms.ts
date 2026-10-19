import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { HouseRoomLook } from '@heartpatch/shared';
import {
  BED_FRAME,
  braidedRug,
  hearth,
  hearthSize,
  mug,
  plant,
  sideTable,
  tableLamp,
  toys,
  type Parts,
} from './house-models.js';
import { HOUSE_GIFT, HOUSE_GRID, HOUSE_TIERS } from './house-config.js';
import type { QualityTier } from '../engine/config.js';
import { heartHallRoom, kitchenRoom, playroomRoom } from './house-rooms-grown.js';
import type { RoomBox } from './house-layout.js';
import { inLane, type DoorLane } from './house-walk.js';

/*
 * What goes inside each room (#381 plan §1c), by its look: a registry of
 * room builders keyed by `HouseRoomLook`, so a new look plugs in by
 * registering a builder and the scene never names a room or a level. The
 * scene lays out every room's shell from its grid layout and then calls the
 * builder for its look, or the plain room when none is registered (a house
 * from a newer server still draws).
 */

/** A point on a room's floor, world metres. */
export interface FloorSpot {
  readonly x: number;
  readonly z: number;
}

/** What a room builder can put in its room; the scene merges and lights it all. */
export interface RoomKit {
  readonly scene: Scene;
  readonly box: RoomBox;
  /** The quality tier, so a builder can pick lighter parts on low (the iPad 9th gen budget). */
  readonly tier: QualityTier;
  /**
   * The clear lanes in front of the room's doorways (#381 W3): no furniture
   * that blocks the Keeper may stand in one (`inLane`).
   */
  readonly lanes: readonly DoorLane[];
  /**
   * Matte-vinyl furniture, merged into the room's one mesh. `walkable`: part
   * of the floor (a deck the walk's floor rects stand for), not furniture
   * the Keeper walks round.
   */
  solid(parts: readonly Mesh[], walkable?: boolean): void;
  /** Glowing bits (lamp shades, flames), merged into the room's glow mesh. */
  glow(parts: readonly Mesh[]): void;
  /** A bed, headboard at its local +z, turned by `yaw`; the scene colours its blanket (`placeBeds` picks the spots). */
  bed(x: number, z: number, yaw: number): void;
  /** A soft contact shadow on the floor under a piece (low tier: no shadow map). */
  shadow(x: number, z: number, width: number, depth: number): void;
  /** A warm pool of light on the floor round a lamp or a fire. */
  pool(x: number, z: number, radius: number): void;
  /** Asks for a warm point light here; the scene lights as many as the tier allows. */
  light(kind: 'fire' | 'lamp', x: number, y: number, z: number): void;
  /** The Heart Seed keepsake (glossy vinyl, softly glowing), e.g. on a mantel. */
  heartSeed(x: number, y: number, z: number, scale: number): void;
  /** The house's name sign on a wall, facing -z. */
  sign(x: number, y: number, z: number, width: number): void;
}

/** Where the room's cast stands: the Keeper (by the fire) and its residents. */
export interface RoomPlan {
  readonly keeper: FloorSpot | null;
  readonly residents: readonly FloorSpot[];
  /** Where a gift waits by the hearth (#381 H2), clear of the cast; the room's front-left corner if left out. */
  readonly gift?: FloorSpot;
}

export type RoomBuilder = (kit: RoomKit) => RoomPlan;

const registry = new Map<HouseRoomLook, RoomBuilder>();

/** Registers what a look's room holds (the last one registered wins). */
export function registerRoom(look: HouseRoomLook, builder: RoomBuilder): void {
  registry.set(look, builder);
}

/** The builder for a look, or the plain room. */
export function roomBuilder(look: HouseRoomLook): RoomBuilder {
  return registry.get(look) ?? plainRoom;
}

/** True when a look has its own builder (the rest draw as the plain room). */
export const hasRoomBuilder = (look: HouseRoomLook): boolean => registry.has(look);

/**
 * Merges parts into one mesh and moves it to `(x, y, z)` turned by `yaw`,
 * baked into its vertices (so the room can merge it again with the rest).
 */
export function placed(parts: readonly Mesh[], x: number, y: number, z: number, yaw: number): Mesh {
  const mesh = Mesh.MergeMeshes([...parts], true, true);
  if (!mesh) throw new Error('placed: nothing to merge');
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}

/** Where a bed can stand: its middle and its turn (headboard at its local +z). */
export interface BedSlot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A bed's box on the floor: `BED_FRAME` turned by its yaw (a quarter turn lies it along a side wall). */
export function bedFootprint(s: BedSlot): { x0: number; x1: number; z0: number; z1: number } {
  const { length, width } = BED_FRAME;
  const [hx, hz] =
    Math.abs(Math.sin(s.yaw)) > 0.7 ? [width / 2, length / 2] : [length / 2, width / 2];
  return { x0: s.x - hx, x1: s.x + hx, z0: s.z - hz, z1: s.z + hz };
}

/**
 * Makes the room's beds, with their contact shadows, in the first of its
 * `slots` (the room plan's, in order) that keep out of its doorways' lanes
 * (#381 W3: at level 4 the Hall's doorway takes the Snug's back-right corner,
 * so its second bed goes in its third slot). Short of clear slots, the rest
 * take blocked ones (the scene test of every level catches that). The slots
 * used, in the plan's order.
 */
export function placeBeds(kit: RoomKit, slots: readonly BedSlot[]): BedSlot[] {
  const n = kit.box.beds;
  const clear = slots.filter((s) => !inLane(kit.lanes, bedFootprint(s), kit.box.y0));
  const used = [...clear, ...slots.filter((s) => !clear.includes(s))]
    .slice(0, n)
    .sort((a, b) => slots.indexOf(a) - slots.indexOf(b));
  for (const s of used) {
    kit.bed(s.x, s.z, s.yaw);
    const along = Math.abs(Math.sin(s.yaw)) > 0.5;
    kit.shadow(s.x, s.z, along ? 1.5 : 1.9, along ? 1.9 : 1.5);
  }
  return used;
}

/** Spots in rows across the middle of a room, front to back, for residents. */
function rowSpots(box: RoomBox, count: number): FloorSpot[] {
  const w = box.x1 - box.x0;
  const d = box.z1 - box.z0;
  const perRow = Math.max(1, Math.floor(w / 1.3));
  return Array.from({ length: count }, (_, i) => ({
    x: box.x0 + (w * ((i % perRow) + 0.5)) / perRow,
    z: box.z0 + d * (0.42 + 0.16 * Math.floor(i / perRow)),
  }));
}

/** Beds side by side along the back wall, headboards to the wall. */
function backBeds(kit: RoomKit): void {
  const { box } = kit;
  const n = box.beds;
  const w = box.x1 - box.x0;
  placeBeds(
    kit,
    Array.from({ length: n }, (_, i) => ({
      x: box.x0 + (w * (i + 0.5)) / n,
      z: box.z1 - 0.65,
      yaw: 0,
    })),
  );
}

/**
 * The plain room, for a look with no builder yet: a rug, its beds along the
 * back wall and room for its residents.
 */
export const plainRoom: RoomBuilder = (kit) => {
  const { box, scene } = kit;
  const cx = (box.x0 + box.x1) / 2;
  const cz = (box.z0 + box.z1) / 2;
  kit.solid(braidedRug(scene, cx, cz - 0.3, Math.min(1.4, (box.x1 - box.x0) * 0.28), box.y0));
  backBeds(kit);
  return { keeper: null, residents: rowSpots(box, box.beds) };
};

/**
 * The Snug (level 1, owner-approved mockup 2026-10-11): a hearth in the
 * left corner turned toward the open front, beds along the side walls at
 * the back, a braided rug, a side table with a lamp and a cocoa mug, a plant
 * and toys at the front, the house's name over the back window.
 */
export const snugRoom: RoomBuilder = (kit) => {
  const { box, scene } = kit;
  const w = box.x1 - box.x0;
  const d = box.z1 - box.z0;
  const y = box.y0;
  const at = (u: number, v: number): [number, number] => [box.x0 + u, box.z0 + v];

  // The hearth, angled 30° toward the dollhouse camera so the lit fire reads,
  // forward of the left bed (B5a: at 0.42 of the depth its mantel stood over
  // the bed in every dollhouse view).
  const [hx, hz] = at(0.62, d * 0.33); // TUNE
  const facing = (2 * Math.PI) / 3; // TUNE: B5a: 0.75π hid a face behind it at level 4
  const fire: Parts = hearth(scene, false, HOUSE_TIERS[kit.tier].rounds);
  kit.solid([placed(fire.solid, hx, y, hz, facing)]);
  kit.glow([placed(fire.glow, hx, y, hz, facing)]);
  const fwd = { x: Math.sin(facing), z: Math.cos(facing) };
  // The Heart Seed keepsake on the mantel, toward its right end.
  const size = hearthSize(false);
  const along = { x: Math.cos(facing), z: -Math.sin(facing) };
  kit.heartSeed(
    hx + along.x * size.w * 0.3 + fwd.x * 0.1,
    y + size.h + 0.24,
    hz + along.z * size.w * 0.3 + fwd.z * 0.1,
    0.85,
  );
  kit.shadow(hx + fwd.x * 0.4, hz + fwd.z * 0.4, 2.4, 1.4);
  kit.pool(hx + fwd.x * 1.3, hz + fwd.z * 1.3, 1.9);
  kit.light('fire', hx + fwd.x * 0.9, y + 0.75, hz + fwd.z * 0.9);

  // Beds along the side walls at the back: the first two, then along the back.
  placeBeds(
    kit,
    [
      { u: 0.62, v: d - 0.8, yaw: -Math.PI / 2 },
      { u: w - 0.62, v: d - 0.8, yaw: Math.PI / 2 },
      { u: w / 2, v: d - 0.65, yaw: 0 },
    ].map((s) => {
      const [x, z] = at(s.u, s.v);
      return { x, z, yaw: s.yaw };
    }),
  );

  const [rx, rz] = at(w / 2, d * 0.33);
  kit.solid(braidedRug(scene, rx, rz, Math.min(1.35, w * 0.28), y));

  const [tx, tz] = at(w - 0.65, 0.75);
  kit.solid([...sideTable(scene, tx, tz, y), ...mug(scene, tx - 0.15, y + 0.66, tz + 0.15)]);
  kit.shadow(tx, tz, 1.3, 1.3);
  const lamp = tableLamp(scene, tx + 0.2, tz - 0.15, y + 0.66, '#f6a83c'); // amber
  kit.solid(lamp.solid);
  kit.glow(lamp.glow);
  kit.pool(tx, tz, 1.5);
  // The light itself a little in from the shade, toward the room: right by
  // the east wall its hotspot washed the wall and the table out (H2 render check).
  kit.light('lamp', tx - 0.35, y + 1.36, tz - 0.15); // TUNE

  // The plant in the front-left corner, just in front of the hearth (B5a:
  // tucked in a little as the hearth came forward; out of the kid frame).
  const [px, pz] = at(0.4, 0.33); // TUNE
  kit.solid(plant(scene, px, pz, y));
  kit.shadow(px, pz, 0.9, 0.9);
  // The pink ball beside the plant, the open book at the rug's front edge.
  kit.solid(
    toys(scene, { ball: at(1.5, 1.05), book: at(w * 0.4, 0.62), block: at(w * 0.62, 0.42) }, y),
  );

  // Over the back window, in front of the wall's inside face (and its light band).
  kit.sign(box.x0 + w / 2, y + 2.62, box.z1 - HOUSE_GRID.wall / 2 - 0.05, 1.9);
  return {
    // Behind the two on the rug, in the gap between them: clear of both at kid height.
    keeper: { x: box.x0 + w * 0.55, z: box.z0 + d * 0.7 },
    // By the east wall behind the side table: in view from the dollhouse,
    // clear of the two on the rug and the Keeper from kid height.
    gift: { x: box.x0 + HOUSE_GIFT.snugSpare.x, z: box.z0 + HOUSE_GIFT.snugSpare.z },
    residents: [at(w * 0.33, d * 0.4), at(w * 0.67, d * 0.36), at(w * 0.5, d * 0.22)].map(
      ([x, z]) => ({ x, z }),
    ),
  };
};

registerRoom('snug', snugRoom);
registerRoom('playroom', playroomRoom);
registerRoom('kitchen', kitchenRoom);
registerRoom('heart-hall', heartHallRoom);
