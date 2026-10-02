import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDbClient, type Database, type DbClient } from './client.js';
import { appendGameEvent } from './game-events.js';
import { gameEvents, maps } from './schema.js';

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('appendGameEvent (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;

  beforeAll(() => {
    client = createDbClient(url!, { max: 10 });
    db = client.db;
  });
  afterAll(() => client.close());

  async function newMap(): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'multiplayer', name: 'Event Test', timeZone: 'UTC' })
      .returning({ id: maps.id });
    return map!.id;
  }

  async function seqsFor(mapId: string): Promise<number[]> {
    const rows = await db
      .select({ seq: gameEvents.seq })
      .from(gameEvents)
      .where(eq(gameEvents.mapId, mapId))
      .orderBy(asc(gameEvents.seq));
    return rows.map((r) => r.seq);
  }

  async function eventSeqOf(mapId: string): Promise<number> {
    const [map] = await db.select({ eventSeq: maps.eventSeq }).from(maps).where(eq(maps.id, mapId));
    return map!.eventSeq;
  }

  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('starts at 1 and stores the event', async () => {
    const mapId = await newMap();
    const event = await db.transaction((tx) =>
      appendGameEvent(tx, {
        mapId,
        type: 'map.updated',
        actorUserId: null,
        payload: { pvpMode: 'off' },
      }),
    );
    expect(event).toMatchObject({
      mapId,
      seq: 1,
      type: 'map.updated',
      payload: { pvpMode: 'off' },
    });
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(await eventSeqOf(mapId)).toBe(1);
  });

  it('gives concurrent appends on one map unique, gap-free seqs', async () => {
    const mapId = await newMap();
    const n = 25;
    await Promise.all(
      range(n).map((i) =>
        db.transaction(async (tx) => {
          // Stagger the other work in each transaction so appends genuinely contend.
          await tx.execute(`select pg_sleep(${String((i % 5) * 0.005)})`);
          return appendGameEvent(tx, {
            mapId,
            type: 'map.updated',
            actorUserId: null,
            payload: { pvpMode: i % 2 ? 'on' : 'off' },
          });
        }),
      ),
    );
    expect(await seqsFor(mapId)).toEqual(range(n));
    expect(await eventSeqOf(mapId)).toBe(n);
  });

  it('leaves no gap when a transaction rolls back after appending', async () => {
    const mapId = await newMap();
    await db.transaction((tx) =>
      appendGameEvent(tx, {
        mapId,
        type: 'map.updated',
        actorUserId: null,
        payload: { pvpMode: 'off' },
      }),
    );

    await expect(
      db.transaction(async (tx) => {
        await appendGameEvent(tx, {
          mapId,
          type: 'map.updated',
          actorUserId: null,
          payload: { pvpMode: 'on' },
        });
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');

    const next = await db.transaction((tx) =>
      appendGameEvent(tx, {
        mapId,
        type: 'map.updated',
        actorUserId: null,
        payload: { pvpMode: 'off' },
      }),
    );
    expect(next.seq).toBe(2);
    expect(await seqsFor(mapId)).toEqual([1, 2]);
    const payloads = await db
      .select({ payload: gameEvents.payload })
      .from(gameEvents)
      .where(eq(gameEvents.mapId, mapId));
    expect(payloads.map((p) => p.payload)).not.toContainEqual({ pvpMode: 'on' });
  });

  it('stays gap-free when concurrent commits and rollbacks interleave', async () => {
    const mapId = await newMap();
    const n = 24;
    const results = await Promise.allSettled(
      range(n).map((i) =>
        db.transaction(async (tx) => {
          await appendGameEvent(tx, {
            mapId,
            type: 'map.updated',
            actorUserId: null,
            payload: { pvpMode: i % 2 ? 'on' : 'off' },
          });
          if (i % 3 === 0) throw new Error('roll back');
        }),
      ),
    );
    const committed = results.filter((r) => r.status === 'fulfilled').length;
    expect(committed).toBe(n - n / 3);
    expect(await seqsFor(mapId)).toEqual(range(committed));
    expect(await eventSeqOf(mapId)).toBe(committed);
  });

  it('keeps each map on its own sequence', async () => {
    const [a, b] = [await newMap(), await newMap()];
    await Promise.all(
      range(10).map((i) =>
        db.transaction((tx) =>
          appendGameEvent(tx, {
            mapId: i % 2 ? a : b,
            type: 'map.updated',
            actorUserId: null,
            payload: { pvpMode: 'off' },
          }),
        ),
      ),
    );
    expect(await seqsFor(a)).toEqual(range(5));
    expect(await seqsFor(b)).toEqual(range(5));
  });

  it('throws for an unknown map and writes nothing', async () => {
    const missing = '0190a000-0000-7000-8000-000000000000';
    await expect(
      db.transaction((tx) =>
        appendGameEvent(tx, {
          mapId: missing,
          type: 'map.updated',
          actorUserId: null,
          payload: { pvpMode: 'off' },
        }),
      ),
    ).rejects.toThrow(/does not exist/);
    expect(await seqsFor(missing)).toEqual([]);
  });

  it('rejects a payload that does not match its type, writing nothing', async () => {
    const mapId = await newMap();
    await expect(
      db.transaction((tx) =>
        appendGameEvent(tx, {
          mapId,
          type: 'map.updated',
          actorUserId: null,
          // @ts-expect-error: not a PvP mode
          payload: { pvpMode: 'wild' },
        }),
      ),
    ).rejects.toThrow();
    expect(await seqsFor(mapId)).toEqual([]);
    expect(await eventSeqOf(mapId)).toBe(0);
  });

  it('rejects a duplicate (map_id, seq) written around the helper', async () => {
    const mapId = await newMap();
    await db.transaction((tx) =>
      appendGameEvent(tx, {
        mapId,
        type: 'map.updated',
        actorUserId: null,
        payload: { pvpMode: 'off' },
      }),
    );
    await expect(
      db.insert(gameEvents).values({ mapId, seq: 1, type: 'test.dup', payload: {} }),
    ).rejects.toThrow();
  });
});
