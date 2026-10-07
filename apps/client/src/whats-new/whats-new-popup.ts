import type { ChangeEntryView } from '@heartpatch/shared';
import { popUpPlan, type SeenStore } from './whats-new-model.js';

// When What's new pops up by itself (#220), without the DOM so it can be
// tested: a build newer than the one this device last saw, with at least one
// entry newer than that too (a deploy of tooling or docs alone stays quiet),
// once per run, and only when nothing else owns the screen.

export interface PopUpDeps {
  /** This app's build number; null for a dev build without git. */
  current: number | null;
  seen: SeenStore;
  /** Something else owns the screen (or the map isn't up): wait. */
  busy: () => boolean;
  /** The changelog's entries, or null when it can't be fetched. */
  load: () => Promise<readonly ChangeEntryView[] | null>;
  /** Shows the sheet with everything after `since`. */
  show: (since: number | null) => void;
  setTimer: (task: () => void, ms: number) => unknown;
  retryMs: number;
}

export interface PopUp {
  /** The map is on screen: pop up if there's something new. */
  maybePop: () => void;
  /** The sheet closed: everything up to this build has been seen. */
  closed: () => void;
  /** It popped up, or there was nothing to pop for this run. */
  readonly finished: boolean;
}

/** True when some entry arrived after `seen`. */
export function hasNewSince(entries: readonly ChangeEntryView[], seen: number | null): boolean {
  return seen !== null && entries.some((e) => e.build !== null && e.build > seen);
}

export function createPopUp(deps: PopUpDeps): PopUp {
  let done = false;
  let checking = false;
  let retrying = false;

  const settle = () => {
    done = true;
    if (deps.current !== null) deps.seen.write(deps.current);
  };

  const popWhenFree = (since: number | null) => {
    if (done) return;
    // The sheet was opened and closed from the menu meanwhile.
    const now = deps.seen.read();
    if (deps.current !== null && now !== null && now >= deps.current) {
      done = true;
      return;
    }
    if (deps.busy()) {
      if (!retrying) {
        retrying = true;
        deps.setTimer(() => {
          retrying = false;
          popWhenFree(since);
        }, deps.retryMs);
      }
      return;
    }
    done = true;
    deps.show(since);
  };

  return {
    maybePop: () => {
      if (done || checking) return;
      const plan = popUpPlan(deps.current, deps.seen.read());
      if (plan.remember !== null) deps.seen.write(plan.remember);
      if (!plan.pop) return;
      // One attempt at a time: it stays on through the busy waits.
      checking = true;
      void deps.load().then((entries) => {
        if (entries === null) {
          checking = false; // offline: a later visit tries again
          return;
        }
        if (hasNewSince(entries, plan.since)) popWhenFree(plan.since);
        else settle(); // nothing a player would see: no pop, quietly caught up
      });
    },
    closed: () => {
      if (deps.current !== null) deps.seen.write(deps.current);
    },
    get finished() {
      return done;
    },
  };
}
