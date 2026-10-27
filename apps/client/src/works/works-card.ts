import { el } from '../ui/dom.js';
import type { BuildingPortraitLook, BuildingPortraits } from '../procedural/portraits.js';
import type { WorksCard } from './works-card-model.js';
import '../resource-buildings/resource-buildings.css';
import './works-card.css';

// The works tile card's lines (#621 W1-10c): the building's own rendered
// picture beside what it does, its storage meter, the weather chip and the
// need line. The home screen's standing card around it adds Collect,
// Upkeep, Upgrade and Take down, as for a resource building.

/**
 * The building's picture, asked for once (the portraits cache it by look).
 * Until it's drawn, or with no engine, the box stays an empty soft square.
 */
export function worksPortrait(
  portraits: BuildingPortraits | undefined,
  look: BuildingPortraitLook,
): HTMLElement {
  const box = el('span', {
    class: 'works-portrait',
    'data-testid': 'tile-works-portrait',
    'aria-hidden': 'true',
  });
  box.style.width = `${String(look.size)}px`;
  box.style.height = `${String(look.size)}px`;
  void askPortrait(portraits, look, (url) => {
    box.replaceChildren(el('img', { class: 'works-portrait-img', alt: '', src: url }));
  });
  return box;
}

/** Asks the shared portraits for the building's picture, and shows it once there is one. */
export function askPortrait(
  portraits: BuildingPortraits | undefined,
  look: BuildingPortraitLook,
  show: (url: string) => void,
): Promise<void> {
  return (portraits?.building(look) ?? Promise.resolve(null)).then((url) => {
    if (url !== null) show(url);
  });
}

/** A works card's lines (`worksCard`) beside its picture. */
export function worksCardLines(card: WorksCard, portrait: HTMLElement): Node[] {
  const fill = el('span', { class: 'resource-meter-fill' });
  fill.style.width = `${String(card.percent)}%`;
  const asleep = card.state === 'paused' || card.state === 'napping';
  const meter = el(
    'div',
    {
      class: `resource-meter${asleep || card.state === 'short' ? ' resource-meter-paused' : ''}${card.state === 'full' ? ' resource-meter-full' : ''}`,
      'data-testid': 'tile-works-meter',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': String(card.max ?? card.stored),
      'aria-valuenow': String(card.stored),
      'aria-label': card.meter,
    },
    el('span', { class: 'resource-meter-bar', 'aria-hidden': 'true' }, fill),
    el('span', { class: 'resource-meter-text' }, card.meter),
  );
  const line =
    card.state === 'short'
      ? el('p', { class: 'works-need', 'data-testid': 'tile-works-need' }, card.line)
      : el(
          'p',
          {
            class: `home-card-note works-line${asleep ? ' resource-line-asleep' : ''}${card.state === 'full' ? ' resource-line-full' : ''}`,
            'data-testid': 'tile-works-note',
            'data-state': card.state,
          },
          card.line,
        );
  return [
    el('div', { class: 'works-top' }, portrait, line),
    meter,
    ...(card.chip
      ? [
          el(
            'p',
            {
              class: `works-weather works-weather-${card.chip.tone}`,
              'data-testid': 'tile-works-weather',
            },
            card.chip.text,
          ),
        ]
      : []),
    el(
      'p',
      { class: 'resource-facts' },
      ...(card.next ? [el('span', { 'data-testid': 'tile-works-next' }, card.next)] : []),
      el('span', { 'data-testid': 'tile-works-upkeep' }, card.upkeep),
    ),
  ];
}

/** A canal, shelter or vane's lines: its picture beside its description. */
export function worksPlainLines(description: string, portrait: HTMLElement): Node[] {
  return [
    el(
      'div',
      { class: 'works-top' },
      portrait,
      el(
        'p',
        { class: 'home-card-note works-line', 'data-testid': 'tile-works-note' },
        description,
      ),
    ),
  ];
}
