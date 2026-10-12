import type { HouseGift } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOUSE_GIFT } from './house-config.js';
import { sampleHouse, withGift } from './house-fixtures.js';
import {
  besideBed,
  giftCard,
  giftPeek,
  giftPlacement,
  giftToast,
  placementKey,
  wrappedGift,
  type BedSpot,
} from './house-gift-view.js';

const gift = (over: Partial<HouseGift> = {}): HouseGift => ({
  day: '2026-10-12',
  giverSquishyId: '0190a000-0000-7000-8000-000000000001',
  itemId: 'timber',
  count: 3,
  note: 'Emberbun found this and thought of you 💛',
  claimed: false,
  ...over,
});

const names = new Map([['0190a000-0000-7000-8000-000000000001', 'Emberbun']]);
const nameOf = (id: string) => names.get(id) ?? null;

describe('the daily gift (#381 H2)', () => {
  it('shows a wrapped gift and nothing once it’s opened, or when there’s none', () => {
    expect(wrappedGift({ gift: gift() })).toEqual(gift());
    expect(wrappedGift({ gift: gift({ claimed: true }) })).toBeNull();
    // A claim of yesterday's gift replies with no gift until the next read.
    expect(wrappedGift({ gift: null })).toBeNull();
    expect(wrappedGift(null)).toBeNull();
  });

  it('names the giver on the peek bar, kindly when it isn’t known here', () => {
    expect(giftPeek(gift(), nameOf)).toBe('🎁 Emberbun left you something!');
    expect(giftPeek(gift({ giverSquishyId: null }), nameOf)).toBe(
      '🎁 A little gift is waiting for you!',
    );
    expect(giftPeek(gift({ giverSquishyId: '0190a000-0000-7000-8000-000000000999' }), nameOf)).toBe(
      '🎁 A little gift is waiting for you!',
    );
    expect(giftPeek(gift({ claimed: true }), nameOf)).toBeNull();
    expect(giftPeek(null, nameOf)).toBeNull();
  });

  it('puts the server’s note on the card as given, with what’s inside and its icon', () => {
    const card = giftCard(gift());
    expect(card).toEqual({
      title: 'A gift for you!',
      note: 'Emberbun found this and thought of you 💛',
      itemId: 'timber',
      icon: '🪵',
      item: '3\u00A0Timber',
      open: 'Open it!',
    });
  });

  it('cheers what came out of it', () => {
    expect(giftToast(gift())).toBe('+3\u00A0Timber\u00A0🎁');
    expect(giftToast(gift({ itemId: 'stone', count: 1 }))).toBe('+1\u00A0Stone\u00A0🎁');
  });

  it('puts the box by the giver’s own bed when the giver is drawn', () => {
    const sample = withGift(sampleHouse(2), { room: 'playroom', index: 1 });
    const drawn = new Set(sample.squishies.map((s) => s.id));
    expect(giftPlacement(sample.view, (id) => drawn.has(id))).toEqual({
      kind: 'bed',
      roomId: 'playroom',
      bed: 1,
    });
  });

  it('goes by the hearth when the giver isn’t drawn (away, traded, or unknown here)', () => {
    const sample = withGift(sampleHouse(1));
    expect(giftPlacement(sample.view, () => false)).toEqual({ kind: 'hearth' });
    const traded = withGift(sampleHouse(1), { away: true });
    expect(giftPlacement(traded.view, () => true)).toEqual({ kind: 'hearth' });
    const nobody = { ...sample.view, gift: gift({ giverSquishyId: null }) };
    expect(giftPlacement(nobody, () => true)).toEqual({ kind: 'hearth' });
    // Out on a job: not in the house, so by the hearth.
    const out = {
      ...sample.view,
      rooms: sample.view.rooms.map((r) => ({
        ...r,
        residents: r.residents.map((x) => ({ ...x, away: 'gathering' as const })),
      })),
    };
    expect(giftPlacement(out, () => true)).toEqual({ kind: 'hearth' });
  });

  it('draws no box for an opened gift or none', () => {
    const sample = withGift(sampleHouse(1), { claimed: true });
    expect(giftPlacement(sample.view, () => true)).toBeNull();
    expect(giftPlacement({ ...sample.view, gift: null }, () => true)).toBeNull();
    expect(placementKey(null)).toBe('none');
    expect(placementKey({ kind: 'hearth' })).toBe('hearth');
    expect(placementKey({ kind: 'bed', roomId: 'snug', bed: 1 })).toBe('bed:snug:1');
  });

  describe('beside a bed', () => {
    const room = { x0: 0, x1: 4.8, z0: 0, z1: 4.8 };
    const r = HOUSE_GIFT.size / 2;
    const clearOf = (p: { x: number; z: number }, beds: readonly BedSpot[]) =>
      beds.every((b) => {
        const dx = p.x - b.x;
        const dz = p.z - b.z;
        const lx = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
        const lz = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
        return Math.abs(lx) >= 0.75 + r || Math.abs(lz) >= 0.55 + r;
      });
    const within = (p: { x: number; z: number }) =>
      p.x > room.x0 + r && p.x < room.x1 - r && p.z > room.z0 + r && p.z < room.z1 - r;

    it('stands at the foot of a bed on a side wall, toward the room’s middle, inside the room', () => {
      // The Snug's west bed: along the west wall, headboard to it.
      const bed = { x: 0.62, z: 4.0, yaw: -Math.PI / 2 };
      const p = besideBed(bed, [bed], room);
      expect(p.x).toBeGreaterThan(bed.x + 0.75); // out in the room, not behind the hearth by the wall
      expect(within(p)).toBe(true);
      expect(clearOf(p, [bed])).toBe(true);
    });

    it('never lands on a neighbouring bed', () => {
      const beds: BedSpot[] = [
        { x: 0.62, z: 4.0, yaw: -Math.PI / 2 },
        { x: 4.18, z: 4.0, yaw: Math.PI / 2 },
        { x: 2.4, z: 4.15, yaw: 0 },
      ];
      for (const bed of beds) {
        const p = besideBed(bed, beds, room);
        expect(within(p)).toBe(true);
        expect(clearOf(p, beds)).toBe(true);
      }
    });

    it('goes beside the bed when its foot would leave the room', () => {
      // A bed facing the front wall up close: its foot is past the wall.
      const bed = { x: 2.4, z: 0.9, yaw: 0 };
      const p = besideBed(bed, [bed], room);
      expect(within(p)).toBe(true);
      expect(clearOf(p, [bed])).toBe(true);
      expect(Math.abs(p.x - bed.x)).toBeGreaterThan(0.75);
    });
  });
});
