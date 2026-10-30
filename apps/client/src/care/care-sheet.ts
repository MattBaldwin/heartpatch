import type { CareListResponse, CareSquishy, PublicUser } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { rarityChip } from '../ui/rarity/rarity.js';
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
import {
  bestFood,
  bigFeed,
  FEED_ACTION,
  FOOD_TEXT,
  PLAIN_FOOD,
  type FoodRow,
} from './food-pick.js';
import { moodHeartsEl } from './mood-hearts.js';
import type { Portraits } from '../procedural/portraits.js';
import { evolvingMeterEl } from './evolving-meter.js';
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
  /** The real squishy pictures (#375); without them, the drawn blob. */
  portraits?: Portraits;
  /** The sheet closed (the Squishies roster under it reads again). */
  onClosed?: () => void;
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
  /** The food row's foods (empty with no row) and the one Feed sends now. */
  readonly foods: readonly string[];
  readonly food: string | null;
  /** Big "Yum!" moments: feeds the server says gave extra. */
  readonly yums: number;
  readonly note: string;
}

export interface CareSheet {
  /** Opens the sheet for one of my squishies on this patch (`food`: pre-picked in the food row). */
  open: (mapId: string, squishyId: string, food?: string) => Promise<void>;
  /** Opens the sheet with `food` pre-picked (the Bag's "Care: Feed"), on a squishy it suits. */
  openWithFood: (mapId: string, food: string) => Promise<void>;
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
  let yums = 0;
  /** The food row's tap (null: the best for this squishy); kept per open. */
  let foodPick: string | null = null;
  /** The row as last drawn, so Feed sends what's on screen. */
  let foods: FoodRow | null = null;
  /** Bumped on every open, close and user change, so a late reply is dropped. */
  let ticket = 0;

  const face = squishyFaceNode();
  const blob = el('div', { class: 'care-blob', 'aria-hidden': 'true' }, face.node);
  /** Which squishy (and accessory) the blob shows a picture of, so care doesn't redraw it. */
  let portraitKey = '';
  const SPARKLES = ['✨', '💖', '✨', '⭐', '✨'];
  // The "Yum!" burst is mostly hearts.
  const HEARTS = ['💗', '✨', '💖', '💗', '💖'];
  const sparkles = el(
    'div',
    { class: 'care-sparkles', 'aria-hidden': 'true' },
    ...SPARKLES.map((s) => el('span', {}, s)),
  );
  const stage = el('div', { class: 'care-stage' }, blob, sparkles);
  const name = el('h1', {
    class: 'auth-title care-name',
    id: 'care-title',
    'data-testid': 'care-name',
  });
  // The rarity chip under the name (#240).
  const rarity = el('div', { class: 'care-rarity', 'data-testid': 'care-rarity' });
  const mood = el('p', { class: 'care-mood', 'data-testid': 'care-mood' });
  const drift = el('p', { class: 'care-drift', 'data-testid': 'care-drift' });
  // A resident of the Keeper's house (#381): its perk, in one line.
  const houseLine = el('p', { class: 'care-house', 'data-testid': 'care-house' });
  // Five hearts and the mood word, the same as the Squishies roster (#375).
  const hearts = moodHeartsEl('care-hearts');
  // Holding steady or drifting down (#376): a badge at the bar's end.
  const heartsBadge = el('span', { class: 'care-hearts-badge', 'aria-hidden': 'true' });
  const heartsRow = el('div', { class: 'care-hearts-row' }, hearts.root, heartsBadge);
  const level = el('p', { class: 'care-level', 'data-testid': 'care-level' });
  const xpFill = el('div', { class: 'care-meter-fill care-xp' });
  const xpBar = el('div', { class: 'care-meter', 'aria-hidden': 'true' }, xpFill);
  const xpLine = el('p', { class: 'care-xp-line' });
  const evolving = evolvingMeterEl('care-evolving');
  // The tutorial's care step spotlights these (Feed, Pet, Play).
  const actions = el('div', { class: 'care-actions', 'data-tutorial-target': 'care-buttons' });
  // The food row (owner's pick 2026-10-30, option C), right above Feed.
  const foodTiles = el('div', {
    class: 'care-foods',
    role: 'group',
    'aria-label': FOOD_TEXT.row,
    'data-testid': 'care-foods',
  });
  const foodHint = el('p', { class: 'care-food-hint', 'data-testid': 'care-food-hint' });
  foodTiles.hidden = true;
  foodHint.hidden = true;
  const note = el('p', { class: 'care-note', role: 'status', 'data-testid': 'care-note' });
  const treatNote = el('p', { class: 'care-treat', 'data-testid': 'care-treat' });
  const infoList = el('ul', { class: 'care-info' });
  const info = el(
    'details',
    // Open from the start: it's where care is explained (the playtest missed it).
    { class: 'care-details', open: '', 'data-testid': 'care-details' },
    el('summary', {}, CARE_TEXT.infoTitle),
    infoList,
  );
  // What's shaping its next evolution (#32), under the evolving meter.
  const whisperIcon = el('span', { class: 'care-whisper-icon', 'aria-hidden': 'true' });
  const whisperText = el('p', { class: 'care-whisper-text' });
  const whisperSub = el('p', { class: 'care-whisper-sub' });
  const whisper = el(
    'div',
    { class: 'care-whisper', 'data-testid': 'care-whisper' },
    whisperIcon,
    el('div', {}, whisperText, whisperSub),
  );
  whisper.hidden = true;
  const celebrateLine = el('p', { class: 'care-celebrate-line' });
  const newForm = el(
    'p',
    { class: 'care-new-form', 'data-testid': 'care-new-form' },
    CARE_TEXT.newForm,
  );
  newForm.hidden = true;
  const yay = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-primary', 'data-testid': 'care-yay' },
    CARE_TEXT.yay,
  );
  const celebrate = el(
    'div',
    { class: 'care-celebrate', 'data-testid': 'care-celebrate' },
    el('h2', { class: 'care-celebrate-title' }, CARE_TEXT.evolvedTitle),
    celebrateLine,
    newForm,
    yay,
  );
  celebrate.hidden = true;
  const closeButton = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-secondary', 'data-testid': 'care-close' },
    CARE_TEXT.close,
  );
  const closeUpButton = el(
    'button',
    { type: 'button', class: 'hp-button hp-button-primary', 'data-testid': 'care-close-up' },
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
      rarity,
      mood,
      drift,
      houseLine,
      heartsRow,
      level,
      xpBar,
      xpLine,
      evolving.root,
      whisper,
      celebrate,
      foodTiles,
      foodHint,
      actions,
      treatNote,
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

  /**
   * One squash-and-stretch (and sparkles for an evolution); plays once per
   * event. `big`: a feed that gave extra gets a bigger squash and a heart burst.
   */
  function squish(kind: 'care' | 'evolve', big = false): void {
    squishes += 1;
    const cls =
      kind === 'evolve' ? 'care-stage-evolve' : big ? 'care-stage-yum' : 'care-stage-squish';
    stage.classList.remove('care-stage-squish', 'care-stage-evolve', 'care-stage-yum');
    const shapes = big ? HEARTS : SPARKLES;
    [...sparkles.children].forEach((span, i) => {
      span.textContent = shapes[i] ?? '✨';
    });
    // A reflow restarts the animation even if the same class was just there.
    stage.getBoundingClientRect();
    stage.classList.add(cls);
    options.onSquish?.(kind);
  }
  stage.addEventListener('animationend', (event) => {
    if (event.target === blob) {
      stage.classList.remove('care-stage-squish', 'care-stage-evolve', 'care-stage-yum');
    }
  });

  function render(): void {
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
    const squishy = current();
    closeUpButton.hidden = !options.onCloseUp || !reply || !squishy;
    if (!reply || !squishy) {
      name.textContent = '';
      rarity.replaceChildren();
      rarity.hidden = true;
      mood.textContent = CARE_TEXT.noneYet;
      drift.hidden = true;
      houseLine.hidden = true;
      actions.replaceChildren();
      foods = null;
      renderFoods();
      return;
    }
    const now = serverNow();
    const model = careSheet(squishy, reply, now, { pick: foodPick });
    foods = model.foods;
    renderFoods();
    face.set(faceFor(squishy.speciesId, speciesById(reply)));
    showPortrait(squishy, reply);
    // The drawn blob's colour; the real picture brings its own.
    blob.style.background = blob.classList.contains('care-blob-real') ? '' : model.color;
    name.textContent = model.name;
    rarity.replaceChildren(...(model.rarity ? [rarityChip(model.rarity)] : []));
    rarity.hidden = model.rarity === null;
    mood.textContent = model.mood;
    drift.textContent = model.drift ?? '';
    drift.hidden = model.drift === null;
    houseLine.textContent = model.house ?? '';
    houseLine.hidden = model.house === null;
    const driftMood = model.driftMood ?? '';
    drift.dataset['mood'] = driftMood;
    heartsRow.dataset['mood'] = driftMood;
    heartsBadge.textContent = driftMood === 'steady' ? '💕' : driftMood === 'drifting' ? '↘' : '';
    hearts.update(squishy.contentment, squishy.mood, driftMood === 'drifting');
    level.textContent = model.level;
    xpFill.style.width = `${String(Math.round(model.xp * 100))}%`;
    xpLine.textContent = model.xpLine;
    evolving.update(model.evolving);
    whisper.hidden = model.whisper === null;
    whisperIcon.textContent = model.whisper?.icon ?? '';
    whisperText.textContent = model.whisper?.text ?? '';
    whisperSub.textContent = model.whisper?.sub ?? '';
    whisperSub.hidden = model.whisper?.sub === undefined;
    actions.replaceChildren(
      ...model.buttons.map((b) => {
        const button = el(
          'button',
          {
            type: 'button',
            class: `hp-button hp-button-primary care-action${b.special ? ' care-action-special' : ''}`,
            'data-care': b.action,
          },
          b.label,
          ...(b.sub ? [el('span', { class: 'care-action-sub' }, b.sub)] : []),
          ...(b.note ? [el('span', { class: 'care-action-note' }, b.note)] : []),
        );
        button.disabled = working || b.note !== null;
        button.addEventListener('click', () => void act(b.action));
        return button;
      }),
    );
    treatNote.textContent = model.treat ?? '';
    treatNote.hidden = model.treat === null;
    infoList.replaceChildren(...model.info.map((line) => el('li', {}, line)));
    const evolved = evolutionLine(squishy, speciesById(reply));
    celebrate.hidden = evolved === null;
    if (evolved) celebrateLine.textContent = evolved;
    newForm.hidden = !(evolved && model.newForm);
    // A debounced button comes back on by itself (one timer, the soonest).
    const wait = nextReadyIn(squishy, now);
    if (wait !== null) readyTimer = window.setTimeout(render, wait + 50);
  }

  /** The food row's tiles: icon, short name and count, the pick pressed. */
  function renderFoods(): void {
    foodTiles.hidden = foods === null;
    foodHint.hidden = foods === null || foods.hint === '';
    foodHint.textContent = foods?.hint ?? '';
    foodTiles.replaceChildren(
      ...(foods?.tiles ?? []).map((tile) => {
        const button = el(
          'button',
          {
            type: 'button',
            class: tile.best ? 'care-food care-food-best' : 'care-food',
            'aria-pressed': String(tile.picked),
            'aria-label': FOOD_TEXT.tile(tile.name, tile.count),
            'data-food': tile.id,
            'data-testid': 'care-food',
          },
          el('span', { 'aria-hidden': 'true' }, `${tile.icon} ${tile.short} `),
          el('b', { 'aria-hidden': 'true' }, String(tile.count)),
          ...(tile.best
            ? [el('span', { class: 'care-food-tag', 'aria-hidden': 'true' }, FOOD_TEXT.best)]
            : []),
        );
        button.disabled = working;
        button.addEventListener('click', () => {
          foodPick = tile.id;
          render();
        });
        return button;
      }),
    );
  }

  async function act(action: string): Promise<void> {
    const id = squishyId;
    const map = mapId;
    if (!id || !map || working) return;
    // Feed pays with the row's pick; plain Treats (and no row) send no itemId, as before.
    const food =
      action === FEED_ACTION && foods && foods.picked !== PLAIN_FOOD ? foods.picked : undefined;
    const mine = ticket;
    working = true;
    render();
    try {
      const next = await sendCommand(
        sendDeps,
        (key) => api.care(map, id, action, key, food),
        () => mine === ticket,
      );
      if (!next || mine !== ticket) return;
      setReply(next);
      // The server's own number decides the big moment, never a client guess.
      const big = bigFeed(next.result);
      if (big) yums += 1;
      note.textContent = careDoneLine(next.result, big);
      squish('care', big);
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

  /** The real squishy in place of the blob once it's drawn (#375); the blob until then. */
  function showPortrait(squishy: CareSquishy, current: CareListResponse): void {
    const key = `${squishy.id}|${squishy.speciesId}|${squishy.accessory ?? ''}`;
    if (key === portraitKey) return;
    portraitKey = key;
    blob.classList.remove('care-blob-real');
    blob.replaceChildren(face.node);
    const species = speciesById(current).get(squishy.speciesId);
    if (!options.portraits || !species) return;
    void options.portraits
      .get({ species, instanceId: squishy.id, accessory: squishy.accessory })
      .then((url) => {
        if (!url || portraitKey !== key) return;
        blob.replaceChildren(el('img', { src: url, alt: '', class: 'care-portrait' }));
        blob.classList.add('care-blob-real');
        blob.style.background = '';
      });
  }

  function hide(): void {
    const wasOpen = !panel.hidden;
    portraitKey = '';
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
    ticket += 1;
    mapId = null;
    squishyId = null;
    reply = null;
    foodPick = null;
    foods = null;
    panel.hidden = true;
    celebrate.hidden = true;
    note.textContent = '';
    if (wasOpen) options.onClosed?.();
  }

  /** Loads the patch's care list and shows the squishy `pick` chooses (nothing if it picks none). */
  async function load(
    map: string,
    pick: (list: CareListResponse) => CareSquishy | undefined,
    quiet: boolean,
    food: string | null = null,
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
      if (panel.hidden) {
        panel.hidden = false;
        panel.scrollTop = 0;
      }
      note.textContent = messageOf(err);
      render();
      return;
    }
    if (mine !== ticket) return;
    const picked = pick(list);
    const chosen = picked ?? (quiet ? undefined : list.squishies[0]);
    if (!chosen && quiet) return;
    // A different squishy (or a food asked for) starts from that pick, or the best.
    if (food !== null || chosen?.id !== squishyId) foodPick = food;
    mapId = map;
    squishyId = chosen?.id ?? null;
    setReply(list);
    // Asked for one that isn't here (it grew up, or it's in the Hollow): say so.
    note.textContent = !picked && chosen ? CARE_TEXT.notHere : '';
    const opening = panel.hidden;
    panel.hidden = false;
    // The sheet keeps its scroll while hidden: a sheet closed from the bottom
    // would open with its name under the account pill (#385).
    if (opening) panel.scrollTop = 0;
    render();
    if (chosen?.newEvolution) squish('evolve');
  }

  return {
    open: (map, id, food) =>
      load(map, (list) => list.squishies.find((s) => s.id === id), false, food ?? null),
    // The first squishy this food is extra yummy for (a Frost one for Frosty
    // Treats), else the first.
    openWithFood: (map, food) =>
      load(
        map,
        (list) =>
          list.squishies.find(
            (s) => bestFood({ [PLAIN_FOOD]: 1, [food]: 1 }, s.element) === food,
          ) ?? list.squishies[0],
        false,
        food,
      ),
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
        foods: foods?.tiles.map((t) => t.id) ?? [],
        food: foods?.picked ?? null,
        yums,
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
  const belly = part('ellipse', {
    cx: '44',
    cy: '58',
    rx: '18',
    ry: '12',
    class: 'care-face-belly',
  });
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
