import { HOUSE_WELCOME } from './house-config.js';

/*
 * Welcome home (#381 H2): the first time the house opens on a patch day, a
 * resident does a little hop and "Welcome home! 🏠" shows. It's cosmetic,
 * so it's remembered per viewer in localStorage (per map, the day last
 * welcomed). Every read and write is guarded: storage that throws
 * (a private window, blocked site data) counts as already welcomed, so the
 * welcome can never repeat in a loop. Pure (the storage and the clock are
 * passed in).
 */

export type WelcomeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The calendar day at `now` in `timeZone` (the device's when unknown), as `YYYY-MM-DD`. */
export function localDayIn(timeZone: string | null, now: Date): string {
  const format = (zone?: string) =>
    new Intl.DateTimeFormat('en-CA', {
      ...(zone ? { timeZone: zone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone ?? undefined);
  } catch {
    return format();
  }
}

const keyFor = (mapId: string) => `${HOUSE_WELCOME.storageKey}.${mapId}`;

/**
 * True the first time it's asked on `day` for `mapId` (and it remembers
 * that); false after, and false whenever storage can't be read or written.
 */
export function welcomeOnce(storage: WelcomeStorage | null, mapId: string, day: string): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(keyFor(mapId)) === day) return false;
    storage.setItem(keyFor(mapId), day);
    return true;
  } catch {
    return false;
  }
}

/** This browser's localStorage, or null where reading it throws. */
export function welcomeStorage(): WelcomeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
