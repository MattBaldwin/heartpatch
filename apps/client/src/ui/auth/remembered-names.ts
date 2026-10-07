// Names that logged in on this device (#197), so a kid who forgot theirs can
// tap it on the log in screen. Only names, never passwords, and at most
// `REMEMBERED_NAMES_MAX`, newest first. Nothing here is sent anywhere.

const KEY = 'heartpatch.rememberedNames.v1';

/** At most this many names (owner decision 2026-10-07). */
export const REMEMBERED_NAMES_MAX = 3; // TUNE: owner decision 2026-10-07

/** The parts of `localStorage` used (tests pass a Map-backed fake). */
export type NameStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): NameStore | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked: the log in screen just asks for a name, as before
  }
}

/** The remembered names, newest first. Anything unreadable counts as none. */
export function rememberedNames(store = storage()): string[] {
  let raw: string | null;
  try {
    raw = store?.getItem(KEY) ?? null;
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .slice(0, REMEMBERED_NAMES_MAX);
  } catch {
    return [];
  }
}

/**
 * Puts a name that just logged in (or signed up) first. Names are the same
 * player whatever their case, so "Pip" replaces "pip".
 */
export function rememberName(name: string, store = storage()): string[] {
  const lower = name.toLowerCase();
  const names = [name, ...rememberedNames(store).filter((n) => n.toLowerCase() !== lower)].slice(
    0,
    REMEMBERED_NAMES_MAX,
  );
  try {
    store?.setItem(KEY, JSON.stringify(names));
  } catch {
    // Full or blocked: next time they type their name, which is harmless.
  }
  return names;
}

/** "Not you?": this device forgets every name (owner decision 2026-10-07). */
export function forgetNames(store = storage()): void {
  try {
    store?.removeItem(KEY);
  } catch {
    // As above.
  }
}
