import { hexToWorld, type Hex, type MapView, type WeatherFront } from '@heartpatch/shared';
import { FALLBACK_LOOK, HEX_SIZE, TERRAIN_LOOKS } from '../map/map-config.js';
import { frontPosition } from './weather-layout.js';
import { WEATHER_EMOJI } from './weather-model.js';

const NS = 'http://www.w3.org/2000/svg';
const SQRT3 = Math.sqrt(3);
const SEA = '#bfe3f7'; // TUNE
/** What a front is called on the little map, with its weather emoji. */
const KIND_NAME: Readonly<Record<string, string>> = {
  rain: 'Rain',
  storm: 'Storm',
  fog: 'Fog',
  drought: 'Dry',
};
/** Label size, in the map's own units (a tile is `HEX_SIZE` across). // TUNE */
const LABEL = 0.85;
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

/** A pointy-top hex's six corners around a centre (x right, y down, like the sheet). */
function hexPoints(cx: number, cy: number, size: number): string {
  return [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const a = (Math.PI / 180) * (60 * k + 30);
      return `${(cx + size * Math.cos(a)).toFixed(3)},${(cy + size * Math.sin(a)).toFixed(3)}`;
    })
    .join(' ');
}

/**
 * A tiny map of today's fronts over the island: the real tiles in their own
 * colours on the sea, each front a soft-edged cloud (where it is now, strong;
 * not yet over the island, faint), the way it is heading (a dashed line), and
 * my home (a heart-pink dot). Drawn from the same fronts the layer uses, so
 * the two always agree.
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
  const box = reach * 1.15;
  const root = svg('svg', {
    viewBox: `${-box} ${-box} ${box * 2} ${box * 2}`,
    class: 'weather-map',
    role: 'img',
    'aria-label': 'A map of the island with the weather over it',
    'data-testid': 'weather-map',
  });
  // A soft edge for each kind of front: opaque in the middle, gone at the rim.
  const defs = svg('defs', {});
  for (const [kind, fill] of Object.entries(KIND_FILL)) {
    const grad = svg('radialGradient', { id: `weather-map-${kind}` });
    grad.append(
      svg('stop', { offset: '0%', 'stop-color': fill, 'stop-opacity': 0.9 }),
      svg('stop', { offset: '65%', 'stop-color': fill, 'stop-opacity': 0.6 }),
      svg('stop', { offset: '100%', 'stop-color': fill, 'stop-opacity': 0 }),
    );
    defs.append(grad);
  }
  root.append(
    defs,
    svg('rect', { x: -box, y: -box, width: box * 2, height: box * 2, rx: box * 0.18, fill: SEA }),
  );
  for (const t of view.tiles) {
    const p = hexToWorld(t, HEX_SIZE);
    const look = TERRAIN_LOOKS[t.terrain] ?? FALLBACK_LOOK;
    root.append(
      svg('polygon', {
        points: hexPoints(p.x, -p.z, HEX_SIZE),
        fill: look.color,
        class: 'weather-map-tile',
      }),
    );
  }
  for (const f of fronts) {
    const a = hexToWorld(f.from, HEX_SIZE);
    const b = hexToWorld(f.to, HEX_SIZE);
    const at = frontPosition(f, nowMs);
    const centre = at ?? a;
    const r = (f.radius + 0.5) * SQRT3 * HEX_SIZE;
    root.append(
      svg('line', { x1: a.x, y1: -a.z, x2: b.x, y2: -b.z, class: 'weather-map-path' }),
      svg('circle', {
        cx: centre.x,
        cy: -centre.z,
        r,
        fill: `url(#weather-map-${f.kind in KIND_FILL ? f.kind : 'rain'})`,
        'fill-opacity': at ? 1 : 0.3,
        class: 'weather-map-front',
        'data-kind': f.kind,
        'data-active': at ? 'true' : 'false',
      }),
    );
  }
  // Each front says what it is, over its middle, so no front is an unlabeled smudge.
  for (const f of fronts) {
    const at = frontPosition(f, nowMs);
    const centre = at ?? hexToWorld(f.from, HEX_SIZE);
    const label = svg('text', {
      x: centre.x,
      y: -centre.z + LABEL * 0.35,
      class: 'weather-map-label',
      'font-size': LABEL,
      'text-anchor': 'middle',
      'fill-opacity': at ? 1 : 0.55,
    });
    label.textContent = `${WEATHER_EMOJI[f.kind]} ${KIND_NAME[f.kind] ?? f.kind}`;
    root.append(label);
  }
  if (home) {
    const p = hexToWorld(home, HEX_SIZE);
    root.append(svg('circle', { cx: p.x, cy: -p.z, r: HEX_SIZE * 0.5, class: 'weather-map-home' }));
  }
  return root;
}
