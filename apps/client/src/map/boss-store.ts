import { GAME_EVENTS, type BossVisit, type WsEventMessage } from '@heartpatch/shared';

/*
 * The mini-boss visit for the map on screen (#190, 190f): what
 * `GET /maps/:id/boss` says now, kept fresh by `boss.appeared` and by the
 * visit's own end. The server decides everything (CLAUDE.md rule 1); this
 * only holds the answer. The species is named only once this Keeper has met
 * it, and its name comes from their own catalog (the server withholds the def
 * until then), so a name the catalog doesn't have yet stays "A BIG squishy".
 */

export interface BossStoreOptions {
  readonly fetchBoss: (mapId: string) => Promise<BossVisit | null>;
  /** The species names this Keeper may know on `mapId` (their catalog's defs). */
  readonly fetchNames: (mapId: string) => Promise<ReadonlyMap<string, string>>;
  readonly now?: () => Date;
  /** A boss arrived on the map on screen (a live `boss.appeared`), after the visit was refetched. */
  readonly onAppeared?: (visit: BossVisit | null, mapId: string) => void;
}

export interface BossStore {
  readonly mapId: string | null;
  readonly visit: BossVisit | null;
  nameOf: (speciesId: string) => string | null;
  /** The map on screen (null when none): fetches its boss. */
  setMap: (mapId: string | null) => Promise<void>;
  /** Asks the server again (after a fight, a reopen). */
  refresh: () => Promise<void>;
  liveEvent: (event: WsEventMessage) => void;
  /** Calls `fn` whenever the visit, a name or its end changes. */
  onChange: (fn: () => void) => () => void;
  dispose: () => void;
}

/** setTimeout can't wait longer than this. */
const MAX_WAIT_MS = 2 ** 31 - 1;

export function createBossStore(options: BossStoreOptions): BossStore {
  const now = options.now ?? (() => new Date());
  const listeners = new Set<() => void>();
  let mapId: string | null = null;
  let visit: BossVisit | null = null;
  let names: ReadonlyMap<string, string> = new Map();
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (): void => {
    for (const fn of [...listeners]) fn();
  };
  /** One timer, for when this visit ends: the marker goes then without a refetch. */
  const arm = (): void => {
    clearTimeout(timer);
    timer = undefined;
    if (!visit) return;
    const wait = Date.parse(visit.window.endsAt) - now().getTime();
    if (!Number.isFinite(wait)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        // Its time is up: listeners ask `markerModel`, which says there is no boss.
        emit();
      },
      Math.min(Math.max(wait, 0) + 50, MAX_WAIT_MS),
    );
  };

  const load = async (id: string | null): Promise<BossVisit | null> => {
    const mine = ++ticket;
    if (id === null) {
      mapId = null;
      visit = null;
      names = new Map();
      arm();
      emit();
      return null;
    }
    if (mapId !== id) {
      mapId = id;
      visit = null;
      names = new Map();
      emit();
    }
    let next: BossVisit | null = null;
    try {
      next = await options.fetchBoss(id);
    } catch {
      // A hiccup keeps what we had; the next open or event asks again.
      return visit;
    }
    if (mine !== ticket) return visit;
    visit = next;
    arm();
    emit();
    if (next?.species != null && !names.has(next.species)) {
      try {
        const got = await options.fetchNames(id);
        if (mine === ticket) {
          names = got;
          emit();
        }
      } catch {
        // No name yet: the stand-in shows.
      }
    }
    return visit;
  };

  return {
    get mapId() {
      return mapId;
    },
    get visit() {
      return visit;
    },
    nameOf: (speciesId) => names.get(speciesId) ?? null,
    setMap: async (id) => {
      await load(id);
    },
    refresh: async () => {
      if (mapId !== null) await load(mapId);
    },
    liveEvent: (event) => {
      if (event.type !== 'boss.appeared' || event.mapId !== mapId) return;
      if (!GAME_EVENTS['boss.appeared'].public.safeParse(event.data).success) return;
      const id = mapId;
      void load(id).then((got) => {
        if (id !== null && mapId === id) options.onAppeared?.(got, id);
      });
    },
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose: () => {
      clearTimeout(timer);
      listeners.clear();
      ticket++;
    },
  };
}
