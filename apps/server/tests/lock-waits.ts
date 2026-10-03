// Helpers for lock-order tests (tech spec §7 "Lock order"): hold a lock in a
// transaction, start the command under test, and go on once it waits on us.
import type { Executor } from '../src/db/client.js';

/** The backend pid of this transaction's connection. */
export async function backendPid(tx: Executor): Promise<number> {
  const rows = await tx.execute<{ pid: number }>('select pg_backend_pid() as pid');
  const [row] = [...rows];
  if (!row) throw new Error('backendPid: no row');
  return row.pid;
}

/**
 * Waits until `count` other backends are blocked on a lock `pid` holds,
 * directly or queued behind one that is (a second locker of the same row
 * waits on the first waiter, not on the holder). Only counts waits that lead
 * back to that one backend, so other test files' locks in the same database
 * never count.
 */
export async function waitUntilBlockedBy(db: Executor, pid: number, count = 1, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // A pid from `backendPid`, so inlining it is safe.
    const rows = await db.execute<{ n: number }>(
      `with recursive waiting(pid) as (
         select pid from pg_stat_activity where ${String(pid)} = any(pg_blocking_pids(pid))
         union
         select a.pid from pg_stat_activity a join waiting w on w.pid = any(pg_blocking_pids(a.pid))
       )
       select count(*)::int as n from waiting`,
    );
    if (([...rows][0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline)
      throw new Error(
        `timed out waiting for ${String(count)} backend(s) blocked by ${String(pid)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
