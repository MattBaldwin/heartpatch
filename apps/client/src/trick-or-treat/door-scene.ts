import { buttonClass, hpButton } from '../ui/button/button.js';
import { el } from '../ui/dom.js';
import { DOOR_TEXT, sceneLines, type DoorBeat, type DoorScene } from './door-view.js';
import './door-scene.css';

// The drawn door (#515 part C, the approved plan): a porch over the dimmed
// map, where the Keeper and their Partner knock. The house, door and pumpkin
// are one inline SVG, so the scene costs no GPU time on an older iPad; the
// Keeper and the Partner are the real 3D toys, drawn once by the portrait
// renderer and set on the porch as pictures. CSS plays every beat from one
// `data-scene` attribute, and Reduce Motion shows the same beats standing still.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an SVG node (the `el` helper is HTML only). */
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

const ARCH = 'M150 242 V190 a30 30 0 0 1 60 0 V242 Z';

/** Confetti pieces: where they start across the top, their colour, delay and fall time. */
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  hue: ['#ff8fb8', '#ffc94d', '#7ec88d', '#6fb4f0', '#f08a24', '#b794f4'][i % 6] ?? '#ff8fb8',
  delay: ((i * 53) % 70) / 100,
  fall: 1.7 + ((i * 29) % 9) / 10,
  turn: (i * 47) % 360,
}));

function houseArt(): SVGSVGElement {
  const defs = svg(
    'defs',
    {},
    svg(
      'radialGradient',
      { id: 'door-light', cx: '50%', cy: '70%', r: '70%' },
      svg('stop', { offset: '0', 'stop-color': '#fff3b0' }),
      svg('stop', { offset: '1', 'stop-color': '#f7a93b' }),
    ),
    svg(
      'radialGradient',
      { id: 'door-glow', cx: '50%', cy: '50%', r: '50%' },
      svg('stop', { offset: '0', 'stop-color': '#ffb347', 'stop-opacity': '0.75' }),
      svg('stop', { offset: '1', 'stop-color': '#ffb347', 'stop-opacity': '0' }),
    ),
    svg('clipPath', { id: 'door-arch' }, svg('path', { d: ARCH })),
  );

  const house = svg(
    'g',
    { class: 'door-house' },
    svg('ellipse', { cx: '180', cy: '272', rx: '168', ry: '30', fill: '#7ec88d' }),
    svg('path', { d: 'M148 246 H212 L240 276 H120 Z', fill: '#e6c79a' }),
    svg('rect', { x: '58', y: '126', width: '244', height: '120', rx: '30', fill: '#fde8d4' }),
    svg('path', {
      d: 'M20 142 C36 94 112 76 180 76 C248 76 324 94 340 142 C270 130 90 130 20 142 Z',
      fill: '#b8487a',
    }),
    svg('ellipse', { cx: '118', cy: '100', rx: '32', ry: '8', fill: '#fff', opacity: '0.18' }),
    svg('path', {
      transform: 'translate(0 24)',
      d: 'M180 52 c-6-9 -20-4 -16 8 c3 8 12 12 16 17 c4-5 13-9 16-17 c4-12 -10-17 -16-8 Z',
      fill: '#ff8fb8',
    }),
    // Windows glow warm: somebody is home.
    ...[100, 260].map((cx) =>
      svg(
        'g',
        { class: 'door-window' },
        svg('circle', { cx: String(cx), cy: '192', r: '25', fill: '#ecc8a2' }),
        svg('circle', { cx: String(cx), cy: '192', r: '20', fill: '#fbc54d' }),
        svg('path', {
          d: `M${String(cx - 20)} 192 H${String(cx + 20)} M${String(cx)} 172 V212`,
          stroke: '#ecc8a2',
          'stroke-width': '3',
        }),
      ),
    ),
    svg('path', { d: ARCH, fill: '#ecc8a2', stroke: '#ecc8a2', 'stroke-width': '12' }),
    // The warm light and what stands in it, behind the door.
    svg('path', { d: ARCH, class: 'door-light', fill: 'url(#door-light)' }),
    svg(
      'g',
      { 'clip-path': 'url(#door-arch)' },
      svg(
        'g',
        { class: 'door-ghost' },
        svg('path', {
          d: 'M164 246 V196 C164 176 196 176 196 196 V246 L190 241 L184 247 L180 241 L174 247 L170 241 Z',
          fill: '#fff',
          stroke: '#e5d8f2',
          'stroke-width': '2',
        }),
        svg('circle', { cx: '173', cy: '199', r: '3', fill: '#4a3150' }),
        svg('circle', { cx: '187', cy: '199', r: '3', fill: '#4a3150' }),
        svg('circle', { cx: '169', cy: '206', r: '3', fill: '#ffb3cf', opacity: '0.8' }),
        svg('circle', { cx: '191', cy: '206', r: '3', fill: '#ffb3cf', opacity: '0.8' }),
        svg('path', {
          d: 'M175 207 Q180 213 185 207',
          fill: 'none',
          stroke: '#4a3150',
          'stroke-width': '2.4',
          'stroke-linecap': 'round',
        }),
      ),
      svg(
        'g',
        { class: 'door-pail' },
        svg('path', {
          d: 'M168 190 V176 a12 14 0 0 1 24 0 V190',
          fill: 'none',
          stroke: '#8a62c4',
          'stroke-width': '4',
          'stroke-linecap': 'round',
        }),
        svg('path', { d: 'M160 188 H200 L194 228 H166 Z', fill: '#f08a24' }),
        svg('rect', { x: '157', y: '184', width: '46', height: '8', rx: '3', fill: '#f5a13d' }),
        svg('path', {
          d: 'M171 204 l4-4 l4 4 M181 204 l4-4 l4 4',
          fill: 'none',
          stroke: '#4a3150',
          'stroke-width': '2.2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
        svg('path', {
          d: 'M173 212 Q180 220 187 212',
          fill: 'none',
          stroke: '#4a3150',
          'stroke-width': '2.6',
          'stroke-linecap': 'round',
        }),
        svg('path', {
          d: 'M146 180 l3-8 l3 8 l8 3 l-8 3 l-3 8 l-3-8 l-8-3 Z',
          fill: '#ffe27a',
          class: 'door-twinkle',
        }),
        svg('path', {
          d: 'M214 186 l2-6 l2 6 l6 2 l-6 2 l-2 6 l-2-6 l-6-2 Z',
          fill: '#ffe27a',
          class: 'door-twinkle door-twinkle-b',
        }),
      ),
    ),
    // The door swings on its left hinge.
    svg(
      'g',
      { class: 'door-panel' },
      svg('path', { d: ARCH, fill: '#c98450' }),
      svg('path', {
        d: 'M170 188 V242 M190 188 V242',
        stroke: '#a96a38',
        'stroke-width': '3',
      }),
      svg('circle', { cx: '199', cy: '218', r: '4.5', fill: '#ffc94d' }),
    ),
    // Open, the door stands at the side of the doorway, seen edge-on.
    svg('path', {
      class: 'door-leaf',
      d: 'M146 188 L122 198 L122 254 L146 244 Z',
      fill: '#c98450',
    }),
    svg('circle', { class: 'door-leaf', cx: '127', cy: '226', r: '3.2', fill: '#ffc94d' }),
    svg('rect', { x: '138', y: '238', width: '84', height: '11', rx: '5.5', fill: '#dcb98c' }),
  );

  // The pumpkin by the step: it glows when its home's lantern is lit.
  const pumpkin = svg(
    'g',
    { class: 'door-pumpkin' },
    svg('circle', {
      class: 'door-pumpkin-glow',
      cx: '58',
      cy: '262',
      r: '58',
      fill: 'url(#door-glow)',
    }),
    svg('path', {
      d: 'M56 232 q-2-9 8-12',
      fill: 'none',
      stroke: '#5f8f3f',
      'stroke-width': '5',
      'stroke-linecap': 'round',
    }),
    svg('ellipse', { cx: '58', cy: '256', rx: '34', ry: '28', fill: '#f08a24' }),
    svg('ellipse', { cx: '44', cy: '256', rx: '14', ry: '26', fill: '#f5a13d', opacity: '0.7' }),
    svg('path', { d: 'M42 250 l8-9 l8 9 Z M62 250 l8-9 l8 9 Z', fill: '#fbd46a' }),
    svg('path', {
      d: 'M40 266 q18 14 36 0 q-6 4 -10 -2 q-8 6 -16 0 q-4 6 -10 2 Z',
      fill: '#fbd46a',
    }),
  );

  return svg(
    'svg',
    { viewBox: '0 0 360 300', class: 'door-art', role: 'img', 'aria-label': '' },
    defs,
    house,
    pumpkin,
  );
}

export interface DoorPictures {
  keeper: Promise<string | null>;
  partner: Promise<string | null>;
}

export interface DoorSceneView {
  /** Puts the porch on screen at "Knock, knock!", ready for a knock. */
  show: (options: {
    hostName: string;
    lit: boolean;
    pictures: DoorPictures;
    onKnock: () => void;
    onClose: () => void;
  }) => void;
  /** The knock is on its way: the door shakes and "Knock, knock…" waits. */
  waiting: () => void;
  /** Plays the beats in turn; a tap skips to the end. `done` runs once, after the last. */
  play: (beats: readonly DoorBeat[], done: () => void) => void;
  /** Takes the porch away (the card or an error comes next). */
  hide: () => void;
  /** Back to "Knock, knock!" after a knock that didn't go through. */
  reset: () => void;
  readonly scene: DoorScene | null;
}

export interface DoorSceneOptions {
  root: HTMLElement;
  /** Sounds for the beats (the game's own cue set). */
  cue?: (name: 'boop' | 'whoosh' | 'giggle' | 'pop') => void;
  setTimer?: (task: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export function createDoorScene(options: DoorSceneOptions): DoorSceneView {
  const setTimer = options.setTimer ?? ((task, ms) => setTimeout(task, ms));
  const cue = options.cue ?? (() => undefined);

  const name = el('p', { class: 'door-name', 'data-testid': 'door-name' });
  const art = houseArt();
  const keeperPicture = el('img', { class: 'door-figure door-keeper', alt: '' });
  const partnerPicture = el('img', { class: 'door-figure door-partner', alt: '' });
  for (const img of [keeperPicture, partnerPicture]) img.hidden = true;
  const knockWords = ['knock!', 'knock!'].map((w, i) =>
    el(
      'span',
      { class: `door-knock-word door-knock-word-${String(i + 1)}`, 'aria-hidden': 'true' },
      w,
    ),
  );
  const confetti = el(
    'div',
    { class: 'door-confetti', 'aria-hidden': 'true' },
    ...CONFETTI.map((c) => {
      const piece = el('i');
      piece.style.cssText = `left:${String(c.left)}%;background:${c.hue};animation-delay:${String(c.delay)}s;animation-duration:${String(c.fall)}s;--turn:${String(c.turn)}deg`;
      return piece;
    }),
  );
  const stage = el(
    'div',
    { class: 'door-stage', 'data-scene': 'knock' },
    art,
    partnerPicture,
    keeperPicture,
    ...knockWords,
    confetti,
  );
  const title = el('h2', { class: 'door-say-title', 'data-testid': 'door-title' });
  const sub = el('p', { class: 'door-say-sub' });
  const say = el('div', { class: 'door-say', role: 'status' }, title, sub);
  const knock = el(
    'button',
    {
      type: 'button',
      class: `${buttonClass({ variant: 'primary' })} door-knock`,
      'data-testid': 'door-knock',
    },
    DOOR_TEXT.knockButton,
  );
  const notNow = hpButton('Not now', { testId: 'door-close' });
  notNow.classList.add('door-close');
  const actions = el('div', { class: 'door-actions' }, knock, notNow);
  const overlay = el(
    'section',
    { class: 'door-overlay', role: 'dialog', 'aria-modal': 'true', 'data-testid': 'door-scene' },
    name,
    stage,
    say,
    actions,
  );
  overlay.hidden = true;
  options.root.append(overlay);

  let scene: DoorScene | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (() => void) | null = null;
  /** Bumped by every show and hide, so late pictures and timers can't land on another visit. */
  let visit = 0;
  let handlers: { onKnock: () => void; onClose: () => void } | null = null;

  function setScene(next: DoorScene): void {
    scene = next;
    stage.dataset['scene'] = next;
    const lines = sceneLines(next);
    title.textContent = lines.title;
    sub.textContent = lines.sub;
    // The button stays up while the knock is on its way, so the scene doesn't jump.
    actions.hidden = next !== 'knock' && next !== 'waiting';
    const waiting = next === 'waiting';
    knock.disabled = waiting;
    notNow.hidden = waiting;
    knock.textContent = waiting ? DOOR_TEXT.knockingButton : DOOR_TEXT.knockButton;
  }

  function place(img: HTMLImageElement, picture: Promise<string | null>, mine: number): void {
    img.hidden = true;
    img.removeAttribute('src');
    void picture.then((url) => {
      if (mine !== visit || !url) return;
      img.src = url;
      img.hidden = false;
    });
  }

  knock.addEventListener('click', () => {
    if (scene !== 'knock') return;
    handlers?.onKnock();
  });
  notNow.addEventListener('click', () => {
    handlers?.onClose();
  });
  // A tap on the picture while it plays skips to the prize.
  stage.addEventListener('click', () => {
    finish?.();
  });

  return {
    show: ({ hostName, lit, pictures, onKnock, onClose }) => {
      visit += 1;
      clearTimeout(timer);
      finish = null;
      handlers = { onKnock, onClose };
      name.textContent = `🏡 ${DOOR_TEXT.home(hostName)}`;
      art.setAttribute('aria-label', DOOR_TEXT.sceneLabel(hostName));
      stage.classList.toggle('door-lit', lit);
      place(partnerPicture, pictures.partner, visit);
      place(keeperPicture, pictures.keeper, visit);
      setScene('knock');
      overlay.hidden = false;
      knock.focus({ preventScroll: true });
    },
    waiting: () => {
      setScene('waiting');
      cue('boop');
      setTimer(() => {
        cue('boop');
      }, 220);
    },
    play: (beats, done) => {
      const mine = visit;
      clearTimeout(timer);
      actions.hidden = true;
      let i = 0;
      let ended = false;
      const end = () => {
        if (ended || mine !== visit) return;
        ended = true;
        clearTimeout(timer);
        finish = null;
        done();
      };
      finish = end;
      const next = () => {
        if (ended || mine !== visit) return;
        const beat = beats[i];
        i += 1;
        if (!beat) {
          end();
          return;
        }
        setScene(beat.scene);
        cue(beat.scene === 'trick' ? 'giggle' : beat.scene === 'open' ? 'whoosh' : 'pop');
        timer = setTimer(next, beat.ms);
      };
      next();
    },
    hide: () => {
      visit += 1;
      clearTimeout(timer);
      finish = null;
      handlers = null;
      overlay.hidden = true;
      scene = null;
    },
    reset: () => {
      setScene('knock');
    },
    get scene() {
      return scene;
    },
  };
}
