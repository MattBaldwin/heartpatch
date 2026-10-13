import type { HouseGift, HouseView } from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { HOUSE_GIFT, HOUSE_KID } from './house-config.js';
import { GIFT_TEXT } from './house-view.js';

/*
 * What the daily gift shows (#381 H2), pure so every case is unit-tested.
 * The server rolls the gift, writes its note and opens it (CLAUDE.md rule
 * 1): this only arranges what the house view says. An opened gift shows
 * nothing, and so does none (`gift: null`, which is also what a claim of
 * yesterday's gift replies with until the next read).
 */

/** The gift to show: today's while it's still wrapped, else null. */
export function wrappedGift(view: Pick<HouseView, 'gift'> | null): HouseGift | null {
  const gift = view?.gift ?? null;
  return gift && !gift.claimed ? gift : null;
}

/**
 * The peek bar's line: "🎁 Puddlepuff left you something!", or a kind
 * stand-in when the giver isn't known here; null with no wrapped gift.
 */
export function giftPeek(
  gift: HouseGift | null,
  nameOf: (squishyId: string) => string | null,
): string | null {
  if (!gift || gift.claimed) return null;
  const name = gift.giverSquishyId ? nameOf(gift.giverSquishyId) : null;
  return name ? GIFT_TEXT.peek(name) : GIFT_TEXT.peekSomeone;
}

/** The gift card: the server's note, what's inside with its icon, and the button. */
export interface GiftCard {
  readonly title: string;
  readonly note: string;
  readonly itemId: string;
  readonly icon: string;
  /** "3 Timber". */
  readonly item: string;
  readonly open: string;
}

export function giftCard(gift: HouseGift): GiftCard {
  return {
    title: GIFT_TEXT.title,
    note: gift.note,
    itemId: gift.itemId,
    icon: itemIcon(gift.itemId),
    item: GIFT_TEXT.item(gift.count, itemName(gift.itemId)),
    open: GIFT_TEXT.open,
  };
}

/** The toast once it's open: "+3 Timber 🎁". */
export const giftToast = (gift: Pick<HouseGift, 'itemId' | 'count'>): string =>
  GIFT_TEXT.toast(gift.count, itemName(gift.itemId));

/**
 * Where the box waits: by the giver's bed when the giver is drawn in its
 * room (`bed` is its place among the room's residents, so it lands by its
 * own bed), else by the hearth in the Keeper's room.
 */
export type GiftPlacement =
  | { readonly kind: 'bed'; readonly roomId: string; readonly bed: number }
  | { readonly kind: 'hearth' };

export function giftPlacement(
  view: Pick<HouseView, 'gift' | 'rooms'>,
  drawn: (squishyId: string) => boolean,
): GiftPlacement | null {
  const gift = wrappedGift(view);
  if (!gift) return null;
  const giver = gift.giverSquishyId;
  if (giver !== null && drawn(giver)) {
    for (const room of view.rooms) {
      const i = room.residents.findIndex((r) => r.squishyId === giver);
      const resident = room.residents[i];
      if (resident && resident.away === null && room.beds > 0) {
        return { kind: 'bed', roomId: room.id, bed: Math.min(i, room.beds - 1) };
      }
    }
  }
  return { kind: 'hearth' };
}

/**
 * Re-read the house (#381 H2 review): the server rolls today's gift only
 * on a read, so a screen left open past the patch's midnight reads again,
 * unless a build or an open is in flight (its reply comes first).
 */
export const shouldReread = (o: {
  readonly readDay: string;
  readonly today: string;
  readonly busy: boolean;
}): boolean => !o.busy && o.readDay !== '' && o.readDay !== o.today;

/**
 * After opening a gift: read again when it was yesterday's (opened after
 * midnight) or the reply shows no gift, so today's can roll and show.
 */
export const rereadAfterOpen = (
  opened: Pick<HouseGift, 'day'>,
  reply: Pick<HouseView, 'gift'>,
  today: string,
): boolean => reply.gift === null || opened.day !== today;

/** The same placement draws the same box: a new one (tomorrow's) means a new scene. */
export const placementKey = (p: GiftPlacement | null): string =>
  p === null ? 'none' : p.kind === 'bed' ? `bed:${p.roomId}:${String(p.bed)}` : 'hearth';

/** A bed as placed: its middle and its turn (headboard at its local +z). */
export interface BedSpot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A room's floor, world metres. */
export interface FloorRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** A bed's half width (its local x) and half length (its local z), metres (house-models bedFrame). */
const BED_HALF = { x: 0.75, z: 0.55 } as const;

/** A point in a bed's own frame to the world (Babylon's RotationY, then the bed's middle). */
const toWorld = (bed: BedSpot, lx: number, lz: number) => ({
  x: bed.x + lx * Math.cos(bed.yaw) + lz * Math.sin(bed.yaw),
  z: bed.z - lx * Math.sin(bed.yaw) + lz * Math.cos(bed.yaw),
});

/** Does a box of half size `r` at `p` touch this bed? */
function onBed(bed: BedSpot, p: { x: number; z: number }, r: number): boolean {
  const dx = p.x - bed.x;
  const dz = p.z - bed.z;
  const lx = dx * Math.cos(bed.yaw) - dz * Math.sin(bed.yaw);
  const lz = dx * Math.sin(bed.yaw) + dz * Math.cos(bed.yaw);
  return Math.abs(lx) < BED_HALF.x + r && Math.abs(lz) < BED_HALF.z + r;
}

/** One of the cast standing in the room (its feet, about how far it reaches): the box keeps clear of it. */
export interface CastFootprint {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  /** A squishy (never covered by the box), or the Keeper. */
  readonly squishy: boolean;
}

/**
 * Where the box stands for its giver (H2 render check: never behind a
 * squishy's leg or ears): the first of the bed's foot, then spots on the way
 * from the foot to the room's middle, then the bed's sides, that is inside
 * the walls, off every bed, clear of the cast, not hidden behind any of them
 * from kid height, and not standing in front of a squishy. B5a: a spot
 * that also keeps clear of the Keeper's whole body (not just its face) wins,
 * by the bed or else at one of the room's `spare` spots. With none clear, the
 * spot that comes closest.
 */
export function besideBed(
  bed: BedSpot,
  beds: readonly BedSpot[],
  room: FloorRect,
  cast: readonly CastFootprint[] = [],
  /** Spots the room keeps clear of its furniture (the Snug's by the hearth), tried when no spot by the bed clears everyone. */
  spare: readonly { x: number; z: number }[] = [],
): { x: number; z: number } {
  const r = HOUSE_GIFT.size / 2;
  const side = BED_HALF.x + HOUSE_GIFT.besideBed + r;
  const gap = HOUSE_GIFT.wallGap;
  const inside = (p: { x: number; z: number }) =>
    p.x >= room.x0 + gap && p.x <= room.x1 - gap && p.z >= room.z0 + gap && p.z <= room.z1 - gap;
  const cx = (room.x0 + room.x1) / 2;
  const cz = (room.z0 + room.z1) / 2;
  const foot = toWorld(bed, 0, -(BED_HALF.z + HOUSE_GIFT.besideBed + r));
  const toward = [0.25, 0.5, 0.75, 1].map((t) => ({
    x: foot.x + (cx - foot.x) * t,
    z: foot.z + (cz - foot.z) * t,
  }));
  const sides = [toWorld(bed, side, -0.15), toWorld(bed, -side, -0.15)].sort(
    (a, b) => a.z - b.z || Math.abs(a.x - cx) - Math.abs(b.x - cx),
  );
  // Kid height stands in front of the room's middle, looking in (the dollhouse looks from further, higher).
  const eye = { x: cx, z: room.z0 - HOUSE_KID.minStandBack };
  const view = (p: { x: number; z: number }, reach: number) => {
    const dx = p.x - eye.x;
    const dz = p.z - eye.z;
    const far = Math.hypot(dx, dz);
    return { angle: Math.atan2(dx, dz), half: Math.atan(reach / Math.max(far, 0.01)), far };
  };
  /**
   * How clear a spot is: below 0 it touches, hides behind or covers someone.
   * `keeper`: the box in front of the Keeper counts too (B5a: at kid height
   * it hid the Keeper from the waist down), not only its face.
   */
  const clearance = (p: { x: number; z: number }, keeper: boolean): number => {
    const box = view(p, r);
    let least = Infinity;
    for (const c of cast) {
      least = Math.min(least, Math.hypot(p.x - c.x, p.z - c.z) - (c.r + r + 0.1));
      const them = view(c, c.r);
      const apart = Math.abs(box.angle - them.angle) - (box.half + them.half);
      // In line of sight with it: hidden behind it, or covered by the box.
      if (them.far < box.far || c.squishy || keeper) least = Math.min(least, apart * box.far);
    }
    return least;
  };
  const usable = (p: { x: number; z: number }) =>
    inside(p) && !beds.some((b) => onBed(b, p, r + 0.05));
  const spots = [foot, ...toward, ...sides].filter(usable);
  // Clear of everyone's whole body first, by the bed or at a spare spot;
  // else as before (the Keeper's face clear, its legs maybe not).
  const clear =
    spots.find((p) => clearance(p, true) >= 0) ??
    spare.filter(usable).find((p) => clearance(p, true) >= 0) ??
    spots.find((p) => clearance(p, false) >= 0);
  if (clear) return clear;
  const best = spots.reduce<{ p: { x: number; z: number }; c: number } | null>((acc, p) => {
    const c = clearance(p, false);
    return acc === null || c > acc.c ? { p, c } : acc;
  }, null);
  if (best) return best.p;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(foot.x, room.x0 + gap, room.x1 - gap),
    z: clamp(foot.z, room.z0 + gap, room.z1 - gap),
  };
}
