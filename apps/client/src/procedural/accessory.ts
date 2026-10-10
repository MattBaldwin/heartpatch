import type { Body, ClothingItem, PartShape, SquishyAnchor } from '@heartpatch/shared';
import { surfacePoint } from './body-shape.js';
import { hexToRgb, type Rgb, type SquishyParams, type Vec3 } from './params.js';

/**
 * Where a squishy accessory sits (#340; DECISIONS "Wardrobe (#43)"): the
 * catalog's pieces are in socket sizes from an anchor, like Keeper clothing,
 * so one piece fits every species and nothing is made per body. Pure maths,
 * no Babylon.
 *
 * - **crown:** on top of the head (the body, for one-piece squishies), seated
 *   where the head is wide enough to hold a hat, sized like the head.
 * - **neck:** a ring sized to the body's width there: low on the head for a
 *   squishy with one (where it meets the torso), else just under the face, so
 *   a scarf wraps the squishy wherever its face sits.
 */

export interface AccessorySocket {
  /** The anchor, from the squishy's ground point (world units at placement scale 1). */
  readonly at: Vec3;
  /** One socket size along x, y and z, world units. */
  readonly size: Vec3;
}

/** One primitive of a worn accessory, ready to draw. */
export interface AccessoryPiece {
  readonly shape: PartShape;
  readonly at: Vec3;
  readonly size: Vec3;
  /** Degrees: pitch (x), yaw (y), roll (z). */
  readonly turn: Vec3;
  readonly color: Rgb;
}

/** The neck ring sits this far (radians up the body) under the lowest face part. */
const NECK_BELOW_FACE = 0.3; // TUNE: judge in the gallery (`?accessory=snuggle-scarf`)
/** …and never below this share of the body's height, so a scarf under a low face stays off the ground. */
const NECK_LOWEST = 0.32; // TUNE
/** On a separate head, the neck ring sits this far up it (radians; −π/2 is its bottom). */
const NECK_ON_HEAD = -0.55; // TUNE
/** Where the face sits when a species has no eyes or mouth. */
const FACE_UP = 0.15;
/**
 * A hat sits on the highest ring of the head at least this share of the
 * head's width across: on a round top just below the crest, on a drop's or
 * a ghost's thin tip down on its shoulders (the tip tucks inside), on a
 * pumpkin up on its lobes.
 */
const CROWN_SEAT = 0.5; // TUNE: owner #340, "a hat covers about half the head"
/** Rings sampled up the head to find the seat. */
const SEAT_STEPS = 24;

const NO_TURN: Vec3 = [0, 0, 0];

/** The face's host body: the head when the species has one. */
function faceHost(
  params: SquishyParams,
  bodies: ReadonlyMap<string, Body>,
): { body: Body; scale: Vec3; at: Vec3; onHead: boolean } | null {
  const headBody = params.head ? bodies.get(params.head.id) : undefined;
  if (params.head && headBody) {
    return { body: headBody, scale: params.head.scale, at: params.head.offset, onHead: true };
  }
  const body = bodies.get(params.body.id);
  return body ? { body, scale: params.body.scale, at: [0, params.lift, 0], onHead: false } : null;
}

/** The lowest `up` of the face (eyes and mouth) on a one-piece body. */
function faceLow(params: SquishyParams): number {
  let low = Infinity;
  for (const part of params.parts) {
    if (part.slot !== 'eyes' && part.slot !== 'mouth') continue;
    for (const p of part.placements) low = Math.min(low, p.up);
  }
  return Number.isFinite(low) ? low : FACE_UP;
}

const scaledPoint = (body: Body, scale: Vec3, around: number, up: number): Vec3 => {
  const p = surfacePoint(body, around, up);
  return [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]];
};

/**
 * How high a hat sits on a host (see `CROWN_SEAT`), from the host's ground
 * point: the highest ring at least half as wide or half as deep as the head,
 * so everything above it fits inside the hat.
 */
function crownSeat(body: Body, scale: Vec3, size: Vec3): number {
  let seat = 0;
  for (let i = 0; i <= SEAT_STEPS; i++) {
    const up = (i / SEAT_STEPS) * (Math.PI / 2);
    const side = scaledPoint(body, scale, Math.PI / 2, up);
    const front = scaledPoint(body, scale, 0, up);
    const back = scaledPoint(body, scale, Math.PI, up);
    const wide = 2 * Math.abs(side[0]) >= CROWN_SEAT * size[0];
    const deep = Math.abs(back[2] - front[2]) >= CROWN_SEAT * size[2];
    if (wide || deep) seat = Math.max(seat, side[1], front[1]);
  }
  return seat;
}

/** The socket a squishy's accessory hangs from; null if its body is unknown. */
export function accessorySocket(
  params: SquishyParams,
  bodies: ReadonlyMap<string, Body>,
  anchor: SquishyAnchor,
): AccessorySocket | null {
  const host = faceHost(params, bodies);
  if (!host) return null;
  const { body, scale, at, onHead } = host;
  const size: Vec3 = [body.width * scale[0], body.height * scale[1], body.depth * scale[2]];
  if (anchor === 'crown') {
    const top = scaledPoint(body, scale, 0, Math.PI / 2);
    return { at: [at[0] + top[0], at[1] + crownSeat(body, scale, size), at[2] + top[2]], size };
  }
  let up = onHead ? NECK_ON_HEAD : faceLow(params) - NECK_BELOW_FACE;
  while (!onHead && up < 1 && scaledPoint(body, scale, 0, up)[1] < NECK_LOWEST * size[1]) {
    up += 0.05;
  }
  const front = scaledPoint(body, scale, 0, up);
  const back = scaledPoint(body, scale, Math.PI, up);
  const side = scaledPoint(body, scale, Math.PI / 2, up);
  return {
    at: [at[0], at[1] + front[1], at[2] + (front[2] + back[2]) / 2],
    // Across the ring (x, z) and the host's height (y).
    size: [2 * Math.abs(side[0]), size[1], Math.abs(back[2] - front[2])],
  };
}

/** An accessory's pieces on `socket`, from the squishy's ground point. */
export function accessoryPieces(item: ClothingItem, socket: AccessorySocket): AccessoryPiece[] {
  const { at, size } = socket;
  return item.visual.pieces.map((p) => ({
    shape: p.shape,
    at: [at[0] + p.at[0] * size[0], at[1] + p.at[1] * size[1], at[2] + p.at[2] * size[2]],
    size: [p.size[0] * size[0], p.size[1] * size[1], p.size[2] * size[2]],
    turn: p.turn ?? NO_TURN,
    color: hexToRgb(p.color),
  }));
}
