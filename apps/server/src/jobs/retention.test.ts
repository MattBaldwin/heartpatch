import { GAME_EVENT_TYPES } from '@heartpatch/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../db/client.js';
import { appendRawGameEvent } from '../db/game-events.js';
import { maps } from '../db/schema.js';
import { REPLAY_WINDOW } from '../ws/limits.js';
import { EVENT_RETENTION_DAYS, EVENT_RETENTION_SHORT_DAYS } from './limits.js';
import {
  isShortLived,
  keepFromSeq,
  pruneGameEvents,
  SHORT_LIVED_EVENT_TYPES,
  type PruneOptions,
} from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe('short-lived event types', () => {
  it('are a live battle’s picks, turns and cheers, and challenges', () => {
    expect(['battle.picked', 'battle.turned', 'battle.cheered'].every(isShortLived)).toBe(true);
    expect(isShortLived('challenge.sent')).toBe(true);
    expect(isShortLived('challenge.answered')).toBe(true);
    for (const kept of ['battle.started', 'battle.ended', 'raid.resolved', 'challenge']) {
      expect(isShortLived(kept)).toBe(false);
    }
  });

  it('come from the registry: only registered types', () => {
    expect(SHORT_LIVED_EVENT_TYPES).toEqual(GAME_EVENT_TYPES.filter(isShortLived));
    for (const type of SHORT_LIVED_EVENT_TYPES) expect(GAME_EVENT_TYPES).toContain(type);
  });
});

describe('keepFromSeq', () => {
  const tutorial = { name: 'tutorial', mapKinds: ['tutorial'] as const };
  const lore = { name: 'lore', mapKinds: ['multiplayer', 'tutorial'] as const };
  const map = (eventSeq: number, positions: Record<string, number>) => ({
    kind: 'multiplayer' as const,
    eventSeq,
    positions: new Map(Object.entries(positions)),
  });

  it('keeps the replay window', () => {
    expect(keepFromSeq(map(1000, { lore: 1000 }), [lore], 100)).toBe(901);
    expect(keepFromSeq(map(50, { lore: 50 }), [lore], 100)).toBe(-49);
  });

  it('keeps from the lowest consumer position, the one at it included', () => {
    expect(keepFromSeq(map(1000, { lore: 300, other: 200 }), [lore], 100)).toBe(200);
  });

  it('keeps everything for a consumer of this kind that has no row yet', () => {
    expect(keepFromSeq(map(1000, {}), [lore], 100)).toBe(0);
    // The tutorial consumer never reads a multiplayer map.
    expect(keepFromSeq(map(1000, { lore: 1000 }), [tutorial, lore], 100)).toBe(901);
  });
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('pruneGameEvents (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;

  beforeAll(() => {
    client = createDbClient(url!, { max: 4, quiet: true });
    db = client.db;
  });
  afterAll(() => client.close());

  const consumer = { name: 'retention-test', mapKinds: ['tutorial'] as const };

  async function newMap(): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Retention Glade', timeZone: 'UTC', maxPlayers: 1 })
      .returning({ id: maps.id });
    return map!.id;
  }

  /** Appends one event per entry, of that type and age. */
  async function addEvents(mapId: string, events: { type: string; at: Date }[]): Promise<void> {
    for (const { type, at } of events) {
      await db.transaction(async (tx) => {
        const row = await appendRawGameEvent(tx, { mapId, type, actorUserId: null, payload: {} });
        await tx.execute(
          `update game_events set created_at = '${at.toISOString()}' where id = '${row.id}'`,
        );
      });
    }
  }

  const many = (n: number, type: string, at: Date) =>
    Array.from({ length: n }, () => ({ type, at }));

  async function setPosition(mapId: string, lastSeq: number): Promise<void> {
    await db.execute(
      `insert into event_consumers (consumer, map_id, last_seq) values ('${consumer.name}', '${mapId}', ${String(lastSeq)})
       on conflict (consumer, map_id) do update set last_seq = excluded.last_seq`,
    );
  }

  async function seqs(mapId: string): Promise<number[]> {
    const rows = await db.execute<{ seq: string }>(
      `select seq from game_events where map_id = '${mapId}' order by seq`,
    );
    return [...rows].map((r) => Number(r.seq));
  }

  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  const prune = (mapIds: string[], options: Partial<PruneOptions> = {}) =>
    pruneGameEvents(db, [consumer], { now: NOW, mapIds, replayWindow: 2, ...options });

  it('deletes old events and keeps recent ones', async () => {
    const mapId = await newMap();
    await addEvents(mapId, [
      ...many(3, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 1)),
      ...many(2, 'test.long', daysAgo(EVENT_RETENTION_DAYS - 1)),
      ...many(4, 'test.long', daysAgo(0)),
    ]);
    await setPosition(mapId, 9);

    expect(await prune([mapId])).toEqual({ deleted: 3, batches: 1, capped: false });
    expect(await seqs(mapId)).toEqual(range(4, 9));
  });

  it('keeps short-lived types for days, and others for their full keep', async () => {
    const mapId = await newMap();
    const old = daysAgo(EVENT_RETENTION_SHORT_DAYS + 1);
    await addEvents(mapId, [
      { type: 'test.turned', at: old }, // 1: goes
      { type: 'test.long', at: old }, // 2: stays
      { type: 'test.turned', at: daysAgo(EVENT_RETENTION_SHORT_DAYS - 1) }, // 3: stays
      { type: 'test.turned', at: old }, // 4: goes
      ...many(3, 'test.long', daysAgo(0)),
    ]);
    await setPosition(mapId, 7);

    const pruned = await prune([mapId], { shortLivedTypes: ['test.turned'] });
    expect(pruned.deleted).toBe(2);
    expect(await seqs(mapId)).toEqual([2, 3, 5, 6, 7]);
  });

  it('never deletes an event at or after the lowest consumer position', async () => {
    const mapId = await newMap();
    await addEvents(mapId, many(10, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 5)));
    await setPosition(mapId, 4);
    // Another consumer's row (one this build doesn't run) still holds its events.
    await db.execute(
      `insert into event_consumers (consumer, map_id, last_seq) values ('retention-old', '${mapId}', 6)`,
    );

    expect((await prune([mapId])).deleted).toBe(3);
    expect(await seqs(mapId)).toEqual(range(4, 10));

    // The consumer moves on: everything it has applied may go, but not its last one.
    await setPosition(mapId, 10);
    expect((await prune([mapId])).deleted).toBe(2);
    expect(await seqs(mapId)).toEqual(range(6, 10)); // 'retention-old' holds 6 on
  });

  it('keeps everything while a consumer of the map kind has no position yet', async () => {
    const mapId = await newMap();
    await addEvents(mapId, many(5, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 5)));

    expect((await prune([mapId])).deleted).toBe(0);
    expect(await seqs(mapId)).toEqual(range(1, 5));
    // A consumer of other map kinds doesn't hold a tutorial map's events.
    const other = { name: 'retention-mp', mapKinds: ['multiplayer'] as const };
    const pruned = await pruneGameEvents(db, [other], {
      now: NOW,
      mapIds: [mapId],
      replayWindow: 2,
    });
    expect(pruned.deleted).toBe(3);
    expect(await seqs(mapId)).toEqual([4, 5]);
  });

  it('keeps the reconnect replay window, however old', async () => {
    const mapId = await newMap();
    await addEvents(mapId, many(8, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 5)));
    await setPosition(mapId, 8);

    expect((await prune([mapId], { replayWindow: 3 })).deleted).toBe(5);
    expect(await seqs(mapId)).toEqual([6, 7, 8]);
    // The real window: a map with fewer events than it keeps them all.
    expect((await prune([mapId], { replayWindow: REPLAY_WINDOW })).deleted).toBe(0);
  });

  it('deletes in bounded batches, capped per run; the next run carries on', async () => {
    const mapId = await newMap();
    await addEvents(mapId, many(12, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 1)));
    await setPosition(mapId, 12);
    const options = { replayWindow: 1, batchSize: 4, maxBatches: 2 };

    // 11 to go, 4 at a time, 2 full batches a run.
    expect(await prune([mapId], options)).toEqual({ deleted: 8, batches: 2, capped: true });
    expect(await seqs(mapId)).toEqual(range(9, 12));
    expect(await prune([mapId], options)).toEqual({ deleted: 3, batches: 1, capped: false });
    expect(await seqs(mapId)).toEqual([12]);
  });

  it('a map with nothing to delete never uses up a run', async () => {
    const maps = [await newMap(), await newMap()];
    for (const mapId of maps) {
      await addEvents(mapId, many(6, 'test.long', daysAgo(EVENT_RETENTION_DAYS + 1)));
      await setPosition(mapId, 6);
    }
    const options = { replayWindow: 1, batchSize: 5, maxBatches: 1 };

    // One map's 5 fill the run; the next run finds the first map done and does the other.
    expect(await prune(maps, options)).toMatchObject({ deleted: 5, capped: true });
    expect(await prune(maps, options)).toMatchObject({ deleted: 5 });
    expect(await prune(maps, options)).toEqual({ deleted: 0, batches: 2, capped: false });
    for (const mapId of maps) expect(await seqs(mapId)).toEqual([6]);
  });

  it('leaves other maps alone', async () => {
    const mine = await newMap();
    const theirs = await newMap();
    const old = daysAgo(EVENT_RETENTION_DAYS + 1);
    await addEvents(mine, many(4, 'test.long', old));
    await addEvents(theirs, many(4, 'test.long', old));
    await setPosition(mine, 4);
    await setPosition(theirs, 4);

    expect((await prune([mine])).deleted).toBe(2);
    expect(await seqs(theirs)).toEqual(range(1, 4));
  });
});
