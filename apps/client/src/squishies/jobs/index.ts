import {
  GAME_DATA,
  JOB_RULES,
  workSource,
  type JobsView,
  type PublicTile,
  type PublicUser,
} from '@heartpatch/shared';
import type { TileActions } from '../../map/map-screen.js';
import { el } from '../../ui/dom.js';
import { createGathererBadges, type GathererBadges } from './gatherer-badges.js';
import { createJobBoard, type JobBoard, type JobBoardDebug } from './job-board.js';
import { jobsApi, type JobsApi } from './jobs-api.js';
import { JOBS_TEXT, workMoods, type WorkMood } from './jobs-view.js';
import { createTeamPicker, type TeamPicker, type TeamPickerDebug } from './team-picker.js';

// Squishy jobs on the client (owner decisions 2026-10-04): the job board and
// the team picker, as self-contained sheets (`openJobBoard(mapId)` /
// `openTeamPicker(mapId)`). Entry points: the tile panel's "Send a gatherer"
// line (`tileActions`) and the Team and Jobs row (`mountTeamButton`), which
// main.ts mounts in the My Home tray.

export interface JobsOptions {
  root: HTMLElement;
  api?: JobsApi;
  /** The Tutorial Glade keeps its own flow: no job entry points there. */
  isGlade?: (mapId: string) => boolean;
  /** Banks finished work into the bag (the bag's settle), before the job board reads its view. */
  settle?: (mapId: string) => Promise<void>;
}

export interface JobsDebug {
  readonly board: JobBoardDebug;
  readonly team: TeamPickerDebug;
  /** Gatherer badges on screen over the map. */
  readonly badges: number;
  /** Of those, the ones showing my gatherers' mood (#393). */
  readonly badgeMoods: Readonly<Record<WorkMood, number>>;
}

export interface Jobs {
  openJobBoard: (mapId: string, spot?: { q: number; r: number }) => Promise<void>;
  openTeamPicker: (mapId: string) => Promise<void>;
  /** Closes both sheets (another screen took over). */
  close: () => void;
  setUser: (user: PublicUser | null) => void;
  /** The tile panel's lines: who's gathering here, and "Send a gatherer" on my land. */
  readonly tileActions: TileActions;
  /**
   * Puts the Team and Jobs buttons in `box` (a box in the My Home tray),
   * opening the sheets for the map `mapNow` names; shown while `box` is.
   */
  mountTeamButton: (box: Element | null, mapNow: () => string | null) => void;
  /** The map layer that puts a 🧺 over tiles with a gatherer (pass it to the map screen). */
  readonly badges: GathererBadges;
  /**
   * How each of my squishies feels about its job on a map (#393), fresh
   * from the server: for the home's bounce and droop.
   */
  workMoods: (mapId: string) => Promise<Map<string, WorkMood>>;
  /** Calls `listener` with every fresh jobs view (a job changed, the board opened). */
  onView: (listener: (mapId: string, view: JobsView) => void) => void;
  readonly isOpen: boolean;
  readonly debug: JobsDebug;
}

/** Can a gatherer of mine work this tile (a node, or land outside home with a yield)? */
export function workableByMe(tile: PublicTile, userId: string | null): boolean {
  return (
    userId !== null &&
    tile.ownerUserId === userId &&
    workSource(tile, GAME_DATA.resources, JOB_RULES) !== null
  );
}

let installed: Jobs | null = null;

/** Opens the job board for a map (the trays call this). */
export function openJobBoard(mapId: string): Promise<void> {
  return installed?.openJobBoard(mapId) ?? Promise.resolve();
}

/** Opens the team picker for a map (the trays call this). */
export function openTeamPicker(mapId: string): Promise<void> {
  return installed?.openTeamPicker(mapId) ?? Promise.resolve();
}

export function createJobs(options: JobsOptions): Jobs {
  // Every jobs view the sheets or the map read passes through here, so the
  // map's badges and the home's moods follow a job change at once (#393).
  const listeners = new Set<(mapId: string, view: JobsView) => void>();
  const seen = (mapId: string) => (view: JobsView) => {
    for (const listener of listeners) listener(mapId, view);
    return view;
  };
  const base = options.api ?? jobsApi;
  const api: JobsApi = {
    view: (mapId) => base.view(mapId).then(seen(mapId)),
    setJob: (mapId, squishyId, job, key) =>
      base.setJob(mapId, squishyId, job, key).then(seen(mapId)),
    setTeam: (mapId, squishyIds, key) => base.setTeam(mapId, squishyIds, key).then(seen(mapId)),
  };
  const board: JobBoard = createJobBoard({
    root: options.root,
    api,
    ...(options.settle ? { settle: options.settle } : {}),
  });
  const picker: TeamPicker = createTeamPicker({ root: options.root, api });
  let userId: string | null = null;
  const glade = (mapId: string) => options.isGlade?.(mapId) ?? false;
  const badges = createGathererBadges(options.root, {
    // My gatherers' moods: never on the Tutorial Glade, never signed out.
    load: (mapId) => {
      if (userId !== null && !glade(mapId)) void api.view(mapId).catch(() => undefined);
    },
  });
  listeners.add((mapId, view) => {
    badges.setMine(mapId, view);
  });

  const jobs: Jobs = {
    // Never on the Tutorial Glade: its steps keep their own flow.
    openJobBoard: (mapId, spot) => {
      if (glade(mapId)) return Promise.resolve();
      picker.close();
      return board.open(mapId, spot);
    },
    openTeamPicker: (mapId) => {
      if (glade(mapId)) return Promise.resolve();
      board.close();
      return picker.open(mapId);
    },
    close: () => {
      board.close();
      picker.close();
    },
    setUser: (user) => {
      userId = user?.id ?? null;
      if (!user) jobs.close();
    },
    tileActions: {
      show: (container, tile, view) => {
        const lines: HTMLElement[] = [];
        if (!glade(view.map.id)) {
          if ((tile.workers ?? 0) > 0) {
            lines.push(
              el(
                'p',
                { class: 'tile-workers', 'data-testid': 'tile-workers' },
                JOBS_TEXT.gatheringHere(tile.workers ?? 0),
              ),
            );
          }
          if (workableByMe(tile, userId)) {
            const send = el(
              'button',
              {
                type: 'button',
                class: 'auth-button auth-button-soft auth-button-small',
                'data-testid': 'tile-send-gatherer',
              },
              JOBS_TEXT.sendGatherer,
            );
            send.addEventListener('click', () => {
              void jobs.openJobBoard(view.map.id, { q: tile.q, r: tile.r });
            });
            lines.push(send);
          }
        }
        container.replaceChildren(...lines);
      },
      hide: () => {
        // The sheets stay open on their own; the panel's lines go with it.
      },
    },
    mountTeamButton: (box, mapNow) => {
      if (!box) return;
      const team = el(
        'button',
        {
          type: 'button',
          class: 'auth-button auth-button-soft auth-button-small',
          'data-testid': 'team-open',
        },
        `⚔️ ${JOBS_TEXT.teamButton}`,
      );
      const board = el(
        'button',
        {
          type: 'button',
          class: 'auth-button auth-button-soft auth-button-small',
          'data-testid': 'jobs-open',
        },
        `🧺 ${JOBS_TEXT.jobsButton}`,
      );
      const row = el('div', { class: 'battle-row jobs-entry' }, team, board);
      team.addEventListener('click', () => {
        const id = mapNow();
        if (id && !glade(id)) void jobs.openTeamPicker(id);
      });
      board.addEventListener('click', () => {
        const id = mapNow();
        if (id && !glade(id)) void jobs.openJobBoard(id);
      });
      box.prepend(row);
      // Not on the Tutorial Glade: shown again whenever the box is (back from
      // a battle, #132), judged by the map the caller says is on screen now.
      const refresh = () => {
        const id = mapNow();
        row.hidden = id === null || glade(id);
      };
      new MutationObserver(refresh).observe(box, { attributes: true, attributeFilter: ['hidden'] });
      refresh();
    },
    badges,
    workMoods: async (mapId) => (glade(mapId) ? new Map() : workMoods(await api.view(mapId))),
    onView: (listener) => {
      listeners.add(listener);
    },
    get isOpen() {
      return board.isOpen || picker.isOpen;
    },
    get debug() {
      return {
        board: board.debug,
        team: picker.debug,
        badges: badges.shown,
        badgeMoods: badges.moods,
      };
    },
  };
  installed = jobs;
  return jobs;
}
