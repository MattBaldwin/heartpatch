/**
 * Runs `run` at most once per animation frame, however often `mark` is called
 * before it: a camera that moves every frame, a resize and a lean in the same
 * frame all cost one pass (#190, the friends' plates). The last `mark` always
 * gets its pass, so whatever settles last is what is shown.
 *
 * `schedule` and `cancel` default to the browser's frame callbacks; tests pass
 * their own.
 */
export interface OncePerFrame {
  /** Asks for a pass on the next frame; more asks before it add nothing. */
  readonly mark: () => void;
  /** Drops a pass that hasn't run yet. */
  readonly cancel: () => void;
}

export function oncePerFrame(
  run: () => void,
  schedule: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  cancel: (id: number) => void = (id) => {
    cancelAnimationFrame(id);
  },
): OncePerFrame {
  let pending = 0;
  let queued = false;
  const tick = () => {
    queued = false;
    pending = 0;
    run();
  };
  return {
    mark: () => {
      if (queued) return;
      queued = true;
      pending = schedule(tick);
    },
    cancel: () => {
      if (!queued) return;
      queued = false;
      cancel(pending);
      pending = 0;
    },
  };
}
