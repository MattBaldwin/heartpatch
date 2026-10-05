import type { CareListResponse, CareSquishy, PublicUser } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { careApi, type CareApi } from './care-api.js';
import {
  CARE_TEXT,
  careDoneLine,
  careSheet,
  evolutionLine,
  faceFor,
  nextReadyIn,
  speciesById,
  type SquishyFace,
} from './care-view.js';
import './care.css';

// The care sheet (#19, design doc §7–8): one squishy's mood, level and XP,
// with Feed / Pet / Play buttons (the visible alternatives to #20's close-up
// gestures). A DOM sheet over whatever is on screen (home base, the catalog,
// the map). An evolution is celebrated here once, with a squash-and-stretch
// and sparkles that play per event (CSS, so nothing redraws while idle).

export interface CareSheetOptions {
  root: HTMLElement;
  api?: CareApi;
  /** "Up close": opens the squishy in the close-up view (#20); no button without it. */
  onCloseUp?: (mapId: string, squishyId: string) => void;
  /** A squash after care, or sparkles for an evolution, starts (sound, #25). */
  onSquish?: (kind: 'care' | 'evolve') => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CareDebug {
  readonly mapId: string;
  readonly squishyId: string | null;
  readonly open: boolean;
  readonly contentment: number | null;
  readonly mood: string | null;
  readonly level: number | null;
  readonly speciesId: string | null;
  readonly caredToday: number | null;
  /** The evolution celebration is on screen. */
  readonly celebrating: boolean;
  /** Squash-and-stretch moments played since the page loaded (one per care or evolution). */
  readonly squishes: number;
  readonly note: string;
}

export interface CareSheet {
  /** Opens the sheet for one of my squishies on this patch. */
  open: (mapId: string, squishyId: string) => Promise<void>;
  /** Opens the sheet for my first squishy of a species (from the catalog). */
  openForSpecies: (mapId: string, speciesId: string) => Promise<void>;
  /** If one of my squishies evolved and I haven't seen it, celebrates it. */
  celebrateNews: (mapId: string) => Promise<void>;
  close: () => void;
  setUser: (user: PublicUser | null) => void;
  readonly isOpen: boolean;
  readonly debug: CareDebug | null;
}

export function createCareSheet(options: CareSheetOptions): CareSheet {
  const api = options.api ?? careApi;
  let mapId: string | null = null;
  let squishyId: string | null = null;
  let reply: CareListResponse | null = null;
  /** `performance.now()` when `reply` arrived: the server clock is `reply.now` plus the time since. */
  let replyAt = 0;
  /** Re-renders when the next debounced button can come back on. */
  let readyTimer: number | undefined;
  let working = false;
  let squishes = 0;
  /** Bumped on every open, close and user change, so a late reply is dropped. */
  let ticket = 0;

  const face = squishyFaceNode();
  const blob = el('div', { class: 'care-blob', 'aria-hidden': 'true' }, face.node);
  const sparkles = el(
    'div',
    { class: 'care-sparkles', 'aria-hidden': 'true' },
    ...['✨', '💖', '✨', '⭐', '✨'].map((s) => el('span', {}, s)),
  );
  const stage = el('div', { class: 'care-stage' }, blob, sparkles);
  const name = el('h1', { class: 'auth-title care-name', id: 'care-title' });
  const mood = el('p', { class: 'care-mood', 'data-testid': 'care-mood' });
  const heartsFill = el('div', { class: 'care-meter-fill care-hearts' });
  const hearts = el('div', { class: 'care-meter', 'aria-hidden': 'true' }, heartsFill);
  const level = el('p', { class: 'care-level', 'data-testid': 'care-level' });
  const xpFill = el('div', { class: 'care-meter-fill care-xp' });
  const xpBar = el('div', { class: 'care-meter', 'aria-hidden': 'true' }, xpFill);
  const xpLine = el('p', { class: 'care-xp-line' });
  // The tutorial's care step spotlights these (Feed, Pet, Play).
  const actions = el('div', { class: 'care-actions', 'data-tutorial-target': 'care-buttons' });
  const note = el('p', { class: 'care-note', role: 'status', 'data-testid': 'care-note' });
  const infoList = el('ul', { class: 'care-info' });
  const info = el(
    'details',
    // Open from the start: it's where care is explained (the playtest missed it).
    { class: 'care-details', open: '', 'data-testid': 'care-details' },
    el('summary', {}, CARE_TEXT.infoTitle),
    infoList,
  );
  const celebrateLine = el('p', { class: 'care-celebrate-line' });
  const yay = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'care-yay' },
    CARE_TEXT.yay,
  );
  const celebrate = el(
    'div',
    { class: 'care-celebrate', 'data-testid': 'care-celebrate' },
    el('h2', { class: 'care-celebrate-title' }, CARE_TEXT.evolvedTitle),
    celebrateLine,
    yay,
  );
  celebrate.hidden = true;
  const closeButton = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'care-close' },
    CARE_TEXT.close,
  );
  const closeUpButton = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'care-close-up' },
    `👀 ${CARE_TEXT.upClose}`,
  );
  closeUpButton.hidden = true;
  const panel = el(
    'section',
    { class: 'care', role: 'dialog', 'aria-labelledby': 'care-title', 'data-testid': 'care' },
    el(
      'div',
      { class: 'auth-card care-card' },
      stage,
      name,
      mood,
      hearts,
      level,
      xpBar,
      xpLine,
      celebrate,
      actions,
      note,
      info,
      el('div', { class: 'auth-actions' }, closeUpButton, closeButton),
    ),
  );
  panel.hidden = true;
  options.root.append(panel);

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const setReply = (next: CareListResponse | null) => {
    reply = next;
    replyAt = performance.now();
  };
  /** The server's time now, as reckoned from the last reply (a phone's own clock may be off). */
  const serverNow = (): number =>
    reply ? Date.parse(reply.now) + (performance.now() - replyAt) : 0;

  const current = (): CareSquishy | null =>
    reply?.squishies.find((s) => s.id === squishyId) ?? null;

  /** One squash-and-stretch (and sparkles for an evolution); plays once per event. */
  function squish(kind: 'care' | 'evolve'): void {
    squishes += 1;
    const cls = kind === 'evolve' ? 'care-stage-evolve' : 'care-stage-squish';
    stage.classList.remove('care-stage-squish', 'care-stage-evolve');
    // A reflow restarts the animation even if the same class was just there.
    stage.getBoundingClientRect();
    stage.classList.add(cls);
    options.onSquish?.(kind);
  }
  stage.addEventListener('animationend', (event) => {
    if (event.target === blob) stage.classList.remove('care-stage-squish', 'care-stage-evolve');
  });

  function render(): void {
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
    const squishy = current();
    closeUpButton.hidden = !options.onCloseUp || !reply || !squishy;
    if (!reply || !squishy) {
      name.textContent = '';
      mood.textContent = CARE_TEXT.noneYet;
      actions.replaceChildren();
      return;
    }
    const now = serverNow();
    const model = careSheet(squishy, reply, now);
    blob.style.background = model.color;
    face.set(faceFor(squishy.speciesId, speciesById(reply)));
    name.textContent = model.name;
    mood.textContent = model.mood;
    heartsFill.style.width = `${String(Math.round(model.hearts * 100))}%`;
    level.textContent = model.level;
    xpFill.style.width = `${String(Math.round(model.xp * 100))}%`;
    xpLine.textContent = model.xpLine;
    actions.replaceChildren(
      ...model.buttons.map((b) => {
        const button = el(
          'button',
          { type: 'button', class: 'auth-button care-action', 'data-care': b.action },
          b.label,
          ...(b.sub ? [el('span', { class: 'care-action-sub' }, b.sub)] : []),
          ...(b.note ? [el('span', { class: 'care-action-note' }, b.note)] : []),
        );
        button.disabled = working || b.note !== null;
        button.addEventListener('click', () => void act(b.action));
        return button;
      }),
    );
    infoList.replaceChildren(...model.info.map((line) => el('li', {}, line)));
    const evolved = evolutionLine(squishy, speciesById(reply));
    celebrate.hidden = evolved === null;
    if (evolved) celebrateLine.textContent = evolved;
    // A debounced button comes back on by itself (one timer, the soonest).
    const wait = nextReadyIn(squishy, now);
    if (wait !== null) readyTimer = window.setTimeout(render, wait + 50);
  }

  async function act(action: string): Promise<void> {
    const id = squishyId;
    const map = mapId;
    if (!id || !map || working) return;
    const mine = ticket;
    working = true;
    render();
    try {
      const next = await sendCommand(
        sendDeps,
        (key) => api.care(map, id, action, key),
        () => mine === ticket,
      );
      if (!next || mine !== ticket) return;
      setReply(next);
      note.textContent = careDoneLine(next.result);
      squish('care');
    } catch (err) {
      if (mine !== ticket) return;
      note.textContent = messageOf(err);
      // The debounce or the bag changed under us: show the server's view again.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        const fresh = await api.list(map).catch(() => null);
        if (fresh && mine === ticket) setReply(fresh);
      }
    } finally {
      working = false;
      if (mine === ticket) render();
    }
  }

  yay.addEventListener('click', () => {
    const id = squishyId;
    const map = mapId;
    if (!id || !map) return;
    const mine = ticket;
    celebrate.hidden = true;
    sendCommand(
      sendDeps,
      (key) => api.seen(map, id, key),
      () => mine === ticket,
    )
      .then((next) => {
        if (next && mine === ticket) {
          setReply(next);
          render();
        }
      })
      .catch((err: unknown) => {
        if (mine === ticket) note.textContent = messageOf(err);
      });
  });

  closeButton.addEventListener('click', () => {
    hide();
  });

  closeUpButton.addEventListener('click', () => {
    const map = mapId;
    const id = squishyId;
    if (map && id) options.onCloseUp?.(map, id);
  });

  function hide(): void {
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
    ticket += 1;
    mapId = null;
    squishyId = null;
    reply = null;
    panel.hidden = true;
    celebrate.hidden = true;
    note.textContent = '';
  }

  /** Loads the patch's care list and shows the squishy `pick` chooses (nothing if it picks none). */
  async function load(
    map: string,
    pick: (list: CareListResponse) => CareSquishy | undefined,
    quiet: boolean,
  ): Promise<void> {
    const mine = (ticket += 1);
    let list: CareListResponse;
    try {
      list = await api.list(map);
    } catch (err) {
      if (mine !== ticket || quiet) return;
      mapId = map;
      squishyId = null;
      setReply(null);
      panel.hidden = false;
      note.textContent = messageOf(err);
      render();
      return;
    }
    if (mine !== ticket) return;
    const picked = pick(list);
    const chosen = picked ?? (quiet ? undefined : list.squishies[0]);
    if (!chosen && quiet) return;
    mapId = map;
    squishyId = chosen?.id ?? null;
    setReply(list);
    // Asked for one that isn't here (it grew up, or it's in the Hollow): say so.
    note.textContent = !picked && chosen ? CARE_TEXT.notHere : '';
    panel.hidden = false;
    render();
    if (chosen?.newEvolution) squish('evolve');
  }

  return {
    open: (map, id) => load(map, (list) => list.squishies.find((s) => s.id === id), false),
    openForSpecies: (map, speciesId) =>
      load(map, (list) => list.squishies.find((s) => s.speciesId === speciesId), false),
    celebrateNews: (map) =>
      load(map, (list) => list.squishies.find((s) => s.newEvolution !== null), true),
    close: hide,
    setUser: () => {
      hide();
    },
    get isOpen() {
      return !panel.hidden;
    },
    get debug() {
      if (!mapId) return null;
      const squishy = current();
      return {
        mapId,
        squishyId,
        open: !panel.hidden,
        contentment: squishy?.contentment ?? null,
        mood: squishy?.mood ?? null,
        level: squishy?.level ?? null,
        speciesId: squishy?.speciesId ?? null,
        caredToday: squishy?.caredToday ?? null,
        celebrating: !celebrate.hidden,
        squishes,
        note: note.textContent,
      };
    },
  };
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The blob's face (#153): eyes, mouth, cheeks and a tummy patch as one small
 * inline SVG, swapped per species. Drawn once; `set` shows the right parts.
 */
function squishyFaceNode(): { node: SVGSVGElement; set: (face: SquishyFace) => void } {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 88 78');
  svg.setAttribute('class', 'care-face');
  svg.setAttribute('aria-hidden', 'true');
  const part = (tag: string, attrs: Record<string, string>): SVGElement => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  const belly = part('ellipse', { cx: '44', cy: '58', rx: '18', ry: '12', class: 'care-face-belly' });
  const cheeks = [
    part('circle', { cx: '22', cy: '44', r: '5', class: 'care-face-blush' }),
    part('circle', { cx: '66', cy: '44', r: '5', class: 'care-face-blush' }),
  ];
  const eyes: Record<SquishyFace['eyes'], SVGElement[]> = {
    dot: [
      part('circle', { cx: '32', cy: '35', r: '3.5', class: 'care-face-ink' }),
      part('circle', { cx: '56', cy: '35', r: '3.5', class: 'care-face-ink' }),
    ],
    oval: [
      part('ellipse', { cx: '32', cy: '35', rx: '3.5', ry: '5', class: 'care-face-ink' }),
      part('ellipse', { cx: '56', cy: '35', rx: '3.5', ry: '5', class: 'care-face-ink' }),
    ],
    happy: [
      part('path', { d: 'M26 37 q6 -8 12 0', class: 'care-face-stroke' }),
      part('path', { d: 'M50 37 q6 -8 12 0', class: 'care-face-stroke' }),
    ],
    sleepy: [
      part('path', { d: 'M26 35 q6 4 12 0', class: 'care-face-stroke' }),
      part('path', { d: 'M50 35 q6 4 12 0', class: 'care-face-stroke' }),
    ],
  };
  const mouths: Record<SquishyFace['mouth'], SVGElement> = {
    smile: part('path', { d: 'M38 46 q6 6 12 0', class: 'care-face-stroke' }),
    open: part('ellipse', { cx: '44', cy: '48', rx: '4', ry: '3', class: 'care-face-ink' }),
    cat: part('path', { d: 'M37 46 q3.5 5 7 0 q3.5 5 7 0', class: 'care-face-stroke' }),
  };
  const show = (node: SVGElement, on: boolean) => {
    node.setAttribute('visibility', on ? 'visible' : 'hidden');
  };
  return {
    node: svg,
    set: (face) => {
      show(belly, face.belly !== null);
      if (face.belly !== null) belly.setAttribute('fill', face.belly);
      for (const c of cheeks) show(c, face.blush);
      for (const [kind, nodes] of Object.entries(eyes)) {
        for (const n of nodes) show(n, kind === face.eyes);
      }
      for (const [kind, n] of Object.entries(mouths)) show(n, kind === face.mouth);
    },
  };
}
