import {
  EXPLORE_RULES,
  GAME_DATA,
  HOME_BASE_RULES,
  JOB_RULES,
  RESOURCE_BUILDING_RULES,
  buildingsGuide,
  type BuildingGuideEntry,
  type ItemCounts,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';
import { itemName } from '../inventory/bag-view.js';
import { seasonsOn } from '../map/map-dressing.js';
import type { BuildingPortraits } from '../procedural/portraits.js';
import { buttonClass, hpClose } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import type { BuildCard } from './build-model.js';
import {
  GUIDE_TEXT,
  costParts,
  fitCounts,
  fitHere,
  guideAction,
  guideShelves,
  placeChips,
  shelfNote,
  tileLine,
  valueLines,
  type GuideFit,
} from './buildings-guide-model.js';
import { createGuidePortraits } from './guide-portraits.js';
import type { BuildSource } from './tile-build.js';
import './buildings-guide.css';

// The Buildings guide (#715): "See all buildings" in the Build sheet opens
// every building this patch can have, shelf by shelf, with why to build it,
// where it goes, whether the picked tile takes it and how many of my tiles
// do, and a "Coming later" shelf of what waits (owner variant B). Every line
// comes from the building data (shared `buildingsGuide`); every ✓ comes from
// the Build sheets' own cards. "Build here" goes back to the Build sheet
// with that card picked.

export interface BuildingsGuideOptions {
  readonly root: HTMLElement;
  readonly portraits?: BuildingPortraits;
  /** Every Build sheet's sources (land and river), for "Fits N of your tiles". */
  readonly sources: () => readonly BuildSource[];
  /** The game's clock (the server's date), for which seasons are on. */
  readonly now: () => Date;
  /** Opens my home base, where the habitats are built ("Go home"). */
  readonly onHome?: () => void;
}

/** One opening: the picked tile and what its Build sheet offers there. */
export interface GuideOpening {
  readonly tile: PublicTile;
  readonly view: MapView;
  /** The Build sheet's cards on the picked tile. */
  readonly here: readonly BuildCard[];
  readonly bag: ItemCounts | null;
  readonly onBuildHere: (id: string) => void;
  readonly onRecipeBook?: () => void;
  /** ‹ Build: back to the sheet, tile still picked. */
  readonly onBack: () => void;
  /** ✕: closes the sheet too. */
  readonly onClose: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface BuildingsGuideDebug {
  readonly open: boolean;
  readonly filter: Filter;
  /** Every building listed (now and later), in order. */
  readonly ids: readonly string[];
  /** The ones the picked tile takes. */
  readonly fits: readonly string[];
  readonly later: readonly string[];
  /** Tiles each building fits on. */
  readonly counts: Readonly<Record<string, number>>;
}

export interface BuildingsGuide {
  open: (opening: GuideOpening) => void;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: BuildingsGuideDebug;
}

type Filter = 'fits' | 'all';

interface Shown {
  readonly opening: GuideOpening;
  readonly entries: readonly BuildingGuideEntry[];
  readonly fit: ReadonlyMap<string, GuideFit>;
  readonly counts: ReadonlyMap<string, number>;
}

const ECONOMY = {
  jobs: JOB_RULES,
  explore: EXPLORE_RULES,
  resourceBuildings: RESOURCE_BUILDING_RULES,
};
const PORTRAIT_PX = 64; // TUNE: the mockup's card picture

export function createBuildingsGuide(options: BuildingsGuideOptions): BuildingsGuide {
  let shown: Shown | null = null;
  let filter: Filter = 'all';

  const close = hpClose(GUIDE_TEXT.close, 'guide-close');
  close.addEventListener('click', () => {
    const was = shown;
    shut();
    was?.opening.onClose();
  });
  const back = el(
    'button',
    {
      type: 'button',
      class: `${buttonClass({ variant: 'secondary', small: true })} guide-back`,
      'data-testid': 'guide-back',
    },
    GUIDE_TEXT.back,
  );
  back.addEventListener('click', () => {
    const was = shown;
    shut();
    was?.opening.onBack();
  });
  const title = el('h2', { class: 'guide-title', id: 'guide-title' }, GUIDE_TEXT.title);
  const tileStrip = el('p', { class: 'guide-tile', 'data-testid': 'guide-tile' });
  const filters = el('div', { class: 'guide-filter', role: 'group' });
  const jumps = el('div', { class: 'guide-jump', 'data-testid': 'guide-jump' });
  const list = el('div', { class: 'guide-list', 'data-testid': 'guide-list' });
  const sheet = el(
    'section',
    {
      class: 'guide',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'guide-title',
      'data-testid': 'buildings-guide',
    },
    el('div', { class: 'guide-bar' }, back, title, close),
    tileStrip,
    filters,
    jumps,
    list,
  );
  sheet.hidden = true;
  const pictures = createGuidePortraits(options.portraits, list);
  /** The shelf whose jump chip was tapped last (cleared on every redraw). */
  let tapped: string | null = null;
  /** A frame is booked to re-pick the chip (one pick per frame while the list scrolls). */
  let picking = false;
  list.addEventListener(
    'scroll',
    () => {
      if (picking) return;
      picking = true;
      requestAnimationFrame(() => {
        picking = false;
        pickChip();
      });
    },
    { passive: true },
  );
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') back.click();
  });
  options.root.append(sheet);

  function shut(): void {
    shown = null;
    sheet.hidden = true;
    pictures.reset();
    list.replaceChildren();
  }

  function render(): void {
    if (!shown) return;
    const { entries, fit, counts, opening } = shown;
    const { fitting, shelves } = guideShelves(entries, fit, filter);

    tileStrip.replaceChildren(
      el('span', { class: 'guide-hex', 'aria-hidden': 'true' }),
      el('span', {}, `${GUIDE_TEXT.yourTile} `, el('b', {}, tileLine(opening.tile))),
    );

    const seg = (key: Filter, label: string) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: 'guide-seg',
          'aria-pressed': String(filter === key),
          'data-testid': `guide-filter-${key}`,
        },
        label,
      );
      b.addEventListener('click', () => {
        filter = key;
        list.scrollTop = 0;
        render();
      });
      return b;
    };
    filters.replaceChildren(
      seg('fits', GUIDE_TEXT.fitsFilter(fitting)),
      seg('all', GUIDE_TEXT.allFilter(entries.length)),
    );

    tapped = null;
    jumps.replaceChildren(
      ...shelves.map((s) => {
        const b = el(
          'button',
          { type: 'button', class: 'guide-chip', 'data-jump': s.key },
          s.key === 'later' ? GUIDE_TEXT.laterChip : GUIDE_TEXT.groups[s.key],
        );
        b.addEventListener('click', () => {
          const head = list.querySelector<HTMLElement>(`[data-shelf="${s.key}"]`);
          tapped = s.key;
          if (head) list.scrollTop = head.offsetTop - list.offsetTop;
          pickChip();
        });
        return b;
      }),
    );

    pictures.reset();
    list.replaceChildren(
      ...(shelves.length === 0
        ? [el('p', { class: 'guide-empty', 'data-testid': 'guide-empty' }, GUIDE_TEXT.nothingFits)]
        : shelves.flatMap((s) => [
            el(
              'div',
              { class: 'guide-group', 'data-shelf': s.key },
              el('h3', {}, s.key === 'later' ? GUIDE_TEXT.later : GUIDE_TEXT.groups[s.key]),
              el('small', {}, s.key === 'later' ? GUIDE_TEXT.laterNote : shelfNote(s)),
            ),
            ...s.items.map((e) => entryCard(e, fit.get(e.id), counts.get(e.id) ?? 0)),
          ])),
    );
    pickChip();
  }

  /**
   * Marks the jump chip of the shelf in view (#715) with `aria-current`: the
   * last shelf whose heading has reached the list's top. At the very bottom
   * the last shelves can't reach it, so a tapped one still on screen stays picked.
   */
  function pickChip(): void {
    const top = list.scrollTop + 8; // TUNE: a heading just under the top counts
    const heads = [...list.querySelectorAll<HTMLElement>('[data-shelf]')];
    const at = (h: HTMLElement) => h.offsetTop - list.offsetTop;
    let key = heads[0]?.dataset['shelf'];
    for (const h of heads) if (at(h) <= top) key = h.dataset['shelf'];
    const bottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
    const head = heads.find((h) => h.dataset['shelf'] === tapped);
    if (bottom && head && at(head) >= list.scrollTop) key = tapped ?? key;
    for (const chip of jumps.querySelectorAll<HTMLElement>('.guide-chip')) {
      const on = chip.dataset['jump'] === key;
      if (on === chip.hasAttribute('aria-current')) continue;
      if (on) {
        chip.setAttribute('aria-current', 'true');
        showChip(chip);
      } else chip.removeAttribute('aria-current');
    }
  }

  /**
   * Slides the chip row so a newly picked chip sits fully inside it, with the
   * row's padding to spare. It scrolls only the row: `scrollIntoView` would
   * also nudge the sheet and page on iOS.
   */
  function showChip(chip: HTMLElement): void {
    const row = jumps.getBoundingClientRect();
    const box = chip.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(jumps).scrollPaddingLeft) || 0;
    if (box.left < row.left + pad) jumps.scrollLeft -= row.left + pad - box.left;
    else if (box.right > row.right - pad) jumps.scrollLeft += box.right - (row.right - pad);
  }

  function entryCard(
    entry: BuildingGuideEntry,
    fit: GuideFit | undefined,
    count: number,
  ): HTMLElement {
    const opening = shown?.opening;
    const f: GuideFit = fit ?? { kind: 'no', reason: '' };
    const later = f.kind === 'later';
    // Fires drawn lit and cozy, as the mockup has them.
    const portrait = pictures.box({
      buildingId: entry.id,
      level: 1,
      asleep: false,
      size: PORTRAIT_PX,
      ...(entry.group === 'fires' ? { lit: true } : {}),
    });

    const fitRow = later
      ? []
      : f.kind === 'home'
        ? [
            el(
              'div',
              { class: 'guide-fitrow' },
              el(
                'span',
                { class: 'guide-fit guide-fit-soon', 'data-testid': 'guide-fit' },
                GUIDE_TEXT.atHome,
              ),
            ),
          ]
        : [
            el(
              'div',
              { class: 'guide-fitrow' },
              el(
                'span',
                {
                  class: `guide-fit ${f.kind === 'fits' ? 'guide-fit-yes' : 'guide-fit-no'}`,
                  'data-testid': 'guide-fit',
                },
                f.kind === 'fits' ? GUIDE_TEXT.fits : `✗ ${f.reason}`,
              ),
              el(
                'span',
                { class: 'guide-count', 'data-testid': 'guide-count' },
                GUIDE_TEXT.fitCount(count),
              ),
            ),
          ];

    const action = guideAction(f, opening?.bag ?? null);
    let foot: HTMLElement;
    if (f.kind === 'home') {
      const home = el(
        'button',
        {
          type: 'button',
          class: buttonClass({ variant: 'primary', small: true }),
          'data-testid': 'guide-home',
        },
        GUIDE_TEXT.goHome,
      );
      home.disabled = !options.onHome;
      home.addEventListener('click', () => {
        const was = shown;
        shut();
        was?.opening.onClose();
        options.onHome?.();
      });
      foot = home;
    } else if (f.kind === 'later') {
      foot = el(
        'span',
        { class: 'guide-fit guide-fit-soon', 'data-testid': 'guide-later' },
        f.label,
      );
    } else {
      const primary = action === 'build' || action === 'craft';
      const build = el(
        'button',
        {
          type: 'button',
          class: buttonClass({ variant: primary ? 'primary' : 'secondary', small: true }),
          'data-testid': 'guide-build',
        },
        action === 'craft'
          ? GUIDE_TEXT.recipeBook
          : action === 'short'
            ? GUIDE_TEXT.needMore
            : GUIDE_TEXT.buildHere,
      );
      build.disabled = !primary;
      build.addEventListener('click', () => {
        if (!opening) return;
        shut();
        // The river sheet has no recipe book, and offers no card to make first.
        if (action === 'craft' && opening.onRecipeBook) opening.onRecipeBook();
        else opening.onBuildHere(entry.id);
      });
      foot = build;
    }
    const edges = entry.place.some((p) => p.kind === 'edges');
    const cost = el(
      'div',
      { class: 'guide-cost' },
      ...costParts(entry.cost, later ? null : (opening?.bag ?? null)).map((p) =>
        el(
          'span',
          { class: p.short ? 'guide-short' : '', title: itemName(p.id) },
          `${p.count} ${itemIcon(p.id)}`,
        ),
      ),
      ...(edges ? [el('span', { class: 'guide-per' }, GUIDE_TEXT.perEdge)] : []),
    );

    return el(
      'article',
      {
        class: `guide-entry${later ? ' guide-entry-later' : ''}${f.kind === 'fits' ? ' guide-entry-fits' : ''}`,
        'data-testid': 'guide-entry',
        'data-building': entry.id,
      },
      el(
        'div',
        { class: 'guide-head' },
        portrait,
        el(
          'div',
          { class: 'guide-names' },
          el('h4', { class: 'guide-name' }, entry.name),
          el('p', { class: 'guide-desc' }, entry.description),
        ),
      ),
      el(
        'div',
        { class: 'guide-sec' },
        el('h5', {}, GUIDE_TEXT.why),
        el(
          'ul',
          { class: 'guide-why' },
          ...valueLines(entry.value).map((line) => el('li', {}, line)),
        ),
      ),
      el(
        'div',
        { class: 'guide-sec' },
        el('h5', {}, GUIDE_TEXT.where),
        el(
          'div',
          { class: 'guide-chips' },
          ...placeChips(entry.place).map((c) => el('span', { class: 'guide-place' }, c)),
        ),
        ...fitRow,
      ),
      el('div', { class: 'guide-foot' }, cost, foot),
    );
  }

  return {
    open: (opening) => {
      const patchType = opening.view.map.patchType ?? 'cozy';
      const entries = buildingsGuide(GAME_DATA.buildings, {
        patchType,
        seasons: seasonsOn(opening.view.map.timeZone, options.now()),
        rules: HOME_BASE_RULES,
        economy: ECONOMY,
      });
      const sources = options.sources();
      const counts = fitCounts(opening.view.tiles, (t) =>
        sources.flatMap((s) => s.cards(t, opening.view)),
      );
      const fit = new Map(entries.map((e) => [e.id, fitHere(e, opening.here)]));
      shown = { opening, entries, fit, counts };
      filter = 'all';
      sheet.hidden = false;
      list.scrollTop = 0;
      render();
      back.focus();
    },
    close: shut,
    get isOpen() {
      return shown !== null;
    },
    get debug() {
      const entries = shown?.entries ?? [];
      return {
        open: shown !== null,
        filter,
        ids: entries.map((e) => e.id),
        fits: entries.filter((e) => shown?.fit.get(e.id)?.kind === 'fits').map((e) => e.id),
        later: entries.filter((e) => shown?.fit.get(e.id)?.kind === 'later').map((e) => e.id),
        counts: Object.fromEntries(shown?.counts ?? []),
      };
    },
  };
}
