import type { MapView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { knockedTiles } from './knocked-marks.js';

const tile = (q: number, owner: string | null, knocked: boolean | undefined) =>
  ({ q, r: 0, ownerUserId: owner, buildings: [{ id: `b${String(q)}`, knocked }] }) as never;

describe('knockedTiles', () => {
  const view = {
    tiles: [
      tile(0, 'me', true),
      tile(1, 'me', false),
      tile(2, 'other', true),
      tile(3, 'me', undefined),
    ],
  } as unknown as MapView;

  it('marks only my knocked buildings', () => {
    expect(knockedTiles(view, 'me').map((t) => t.q)).toEqual([0]);
  });

  it('marks nothing before I am known', () => {
    expect(knockedTiles(view, null)).toEqual([]);
  });
});
