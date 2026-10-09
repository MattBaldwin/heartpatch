/**
 * A look for found pages now and once more after `ms` (the finder, a server
 * event consumer, can lag the step that found a page), counting the looks
 * still to finish, so tests can wait for none outstanding (#318: a page found
 * while one was in flight showed its card before a reload).
 */
export interface Rechecker {
  check: () => void;
  /** Looks scheduled or in flight. */
  readonly pending: number;
}

export function createRechecker(
  look: () => Promise<void>,
  setTimer: (task: () => void, ms: number) => unknown,
  ms: number,
): Rechecker {
  let pending = 0;
  const run = () => {
    void look().finally(() => {
      pending--;
    });
  };
  return {
    check: () => {
      pending += 2;
      run();
      setTimer(run, ms);
    },
    get pending() {
      return pending;
    },
  };
}
