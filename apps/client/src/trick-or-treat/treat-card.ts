import { el } from '../ui/dom.js';
import { rarityChip } from '../ui/rarity/rarity.js';
import { CARD_TEXT, type CardModel } from './door-view.js';
import './treat-card.css';

// The prize card after the door opens (#515 part C, the approved screens):
// one card, three kinds of treat. Heartdust gets a big heart; a costume gets
// the real 3D Keeper or Partner wearing it, with "Wear it!" / "Dress up!" as a
// shortcut (the Wardrobe has it either way). A lantern home adds a line so the
// kid sees why it was a good one.

const SPARKLES = ['✨', '✨', '✨', '✨', '✨', '✨'];

function heart(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 100 90');
  svg.setAttribute('class', 'treat-heart');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><linearGradient id="treat-heart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9fc4"/><stop offset="1" stop-color="#e8467f"/></linearGradient></defs>
    <path d="M50 84 C12 56 2 34 10 20 C18 6 40 6 50 24 C60 6 82 6 90 20 C98 34 88 56 50 84 Z" fill="url(#treat-heart-fill)"/>
    <ellipse cx="30" cy="27" rx="12" ry="7" transform="rotate(-28 30 27)" fill="#fff" opacity="0.4"/>
    <circle cx="58" cy="46" r="3.4" fill="#fff" opacity="0.45"/><circle cx="46" cy="58" r="2.4" fill="#fff" opacity="0.45"/><circle cx="68" cy="34" r="2" fill="#fff" opacity="0.45"/>`;
  return svg;
}

export interface TreatCardShow {
  model: CardModel;
  /** The costume's picture (the Keeper or the Partner wearing it); unused for Heartdust. */
  picture: Promise<string | null>;
  /** "Wear it!": put a Keeper costume on (the Wardrobe sends it). */
  onWear: (itemId: string) => void;
  /** "Dress up!": open the squishy picker. */
  onDressUp: () => void;
  onClose: () => void;
}

export interface TreatCardView {
  show: (options: TreatCardShow) => void;
  hide: () => void;
  readonly debug: { readonly showing: CardModel | null; readonly worn: boolean };
}

export interface TreatCardOptions {
  root: HTMLElement;
  /** A card came or went (so the next sheet in line can take its turn). */
  onChange?: () => void;
}

export function createTreatCard(options: TreatCardOptions): TreatCardView {
  const kicker = el('p', { class: 'treat-kicker' }, CARD_TEXT.kicker);
  const sparkles = el(
    'div',
    { class: 'treat-sparkles', 'aria-hidden': 'true' },
    ...SPARKLES.map((s) => el('span', {}, s)),
  );
  const art = el('div', { class: 'treat-art' }, sparkles);
  const title = el('h2', { class: 'treat-title', 'data-testid': 'treat-title' });
  const chip = el('div', { class: 'treat-chip' });
  const lantern = el(
    'p',
    { class: 'treat-lantern', 'data-testid': 'treat-lantern' },
    CARD_TEXT.lantern,
  );
  const detail = el('p', { class: 'treat-detail', 'data-testid': 'treat-detail' });
  const primary = el('button', {
    type: 'button',
    class: 'hp-button hp-button-primary',
    'data-testid': 'treat-primary',
  });
  const later = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-secondary', 'data-testid': 'treat-later' },
    CARD_TEXT.later,
  );
  const buttons = el('div', { class: 'treat-buttons' }, primary, later);
  const card = el(
    'section',
    {
      class: 'treat-card',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': CARD_TEXT.kicker,
      'data-testid': 'treat-card',
    },
    kicker,
    art,
    title,
    chip,
    lantern,
    detail,
    buttons,
  );
  const backdrop = el('div', { class: 'treat-backdrop' }, card);
  backdrop.hidden = true;
  options.root.append(backdrop);

  let showing: CardModel | null = null;
  let handlers: Pick<TreatCardShow, 'onWear' | 'onDressUp' | 'onClose'> | null = null;
  let worn = false;
  /** Bumped by every show and hide, so a late picture can't land on the next card. */
  let generation = 0;

  primary.addEventListener('click', () => {
    if (!showing || !handlers) return;
    if (showing.kind === 'keeper-costume' && !worn) {
      worn = true;
      handlers.onWear(showing.itemId);
      detail.textContent = CARD_TEXT.wearing;
      primary.hidden = true;
      later.textContent = CARD_TEXT.yay;
      return;
    }
    if (showing.kind === 'squishy-costume') {
      const done = handlers;
      hide();
      done.onDressUp();
      done.onClose();
      return;
    }
    // Heartdust's "Yay!".
    const done = handlers;
    hide();
    done.onClose();
  });
  later.addEventListener('click', () => {
    const done = handlers;
    hide();
    done?.onClose();
  });

  function hide(): void {
    generation += 1;
    showing = null;
    handlers = null;
    backdrop.hidden = true;
    options.onChange?.();
  }

  return {
    show: ({ model, picture, onWear, onDressUp, onClose }) => {
      generation += 1;
      const mine = generation;
      showing = model;
      handlers = { onWear, onDressUp, onClose };
      worn = false;
      art.replaceChildren(sparkles);
      art.dataset['kind'] = model.kind;
      title.textContent = model.title;
      lantern.hidden = !model.lantern;
      detail.textContent = model.detail;
      primary.hidden = false;
      chip.replaceChildren();
      if (model.kind === 'heartdust') {
        art.prepend(heart());
        primary.textContent = CARD_TEXT.yay;
        later.hidden = true;
      } else {
        const stand = el('span', { class: 'treat-stand', 'aria-hidden': 'true' }, '🎃');
        art.prepend(stand);
        void picture.then((url) => {
          if (mine !== generation || !url) return;
          const img = el('img', { class: 'treat-picture', alt: '', src: url });
          stand.replaceWith(img);
        });
        chip.append(rarityChip(model.rarity));
        chip.lastElementChild?.append(' costume');
        primary.textContent = model.kind === 'keeper-costume' ? CARD_TEXT.wear : CARD_TEXT.dressUp;
        later.hidden = false;
        later.textContent = CARD_TEXT.later;
      }
      backdrop.hidden = false;
      // The sparkles start over for each card.
      sparkles.classList.remove('treat-sparkles-on');
      sparkles.getBoundingClientRect();
      sparkles.classList.add('treat-sparkles-on');
      options.onChange?.();
      primary.focus({ preventScroll: true });
    },
    hide,
    get debug() {
      return { showing, worn };
    },
  };
}
