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
import {
  createGathererSquishies,
  type GathererSquishies,
  type GathererSquishiesDebug,
} from './gatherer-squishies.js';
import { createJobBoard, type JobBoard, type JobBoardDebug } from './job-board.js';
import { jobsApi, type JobsApi } from './jobs-api.js';
import { JOBS_TEXT, workerLine } from './jobs-view.js';
import { createViewFeed } from './view-feed.js';
import { createTeamPicker, type TeamPicker, type TeamPickerDebug } from './team-picker.js';

// Squishy jobs on the client (owner decisions 2026-10-04): the job board and
// the team picker, as self-contained sheets (`openJobBoard(mapId)` /
// `openTeamPicker(mapId)`). Entry points: the tile panel's "Send a gatherer"
// button (`tileActions`; who gathers there is `workerLine`, #602) and the
// Team and Jobs row (`mountTeamButton`), which main.ts mounts in the My Home
// tray.

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
  /** Gatherers standing on their tiles on the map, and my marks (#602). */
  readonly gatherers: GathererSquishiesDebug;
}

export interface Jobs {
  openJobBoard: (mapId: string, spot?: { q: number; r: number }) => Promise<void>;
  openTeamPicker: (mapId: string) => Promise<void>;
  /** Closes both sheets (another screen took over). */
  close: () => void;
  setUser: (user: PublicUser | null) => void;
  /** The tile panel's line about who's gathering here and how they feel (#602): near the top. */
  readonly workerLine: TileActions;
  /** The tile panel's "Send a gatherer" on my land. */
  readonly tileActions: TileActions;
  /**
   * Puts the Team and Jobs buttons in `box` (a box in the My Home tray),
   * opening the sheets for the map `mapNow` names; shown while `box` is.
   */
  mountTeamButton: (box: Element | null, mapNow: () => string | null) => void;
  /** The map layer that stands each gatherer on its tile (pass it to the map screen). */
  readonly gatherers: GathererSquishies;
  /**
   * Asks for my fresh jobs view of a map (#393): it reaches `onView` (only if
   * it's still the newest), for the home's bubbles, bounce and droop.
   */
  loadView: (mapId: string) => void;
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
  // My jobs views, newest only, for the map's gatherers and the home's moods (#393).
  const feed = createViewFeed(options.api ?? jobsApi);
  const api = feed.api;
  const board: JobBoard = createJobBoard({
    root: options.root,
    api,
    ...(options.settle ? { settle: options.settle } : {}),
  });
  const picker: TeamPicker = createTeamPicker({ root: options.root, api });
  let userId: string | null = null;
  const glade = (mapId: string) => options.isGlade?.(mapId) ?? false;
  /** My jobs view, for the moods: never on the Tutorial Glade, never signed out. */
  const loadView = (mapId: string) => {
    if (userId !== null && !glade(mapId)) void api.view(mapId).catch(() => undefined);
  };
  const gatherers = createGathererSquishies(options.root, { load: loadView });
  feed.listen((mapId, view) => {
    gatherers.setMine(mapId, view);
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
      const next = user?.id ?? null;
      const changed = next !== userId;
      userId = next;
      if (changed) {
        // Another player (or none): the last one's moods go, and so does anything still on its way.
        feed.reset();
        gatherers.forget();
      }
      if (!user) jobs.close();
    },
    workerLine: {
      show: (container, tile, view) => {
        const count = tile.workers ?? 0;
        container.replaceChildren(
          ...(count > 0 && !glade(view.map.id)
            ? [
                el(
                  'p',
                  { class: 'tile-workers', 'data-testid': 'tile-workers' },
                  workerLine(count, gatherers.mineOn(view.map.id, tile), tile),
                ),
              ]
            : []),
        );
      },
      hide: () => {
        // The line goes with the panel.
      },
    },
    tileActions: {
      show: (container, tile, view) => {
        const lines: HTMLElement[] = [];
        if (!glade(view.map.id) && workableByMe(tile, userId)) {
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
    gatherers,
    loadView,
    onView: feed.listen,
    get isOpen() {
      return board.isOpen || picker.isOpen;
    },
    get debug() {
      return {
        board: board.debug,
        team: picker.debug,
        gatherers: gatherers.debug,
      };
    },
  };
  installed = jobs;
  return jobs;
}
