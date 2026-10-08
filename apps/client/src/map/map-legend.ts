import type { MapMember } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { BORDER, PLAYER_COLORS, type BorderLine, type KeeperIcon } from './map-config.js';

// The map's legend (#278): whose land is whose. The map's name pill shows
// each Keeper's icon; tapping it opens a card with every Keeper's colour,
// icon and line, so colour is never the only way to tell (design: owner
// decision 2026-10-08, direction D). It sits under the name and closes on
// any tap, so it never covers the chips below for long.

/** One Keeper in the legend, as the map draws their land. */
export interface LegendEntry {
  readonly slot: number;
  readonly name: string;
  readonly mine: boolean;
  readonly color: string;
  readonly icon: KeeperIcon;
  readonly line: BorderLine;
}

/** Every Keeper with a home on the map, in home-slot order (their colour's order). */
export function legendEntries(members: readonly MapMember[], userId: string | null): LegendEntry[] {
  return members
    .flatMap((m) => {
      const slot = m.homeSlot;
      if (slot === null) return [];
      return [
        {
          slot,
          name: m.user.username,
          mine: m.user.id === userId,
          color: PLAYER_COLORS[slot % PLAYER_COLORS.length] ?? '#ffffff',
          icon: BORDER.icons[slot % BORDER.icons.length] ?? 'heart',
          line: BORDER.lines[slot % BORDER.lines.length] ?? 'solid',
        },
      ];
    })
    .sort((a, b) => a.slot - b.slot);
}

/** What a legend row says (style guide: short and kid-readable). */
export function legendLabel(entry: LegendEntry): string {
  return entry.mine ? 'Your land' : `${entry.name}'s land`;
}

const SVG = 'http://www.w3.org/2000/svg';

/** Icon paths on a 24 × 24 grid, the same shapes as the badges on the land. */
const ICON_PATHS: Readonly<Record<KeeperIcon, string>> = {
  heart:
    'M12 21s-7.5-4.6-9.6-9C.9 8.6 3 5 6.6 5c2.1 0 3.5 1.2 5.4 3.2C13.9 6.2 15.3 5 17.4 5 21 5 23.1 8.6 21.6 12c-2.1 4.4-9.6 9-9.6 9z',
  star: 'M12 2.5l2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17.3 5.9 20.7l1.5-6.7L2.3 9.4l6.8-.7z',
  flower:
    'M12 2.5a3.5 3.5 0 013.3 4.6 3.5 3.5 0 014.3 5.2 3.5 3.5 0 01-2.6 6 3.5 3.5 0 01-5 2.2 3.5 3.5 0 01-5-2.2 3.5 3.5 0 01-2.6-6A3.5 3.5 0 018.7 7.1 3.5 3.5 0 0112 2.5z',
  diamond: 'M12 2l8 10-8 10-8-10z',
};

/** Each line's look as a short stroke: dashes, dots, or two thin lines. */
const LINE_STROKES: Readonly<
  Record<BorderLine, readonly { y: number; width: number; dash?: string }[]>
> = {
  solid: [{ y: 5, width: 5 }],
  dash: [{ y: 5, width: 5, dash: '5 8' }],
  dot: [{ y: 5, width: 5, dash: '0.1 7' }],
  double: [
    { y: 2.5, width: 2.5 },
    { y: 7.5, width: 2.5 },
  ],
};

function icon(entry: LegendEntry, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICON_PATHS[entry.icon]);
  path.setAttribute('fill', entry.color);
  svg.append(path);
  return svg;
}

function lineSample(entry: LegendEntry): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 36 10');
  svg.setAttribute('width', '36');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  for (const stroke of LINE_STROKES[entry.line]) {
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', '3');
    line.setAttribute('x2', '33');
    line.setAttribute('y1', String(stroke.y));
    line.setAttribute('y2', String(stroke.y));
    line.setAttribute('stroke', entry.color);
    line.setAttribute('stroke-width', String(stroke.width));
    line.setAttribute('stroke-linecap', 'round');
    if (stroke.dash) line.setAttribute('stroke-dasharray', stroke.dash);
    svg.append(line);
  }
  return svg;
}

export interface MapLegend {
  /** The Keepers' icons, for the name pill (decorative). */
  readonly icons: HTMLElement;
  /** The card that opens under the name. */
  readonly card: HTMLElement;
  /** Draws the legend for the map's members now. */
  show: (members: readonly MapMember[], userId: string | null) => void;
  toggle: () => void;
  close: () => void;
  readonly open: boolean;
}

export function mountMapLegend(): MapLegend {
  const icons = el('span', { class: 'map-legend-icons', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'map-legend-list' });
  const card = el(
    'div',
    { class: 'map-legend', id: 'map-legend', 'data-testid': 'map-legend' },
    el('p', { class: 'map-legend-title' }, 'Whose land?'),
    list,
  );
  card.hidden = true;
  let shown = '';

  return {
    icons,
    card,
    show: (members, userId) => {
      const entries = legendEntries(members, userId);
      const key = JSON.stringify(entries);
      if (key === shown) return;
      shown = key;
      icons.replaceChildren(...entries.map((e) => icon(e, 14)));
      list.replaceChildren(
        ...entries.map((e) =>
          el(
            'li',
            { class: `map-legend-row${e.mine ? ' map-legend-mine' : ''}` },
            icon(e, 20),
            el('span', { class: 'map-legend-name' }, legendLabel(e)),
            lineSample(e),
          ),
        ),
      );
    },
    toggle: () => {
      card.hidden = !card.hidden;
    },
    close: () => {
      card.hidden = true;
    },
    get open() {
      return !card.hidden;
    },
  };
}
