import type { ItemCounts } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import {
  BUILD_TEXT,
  buildStatus,
  detailLine,
  pickCard,
  type BuildCard,
  type BuildStatus,
} from './build-model.js';
import './build.css';

// The one Build sheet (#371). Home base, my land's fires and fences all draw
// it: a line saying what to tap on the 3D tile, one horizontal swipe row of
// building cards, the picked card's line, and Build!. Nothing in it scrolls
// up and down, so it never sits inside another scrolling box.

export interface BuildSheetProps {
  readonly cards: readonly BuildCard[];
  readonly selectedId: string | null;
  readonly bag: ItemCounts | null;
  /** How many spots or edges are picked on the 3D tile. */
  readonly areas: number;
  /** What to tap on the tile, in a line. */
  readonly hint: string;
  /** Edge cards: the "All edges" / "None" button; null for a single spot. */
  readonly allEdges: { readonly all: boolean } | null;
  readonly working: boolean;
  /** A line after a command, or why it failed. */
  readonly note: string;
  readonly onSelect: (id: string) => void;
  readonly onAllEdges: () => void;
  readonly onBuild: () => void;
  readonly onCancel: () => void;
  readonly onRecipeBook?: () => void;
}

export interface BuildSheet {
  readonly element: HTMLElement;
  /** Redraws; the row keeps its place so a tap on a card never jumps it. */
  update: (props: BuildSheetProps) => BuildStatus | null;
}

const button = (label: string, testId: string, soft: boolean, onTap: () => void) => {
  const b = el(
    'button',
    {
      type: 'button',
      class: `auth-button bag-action${soft ? ' auth-button-soft' : ''}`,
      'data-testid': testId,
    },
    label,
  );
  b.addEventListener('click', onTap);
  return b;
};

export function createBuildSheet(): BuildSheet {
  const row = el('ul', { class: 'build-row', 'data-testid': 'build-row' });
  const element = el('div', { class: 'build-sheet', 'data-testid': 'build-sheet' });

  return {
    element,
    update: (props) => {
      const selected = pickCard(props.cards, props.selectedId, props.bag);
      const status = selected ? buildStatus(selected, props.bag, props.areas) : null;

      const hint = el('div', { class: 'build-hint-row' });
      hint.append(el('p', { class: 'build-hint', 'data-testid': 'build-hint' }, props.hint));
      if (props.allEdges) {
        const toggle = button(
          props.allEdges.all ? BUILD_TEXT.noEdges : BUILD_TEXT.allEdges,
          'build-all-edges',
          true,
          props.onAllEdges,
        );
        toggle.classList.add('build-all');
        toggle.disabled = props.working;
        hint.append(toggle);
      }

      row.replaceChildren(
        ...props.cards.map((card) => {
          const on = card.id === selected?.id;
          const off = card.blocked !== null;
          const b = el(
            'button',
            {
              type: 'button',
              class: `build-card${off ? ' build-card-off' : ''}`,
              'aria-pressed': on ? 'true' : 'false',
              'data-testid': 'build-card',
              'data-build': card.id,
            },
            el('span', { class: 'build-card-icon', 'aria-hidden': 'true' }, card.icon),
            el('span', { class: 'build-card-name' }, card.name),
          );
          b.disabled = props.working || off;
          b.addEventListener('click', () => {
            props.onSelect(card.id);
          });
          return el('li', {}, b);
        }),
      );
      let detail = '';
      if (selected && status) {
        if (status.kind === 'blocked' || status.kind === 'craft') detail = status.note;
        else if (status.kind === 'short')
          detail = `${detailLine(selected, props.areas)}. ${BUILD_TEXT.needMore}`;
        else detail = detailLine(selected, props.areas);
      }

      const go = button(
        props.working ? BUILD_TEXT.working : BUILD_TEXT.go,
        'build-go',
        false,
        props.onBuild,
      );
      go.disabled = props.working || status?.kind !== 'ready';
      const actions: HTMLElement[] = [go];
      if (status?.kind === 'craft' && props.onRecipeBook) {
        actions.unshift(button(BUILD_TEXT.recipeBook, 'build-recipe', false, props.onRecipeBook));
        go.hidden = true;
      }
      actions.push(button(BUILD_TEXT.cancel, 'build-cancel', true, props.onCancel));

      const left = row.scrollLeft;
      element.replaceChildren(
        hint,
        row,
        el(
          'p',
          {
            class: `build-detail${status?.kind === 'short' ? ' build-detail-short' : ''}`,
            'data-testid': 'build-detail',
          },
          detail,
        ),
        el('div', { class: 'build-actions' }, ...actions),
        ...(props.note
          ? [
              el(
                'p',
                { class: 'build-note', role: 'status', 'data-testid': 'build-note' },
                props.note,
              ),
            ]
          : []),
      );
      row.scrollLeft = left;
      row.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });

      return status;
    },
  };
}
