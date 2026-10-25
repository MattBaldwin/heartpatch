import { hexToWorld, type Hex, type MapView, type WeatherFront } from '@heartpatch/shared';
import { HEX_SIZE } from '../map/map-config.js';
import { frontPosition } from './weather-layout.js';

const NS = 'http://www.w3.org/2000/svg';
const SQRT3 = Math.sqrt(3);
const KIND_FILL: Readonly<Record<string, string>> = {
  rain: '#7f8fc9',
  storm: '#5a5190',
  fog: '#c9c6dc',
  drought: '#f2a65a',
};

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * A tiny map of today's fronts over the island: where each is now (a soft
 * disc), the way it is heading (a dashed line), and my home (a dot). Drawn
 * from the same fronts the layer uses, so the two always agree.
 */
export function islandMap(
  view: MapView,
  fronts: readonly WeatherFront[],
  home: Hex | null,
  nowMs: number,
): SVGSVGElement {
  let reach = HEX_SIZE;
  for (const t of view.tiles) {
    const p = hexToWorld(t, HEX_SIZE);
    reach = Math.max(reach, Math.hypot(p.x, p.z) + HEX_SIZE);
  }
  const box = reach * 1.3;
  const root = svg('svg', {
    viewBox: `${-box} ${-box} ${box * 2} ${box * 2}`,
    class: 'weather-map',
    role: 'img',
    'data-testid': 'weather-map',
  });
  root.append(svg('circle', { cx: 0, cy: 0, r: reach, class: 'weather-map-island' }));
  for (const f of fronts) {
    const a = hexToWorld(f.from, HEX_SIZE);
    const b = hexToWorld(f.to, HEX_SIZE);
    const at = frontPosition(f, nowMs);
    const fill = KIND_FILL[f.kind] ?? '#999999';
    root.append(
      svg('line', { x1: a.x, y1: -a.z, x2: b.x, y2: -b.z, class: 'weather-map-path' }),
      svg('circle', {
        cx: (at ?? a).x,
        cy: -(at ?? a).z,
        r: (f.radius + 0.5) * SQRT3 * HEX_SIZE,
        fill,
        'fill-opacity': at ? 0.55 : 0.2,
        class: 'weather-map-front',
        'data-kind': f.kind,
        'data-active': at ? 'true' : 'false',
      }),
    );
  }
  if (home) {
    const p = hexToWorld(home, HEX_SIZE);
    root.append(
      svg('circle', { cx: p.x, cy: -p.z, r: HEX_SIZE * 0.45, class: 'weather-map-home' }),
    );
  }
  return root;
}
