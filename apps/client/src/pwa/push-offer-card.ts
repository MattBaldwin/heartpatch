import { hpButton } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { PUSH_OFFER_TEXT, type ReadyOffer } from './push-offer.js';
import './pwa.css';

// The nudge offer's card (#726): one card over the map, in its turn (#129).
// `push-offer.ts` decides when; this only draws it and hands the taps over.

export interface PushOfferCard {
  show: (offer: ReadyOffer) => void;
  hide: () => void;
  readonly isOpen: boolean;
}

export function createPushOfferCard(root: HTMLElement, onChange: () => void): PushOfferCard {
  const yes = hpButton(PUSH_OFFER_TEXT.yes, { variant: 'primary' });
  const no = hpButton(PUSH_OFFER_TEXT.no, { variant: 'quiet' });
  yes.dataset['testid'] = 'push-offer-yes';
  no.dataset['testid'] = 'push-offer-no';
  const card = el(
    'section',
    {
      class: 'push-offer',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'push-offer-title',
      'data-testid': 'push-offer',
    },
    el('h2', { class: 'push-offer-title', id: 'push-offer-title' }, PUSH_OFFER_TEXT.title),
    el('p', { class: 'push-offer-line' }, PUSH_OFFER_TEXT.line),
    el('div', { class: 'push-offer-buttons' }, yes, no),
  );
  card.hidden = true;
  root.append(card);
  let offer: ReadyOffer | null = null;

  yes.addEventListener('click', () => {
    // The tap rule: `yes()` subscribes first thing, with no await before it.
    void offer?.yes();
  });
  no.addEventListener('click', () => {
    offer?.no();
  });

  return {
    show: (next) => {
      offer = next;
      card.hidden = false;
      onChange();
    },
    hide: () => {
      offer = null;
      card.hidden = true;
      onChange();
    },
    get isOpen() {
      return !card.hidden;
    },
  };
}
