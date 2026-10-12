import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { HOUSE_GRID, HOUSE_GROWN } from './house-config.js';
import {
  counter,
  gallery,
  hangingLantern,
  heartTree,
  heartTreeCrown,
  kitchenShelves,
  kitchenTable,
  ovalRug,
  playMat,
  playTent,
  stairs,
  starLight,
  stove,
  toyChest,
  toyBlocks,
  type Parts,
} from './house-models.js';
import { placed, type FloorSpot, type RoomKit, type RoomPlan } from './house-rooms.js';

/*
 * The grown rooms (#381 B3, the owner-approved mockup 2026-10-12): what the
 * Playroom, the Kitchen loft and the two-storey Heart Hall hold, registered
 * by look in house-rooms.ts. Each builder places its pieces from the room's
 * box (so a modest data edit to its size still fits), with every piece merged into
 * the room's one solid mesh and one glow mesh: furniture adds triangles,
 * never draw calls. The Keeper stays in the Snug, so these rooms plan only
 * where their residents stand.
 *
 * Pieces are built facing local -z, toward the open front: yaw 0 faces the
 * dollhouse camera, -π/2 stands against the west wall facing in, π/2 the east.
 *
 * The builders are function declarations: house-rooms.ts imports them and
 * this file imports `placed` back, and a declaration is there whichever
 * module loads first (a `const` would not be).
 */

const WEST = -Math.PI / 2;
const EAST = Math.PI / 2;

/** A room's helpers: `at(u, v)` is metres from its front-left corner, on its floor. */
function frame(kit: RoomKit) {
  const { box } = kit;
  return {
    w: box.x1 - box.x0,
    d: box.z1 - box.z0,
    y: box.y0,
    at: (u: number, v: number): [number, number] => [box.x0 + u, box.z0 + v],
    spot: (u: number, v: number): FloorSpot => ({ x: box.x0 + u, z: box.z0 + v }),
  };
}

/** Places a piece (solid meshes, or solid and glow parts) on the room's floor, turned by `yaw`. */
function put(
  kit: RoomKit,
  piece: Parts | readonly Mesh[],
  x: number,
  y: number,
  z: number,
  yaw: number,
): void {
  const parts: Parts = isParts(piece) ? piece : { solid: [...piece], glow: [] };
  if (parts.solid.length > 0) kit.solid([placed(parts.solid, x, y, z, yaw)]);
  if (parts.glow.length > 0) kit.glow([placed(parts.glow, x, y, z, yaw)]);
}

const isParts = (piece: Parts | readonly Mesh[]): piece is Parts => !Array.isArray(piece);

/** A bed with its contact shadow; `along` says it lies along a side wall. */
function bedAt(kit: RoomKit, x: number, z: number, yaw: number): void {
  kit.bed(x, z, yaw);
  const along = Math.abs(Math.sin(yaw)) > 0.5;
  kit.shadow(x, z, along ? 1.5 : 1.9, along ? 1.9 : 1.5);
}

/**
 * The Playroom (level 2): a play mat of coloured squares in the middle, a
 * toy chest with its lid open by the back wall, a striped play tent in the
 * back-right corner and a star night-light in the front corner. One bed along the back wall, the
 * next along the east wall under its window.
 */
export function playroomRoom(kit: RoomKit): RoomPlan {
  const { scene } = kit;
  const { w, d, y, at, spot } = frame(kit);

  const [mx, mz] = at(w * 0.45, d * 0.4);
  put(kit, playMat(scene), mx, y, mz, 0);

  // Off the back wall: the lid leans back and must stay clear of it.
  const [cx, cz] = at(0.85, d - 0.8);
  put(kit, toyChest(scene), cx, y, cz, 0);
  kit.shadow(cx, cz, 1.3, 0.9);

  const [tx, tz] = at(w - 0.95, d - 0.95);
  put(kit, playTent(scene), tx, y, tz, 0.4);
  kit.shadow(tx, tz, 1.7, 1.7);

  const slots = [
    { u: w * 0.49, v: d - 0.65, yaw: 0 },
    { u: w - 0.62, v: d * 0.4, yaw: EAST },
  ];
  for (const s of slots.slice(0, kit.box.beds)) {
    const [bx, bz] = at(s.u, s.v);
    bedAt(kit, bx, bz, s.yaw);
  }

  // The star night-light in the open front-left corner, where it reads.
  const [lx, lz] = at(0.45, 0.45);
  put(kit, starLight(scene), lx, y, lz, 0);
  kit.pool(lx, lz, 0.9);
  kit.light('lamp', lx, y + 0.9, lz);

  const [bx, bz] = at(w * 0.66, 0.55);
  put(kit, toyBlocks(scene), bx, y, bz, 0.3);

  return {
    keeper: null,
    residents: [spot(w * 0.34, d * 0.36), spot(w * 0.58, d * 0.44), spot(w * 0.4, d * 0.62)],
  };
}

/**
 * The Kitchen loft (level 3, upstairs): a little iron stove in the back-left
 * corner with its pipe up to the roof, a counter along the back wall under
 * the window, shelves of jars on the west wall and a round table with a pie
 * in the middle. Its beds stand along the east wall, either side of the door.
 */
export function kitchenRoom(kit: RoomKit): RoomPlan {
  const { scene } = kit;
  const { w, d, y, at, spot } = frame(kit);

  // On the low tier the fire's window is bright vinyl in the room's solid
  // mesh: alone upstairs, its glow would cost the floor a draw call.
  const [sx, sz] = at(0.65, d - 0.55);
  const fire = stove(scene, HOUSE_GRID.storey - 0.2);
  put(
    kit,
    kit.tier === 'low' ? { solid: [...fire.solid, ...fire.glow], glow: [] } : fire,
    sx,
    y,
    sz,
    0,
  );
  kit.shadow(sx, sz, 1.3, 1.0);
  kit.pool(sx, sz - 0.6, 1.3);
  kit.light('fire', sx, y + 0.8, sz - 0.7);

  // Between the stove and the beds; a Kitchen tuned too narrow goes without.
  const counterW = Math.min(2.0, w - 2.6);
  if (counterW >= 0.6) {
    const [kx, kz] = at(1.3 + counterW / 2, d - 0.45);
    put(kit, counter(scene, counterW), kx, y, kz, 0);
    kit.shadow(kx, kz, counterW + 0.3, 0.9);
  }

  const [hx, hz] = at(0.27, d * 0.42);
  put(kit, kitchenShelves(scene, Math.min(2.2, d * 0.5)), hx, y, hz, WEST);

  const [tx, tz] = at(w * 0.48, d * 0.4);
  put(kit, kitchenTable(scene), tx, y, tz, 0);
  kit.shadow(tx, tz, 2.2, 1.4);

  const slots = [
    { u: w - 0.62, v: d - 0.85, yaw: EAST },
    { u: w - 0.62, v: 0.85, yaw: EAST },
  ];
  for (const s of slots.slice(0, kit.box.beds)) {
    const [bx, bz] = at(s.u, s.v);
    bedAt(kit, bx, bz, s.yaw);
  }

  return {
    keeper: null,
    // In front of the table and by the counter: the stools stand behind the table.
    residents: [spot(w * 0.3, d * 0.16), spot(w * 0.62, d * 0.16), spot(w * 0.5, d * 0.66)],
  };
}

/**
 * The Heart Hall (level 4, the top level, two storeys): the Heart Tree grows
 * up through the middle with a gold heart in its crown, a gallery runs along
 * the back wall at the second storey with stairs up the east wall, lanterns
 * hang either side of the tree and a gold-edged rug lies in front of it. The
 * beds sleep in a row under the gallery.
 */
export function heartHallRoom(kit: RoomKit): RoomPlan {
  const { scene, box } = kit;
  const { w, d, y, at, spot } = frame(kit);
  const g = HOUSE_GROWN.hall;
  const upper = HOUSE_GRID.storey;
  const tall = box.y1 - box.y0;
  const deck = g.galleryDepth;

  // The gallery along the back wall, its floor at the second storey.
  if (box.storeys > 1) {
    const inner = w - HOUSE_GRID.wall;
    const [gx, gz] = at(w / 2, d - HOUSE_GRID.wall / 2 - deck / 2);
    kit.solid([placed(gallery(scene, inner, deck, upper), gx, y + upper, gz, 0)]);
    // Stairs up the east wall to the gallery's front edge (a Hall tuned too
    // shallow for a walkable flight goes without).
    const front = d - HOUSE_GRID.wall / 2 - deck;
    const run = front - 0.6;
    if (run >= 2) {
      const [sx, sz] = at(w - g.stairWidth / 2 - HOUSE_GRID.wall / 2, front - run);
      kit.solid([placed(stairs(scene, g.stairWidth, upper, run, g.steps), sx, y, sz, 0)]);
      kit.shadow(sx, sz + run / 2, g.stairWidth + 0.3, run);
    }
  }

  // The tree stands right of the middle: at w / 2 the Kitchen loft's wall hid its trunk.
  const treeU = w * 0.58;
  const [rx, rz] = at(treeU, d * 0.3);
  put(kit, ovalRug(scene, Math.min(2.2, w * 0.24), Math.min(1.3, d * 0.2)), rx, y, rz, 0);

  const treeH = Math.min(5.6, tall - 0.4);
  const [tx, tz] = at(treeU, d * 0.56);
  put(kit, heartTree(scene, treeH), tx, y, tz, 0);
  kit.shadow(tx, tz, 2.0, 2.0);
  // A warm light just in front of the crown's gold heart.
  const crown = heartTreeCrown(treeH);
  kit.light('lamp', tx, y + crown.y - 0.6, tz + crown.z - 1.0);

  // Either side of the tree's crown, clear of the gallery's posts.
  for (const u of [w * 0.32, w * 0.88]) {
    const [lx, lz] = at(u, d * 0.42);
    put(kit, hangingLantern(scene, 1.6), lx, y + tall - 0.1, lz, 0);
  }

  // Beds in a row under the gallery, either side of the tree: room for 5 (the
  // data has 4); a Hall tuned past that would want a second row.
  const n = kit.box.beds;
  const spacing = Math.min(1.7, (w - 1.0) / Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const side = i < Math.ceil(n / 2) ? -1 : 1;
    const k = side < 0 ? i : i - Math.ceil(n / 2);
    const u = side < 0 ? 0.5 + 0.75 + k * spacing : w - 0.5 - 0.75 - k * spacing;
    const [bx, bz] = at(u, d - 0.65);
    bedAt(kit, bx, bz, 0);
  }

  // Residents stand right of the Kitchen loft, which hides the Hall's left
  // from the dollhouse camera (render check: faces hidden on the iPad's 48°
  // pitch). Past the band's four, more wait on the left, out of the way.
  const band = HOUSE_GROWN.hall.residentBand;
  const residents = Array.from({ length: Math.max(n, band.length) }, (_, i) => {
    const b = band[i];
    if (b) return spot(w * b[0], d * b[1]);
    const k = i - band.length;
    return spot(w * (0.1 + 0.1 * (k % 4)), d * (0.3 + 0.16 * Math.floor(k / 4)));
  });
  return { keeper: null, residents };
}
