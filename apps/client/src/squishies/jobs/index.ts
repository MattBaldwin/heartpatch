import {
  GAME_DATA,
  JOB_RULES,
  workSource,
  type PublicTile,
  type PublicUser,
} from '@heartpatch/shared';
import type { TileActions } from '../../map/map-screen.js';
import { el } from '../../ui/dom.js';
import { createGathererBadges, type GathererBadges } from './gatherer-badges.js';
import { createJobBoard, type JobBoard, type JobBoardDebug } from './job-board.js';
import type { JobsApi } from './jobs-api.js';
import { JOBS_TEXT } from './jobs-view.js';
import { createTeamPicker, type TeamPicker, type TeamPickerDebug } from './team-picker.js';

// Squishy jobs on the client (owner decisions 2026-10-04): the job board and
// the team picker, as self-contained sheets. The trays (ui-trays-recipes)
// open them with `openJobBoard(mapId)` / `openTeamPicker(mapId)`. Until then,
// two temporary entry points: the tile panel's "Send a gatherer" line
// (`tileActions`) and a "Team" button by the battle entry (`mountTeamButton`).

export interface JobsOptions {
  root: HTMLElement;
  api?: JobsApi;
  /** The Tutorial Glade keeps its own flow: no job entry points there. */
  isGlade?: (mapId: string) => boolean;
  /** Collected work changed the bag. */
  onChanged?: (mapId: string) => void;
}

export interface JobsDebug {
  readonly board: JobBoardDebug;
  readonly team: TeamPickerDebug;
  /** Gatherer badges on screen over the map. */
  readonly badges: number;
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
   * Temporary: puts a "Team" button in `box` (the battle entry), opening the
   * picker for the map `mapNow` names. The trays move it later.
   */
  mountTeamButton: (box: Element | null, mapNow: () => string | null) => void;
  /** The map layer that puts a 🧺 over tiles with a gatherer (pass it to the map screen). */
  readonly badges: GathererBadges;
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
  const board: JobBoard = createJobBoard({
    root: options.root,
    ...(options.api ? { api: options.api } : {}),
    ...(options.onChanged ? { onChanged: options.onChanged } : {}),
  });
  const picker: TeamPicker = createTeamPicker({
    root: options.root,
    ...(options.api ? { api: options.api } : {}),
  });
  const badges = createGathererBadges(options.root);
  let userId: string | null = null;
  const glade = (mapId: string) => options.isGlade?.(mapId) ?? false;

  const jobs: Jobs = {
    openJobBoard: (mapId, spot) => {
      picker.close();
      return board.open(mapId, spot);
    },
    openTeamPicker: (mapId) => {
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
      // Not on the Tutorial Glade: shown again whenever the battle entry is.
      const refresh = () => {
        const id = mapNow();
        row.hidden = id === null || glade(id);
      };
      new MutationObserver(refresh).observe(box, { attributes: true, attributeFilter: ['hidden'] });
      refresh();
    },
    badges,
    get isOpen() {
      return board.isOpen || picker.isOpen;
    },
    get debug() {
      return { board: board.debug, team: picker.debug, badges: badges.shown };
    },
  };
  installed = jobs;
  return jobs;
}
