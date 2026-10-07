import { hexKey, type Hex, type PublicTile } from '@heartpatch/shared';
import type { TileActions } from '../map/map-screen.js';
import { el, messageOf } from '../ui/dom.js';
import { WildHints, WILD_TEXT } from './wild-pick.js';

// "Meet it" in the tile panel (#209): on a tile with a rustling tuft, the
// panel says "Something's rustling here!" and offers to meet whoever it is.
// The battle starts through the battle screen's one wild path (`meet`); the
// server checks the tile is in reach (CLAUDE.md rule 1).

export interface WildPickerOptions {
  /** Starts the wild battle on `tile` of map `mapId`; rejects with what went wrong. */
  meet: (mapId: string, tile: Hex) => Promise<void>;
}

export interface WildPicker {
  /** The tile panel's slot: the rustling line and Meet it. */
  readonly tileActions: TileActions;
  /** The server's hints for a map (tiles only, no species); the open panel follows. */
  setHints: (mapId: string | null, tiles: readonly Hex[]) => void;
}

export function createWildPicker(options: WildPickerOptions): WildPicker {
  const hints = new WildHints();
  let panel: { container: HTMLElement; tile: PublicTile; mapId: string } | null = null;
  /** What went wrong with the last Meet it on the tile shown, until another tile shows. */
  let problem: string | null = null;
  let working = false;

  const render = (): void => {
    if (!panel) return;
    const { container, tile, mapId } = panel;
    if (!hints.has(mapId, tile)) {
      container.replaceChildren(...(problem ? [note(problem)] : []));
      return;
    }
    const meet = el(
      'button',
      { type: 'button', class: 'auth-button bag-action', 'data-testid': 'tile-meet-wild' },
      WILD_TEXT.meet,
    );
    meet.disabled = working;
    meet.addEventListener('click', () => {
      const shown = panel;
      if (!shown || working) return;
      working = true;
      problem = null;
      render();
      options
        .meet(shown.mapId, { q: shown.tile.q, r: shown.tile.r })
        .catch((err: unknown) => {
          if (panel && hexKey(panel.tile) === hexKey(shown.tile)) problem = messageOf(err);
        })
        .finally(() => {
          working = false;
          render();
        });
    });
    container.replaceChildren(
      el('p', { class: 'wild-rustle', 'data-testid': 'tile-wild-rustle' }, WILD_TEXT.rustling),
      ...(problem ? [note(problem)] : []),
      meet,
    );
  };

  return {
    tileActions: {
      show: (container, tile, view) => {
        if (!panel || hexKey(panel.tile) !== hexKey(tile)) problem = null;
        panel = { container, tile, mapId: view.map.id };
        render();
      },
      hide: () => {
        panel = null;
        problem = null;
      },
    },
    setHints: (mapId, tiles) => {
      hints.set(mapId, tiles);
      render();
    },
  };
}

const note = (text: string) => el('p', { class: 'tile-action-note wild-problem' }, text);
