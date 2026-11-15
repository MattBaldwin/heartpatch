import { el } from '../ui/dom.js';
import { COMPUTER_TEXT } from './computer-mates-model.js';
import './computer-mates.css';

/*
 * The Computer friend look (#386b, mockup variant A, owner-approved): a plum
 * rounded square with a wind-up key, plus the words "Computer friend". Three
 * cues, never colour alone (#146). Real kids keep their round pink dot or
 * lavender circle. Every screen that shows a mate draws it from here, so no
 * screen can forget the badge.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** The wind-up key: two loops and a stem with two teeth (line art, 24 px box). */
export function keyIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('cf-key');
  for (const cx of ['6.5', '17.5']) {
    const loop = document.createElementNS(SVG, 'ellipse');
    loop.setAttribute('cx', cx);
    loop.setAttribute('cy', '6.5');
    loop.setAttribute('rx', '4.5');
    loop.setAttribute('ry', '4');
    loop.setAttribute('fill', 'currentColor');
    loop.setAttribute('fill-opacity', '.25');
    svg.append(loop);
  }
  const stem = document.createElementNS(SVG, 'path');
  stem.setAttribute('d', 'M12 6.5v15.5M12 15h4.5M12 19h3');
  svg.append(stem);
  return svg;
}

/** The plum "Computer friend" pill with the key (mockup `.cf`). */
export function computerBadge(many = false): HTMLElement {
  return el(
    'span',
    { class: 'cf-badge', 'data-testid': 'computer-badge' },
    keyIcon(),
    many ? COMPUTER_TEXT.badgeMany : COMPUTER_TEXT.badge,
  );
}

/**
 * The mate's picture: `dot` is the 20 px slot-icon size for list rows
 * (mockup `.si.pc`), `avatar` the 44 px circle's size (mockup `.av.pc`).
 */
export function computerAvatar(size: 'dot' | 'avatar'): HTMLElement {
  return el(
    'span',
    { class: `cf-${size}`, 'aria-hidden': 'true', 'data-testid': 'computer-avatar' },
    keyIcon(),
  );
}
