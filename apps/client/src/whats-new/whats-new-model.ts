import type { ChangeEntryView } from '@heartpatch/shared';

// "What's new" (#220), pure: which entries to show, grouped by version, and
// when the sheet pops up by itself. The device remembers the last build it
// showed (`SEEN_BUILD_KEY`); a brand-new device starts at its own build, so
// it never pops the whole history up.

export const SEEN_BUILD_KEY = 'heartpatch.whatsNewSeenBuild';

export interface VersionGroup {
  /** The build every entry in it arrived in; null for "Coming next" (no build yet). */
  build: number | null;
  /** The UTC date of that build's first entry, YYYY-MM-DD. */
  date: string | null;
  entries: ChangeEntryView[];
}

/** Newest first: "Coming next" on top, then each build, its entries by slug. */
export function groupByBuild(entries: readonly ChangeEntryView[]): VersionGroup[] {
  const groups = new Map<number | null, VersionGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.build) ?? { build: entry.build, date: entry.date, entries: [] };
    group.entries.push(entry);
    groups.set(entry.build, group);
  }
  const rank = (g: VersionGroup) => g.build ?? Number.MAX_SAFE_INTEGER;
  return [...groups.values()]
    .sort((a, b) => rank(b) - rank(a))
    .map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => (a.slug < b.slug ? -1 : 1)) }));
}

/** True for a group that arrived after `seen` (nothing is new when nothing was seen). */
export function isNewSince(group: Pick<VersionGroup, 'build'>, seen: number | null): boolean {
  return seen !== null && group.build !== null && group.build > seen;
}

export interface PopUpPlan {
  /** Show the sheet by itself, with everything after `since`. */
  pop: boolean;
  /** The last build this device showed, or null. */
  since: number | null;
  /** What to remember now, or null to leave it (it's written when the sheet closes). */
  remember: number | null;
}

/**
 * On start: a device that never saw a build remembers this one quietly; a
 * newer build than the one it saw pops the sheet up once. A dev build
 * (no number) never pops.
 */
export function popUpPlan(current: number | null, seen: number | null): PopUpPlan {
  if (current === null) return { pop: false, since: seen, remember: null };
  if (seen === null) return { pop: false, since: null, remember: current };
  return { pop: current > seen, since: seen, remember: null };
}

/** The device's memory of the last build it showed; storage can be blocked. */
export interface SeenStore {
  read: () => number | null;
  write: (build: number) => void;
}

export function createSeenStore(storage: () => Storage | undefined): SeenStore {
  return {
    read: () => {
      try {
        const value = storage()?.getItem(SEEN_BUILD_KEY) ?? null;
        return value !== null && /^\d+$/.test(value) ? Number(value) : null;
      } catch {
        return null;
      }
    },
    write: (build) => {
      try {
        storage()?.setItem(SEEN_BUILD_KEY, String(build));
      } catch {
        // Private mode: it pops up again next time, which is fine.
      }
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "v0.298 · Oct 7", or "Coming next" before a build has a number. */
export function groupLabel(group: Pick<VersionGroup, 'build' | 'date'>, major: number): string {
  if (group.build === null) return 'Coming next';
  const [, month, day] = (group.date ?? '').split('-').map(Number);
  const when = month && day ? ` · ${MONTHS[month - 1] ?? ''} ${String(day)}` : '';
  return `v${String(major)}.${String(group.build)}${when}`;
}
