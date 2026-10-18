import type { HouseGift } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { HOUSE_GIFT } from './house-config.js';
import { localDayIn } from './house-welcome.js';
import { sampleHouse, withGift } from './house-fixtures.js';
import {
  besideBed,
  giftCard,
  giftPeek,
  giftPlacement,
  giftToast,
  placementKey,
  rereadAfterOpen,
  shouldReread,
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

  describe('a new day on a screen left open (review: today’s gift rolls only on a read)', () => {
    const zone = 'America/Chicago';
    const day = (iso: string) => localDayIn(zone, new Date(iso));

    it('reads again after the patch’s midnight (left open overnight)', () => {
      const readDay = day('2026-10-13T04:30:00Z'); // 11:30 pm on the 12th in Chicago
      expect(shouldReread({ readDay, today: day('2026-10-13T04:59:00Z'), busy: false })).toBe(
        false,
      );
      // 7 am on the 13th: the light moved on, and so must the gift.
      expect(shouldReread({ readDay, today: day('2026-10-13T12:00:00Z'), busy: false })).toBe(true);
      // Not while a build or an open is in flight: its reply comes first.
      expect(shouldReread({ readDay, today: day('2026-10-13T12:00:00Z'), busy: true })).toBe(false);
      // Nothing read yet: nothing to compare.
      expect(shouldReread({ readDay: '', today: day('2026-10-13T12:00:00Z'), busy: false })).toBe(
        false,
      );
    });

    it('reads again after opening yesterday’s gift just past midnight', () => {
      const today = day('2026-10-13T05:05:00Z'); // 00:05 on the 13th in Chicago
      const yesterdays = gift({ day: '2026-10-12' });
      // The server replies with no gift until the next read rolls today's.
      expect(rereadAfterOpen(yesterdays, { gift: null }, today)).toBe(true);
      expect(rereadAfterOpen(yesterdays, { gift: { ...yesterdays, claimed: true } }, today)).toBe(
        true,
      );
      // Today's gift opened: the reply already says so, no second read.
      const todays = gift({ day: today });
      expect(rereadAfterOpen(todays, { gift: { ...todays, claimed: true } }, today)).toBe(false);
    });
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

    it('keeps out from behind a squishy’s leg or ears, and never stands in front of one (H2 render check)', () => {
      // The Snug at level 1: Emberbun and Puddlepuff on the rug, the Keeper behind them.
      const bed = { x: 0.62, z: 4.0, yaw: -Math.PI / 2 };
      const reach = 0.59;
      const cast = [
        { x: 1.58, z: 1.92, r: reach, squishy: true },
        { x: 3.2, z: 1.73, r: reach, squishy: true },
        { x: 2.64, z: 3.36, r: 0.35, squishy: false },
      ];
      const p = besideBed(bed, [bed, { x: 4.18, z: 4.0, yaw: Math.PI / 2 }], room, cast);
      const eye = { x: 2.4, z: -2.9 };
      const view = (q: { x: number; z: number }, reachOf: number) => {
        const far = Math.hypot(q.x - eye.x, q.z - eye.z);
        return { a: Math.atan2(q.x - eye.x, q.z - eye.z), h: Math.atan(reachOf / far), far };
      };
      const box = view(p, r);
      for (const c of cast) {
        expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r + r);
        const them = view(c, c.r);
        if (them.far < box.far || c.squishy)
          expect(Math.abs(box.a - them.a)).toBeGreaterThanOrEqual(box.h + them.h);
      }
      expect(within(p)).toBe(true);
    });

    it('stands clear of the Keeper’s whole body from kid height, at the room’s spare spot if need be (B5a)', () => {
      // The Snug at level 2: by Emberbun's bed the box stood in front of the Keeper (waist down).
      const reach = 0.59;
      const cast = [
        { x: 1.58, z: 1.92, r: reach, squishy: true },
        { x: 3.22, z: 1.73, r: reach, squishy: true },
        { x: 2.64, z: 3.36, r: 0.35, squishy: false },
      ];
      const eye = { x: 2.4, z: -2.9 };
      const view = (q: { x: number; z: number }, reachOf: number) => {
        const far = Math.hypot(q.x - eye.x, q.z - eye.z);
        return { a: Math.atan2(q.x - eye.x, q.z - eye.z), h: Math.atan(reachOf / far), far };
      };
      const beds: BedSpot[] = [
        { x: 0.62, z: 4.0, yaw: -Math.PI / 2 },
        { x: 4.18, z: 4.0, yaw: Math.PI / 2 },
      ];
      const spare = { x: 1.0, z: 0.62 };
      const keeper = view(cast[2]!, cast[2]!.r);
      const covers = (p: { x: number; z: number }) => {
        const box = view(p, r);
        return Math.abs(box.a - keeper.a) < box.h + keeper.h;
      };
      // Without a spare spot it still stands in front of the Keeper (the old fallback)…
      expect(covers(besideBed(beds[0]!, beds, room, cast))).toBe(true);
      // …with one, it takes it, and it's clear of everyone.
      const p = besideBed(beds[0]!, beds, room, cast, [spare]);
      expect(p).toEqual(spare);
      expect(covers(p)).toBe(false);
      // A spot by the bed that clears everyone still comes first (an empty room: the foot).
      const alone = besideBed(beds[0]!, beds, room, [], [spare]);
      expect(alone).toEqual(besideBed(beds[0]!, beds, room));
      expect(alone).not.toEqual(spare);
    });

    it('finds a spot inside when its foot would leave the room', () => {
      // A bed facing the front wall up close: its foot is past the wall.
      const bed = { x: 2.4, z: 0.9, yaw: 0 };
      const p = besideBed(bed, [bed], room);
      expect(within(p)).toBe(true);
      expect(clearOf(p, [bed])).toBe(true);
    });
  });
});
