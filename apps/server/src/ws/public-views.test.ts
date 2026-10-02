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
    for (const type of ['tile.updated', 'chat.quick', 'test.secret']) {
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
