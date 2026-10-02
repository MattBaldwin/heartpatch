import type { WsEventMessage } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { ReorderBuffer } from './ws-reorder.js';

const MAP = '0190a8c4-0000-7000-8000-000000000001';
const ev = (seq: number): WsEventMessage => ({
  v: 1,
  type: 'tile.updated',
  mapId: MAP,
  seq,
  at: '2026-10-31T21:00:00.000Z',
  data: {},
});
const seqs = (events: WsEventMessage[]) => events.map((e) => e.seq);

describe('ReorderBuffer', () => {
  it('applies in-order events straight away', () => {
    const buffer = new ReorderBuffer(0);
    expect(seqs(buffer.push(ev(1)))).toEqual([1]);
    expect(seqs(buffer.push(ev(2)))).toEqual([2]);
    expect(buffer.applied).toBe(2);
    expect(buffer.hasGap).toBe(false);
  });

  it('holds early events until the gap fills, then applies in order', () => {
    const buffer = new ReorderBuffer(4);
    expect(buffer.push(ev(7))).toEqual([]);
    expect(buffer.push(ev(6))).toEqual([]);
    expect(buffer.hasGap).toBe(true);
    expect(seqs(buffer.push(ev(5)))).toEqual([5, 6, 7]);
    expect(buffer.hasGap).toBe(false);
    expect(buffer.applied).toBe(7);
  });

  it('drops duplicates and anything already applied (replays overlap)', () => {
    const buffer = new ReorderBuffer(3);
    expect(buffer.push(ev(2))).toEqual([]);
    expect(buffer.push(ev(3))).toEqual([]);
    expect(buffer.push(ev(5))).toEqual([]);
    expect(buffer.push(ev(5))).toEqual([]);
    expect(seqs(buffer.push(ev(4)))).toEqual([4, 5]);
    expect(buffer.hasGap).toBe(false);
  });

  it('moves past seqs the server says are not ours', () => {
    const buffer = new ReorderBuffer(0);
    expect(buffer.push(ev(3))).toEqual([]);
    expect(buffer.push(ev(5))).toEqual([]);
    // Seqs 1, 2 and 4 were skipped for this player.
    expect(seqs(buffer.advanceTo(4))).toEqual([3, 5]);
    expect(buffer.applied).toBe(5);
    expect(buffer.hasGap).toBe(false);
  });

  it('keeps waiting for events above the cursor', () => {
    const buffer = new ReorderBuffer(0);
    buffer.push(ev(9));
    expect(buffer.advanceTo(2)).toEqual([]);
    expect(buffer.applied).toBe(2);
    expect(buffer.hasGap).toBe(true);
  });

  it('never moves the cursor backwards', () => {
    const buffer = new ReorderBuffer(10);
    expect(buffer.advanceTo(4)).toEqual([]);
    expect(buffer.applied).toBe(10);
  });
});
