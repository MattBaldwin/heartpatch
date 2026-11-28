import { GAME_EVENTS, type BossVisit, type WsEventMessage } from '@heartpatch/shared';
import { barFromEvent, newerBar, type PatchBarState } from '../battle/patch-bar.js';

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
  /**
   * The Christmas Eve view needs a fresh read (#37 X5b): the bar closed (there
   * is no `boss.dozed` event), or this Keeper's thanks landed (`boss.thanked`).
   */
  readonly onEveRefresh?: (mapId: string) => void;
  /**
   * Remembers that this Keeper chipped a bar across a reload (the view has no
   * "viewer chipped" flag), so the thanks wait still shows. Null or throwing is fine.
   */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export interface BossStore {
  readonly mapId: string | null;
  readonly visit: BossVisit | null;
  /**
   * The Christmas Eve patch bar as live events last left it (#37 X4), or null
   * before any came. The map view's own read is newer or older: `newerBar` picks.
   */
  readonly eveBar: PatchBarState | null;
  /** This Keeper's own fight chipped the bar on screen (a live `boss.chipped` with their points). */
  readonly iChipped: boolean;
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
  let eveBar: PatchBarState | null = null;
  let iChipped = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let names: ReadonlyMap<string, string> = new Map();
  let ticket = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const chipKey = (id: string, window: string): string => `hp-eve-chipped:${id}:${window}`;
  const readChipped = (id: string, window: string): boolean => {
    try {
      return options.storage?.getItem(chipKey(id, window)) === '1';
    } catch {
      return false;
    }
  };
  const emit = (): void => {
    for (const fn of [...listeners]) fn();
  };
  /** One timer, for when this visit ends: the marker goes then without a refetch. */
  const arm = (): void => {
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(closeTimer);
    closeTimer = undefined;
    if (!visit) return;
    // The Eve bar closes at `closesAt`; nothing says so live, so ask the view again then.
    if (visit.event) {
      const toClose = Date.parse(visit.event.closesAt) - now().getTime();
      if (Number.isFinite(toClose) && toClose > 0) {
        const id = mapId;
        closeTimer = setTimeout(
          () => {
            closeTimer = undefined;
            if (id === null || id !== mapId) return;
            // /boss pays a thanks that's due; then the map view reads it.
            void load(id).then(() => {
              if (mapId === id) options.onEveRefresh?.(id);
            });
          },
          Math.min(toClose + 1_000, MAX_WAIT_MS),
        );
      }
    }
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
      eveBar = null;
      iChipped = false;
      names = new Map();
      arm();
      emit();
      return null;
    }
    if (mapId !== id) {
      mapId = id;
      visit = null;
      eveBar = null;
      iChipped = false;
      names = new Map();
      emit();
    }
    let next: BossVisit | null;
    try {
      next = await options.fetchBoss(id);
    } catch {
      // A hiccup keeps what we had; the next open or event asks again.
      return visit;
    }
    if (mine !== ticket) return visit;
    visit = next;
    if (next && !iChipped) iChipped = readChipped(id, next.window.id);
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
    get eveBar() {
      return eveBar;
    },
    get iChipped() {
      return iChipped;
    },
    nameOf: (speciesId) => names.get(speciesId) ?? null,
    setMap: async (id) => {
      await load(id);
    },
    refresh: async () => {
      if (mapId !== null) await load(mapId);
    },
    liveEvent: (event) => {
      if (event.type === 'boss.chipped' || event.type === 'boss.fell') {
        if (event.mapId !== mapId) return;
        const parsed =
          event.type === 'boss.chipped'
            ? GAME_EVENTS['boss.chipped'].public.safeParse(event.data)
            : GAME_EVENTS['boss.fell'].public.safeParse(event.data);
        // Another visit's bar (a window we aren't showing) isn't ours.
        if (!parsed.success || (visit && parsed.data.window !== visit.window.id)) return;
        // Only the chipper's own copy carries their points.
        if ('points' in parsed.data && parsed.data.points !== undefined) {
          iChipped = true;
          try {
            options.storage?.setItem(chipKey(event.mapId, parsed.data.window), '1');
          } catch {
            // Not remembered across a reload; the live copy still counts.
          }
        }
        const next = barFromEvent(parsed.data);
        eveBar = newerBar(eveBar, event.type === 'boss.fell' ? { ...next, state: 'fell' } : next);
        emit();
        if (event.type === 'boss.fell') {
          // /boss pays the fall's thanks; the map view then shows it.
          const id = mapId;
          void load(id).then(() => {
            if (mapId === id) options.onEveRefresh?.(id);
          });
        }
        return;
      }
      if (event.type === 'boss.thanked') {
        if (event.mapId === mapId) options.onEveRefresh?.(mapId);
        return;
      }
      if (event.type !== 'boss.appeared' || event.mapId !== mapId) return;
      if (!GAME_EVENTS['boss.appeared'].public.safeParse(event.data).success) return;
      const id = mapId;
      void load(id).then((got) => {
        if (mapId === id) options.onAppeared?.(got, id);
      });
    },
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose: () => {
      clearTimeout(timer);
      clearTimeout(closeTimer);
      listeners.clear();
      ticket++;
    },
  };
}
