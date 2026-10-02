import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../db/client.js';
import { appendGameEvent } from '../db/game-events.js';
import { maps } from '../db/schema.js';
import { startJobs, type Jobs } from './boss.js';
import { runConsumer, type EventConsumer } from './consumers.js';
import { createJobsRepo } from './repo.js';

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('event consumers (needs DATABASE_URL)', () => {
  let client: DbClient;
  let db: Database;
  let jobs: Jobs | undefined;
  let counter = 0;

  beforeAll(async () => {
    client = createDbClient(url!, { max: 10, quiet: true });
    db = client.db;
    // Where test consumers record what they applied, inside their transaction.
    await db.execute(
      'create table if not exists consumer_test_log (consumer text not null, map_id uuid not null, seq bigint not null)',
    );
  });
  afterEach(async () => {
    await jobs?.stop();
    jobs = undefined;
  });
  afterAll(() => client.close());

  /** A consumer with a fresh name, so tests never see each other's positions. */
  function testConsumer(
    options: { failOnSeq?: number; delayMs?: number } = {},
  ): EventConsumer & { failOnSeq: number | undefined } {
    const consumer = {
      name: `test-${String(process.pid)}-${String((counter += 1))}`,
      mapKinds: ['tutorial'] as const,
      failOnSeq: options.failOnSeq,
      handle: async (
        tx: Parameters<EventConsumer['handle']>[0],
        event: { mapId: string; seq: number },
      ) => {
        if (event.seq === consumer.failOnSeq) throw new Error(`boom at ${String(event.seq)}`);
        // Ids and seqs come from our own rows, so inlining them is safe here.
        await tx.execute(
          `insert into consumer_test_log values ('${consumer.name}', '${event.mapId}', ${String(event.seq)})`,
        );
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      },
    };
    return consumer;
  }

  async function applied(consumer: EventConsumer, mapId: string): Promise<number[]> {
    const rows = await db.execute<{ seq: string }>(
      `select seq from consumer_test_log where consumer = '${consumer.name}' and map_id = '${mapId}' order by seq`,
    );
    return [...rows].map((r) => Number(r.seq));
  }

  async function position(consumer: EventConsumer, mapId: string): Promise<number | null> {
    const rows = await db.execute<{ last_seq: string }>(
      `select last_seq from event_consumers where consumer = '${consumer.name}' and map_id = '${mapId}'`,
    );
    const [row] = [...rows];
    return row ? Number(row.last_seq) : null;
  }

  async function newMap(): Promise<string> {
    const [map] = await db
      .insert(maps)
      .values({ kind: 'tutorial', name: 'Consumer Glade', timeZone: 'UTC', maxPlayers: 1 })
      .returning({ id: maps.id });
    return map!.id;
  }

  /** Commits `n` events on the map, one transaction each. */
  async function addEvents(mapId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await db.transaction((tx) =>
        appendGameEvent(tx, {
          mapId,
          type: 'map.updated',
          actorUserId: null,
          payload: { pvpMode: 'off' },
        }),
      );
    }
  }

  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  async function eventually(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  describe('runConsumer', () => {
    it('applies every event once, in seq order, and records its position', async () => {
      const consumer = testConsumer();
      const mapId = await newMap();
      await addEvents(mapId, 7);
      const afterCommit = vi.fn();

      expect(await runConsumer(db, consumer, mapId, { batchSize: 3, afterCommit })).toBe(7);
      expect(await applied(consumer, mapId)).toEqual(range(1, 7));
      expect(await position(consumer, mapId)).toBe(7);
      expect(afterCommit).toHaveBeenCalledTimes(3); // batches of 3, 3, 1

      // Caught up: nothing to do, nothing applied twice.
      expect(await runConsumer(db, consumer, mapId)).toBe(0);
      await addEvents(mapId, 2);
      expect(await runConsumer(db, consumer, mapId)).toBe(2);
      expect(await applied(consumer, mapId)).toEqual(range(1, 9));
    });

    it('rolls a failed batch back: the event is delayed, never lost or doubled', async () => {
      const consumer = testConsumer({ failOnSeq: 4 });
      const mapId = await newMap();
      await addEvents(mapId, 6);

      // Batch 1-2 commits; batch 3-4 throws on 4 and rolls back with 3.
      await expect(runConsumer(db, consumer, mapId, { batchSize: 2 })).rejects.toThrow('boom');
      expect(await applied(consumer, mapId)).toEqual([1, 2]);
      expect(await position(consumer, mapId)).toBe(2);

      // A retry fails at the same place without re-applying 1-2 or keeping 3.
      await expect(runConsumer(db, consumer, mapId, { batchSize: 2 })).rejects.toThrow('boom');
      expect(await applied(consumer, mapId)).toEqual([1, 2]);

      consumer.failOnSeq = undefined; // the bug is fixed (or the crash is over)
      expect(await runConsumer(db, consumer, mapId, { batchSize: 2 })).toBe(4);
      expect(await applied(consumer, mapId)).toEqual(range(1, 6));
      expect(await position(consumer, mapId)).toBe(6);
    });

    it('lets two workers on one map take turns: each event exactly once', async () => {
      const consumer = testConsumer({ delayMs: 5 });
      const mapId = await newMap();
      await addEvents(mapId, 12);

      const runs = await Promise.all([
        runConsumer(db, consumer, mapId, { batchSize: 2 }),
        runConsumer(db, consumer, mapId, { batchSize: 2 }),
        runConsumer(db, consumer, mapId, { batchSize: 5 }),
      ]);
      expect(runs.reduce((a, b) => a + b, 0)).toBe(12);
      expect(await applied(consumer, mapId)).toEqual(range(1, 12));
    });

    it('keeps going until it reaches events committed while it runs', async () => {
      const consumer = testConsumer({ delayMs: 20 });
      const mapId = await newMap();
      await addEvents(mapId, 2);
      const running = runConsumer(db, consumer, mapId, { batchSize: 1 });
      await addEvents(mapId, 3);
      await running;
      expect(await applied(consumer, mapId)).toEqual(range(1, 5));
    });

    it('ends quietly for a map that does not exist', async () => {
      const consumer = testConsumer();
      const missing = '0190a000-0000-7000-8000-00000000dead';
      expect(await runConsumer(db, consumer, missing)).toBe(0);
      expect(await position(consumer, missing)).toBeNull();
    });
  });

  // pg-boss installs its schema on first start, which takes a few seconds.
  describe('pg-boss wake-ups', { timeout: 30_000 }, () => {
    const logger = pino({ level: 'silent' });

    async function jobsFor(consumer: EventConsumer, mapId: string): Promise<number> {
      const rows = await db.execute<{ n: string }>(
        `select count(*) as n from pgboss.job where name = 'event-consumer.${consumer.name}' and singleton_key = '${mapId}'`,
      );
      return Number([...rows][0]!.n);
    }

    it('enqueues the wake-up inside the command transaction', async () => {
      const consumer = testConsumer();
      // Asserts on pgboss.job rows (any state), not on delivery timing.
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [consumer],
        logger,
        schedule: false,
      });
      const mapId = await newMap();

      // Rolled back: the event and its wake-up are both gone.
      await expect(
        db.transaction(async (tx) => {
          await appendGameEvent(tx, {
            mapId,
            type: 'map.updated',
            actorUserId: null,
            payload: { pvpMode: 'off' },
          });
          throw new Error('command failed');
        }),
      ).rejects.toThrow('command failed');
      expect(await jobsFor(consumer, mapId)).toBe(0);

      // Committed, twice in one transaction: one de-duplicated wake-up, no error.
      await db.transaction(async (tx) => {
        for (const pvpMode of ['off', 'gentle'] as const) {
          await appendGameEvent(tx, {
            mapId,
            type: 'map.updated',
            actorUserId: null,
            payload: { pvpMode },
          });
        }
      });
      expect(await jobsFor(consumer, mapId)).toBe(1);
    });

    it('wakes only consumers that read the map kind', async () => {
      const consumer = testConsumer();
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [consumer],
        logger,
        schedule: false,
      });
      const [map] = await db
        .insert(maps)
        .values({ kind: 'multiplayer', name: 'Not Mine', timeZone: 'UTC' })
        .returning({ id: maps.id });
      await addEvents(map!.id, 1);
      expect(await jobsFor(consumer, map!.id)).toBe(0);
      expect(await createJobsRepo(db).laggingMaps(consumer.name, consumer.mapKinds)).not.toContain(
        map!.id,
      );
    });

    // The one end-to-end delivery test: catch-up at boot, then a worker runs the job.
    it('catches up on events whose wake-up was lost', async () => {
      const consumer = testConsumer();
      const mapId = await newMap();
      await addEvents(mapId, 3); // no jobs running: no wake-up enqueued
      expect(await createJobsRepo(db).laggingMaps(consumer.name, consumer.mapKinds)).toContain(
        mapId,
      );

      // Booting runs a catch-up, which wakes the lagging consumer.
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [consumer],
        logger,
        schedule: false,
      });
      await eventually(async () => (await position(consumer, mapId)) === 3);
      expect(await applied(consumer, mapId)).toEqual([1, 2, 3]);
      expect(await createJobsRepo(db).laggingMaps(consumer.name, consumer.mapKinds)).not.toContain(
        mapId,
      );
    });

    it('sweeps for due nightfalls at boot and runs one job per map and night (#21)', async () => {
      const mapId = await newMap();
      const ran: string[] = [];
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [],
        logger,
        schedule: false,
        nightfall: {
          due: () => Promise.resolve([{ mapId, night: '2026-10-31' }]),
          run: (id, night) => {
            ran.push(`${id}/${night}`);
            return Promise.resolve();
          },
        },
      });
      await eventually(() => Promise.resolve(ran.length > 0));
      expect(ran[0]).toBe(`${mapId}/2026-10-31`);
      // Keyed by map and night (`stately`: at most one queued and one running per
      // key); the night's `hollow_events` row makes any repeat a no-op.
      expect(await jobs.nightfallSweep()).toBe(1);
      const rows = await db.execute<{ n: string }>(
        `select count(*) as n from pgboss.job where name = 'nightfall' and singleton_key = '${mapId}/2026-10-31'`,
      );
      expect(Number([...rows][0]!.n)).toBeGreaterThanOrEqual(1);
    });
  });
});
