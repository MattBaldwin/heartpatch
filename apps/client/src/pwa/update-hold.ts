// Holds automatic updates while something the player can't get back is on
// screen (#47, kid safety). A new account's recovery code is shown exactly
// once; if the app reloaded for an update under it, the child would lose
// their only way back in. Screens like that take a hold; update-flow.ts
// never reloads the page while one is held.

export interface UpdateHold {
  /** True while any screen holds updates. */
  readonly held: boolean;
  /** Holds updates until the returned release is called. Releasing twice is harmless. */
  hold: () => () => void;
  /** Runs `listener` once nothing is held: right away if nothing is now. */
  whenReleased: (listener: () => void) => void;
}

export function createUpdateHold(): UpdateHold {
  const holds = new Set<symbol>();
  let waiting: (() => void)[] = [];

  return {
    get held() {
      return holds.size > 0;
    },
    hold: () => {
      const token = Symbol('update-hold');
      holds.add(token);
      return () => {
        if (!holds.delete(token) || holds.size > 0) return;
        const listeners = waiting;
        waiting = [];
        for (const listener of listeners) listener();
      };
    },
    whenReleased: (listener) => {
      if (holds.size === 0) listener();
      else waiting.push(listener);
    },
  };
}

/** The app's one hold: ui/auth and the lobby take it, update-flow.ts respects it. */
export const updateHold = createUpdateHold();
