import { hexKey } from '@heartpatch/shared';
import { el, messageOf } from '../ui/dom.js';
import type { TileActions } from './map-screen.js';
import type { BossStore } from './boss-store.js';
import { BOSS_TEXT, cardModel, markerModel } from './boss-view.js';

/*
 * The tile card for the boss's tile (#190, 190f): "A BIG squishy! Bring your
 * whole team?", the tries chip and "Let's go!". The fight starts through the
 * server (`fight`), which checks everything (CLAUDE.md rule 1): the card only
 * offers it. Any other tile shows nothing.
 */

export interface BossPickerOptions {
  readonly store: BossStore;
  /** Starts (or resumes) the fight on `mapId`; rejects with what went wrong. */
  readonly fight: (mapId: string) => Promise<void>;
  readonly now?: () => Date;
}

export interface BossPicker extends TileActions {
  redraw: () => void;
  /** True when the boss's marker stands on this tile right now (its card owns the tile). */
  claims: (tile: { q: number; r: number }) => boolean;
}

/**
 * `other`'s actions everywhere except the boss's tile, where the boss card is
 * the one state: "Let's go!" or its own refusal, never also "Too far away!"
 * from the land rules. The server doesn't forbid claiming the tile, so this is
 * a product call (one state per tile): claiming it waits until the visit ends.
 */
export function exceptBossTile(
  picker: Pick<BossPicker, 'claims'>,
  other: TileActions,
): TileActions {
  return {
    show: (container, tile, view) => {
      if (picker.claims(tile)) {
        other.hide();
        container.replaceChildren();
        return;
      }
      other.show(container, tile, view);
    },
    hide: () => {
      other.hide();
    },
  };
}

/**
 * The info panel's lines for the boss's tile: just the land's name and kind.
 * The wild guards and the gatherer line are about ordinary wild land, and the
 * boss card says the rest.
 */
export function bossTileInfo<T extends { guardians: string | null; gatherer: string | null }>(
  picker: Pick<BossPicker, 'claims'>,
  info: T,
  tile: { q: number; r: number },
): T {
  return picker.claims(tile) ? { ...info, guardians: null, gatherer: null } : info;
}

export function createBossPicker(options: BossPickerOptions): BossPicker {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  let panel: { container: HTMLElement; q: number; r: number } | null = null;
  let problem: string | null = null;
  let working = false;

  const render = (): void => {
    if (!panel) return;
    const { container, q, r } = panel;
    const visit = store.visit;
    const marker = markerModel(visit, now(), store.nameOf);
    if (!visit || !marker || hexKey(marker) !== hexKey({ q, r })) {
      container.replaceChildren();
      return;
    }
    const card = cardModel(visit, marker);
    const children: HTMLElement[] = [
      el('p', { class: 'boss-card-title' }, card.title),
      el('p', { class: 'boss-card-body' }, card.body),
    ];
    if (card.chip)
      children.push(el('span', { class: 'boss-chip', 'data-testid': 'boss-tries' }, card.chip));
    if (problem) children.push(el('p', { class: 'boss-card-body', role: 'status' }, problem));
    if (card.canFight) {
      const go = el(
        'button',
        { type: 'button', class: 'hp-button hp-button-primary', 'data-testid': 'boss-fight' },
        BOSS_TEXT.go,
      );
      go.disabled = working;
      go.addEventListener('click', () => {
        const id = store.mapId;
        if (!id || working) return;
        working = true;
        problem = null;
        render();
        options
          .fight(id)
          .catch((err: unknown) => {
            problem = messageOf(err);
          })
          .finally(() => {
            working = false;
            void store.refresh();
            render();
          });
      });
      children.push(go);
    }
    container.replaceChildren(
      el('div', { class: 'boss-card', 'data-testid': 'boss-card' }, ...children),
    );
  };

  return {
    claims: (tile) => {
      const marker = markerModel(store.visit, now(), store.nameOf);
      return marker !== null && hexKey(marker) === hexKey(tile);
    },
    show: (container, tile) => {
      if (!panel || panel.q !== tile.q || panel.r !== tile.r) problem = null;
      panel = { container, q: tile.q, r: tile.r };
      render();
    },
    hide: () => {
      panel = null;
      problem = null;
    },
    redraw: render,
  };
}
