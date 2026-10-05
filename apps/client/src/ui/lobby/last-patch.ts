// Where the player left off (#160): the last patch they visited on this
// device, per account, so a reload or a log-in lands back on it. Only a map
// id is kept; the server still decides whether they may open it.

const KEY_PREFIX = 'heartpatch.lastPatch.v1.';

/** The parts of `localStorage` used (tests pass a Map-backed fake). */
export type PatchStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): PatchStore | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked: the player lands in the lobby, as before
  }
}

export function rememberPatch(userId: string, mapId: string, store = storage()): void {
  try {
    store?.setItem(KEY_PREFIX + userId, mapId);
  } catch {
    // Full or blocked: next time starts in the lobby, which is harmless.
  }
}

export function forgetPatch(userId: string, store = storage()): void {
  try {
    store?.removeItem(KEY_PREFIX + userId);
  } catch {
    // As above.
  }
}

/** The patch to land on: the remembered one, if it's still one of `mine`. */
export function patchToResume(
  userId: string,
  mine: readonly { id: string }[],
  store = storage(),
): string | null {
  let id: string | null = null;
  try {
    id = store?.getItem(KEY_PREFIX + userId) ?? null;
  } catch {
    return null;
  }
  if (id === null) return null;
  if (mine.some((m) => m.id === id)) return id;
  forgetPatch(userId, store); // left or removed since: start in the lobby
  return null;
}
