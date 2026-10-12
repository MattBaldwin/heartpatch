import type { HouseGift, HouseView } from '@heartpatch/shared';
import { itemName } from '../inventory/bag-view.js';
import { itemIcon } from '../inventory/item-icons.js';
import { HOUSE_GIFT } from './house-config.js';
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

/**
 * Where the box stands by a bed: at its foot (toward the room's middle,
 * where the camera sees it), else beside it toward the open front, else its
 * other side; never on another bed, and inside the room's walls.
 */
export function besideBed(
  bed: BedSpot,
  beds: readonly BedSpot[],
  room: FloorRect,
): { x: number; z: number } {
  const r = HOUSE_GIFT.size / 2;
  const side = BED_HALF.x + HOUSE_GIFT.besideBed + r;
  const gap = HOUSE_GIFT.wallGap;
  const inside = (p: { x: number; z: number }) =>
    p.x >= room.x0 + gap && p.x <= room.x1 - gap && p.z >= room.z0 + gap && p.z <= room.z1 - gap;
  const cx = (room.x0 + room.x1) / 2;
  const sides = [toWorld(bed, side, -0.15), toWorld(bed, -side, -0.15)].sort(
    (a, b) => a.z - b.z || Math.abs(a.x - cx) - Math.abs(b.x - cx),
  );
  const foot = toWorld(bed, 0, -(BED_HALF.z + HOUSE_GIFT.besideBed + r));
  // The foot first: toward the room's middle (or the open front), clear of the
  // walls and of what stands by them (a side can land behind the hearth).
  const free = [foot, ...sides].find((p) => inside(p) && !beds.some((b) => onBed(b, p, r + 0.05)));
  if (free) return free;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(foot.x, room.x0 + gap, room.x1 - gap),
    z: clamp(foot.z, room.z0 + gap, room.z1 - gap),
  };
}
