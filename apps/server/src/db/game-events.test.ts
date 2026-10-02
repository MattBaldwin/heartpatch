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
        type: 'tile.updated',
        actorUserId: null,
        payload: { q: 1, r: -1 },
      }),
    );
    expect(event).toMatchObject({ mapId, seq: 1, type: 'tile.updated', payload: { q: 1, r: -1 } });
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
            type: 'test.concurrent',
            actorUserId: null,
            payload: { i },
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
      appendGameEvent(tx, { mapId, type: 'test.kept', actorUserId: null, payload: {} }),
    );

    await expect(
      db.transaction(async (tx) => {
        await appendGameEvent(tx, {
          mapId,
          type: 'test.rolled_back',
          actorUserId: null,
          payload: {},
        });
        throw new Error('change failed');
      }),
    ).rejects.toThrow('change failed');

    const next = await db.transaction((tx) =>
      appendGameEvent(tx, { mapId, type: 'test.kept', actorUserId: null, payload: {} }),
    );
    expect(next.seq).toBe(2);
    expect(await seqsFor(mapId)).toEqual([1, 2]);
    const types = await db
      .select({ type: gameEvents.type })
      .from(gameEvents)
      .where(eq(gameEvents.mapId, mapId));
    expect(types.map((t) => t.type)).not.toContain('test.rolled_back');
  });

  it('stays gap-free when concurrent commits and rollbacks interleave', async () => {
    const mapId = await newMap();
    const n = 24;
    const results = await Promise.allSettled(
      range(n).map((i) =>
        db.transaction(async (tx) => {
          await appendGameEvent(tx, {
            mapId,
            type: 'test.mixed',
            actorUserId: null,
            payload: { i },
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
            type: 'test.split',
            actorUserId: null,
            payload: {},
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
        appendGameEvent(tx, { mapId: missing, type: 'test.x', actorUserId: null, payload: {} }),
      ),
    ).rejects.toThrow(/does not exist/);
    expect(await seqsFor(missing)).toEqual([]);
  });

  it('rejects a duplicate (map_id, seq) written around the helper', async () => {
    const mapId = await newMap();
    await db.transaction((tx) =>
      appendGameEvent(tx, { mapId, type: 'test.x', actorUserId: null, payload: {} }),
    );
    await expect(
      db.insert(gameEvents).values({ mapId, seq: 1, type: 'test.dup', payload: {} }),
    ).rejects.toThrow();
  });
});
