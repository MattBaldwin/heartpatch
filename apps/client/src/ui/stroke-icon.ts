const SVG = 'http://www.w3.org/2000/svg';

/** The ✕ every close button draws: the shared button's and a tray's (one path, one place). */
export const CLOSE_ICON_PATH = 'M6 6l12 12 M18 6L6 18';

/** A 24px stroke icon (the look is `.tray-icon` in `trays/trays.css`). */
export function strokeIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tray-icon');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}
