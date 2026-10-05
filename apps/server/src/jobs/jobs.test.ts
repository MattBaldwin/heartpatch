import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createDbClient, type Database, type DbClient } from '../db/client.js';
import { appendGameEvent, appendRawGameEvent } from '../db/game-events.js';
import { maps } from '../db/schema.js';
import { backendPid, waitUntilBlockedBy } from '../../tests/lock-waits.js';
import { PG_BOSS_SCHEMA, startJobs, type Jobs } from './boss.js';
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
    // A stand-in for an entity row (a squishy, a tile) a handler locks.
    await db.execute('create table if not exists consumer_test_entity (id uuid primary key)');
  });
  afterEach(async () => {
    await jobs?.stop();
    jobs = undefined;
  });
  afterAll(() => client.close());

  /** A consumer with a fresh name, so tests never see each other's positions. */
  function testConsumer(
    options: {
      failOnSeq?: number;
      delayMs?: number;
      /** Hold this event's transaction open (one map's) until the promise settles. */
      holdAt?: { mapId: string; seq: number; until: Promise<void> };
    } = {},
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
        if (options.holdAt?.mapId === event.mapId && options.holdAt.seq === event.seq) {
          await options.holdAt.until;
        }
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

      expect(await runConsumer(db, consumer, mapId, { afterCommit })).toBe(7);
      expect(await applied(consumer, mapId)).toEqual(range(1, 7));
      expect(await position(consumer, mapId)).toBe(7);
      expect(afterCommit).toHaveBeenCalledTimes(7); // one transaction per event

      // Caught up: nothing to do, nothing applied twice.
      expect(await runConsumer(db, consumer, mapId)).toBe(0);
      await addEvents(mapId, 2);
      expect(await runConsumer(db, consumer, mapId)).toBe(2);
      expect(await applied(consumer, mapId)).toEqual(range(1, 9));
    });

    it('rolls a failed event back: it is delayed, never lost or doubled', async () => {
      const consumer = testConsumer({ failOnSeq: 4 });
      const mapId = await newMap();
      await addEvents(mapId, 6);

      // 1-3 commit, each on its own; 4 throws and rolls back alone (a crash mid-run).
      await expect(runConsumer(db, consumer, mapId)).rejects.toThrow('boom');
      expect(await applied(consumer, mapId)).toEqual([1, 2, 3]);
      expect(await position(consumer, mapId)).toBe(3);

      // A retry fails at the same place without re-applying 1-3.
      await expect(runConsumer(db, consumer, mapId)).rejects.toThrow('boom');
      expect(await applied(consumer, mapId)).toEqual([1, 2, 3]);

      consumer.failOnSeq = undefined; // the bug is fixed (or the crash is over)
      expect(await runConsumer(db, consumer, mapId)).toBe(3);
      expect(await applied(consumer, mapId)).toEqual(range(1, 6));
      expect(await position(consumer, mapId)).toBe(6);
    });

    it('lets two workers on one map take turns: each event exactly once', async () => {
      const consumer = testConsumer({ delayMs: 5 });
      const mapId = await newMap();
      await addEvents(mapId, 12);

      const runs = await Promise.all([
        runConsumer(db, consumer, mapId),
        runConsumer(db, consumer, mapId),
        runConsumer(db, consumer, mapId),
      ]);
      expect(runs.reduce((a, b) => a + b, 0)).toBe(12);
      expect(await applied(consumer, mapId)).toEqual(range(1, 12));
    });

    it('keeps going until it reaches events committed while it runs', async () => {
      const consumer = testConsumer({ delayMs: 20 });
      const mapId = await newMap();
      await addEvents(mapId, 2);
      const running = runConsumer(db, consumer, mapId);
      await addEvents(mapId, 3);
      await running;
      expect(await applied(consumer, mapId)).toEqual(range(1, 5));
    });

    // Tech spec §7 "Lock order". A handler locks an entity row, then appends
    // (taking `maps`), like the hollow, raid and tutorial consumers. Were
    // events batched in one transaction, event 1's append would hold `maps`
    // while event 2 waits for the row, and a command holding the row that then
    // appends (nightfall: squishies, then `maps`) would deadlock with it.
    it('never holds `maps` while a later event waits for an entity row', async () => {
      const mapId = await newMap();
      await addEvents(mapId, 2);
      await db.execute(`insert into consumer_test_entity values ('${mapId}')`);
      const consumer: EventConsumer = {
        name: `test-${String(process.pid)}-${String((counter += 1))}`,
        mapKinds: ['tutorial'],
        handle: async (tx, event) => {
          if (event.type !== 'map.updated') return;
          // The first event only appends, so the consumer has taken `maps` once
          // before it meets the locked row.
          if (event.seq > 1) {
            await tx.execute(
              `select id from consumer_test_entity where id = '${mapId}' for update`,
            );
          }
          await appendRawGameEvent(tx, {
            mapId,
            type: 'test.reacted',
            actorUserId: null,
            payload: {},
          });
        },
      };

      let running: Promise<number> | undefined;
      await db.transaction(async (tx) => {
        // Fails fast instead of hanging if the order is ever wrong again.
        await tx.execute(`set local lock_timeout = '10s'`);
        // The command: the entity row first...
        await tx.execute(`select id from consumer_test_entity where id = '${mapId}' for update`);
        const pid = await backendPid(tx);
        running = runConsumer(db, consumer, mapId);
        await waitUntilBlockedBy(db, pid); // the consumer is at event 2, waiting on the row
        // ...then `maps`, last. Free: the consumer committed event 1 on its own.
        await appendGameEvent(tx, {
          mapId,
          type: 'map.updated',
          actorUserId: null,
          payload: { pvpMode: 'off' },
        });
      });
      expect(await running).toBe(6);
      const types = await db.execute<{ type: string }>(
        `select type from game_events where map_id = '${mapId}' order by seq`,
      );
      expect([...types].map((r) => r.type)).toEqual([
        'map.updated',
        'map.updated',
        'test.reacted', // event 1
        'map.updated', // the command's
        'test.reacted', // event 2, once the row was free
        'test.reacted', // the command's event
      ]);
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

    /** The map's jobs on the consumer's queue, counted by state. */
    async function jobStates(
      consumer: EventConsumer,
      mapId: string,
    ): Promise<Record<string, number>> {
      const rows = await db.execute<{ state: string; n: string }>(
        `select state, count(*) as n from pgboss.job where name = 'event-consumer.${consumer.name}' and singleton_key = '${mapId}' group by state`,
      );
      return Object.fromEntries([...rows].map((r) => [r.state, Number(r.n)]));
    }

    async function queuePolicy(name: string): Promise<string | undefined> {
      const rows = await db.execute<{ policy: string }>(
        `select policy from pgboss.queue where name = '${name}'`,
      );
      return [...rows][0]?.policy;
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

    // The CI Postgres log used to fill with `duplicate key value violates
    // unique constraint "job_common_i3"` for `event-consumer.tutorial`: with
    // the `stately` policy, the wake-up for a tap that landed while the map's
    // job was running was fetched by an idle worker and tripped the
    // one-active-per-key index, on every poll until the job ended. With
    // `short` that wake-up is simply a second job for the map, taken right
    // away; `runConsumer`'s row lock makes the two take turns.
    it('takes a wake-up that arrives mid-run as a job of its own: nothing lost or doubled', async () => {
      let release = (): void => {};
      const until = new Promise<void>((resolve) => {
        release = resolve;
      });
      const mapId = await newMap();
      // Holds this map's first event only: the boot catch-up also runs the
      // consumer over every earlier map in the database.
      const consumer = testConsumer({ holdAt: { mapId, seq: 1, until } });
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [consumer],
        logger,
        schedule: false,
      });

      try {
        // The first event's wake-up: its job starts and holds at event 1.
        await addEvents(mapId, 1);
        await eventually(async () => (await jobStates(consumer, mapId))['active'] === 1);
        expect(await applied(consumer, mapId)).toEqual([]); // held open, not committed

        // Two more while it runs. Their wake-up is queued beside the running
        // job and a free worker takes it at once (under `stately` it would be
        // refused with a unique-key error until the first job ended).
        await addEvents(mapId, 2);
        await eventually(async () => ((await jobStates(consumer, mapId))['active'] ?? 0) >= 2);
        expect((await position(consumer, mapId)) ?? 0).toBe(0); // the second job waits its turn
      } finally {
        release(); // also on a failed assertion, or `stop()` would wait on the held job
      }
      await eventually(async () => (await position(consumer, mapId)) === 3);
      expect(await applied(consumer, mapId)).toEqual([1, 2, 3]);
      // Every job for the map finished; none stuck queued, retrying or failed.
      await eventually(async () => {
        const states = await jobStates(consumer, mapId);
        return Object.keys(states).every((state) => state === 'completed');
      });
    });

    it('recreates a queue that an older build left with another policy', async () => {
      const consumer = testConsumer();
      const queue = `event-consumer.${consumer.name}`;
      const mapId = await newMap();
      // An older build: the queue with the policy it had, and a wake-up on it.
      const older = new PgBoss({ connectionString: url!, schema: PG_BOSS_SCHEMA, max: 1 });
      await older.start();
      await older.createQueue(queue, { policy: 'stately' });
      await older.send(queue, { mapId }, { singletonKey: mapId });
      await older.stop({ graceful: false });
      expect(await queuePolicy(queue)).toBe('stately');
      await addEvents(mapId, 2); // nothing running: these lag until a catch-up

      // pg-boss keeps a queue's policy for good, so startJobs drops and
      // recreates it; the boot catch-up then wakes the lagging map anyway.
      jobs = await startJobs({
        connectionString: url!,
        db,
        consumers: [consumer],
        logger,
        schedule: false,
      });
      expect(await queuePolicy(queue)).toBe('short');
      const stale = await db.execute<{ n: string }>(
        `select count(*) as n from pgboss.job where name = '${queue}' and policy = 'stately'`,
      );
      expect(Number([...stale][0]!.n)).toBe(0);
      await eventually(async () => (await position(consumer, mapId)) === 2);
      expect(await applied(consumer, mapId)).toEqual([1, 2]);
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
      // Keyed by map and night (`short`: at most one queued per key); the
      // night's `hollow_events` row makes any repeat a no-op.
      expect(await jobs.nightfallSweep()).toBe(1);
      const rows = await db.execute<{ n: string }>(
        `select count(*) as n from pgboss.job where name = 'nightfall' and singleton_key = '${mapId}/2026-10-31'`,
      );
      expect(Number([...rows][0]!.n)).toBeGreaterThanOrEqual(1);
    });
  });
});
