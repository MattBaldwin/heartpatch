/*
 * Opening the house one reply at a time (#381), as the close-up's `ticket`
 * and home's `generation` do: an open waits for `GET /house`, and by the
 * time it lands the player may have tapped again, left Home, logged out or
 * switched player. Only the latest open's reply is used, a second open
 * while one is loading does nothing, and `cancel` drops whatever is in
 * flight. Pure (no DOM), so it's unit-tested.
 */

export interface OpenGate {
  /**
   * Fetches, then hands the reply to `ready`, unless another open or a
   * cancel came first; a failure goes to `fail` on the same terms. A call
   * while one is loading is ignored (a double tap opens once).
   */
  open<T>(
    fetch: () => Promise<T>,
    ready: (value: T) => void,
    fail: (err: unknown) => void,
  ): Promise<void>;
  /** Drops the open in flight (hide, Back, a logout or another player). */
  cancel(): void;
  /** An open is waiting for its reply. */
  readonly busy: boolean;
}

export function createOpenGate(): OpenGate {
  let ticket = 0;
  let busy = false;
  return {
    async open(fetch, ready, fail) {
      if (busy) return;
      ticket += 1;
      const mine = ticket;
      busy = true;
      let value;
      try {
        value = await fetch();
      } catch (err) {
        if (mine !== ticket) return;
        busy = false;
        fail(err);
        return;
      }
      if (mine !== ticket) return;
      busy = false;
      ready(value);
    },
    cancel() {
      ticket += 1;
      busy = false;
    },
    get busy() {
      return busy;
    },
  };
}
