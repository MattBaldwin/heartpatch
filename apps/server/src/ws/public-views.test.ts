import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { GameEvent } from '../db/game-events.js';
import {
  definePublicView,
  GAME_EVENT_TYPES,
  PUBLIC_VIEWS,
  publicViewFor,
  type PublicViews,
} from './public-views.js';

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
    for (const type of GAME_EVENT_TYPES) {
      if (Object.hasOwn(PUBLIC_VIEWS, type)) continue;
      expect(publicViewFor(PUBLIC_VIEWS, event(type, { secret: 1 }), me)).toBeNull();
    }
    expect(publicViewFor(PUBLIC_VIEWS, event('toString', {}), me)).toBeNull();
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
