import { moodHeartsEl } from '../care/mood-hearts.js';
import type { Portraits } from '../procedural/portraits.js';
import type { RosterRow } from '../squishies/roster/roster-view.js';
import { el } from '../ui/dom.js';
import { houseButton } from './house-grow.js';
import type { BedChip, Picker, PickRow, RoomBeds } from './house-residents-view.js';
import { RESIDENT_TEXT } from './house-view.js';

/*
 * The residents' DOM (#381 plan §10.2–10.3): the open sheet's beds, room by
 * room, the move-in picker page and the move-out confirm. What it says comes
 * from `house-residents-view.ts`; the house screen owns the sheet, the moves
 * and the replies.
 */

/** A picture that didn't come is asked for again this many times, this far apart. */
const PORTRAIT_RETRIES = 4; // TUNE
const PORTRAIT_RETRY_MS = 2000; // TUNE
/** A picture that failed for good is tried again after this long (a new open, say). */
const PORTRAIT_FORGET_MS = 60_000; // TUNE

/**
 * Pictures this screen already has, by look: a URL, or when one failed for
 * good. A redraw of the sheet shows a known picture at once (no flash of
 * the placeholder) and doesn't ask again for one that just failed.
 */
const known = new Map<string, { url: string } | { failedAt: number }>();

const lookKey = (person: RosterRow) => `${person.speciesId}|${person.id}|${person.accessory ?? ''}`;

/** The squishy's own flat look, on purpose: its colour, a body and two eyes (CSS). */
function flatFace(wrap: HTMLElement, color: string | null): void {
  const body = el(
    'span',
    { class: 'jobs-blob house-face-flat-blob', 'aria-hidden': 'true' },
    el('span', { class: 'house-face-eyes' }),
  );
  if (color) body.style.background = color;
  wrap.replaceChildren(body);
  wrap.classList.remove('house-face-wait');
  wrap.dataset['state'] = 'flat';
}

function showPicture(wrap: HTMLElement, url: string): void {
  const img = el('img', { src: url, alt: '', class: 'house-face-img' });
  img.decoding = 'async';
  wrap.replaceChildren(img);
  wrap.classList.remove('house-face-wait');
  wrap.dataset['state'] = 'ready';
  wrap.dataset['ready'] = 'true';
}

/**
 * The squishy's real picture (`data-state="ready"`). Until it's drawn, a
 * soft round glow of its colour that breathes gently (`wait`); if it can't
 * be drawn (no renderer, or every try gave up), its flat look with eyes
 * (`flat`), never a faceless blur.
 */
export function faceEl(person: RosterRow | null, portraits: Portraits | undefined): HTMLElement {
  const wrap = el('span', { class: 'house-face', 'aria-hidden': 'true' });
  const species = person?.species;
  if (!portraits || !person || !species) {
    flatFace(wrap, person?.color ?? null);
    return wrap;
  }
  const key = lookKey(person);
  const had = known.get(key);
  if (had && 'url' in had) {
    showPicture(wrap, had.url);
    return wrap;
  }
  if (had && Date.now() - had.failedAt < PORTRAIT_FORGET_MS) {
    flatFace(wrap, person.color);
    return wrap;
  }
  const glow = el('span', { class: 'jobs-blob', 'aria-hidden': 'true' });
  glow.style.background = person.color;
  wrap.append(glow);
  wrap.classList.add('house-face-wait');
  wrap.dataset['state'] = 'wait';
  const look = { species, instanceId: person.id, accessory: person.accessory };
  // A first draw can give up (shaders still compiling, a busy engine): ask
  // again a few times while the face is still on screen, then settle on the
  // flat look.
  const ask = (triesLeft: number): void => {
    void portraits.get(look).then((url) => {
      if (url) {
        known.set(key, { url });
        showPicture(wrap, url);
        return;
      }
      if (triesLeft <= 0 || !wrap.isConnected) {
        known.set(key, { failedAt: Date.now() });
        flatFace(wrap, person.color);
        return;
      }
      setTimeout(() => {
        if (wrap.isConnected) ask(triesLeft - 1);
      }, PORTRAIT_RETRY_MS);
    });
  };
  ask(PORTRAIT_RETRIES);
  return wrap;
}

/** How many faces on screen are still waiting for their picture (the dev hook's signal). */
export function facesWaiting(root: ParentNode): number {
  return [...root.querySelectorAll<HTMLElement>('.house-face[data-state="wait"]')].filter(
    (f) => f.getBoundingClientRect().width > 0,
  ).length;
}

export interface BedHandlers {
  /** An empty bed: open the picker for its room. */
  onMoveIn: (roomId: string) => void;
  /** A resident's chip: open or fold its detail. */
  onChoose: (squishyId: string) => void;
  /** The opened chip's Move out. */
  onMoveOut: (squishyId: string) => void;
}

function bedChip(
  chip: BedChip,
  chosen: string | null,
  on: BedHandlers,
  portraits: Portraits | undefined,
): HTMLElement {
  const open = chip.squishyId !== null && chip.squishyId === chosen;
  const empty = chip.kind === 'empty';
  const away = !empty && chip.kind !== 'home';
  const b = el(
    'button',
    {
      type: 'button',
      class: `house-bed house-bed-${empty ? 'empty' : away ? 'away' : 'home'}${
        chip.kind === 'hollow' ? ' house-bed-hollow' : ''
      }${open ? ' house-bed-open' : ''}`,
      'data-testid': 'house-bed',
      'data-kind': chip.kind,
      'data-room': chip.roomId,
      ...(chip.squishyId ? { 'data-squishy': chip.squishyId } : {}),
      ...(empty ? {} : { 'aria-expanded': String(open) }),
    },
    empty
      ? el(
          'span',
          { class: 'house-face house-face-empty', 'aria-hidden': 'true' },
          RESIDENT_TEXT.moveInIcon,
        )
      : faceEl(chip.person, portraits),
    el(
      'span',
      { class: 'house-bed-words' },
      el('strong', { class: 'house-bed-name' }, empty ? RESIDENT_TEXT.moveIn : chip.name),
      ...(chip.line ? [el('span', { class: 'house-bed-line' }, chip.line)] : []),
    ),
  );
  b.addEventListener('click', () => {
    if (empty) on.onMoveIn(chip.roomId);
    else if (chip.squishyId) on.onChoose(chip.squishyId);
  });
  return b;
}

/** Under an opened resident's chip, in its tint: its picture, who it is, how it feels, and Move out. */
function bedDetail(
  chip: BedChip,
  busy: boolean,
  on: BedHandlers,
  portraits: Portraits | undefined,
): HTMLElement {
  const p = chip.person;
  const out = houseButton(
    `${RESIDENT_TEXT.moveOut} 👋`,
    () => {
      if (!busy && chip.squishyId) on.onMoveOut(chip.squishyId);
    },
    { 'data-testid': 'house-move-out' },
    true,
  );
  if (busy) out.setAttribute('aria-disabled', 'true');
  return el(
    'div',
    {
      class: `house-bed-detail house-bed-detail-${chip.kind === 'home' ? 'home' : 'away'}${
        chip.kind === 'hollow' ? ' house-bed-hollow' : ''
      }`,
      'data-testid': 'house-bed-detail',
    },
    el(
      'div',
      { class: 'house-bed-detail-top' },
      faceEl(p, portraits),
      el(
        'div',
        { class: 'house-bed-detail-words' },
        el(
          'p',
          { class: 'house-bed-about' },
          el('strong', {}, chip.name),
          // The species when a nickname hides it ("Mochi · Lv 6 · Fuzzbolt").
          ...(p
            ? [` · Lv ${String(p.level)}${p.name === p.speciesName ? '' : ` · ${p.speciesName}`}`]
            : []),
        ),
        ...(chip.about ? [el('p', { class: 'house-bed-mood' }, chip.about)] : []),
        ...(chip.next
          ? [el('p', { class: 'house-bed-next', 'data-testid': 'house-bed-next' }, chip.next)]
          : []),
      ),
    ),
    out,
  );
}

/** Every room's beds, in order: its heading, then a chip per bed (and the opened one's detail). */
export function bedsPanel(
  rooms: readonly RoomBeds[],
  chosen: string | null,
  busy: boolean,
  on: BedHandlers,
  portraits?: Portraits,
): HTMLElement[] {
  // One room: its line is the sheet's only heading (the house screen hides the peek line).
  const only = rooms.length === 1;
  return rooms.map((r) => {
    const opened = r.chips.find((c) => c.squishyId !== null && c.squishyId === chosen) ?? null;
    return el(
      'section',
      { class: 'house-room', 'data-testid': 'house-room', 'data-room': r.room.id },
      el(
        'h4',
        {
          class: `house-room-title${only ? ' house-room-title-only' : ''}`,
          tabindex: '-1',
          'data-testid': `house-room-${r.room.id}`,
        },
        r.title,
      ),
      el('div', { class: 'house-beds' }, ...r.chips.map((c) => bedChip(c, chosen, on, portraits))),
      ...(opened ? [bedDetail(opened, busy, on, portraits)] : []),
    );
  });
}

/** A page's sticky header in the Grow sheet's look: eyebrow, title, and ✕ (or none on a confirm). */
function pageHead(
  eyebrow: string,
  title: string,
  testid: string,
  onClose: (() => void) | null,
): HTMLElement {
  return el(
    'header',
    { class: 'house-grow-head' },
    el(
      'div',
      { class: 'house-grow-heading' },
      el('p', { class: 'house-grow-eyebrow' }, eyebrow),
      el('h3', { class: 'house-grow-title house-page-title', 'data-testid': testid }, title),
    ),
    ...(onClose
      ? [
          houseButton(
            '✕',
            onClose,
            {
              class: 'house-grow-close',
              'data-testid': 'house-picker-close',
              'aria-label': RESIDENT_TEXT.close,
            },
            true,
          ),
        ]
      : []),
  );
}

export interface PickerHandlers {
  onPick: (squishyId: string) => void;
  onClose: () => void;
}

function pickRow(
  p: PickRow,
  busy: boolean,
  focus: string | null,
  on: PickerHandlers,
  portraits: Portraits | undefined,
): HTMLElement {
  const { row } = p;
  // The species when a nickname hides it (never "Puddlepuff · Lv 1 · Puddlepuff").
  const sub =
    row.name === row.speciesName
      ? `Lv ${String(row.level)}`
      : `Lv ${String(row.level)} · ${row.speciesName}`;
  const extra: HTMLElement[] = [];
  if (p.reason) {
    extra.push(
      el('span', { class: 'house-pick-reason', 'data-testid': 'house-pick-reason' }, p.reason),
    );
  } else if (row.mood) {
    const hearts = moodHeartsEl('house-pick-mood');
    hearts.update(row.mood.contentment, row.mood.mood, false);
    extra.push(hearts.root);
  }
  if (p.tag)
    extra.push(el('span', { class: 'house-pick-tag', 'data-testid': 'house-pick-tag' }, p.tag));
  const b = el(
    'button',
    {
      type: 'button',
      class: `house-pick${p.can ? '' : ' house-pick-dim'}${
        p.kind === 'hollowed' ? ' house-pick-hollowed' : ''
      }${row.id === focus ? ' house-pick-focus' : ''}`,
      'data-testid': 'house-pick',
      'data-squishy': row.id,
      'data-kind': p.kind,
      ...(p.can && !busy ? {} : { 'aria-disabled': 'true' }),
    },
    faceEl(row, portraits),
    el(
      'span',
      { class: 'house-pick-words' },
      el('span', { class: 'house-pick-top' }, el('strong', { class: 'house-pick-name' }, row.name)),
      el('span', { class: 'house-pick-sub' }, sub),
      ...extra,
    ),
  );
  b.addEventListener('click', () => {
    if (p.can && !busy) on.onPick(row.id);
  });
  return el('li', {}, b);
}

/** The move-in picker page: "Who moves into the Snug?", then a row per squishy. */
export function pickerPanel(
  picker: Picker,
  busy: boolean,
  focus: string | null,
  on: PickerHandlers,
  portraits?: Portraits,
): HTMLElement[] {
  return [
    pageHead(RESIDENT_TEXT.pickerEyebrow, picker.title, 'house-picker-title', on.onClose),
    el(
      'p',
      {
        class: `house-picker-line${picker.full ? ' house-picker-full' : ''}`,
        'data-testid': 'house-picker-line',
      },
      busy ? RESIDENT_TEXT.moving : picker.line,
    ),
    picker.rows.length === 0
      ? el('p', { class: 'house-picker-none' }, RESIDENT_TEXT.noOne)
      : el(
          'ul',
          { class: 'house-picks', 'data-testid': 'house-picks' },
          ...picker.rows.map((p) => pickRow(p, busy, focus, on, portraits)),
        ),
    el('span', { class: 'house-grow-fade', 'aria-hidden': 'true' }),
  ];
}

export interface MoveOutHandlers {
  onYes: () => void;
  onNo: () => void;
}

/** "Move them out? They can move back in after a day." (style guide §3.6), under the name. */
export function moveOutPanel(
  name: string,
  ask: string,
  busy: boolean,
  on: MoveOutHandlers,
  face: HTMLElement | null = null,
): HTMLElement[] {
  // While moving, both stay focusable (focus doesn't fall to the page) but ignore taps.
  const yes = houseButton(
    busy ? RESIDENT_TEXT.movingOut : RESIDENT_TEXT.moveOut,
    () => {
      if (!busy) on.onYes();
    },
    { 'data-testid': 'house-move-out-yes' },
  );
  const no = houseButton(
    RESIDENT_TEXT.notNow,
    () => {
      if (!busy) on.onNo();
    },
    { 'data-testid': 'house-move-out-no' },
    true,
  );
  for (const b of [yes, no]) if (busy) b.setAttribute('aria-disabled', 'true');
  return [
    pageHead(RESIDENT_TEXT.moveOut, name, 'house-move-out-title', null),
    el(
      'div',
      { class: 'house-move-out-body' },
      ...(face ? [face] : []),
      el('p', { class: 'house-grow-confirm', 'data-testid': 'house-move-out-ask' }, ask),
    ),
    el('div', { class: 'house-sheet-row' }, yes, no),
  ];
}
