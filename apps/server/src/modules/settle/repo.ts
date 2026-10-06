import { withTransaction, type Executor, type Transaction } from '../../db/client.js';
import { appendGameEvent, type GameEvent, type NewGameEvent } from '../../db/game-events.js';

/**
 * Settling's storage: just the transaction and its events. The rows it
 * banks belong to the gathering, inventory and jobs repos, used on the same
 * transaction (tech spec §7 lock order is the service's to keep).
 */
export interface SettleRepo {
  transaction: <T>(fn: (repo: SettleTxRepo, tx: Executor) => Promise<T>) => Promise<T>;
}

export interface SettleTxRepo {
  /** `appendGameEvent` in this transaction; events are the last writes. */
  appendEvent: <T extends NewGameEvent['type']>(event: NewGameEvent<T>) => Promise<GameEvent>;
}

export function createSettleRepo(db: Executor): SettleRepo {
  return {
    transaction: (fn) => withTransaction(db, (tx: Transaction) => fn(txRepo(tx), tx)),
  };
}

function txRepo(tx: Transaction): SettleTxRepo {
  return { appendEvent: (event) => appendGameEvent(tx, event) };
}
