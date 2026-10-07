import { GAME_EVENT_TYPES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GameEvent } from '../db/game-events.js';
import { definePublicView, PUBLIC_VIEWS, publicViewFor, type PublicViews } from './public-views.js';

const event = (type: string, payload: unknown): GameEvent => ({
  id: '0190a8c4-0000-7000-8000-0000000000aa',
  mapId: '0190a8c4-0000-7000-8000-000000000001',
  seq: 1,
  type,
  actorUserId: null,
  payload,
  createdAt: new Date('2026-10-31T21:00:00Z'),
});
const me = { userId: 'me' };

describe('public views', () => {
  it('denies by default: a type without a view is never sent', () => {
    // Not in the shared registry (yet), so no view.
    for (const type of ['tile.updated', 'milestone.earned', 'test.secret']) {
      expect(publicViewFor(PUBLIC_VIEWS, event(type, { secret: 1 }), me)).toBeNull();
    }
    expect(publicViewFor(PUBLIC_VIEWS, event('toString', {}), me)).toBeNull();
  });

  it('has exactly one view per registry event type', () => {
    expect(Object.keys(PUBLIC_VIEWS).sort()).toEqual([...GAME_EVENT_TYPES].sort());
  });

  it("sends a registry event's public schema only (member.left, map.created)", () => {
    const userId = '0190a8c4-0000-7000-8000-000000000002';
    expect(
      publicViewFor(PUBLIC_VIEWS, event('member.left', { userId, releasedTiles: 7 }), me),
    ).toEqual({ userId, releasedTiles: 7 });
    expect(
      publicViewFor(
        PUBLIC_VIEWS,
        event('map.created', {
          name: 'Pumpkin Hollow',
          timeZone: 'America/Chicago',
          pvpMode: 'gentle',
          maxPlayers: 4,
          homeSlot: 0,
          heartSeed: { q: 8, r: 0 },
        }),
        me,
      ),
    ).toEqual({ name: 'Pumpkin Hollow', pvpMode: 'gentle' });
  });

  it('never tells anyone who broke or bumped a fence, the owner included (#203)', () => {
    const owner = '0190a8c4-0000-7000-8000-000000000002';
    const attacker = '0190a8c4-0000-7000-8000-000000000004';
    const fenceId = '0190a8c4-0000-7000-8000-000000000005';
    const ids = {
      attackerUserId: attacker,
      attackId: '0190a8c4-0000-7000-8000-000000000006',
      battleId: '0190a8c4-0000-7000-8000-000000000007',
    };
    const fence = {
      id: fenceId,
      edge: 2,
      buildingId: 'stone-wall',
      level: 1,
      hp: 42,
      maxHp: 70,
      q: 3,
      r: -1,
    };
    const broken = event('fence.broken', {
      userId: owner,
      ...ids,
      fenceId,
      buildingId: 'stone-wall',
      q: 3,
      r: -1,
      edge: 2,
    });
    const damaged = event('fence.damaged', { userId: owner, ...ids, fence });
    for (const viewer of [owner, attacker, 'someone-else']) {
      expect(publicViewFor(PUBLIC_VIEWS, broken, { userId: viewer })).toEqual({
        userId: owner,
        fenceId,
        q: 3,
        r: -1,
        edge: 2,
      });
      expect(publicViewFor(PUBLIC_VIEWS, damaged, { userId: viewer })).toEqual({
        userId: owner,
        fence,
      });
    }
  });

  it('tells only the owner which squishy went to the Hollow or came home (#21)', () => {
    const owner = '0190a8c4-0000-7000-8000-000000000002';
    const squishyId = '0190a8c4-0000-7000-8000-000000000003';
    const hollowed = event('squishy.hollowed', { userId: owner, squishyId, night: '2026-10-31' });
    expect(publicViewFor(PUBLIC_VIEWS, hollowed, { userId: owner })).toEqual({
      userId: owner,
      squishyId,
      night: '2026-10-31',
    });
    expect(publicViewFor(PUBLIC_VIEWS, hollowed, me)).toBeNull();
    const rescued = event('squishy.rescued', {
      userId: owner,
      squishyId,
      battleId: '0190a8c4-0000-7000-8000-000000000004',
      heartdust: 1,
    });
    expect(publicViewFor(PUBLIC_VIEWS, rescued, { userId: owner })).toEqual({
      userId: owner,
      squishyId,
      heartdust: 1,
    });
    expect(publicViewFor(PUBLIC_VIEWS, rescued, me)).toBeNull();
    // Everyone hears that night fell, and who lost someone, never which squishy.
    expect(
      publicViewFor(
        PUBLIC_VIEWS,
        event('hollow.nightfall', { night: '2026-10-31', taken: [{ userId: owner, squishyId }] }),
        me,
      ),
    ).toEqual({ night: '2026-10-31', taken: [{ userId: owner }] });
  });

  it('refuses a stored payload that breaks its internal schema', () => {
    expect(() =>
      publicViewFor(PUBLIC_VIEWS, event('member.left', { userId: 'nope', secret: 1 }), me),
    ).toThrow();
  });

  it('strips fields the view schema does not declare, nested ones too', () => {
    const views: PublicViews = {
      'tile.updated': definePublicView({
        schema: z.object({ q: z.number(), owner: z.object({ username: z.string() }) }),
        build: (e) => e.payload as { q: number; owner: { username: string } },
      }),
    };
    const payload = { q: 1, spawnSeed: 42, owner: { username: 'pip', birthYear: 2014 } };
    expect(publicViewFor(views, event('tile.updated', payload), me)).toEqual({
      q: 1,
      owner: { username: 'pip' },
    });
  });

  it('lets a view skip a recipient', () => {
    const views: PublicViews = {
      'milestone.earned': definePublicView({
        schema: z.object({ id: z.string() }),
        build: (_e, r) => (r.userId === 'me' ? { id: 'first-patch' } : null),
      }),
    };
    expect(publicViewFor(views, event('milestone.earned', {}), me)).toEqual({ id: 'first-patch' });
    expect(publicViewFor(views, event('milestone.earned', {}), { userId: 'you' })).toBeNull();
  });
});
