import type { Scene } from '@babylonjs/core/scene';
import { hexKey, type MapView } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { markerModel, BOSS_TEXT, type BossMarkerModel } from './boss-view.js';
import type { BossStore } from './boss-store.js';
import type { MapLayer, MapLayerHost } from './map-screen.js';
import { tileScreenRectOf } from './map-scene.js';
import './boss.css';

/*
 * The mini-boss's marker (#190, 190f): a giant wobbling blob with its name
 * and "here until Sunday", over the tile it stands on. A DOM overlay placed
 * with the map's one tile projection after every drawn frame (as the trading
 * post flags are), so it costs nothing between frames and shows on any zoom.
 * Until this Keeper has met the species it is a "?!" and "A BIG squishy";
 * the server's reply never names it before (CLAUDE.md rule 6). Taps pass
 * through to the tile, whose card (boss-picker.ts) is the way in.
 */

export interface BossMarkerLayer extends MapLayer {
  /** The marker now (the dev hook and e2e): null when none shows. */
  readonly shown: {
    readonly name: string;
    readonly known: boolean;
    readonly until: string;
    readonly x: number;
    readonly y: number;
  } | null;
}

/** The blob's size on screen from its tile's width: big, but never filling the screen. */
export function markerSize(tileWidth: number): number {
  return Math.round(Math.min(120, Math.max(44, tileWidth * 1.3)));
}

export function createBossMarker(
  root: HTMLElement,
  store: BossStore,
  now = () => new Date(),
): BossMarkerLayer {
  let scene: Scene | null = null;
  let host: MapLayerHost | undefined;
  let view: MapView | null = null;
  let model: BossMarkerModel | null = null;
  let last = '';
  let centre: { x: number; y: number } | null = null;

  const bang = el('span', { class: 'boss-bang', 'aria-hidden': 'true' }, '?!');
  const name = el('span', { class: 'boss-name' });
  const until = el('span', { class: 'boss-until' });
  const node = el(
    'div',
    { class: 'boss-marker', 'aria-hidden': 'true', 'data-testid': 'boss-marker' },
    el('span', { class: 'boss-glow' }),
    el(
      'span',
      { class: 'boss-body' },
      el('i', { class: 'boss-eye boss-eye-l' }),
      el('i', { class: 'boss-eye boss-eye-r' }),
      el('i', { class: 'boss-mouth' }),
      bang,
    ),
    el('span', { class: 'boss-label' }, name, until),
  );
  node.hidden = true;
  root.append(node);

  const refresh = (): void => {
    model = markerModel(store.visit, now(), store.nameOf);
    // Only a boss on a tile this map has gets drawn (a stale reply draws nothing).
    if (model && view && !view.tiles.some((t) => hexKey(t) === hexKey(model as BossMarkerModel))) {
      model = null;
    }
    bang.hidden = model?.known ?? true;
    name.textContent = model?.name ?? BOSS_TEXT.unknownName;
    until.textContent = model?.until.text ?? '';
    last = '';
    place();
    host?.invalidate();
  };

  const place = (): void => {
    const tile =
      model && view ? view.tiles.find((t) => hexKey(t) === hexKey(model as BossMarkerModel)) : null;
    const rect = scene && tile ? tileScreenRectOf(scene, tile) : null;
    if (!rect) {
      centre = null;
      if (!node.hidden) node.hidden = true;
      last = '';
      return;
    }
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const size = markerSize(rect.width);
    const at = `${String(x)},${String(y)},${String(size)}`;
    centre = { x, y };
    if (at === last) return;
    last = at;
    node.hidden = false;
    node.style.setProperty('--boss-size', `${String(size)}px`);
    node.style.transform = `translate(${String(x)}px, ${String(y)}px) translate(-50%, -${String(Math.round(size * 0.55))}px)`;
  };

  let unsubscribe: (() => void) | null = null;
  return {
    attach: (next, nextView, nextHost) => {
      scene = next;
      view = nextView;
      host = nextHost;
      unsubscribe?.();
      unsubscribe = store.onChange(refresh);
      // The map on screen is the boss's map: ask whenever one is built (open, reopen, GPU rebuild).
      void store.setMap(nextView.map.id);
      next.onAfterRenderObservable.add(place);
      next.onDisposeObservable.addOnce(() => {
        if (scene !== next) return;
        scene = null;
        centre = null;
        node.hidden = true;
        unsubscribe?.();
        unsubscribe = null;
        void store.setMap(null);
      });
      refresh();
    },
    update: (nextView) => {
      view = nextView;
      refresh();
    },
    get shown() {
      return model && centre && !node.hidden
        ? {
            name: model.name,
            known: model.known,
            until: model.until.text,
            x: centre.x,
            y: centre.y,
          }
        : null;
    },
  };
}
