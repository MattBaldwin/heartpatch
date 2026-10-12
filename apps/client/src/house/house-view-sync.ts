/*
 * Which house reply is newest (#381 B3b). The open house re-reads
 * `GET /house` when its sheet opens, and a build replies with the new house.
 * A read sent before (or while) a build is in flight can land after the
 * build's reply and would put the old level back, so starting a build and
 * taking its reply both drop every read in flight. Pure (no DOM), so it's
 * unit-tested.
 */

export interface ViewSync {
  /**
   * A read starts: the check it returns stays true until a newer read, a
   * build or `drop` comes along.
   */
  begin(): () => boolean;
  /** Something newer than every read in flight (a build started or replied, or the house closed). */
  drop(): void;
}

export function createViewSync(): ViewSync {
  let ticket = 0;
  return {
    begin() {
      ticket += 1;
      const mine = ticket;
      return () => mine === ticket;
    },
    drop() {
      ticket += 1;
    },
  };
}
