import type { Scene } from '@babylonjs/core/scene';
import type { MapView } from '@heartpatch/shared';
import { hpButton, hpClose } from '../ui/button/button.js';
import { el, messageOf } from '../ui/dom.js';
import type { BossStore } from './boss-store.js';
import {
  EVE_TEXT,
  eveOf,
  eveStage,
  noticeLine,
  thanksModel,
  waitingForThanks,
  type EveStage,
  type ThanksModel,
} from './eve-model.js';
import type { MapLayer } from './map-screen.js';
import './eve.css';

/*
 * The Christmas Eve visit's own bits on the map (#37 X5b): the 3-day notice
 * chip, the little "it fell asleep" beat, and the thanks sheet. A map layer:
 * it reads each `MapView` the map draws (`MapView.christmas.eve`) and keeps
 * no state of its own that the server could contradict (CLAUDE.md rule 1).
 * The sheet's asks reuse the befriend flow (`POST /battles/:id/befriend`).
 */

export interface EveLayerOptions {
  readonly root: HTMLElement;
  readonly store: BossStore;
  /** Sends one befriend ask (`ask` is asks made + 1); rejects with what went wrong. */
  readonly ask: (battleId: string, ask: number) => Promise<'joined' | 'not-yet'>;
  /** Asks the map for a fresh view (after an ask, or while a thanks is on its way). */
  readonly refresh: () => void;
  /** Reduce Motion is on. */
  readonly reducedMotion?: () => boolean;
  readonly now?: () => Date;
}

export interface EveLayer extends MapLayer {
  /** The sheet is up (other cards wait their turn). */
  readonly isOpen: boolean;
  readonly debug: {
    readonly stage: EveStage | null;
    readonly notice: string | null;
    readonly sheetOpen: boolean;
    readonly thanks: ThanksModel | null;
    readonly waiting: boolean;
    readonly beat: boolean;
  };
}

/** How often the map is asked again while a settled bar's thanks hasn't landed (it pays within ~5 min). */
export const THANKS_POLL_MS = 15_000; // TUNE:
/** …and how many times, so a thanks that never comes isn't asked for forever (~10 min). */
export const THANKS_POLLS_MAX = 40; // TUNE:
/** How long the fall beat stays up. */
export const BEAT_MS = 3_200; // TUNE:

export function createEveLayer(options: EveLayerOptions): EveLayer {
  const { root, store } = options;
  const now = options.now ?? (() => new Date());
  const reduced = () =>
    options.reducedMotion?.() ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let view: MapView | null = null;
  let prevStage: EveStage | null = null;
  let prevMap: string | null = null;
  let sheetOpen = false;
  /** A thanks the Keeper has already seen pop up (once per bar). */
  let offered = false;
  let note = '';
  let busy = false;
  let beat = false;
  /** The beat plays once per bar on a patch. */
  let beatPlayed = false;
  let beatTimer: ReturnType<typeof setTimeout> | undefined;
  let polls = 0;
  let pollsSpent = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const chip = el('div', {
    class: 'eve-chip',
    role: 'status',
    'data-testid': 'eve-notice',
  });
  chip.hidden = true;
  const gift = hpButton(EVE_TEXT.chip, { testId: 'eve-gift' });
  gift.classList.add('eve-gift');
  gift.hidden = true;
  const beatEl = el('div', { class: 'eve-beat', role: 'status', 'data-testid': 'eve-beat' });
  beatEl.hidden = true;
  const sheet = el('div', { class: 'eve-sheet', 'data-testid': 'eve-sheet' });
  sheet.hidden = true;
  root.append(chip, gift, beatEl, sheet);
  gift.addEventListener('click', () => {
    sheetOpen = true;
    render();
  });

  const closeSheet = (): void => {
    sheetOpen = false;
    note = '';
    render();
  };

  const startBeat = (): void => {
    if (beatPlayed) return;
    beatPlayed = true;
    beat = true;
    clearTimeout(beatTimer);
    beatTimer = setTimeout(() => {
      beat = false;
      render();
    }, BEAT_MS);
  };

  const sheetBody = (model: ThanksModel | null): HTMLElement[] => {
    if (!model) {
      return [
        el('p', { class: 'eve-sheet-title' }, EVE_TEXT.fellTitle),
        el('p', { class: 'eve-sheet-line', 'data-testid': 'eve-waiting' }, EVE_TEXT.waiting),
      ];
    }
    const kids: HTMLElement[] = [
      el('p', { class: 'eve-sheet-title' }, model.title),
      el('p', { class: 'eve-sheet-line' }, model.line),
      el('p', { class: 'eve-sheet-head' }, EVE_TEXT.bundleHead),
      el(
        'ul',
        { class: 'eve-bundle', 'data-testid': 'eve-bundle' },
        ...model.items.map((line) => el('li', {}, line)),
      ),
    ];
    if (model.kind === 'fell' && model.asksLeft > 0) {
      const ask = hpButton(EVE_TEXT.ask, { variant: 'primary', testId: 'eve-ask' });
      ask.disabled = busy;
      ask.addEventListener('click', () => {
        if (busy) return;
        busy = true;
        note = '';
        render();
        options
          .ask(model.battleId, model.nextAsk)
          .then((outcome) => {
            note = outcome === 'joined' ? EVE_TEXT.joined : EVE_TEXT.notYet;
          })
          .catch((err: unknown) => {
            note = messageOf(err);
          })
          .finally(() => {
            busy = false;
            options.refresh();
            render();
          });
      });
      kids.push(
        el('p', { class: 'eve-sheet-head' }, EVE_TEXT.asksHead),
        el(
          'p',
          { class: 'eve-asks', 'data-testid': 'eve-asks' },
          EVE_TEXT.asksLeft(model.asksLeft),
        ),
        ask,
      );
    }
    if (note) kids.push(el('p', { class: 'eve-sheet-note', role: 'status' }, note));
    return kids;
  };

  function render(): void {
    const eve = eveOf(view);
    const stage = eveStage(eve);
    const line = noticeLine(eve, now());
    chip.textContent = line ?? '';
    chip.hidden = line === null;

    const model = eve?.thanks ? thanksModel(eve.thanks) : null;
    if (model) store.noteThanked();
    // Only for a thanks not yet seen (the view drops one a day after it's paid), and only
    // while the poll budget lasts, so a thanks that never lands isn't waited on forever.
    const waiting = waitingForThanks(eve, store.iChipped && !store.iThanked && !pollsSpent);
    // The thanks pops up once, the first time it's there; the chip brings it back.
    if (model && !offered && !beat) {
      offered = true;
      sheetOpen = true;
    }
    // A fall with no thanks yet and a Keeper who chipped: the gentle wait, never an error.
    gift.hidden = !(model || waiting) || sheetOpen || beat;
    gift.textContent = model ? EVE_TEXT.chip : EVE_TEXT.waiting;
    gift.disabled = !model;
    beatEl.hidden = !beat;
    beatEl.textContent = beat ? EVE_TEXT.fallBeat : '';
    beatEl.classList.toggle('eve-beat-still', reduced());

    sheet.hidden = !(sheetOpen && (model || waiting));
    if (!sheet.hidden) {
      const x = hpClose('Close', 'eve-close');
      const done = hpButton(EVE_TEXT.close, { testId: 'eve-done' });
      x.addEventListener('click', closeSheet);
      done.addEventListener('click', closeSheet);
      sheet.replaceChildren(
        el(
          'div',
          { class: 'eve-sheet-card', role: 'dialog', 'aria-modal': 'true' },
          x,
          ...sheetBody(model),
          done,
        ),
      );
    }
    document.documentElement.dataset['eveSheet'] = sheet.hidden ? 'off' : 'on';

    // While a thanks is still on its way, ask the view again every so often.
    if (waiting && pollTimer === undefined) {
      polls = 0;
      pollTimer = setInterval(() => {
        // A thanks that never lands (nothing was due) stops being asked for, and waited on.
        if (++polls > THANKS_POLLS_MAX) {
          clearInterval(pollTimer);
          pollTimer = undefined;
          pollsSpent = true;
          render();
          return;
        }
        options.refresh();
      }, THANKS_POLL_MS);
    } else if (!waiting && pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    prevStage = stage;
  }

  const take = (next: MapView): void => {
    const mapChanged = prevMap !== next.map.id;
    prevMap = next.map.id;
    view = next;
    const stage = eveStage(eveOf(next));
    if (mapChanged) {
      // A new patch: nothing carries over, and a fall we only just opened onto is not a beat.
      prevStage = stage;
      offered = false;
      sheetOpen = false;
      beat = false;
      beatPlayed = false;
      pollsSpent = false;
      note = '';
    } else if (stage === 'fell' && prevStage === 'open') {
      startBeat();
    }
    render();
  };

  store.onChange(() => {
    // The live bar fell before the view says so: the beat is for the moment it fell.
    if (view && store.eveBar?.state === 'fell' && eveStage(eveOf(view)) === 'open') {
      startBeat();
      render();
    }
  });

  return {
    attach: (_scene: Scene, next: MapView) => {
      take(next);
    },
    update: (next) => {
      take(next);
    },
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      const eve = eveOf(view);
      return {
        stage: eveStage(eve),
        notice: noticeLine(eve, now()),
        sheetOpen: !sheet.hidden,
        thanks: eve?.thanks ? thanksModel(eve.thanks) : null,
        waiting: waitingForThanks(eve, store.iChipped && !store.iThanked && !pollsSpent),
        beat,
      };
    },
  };
}
