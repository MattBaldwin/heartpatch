import {
  completeKeeperConfig,
  defaultKeeperConfig,
  KEEPER_DATA,
  KeeperEyesSchema,
  type KeeperBodyType,
  type KeeperConfig,
  type KeeperEyes,
  type KeeperFaceLine,
  type KeeperSwatch,
  type PublicUser,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../../engine/config.js';
import type { SceneBuilder, SceneContent } from '../../engine/stage.js';
import { lodFor } from '../../procedural/motion.js';
import { el, messageOf } from '../dom.js';
import { keeperApi, type KeeperApi } from './keeper-api.js';
import { KeeperPreview } from './keeper-preview.js';
import { saveForSession } from './keeper-save.js';
import {
  bodyTileSvg,
  faceTileSvg,
  KEEPER_STEPS,
  nextStep,
  previousStep,
  type KeeperStep,
} from './keeper-steps.js';
import { watchScrollHints } from './scroll-hint.js';
import './keeper.css';

// Picking your Keeper (design doc §23, issue #42): right after signup and
// before the opening cinematic (#46) and the tutorial, and again
// any time from Settings, for free. One step per screen (#372): face, body
// and outfit, skin, hair style, hair and eye colours, face details, with Back and Next,
// in a bottom card for one thumb and the Keeper in 3D above it. Every step
// starts on a pick, so Next all the way through makes a Keeper; the step
// tabs jump straight to any step. Picks are tried on the device; only
// "That's me!" talks to the server, which checks every id.

export type KeeperPickerMode = 'first' | 'edit';

export interface KeeperScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the preview, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player has a Keeper (from before, or just picked): the game goes on. */
  onReady: (user: PublicUser) => void;
  /** The picker is taking the screen (edit mode): put the map and lobby away. */
  onEditOpen: () => void;
  /** The editor closed; `saved` says whether the Keeper changed. */
  onEditClosed: (saved: boolean) => void;
  api?: Pick<KeeperApi, 'get' | 'save'>;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface KeeperDebug {
  readonly mode: KeeperPickerMode | null;
  /** What the picker shows right now. */
  readonly picked: KeeperConfig | null;
  /** The step on screen (#372), while the picker is open. */
  readonly step: KeeperStep | null;
  /** The player's saved Keeper, once known. */
  readonly saved: KeeperConfig | null;
  /** `keeperHash` of the 3D preview, while it's on screen. */
  readonly preview: string | null;
  /**
   * Where the preview put the Keeper (#372, CSS px from the top): its feet
   * and the top of its hair, and the band it had to fit (top bar to card).
   */
  readonly fit: { feet: number; head: number; top: number; bottom: number } | null;
  readonly hopping: boolean;
}

export interface KeeperScreen {
  setUser: (user: PublicUser | null) => void;
  /** Opens the picker to change the Keeper (Settings). */
  edit: () => void;
  /** The Settings rows. */
  settings: () => Node[];
  /** The player's saved Keeper, once known. */
  readonly current: KeeperConfig | null;
  readonly debug: KeeperDebug | null;
}

export const KEEPER_TEXT = {
  first: { title: 'Pick your Keeper!' },
  edit: { title: 'Your Keeper' },
  save: { first: 'That’s me!', edit: 'Save' },
  saving: 'One moment…',
  back: 'Back',
  next: 'Next',
  /** The steps (#372): a short tab name and what to do on it. */
  steps: {
    face: { tab: 'Face', prompt: 'Pick a face shape!' },
    body: { tab: 'Body', prompt: 'Pick a body and an outfit!' },
    skin: { tab: 'Skin', prompt: 'Pick a skin tone!' },
    hairstyle: { tab: 'Hair', prompt: 'Pick a hair style!' },
    hairColor: { tab: 'Colors', prompt: 'Pick your hair and eye colors!' },
    details: { tab: 'Details', prompt: 'Eyes, brows and a smile!' },
  } satisfies Record<KeeperStep, { tab: string; prompt: string }>,
  /** Screen readers: where the player is. */
  stepOf: (n: number, of: number) => `Step ${String(n)} of ${String(of)}`,
  /** Under a step whose list scrolls: there's more below. */
  more: 'More ↓',
  loadFailed: 'We couldn’t find your Keeper. Check your connection and try again!',
  retry: 'Try again',
  settings: 'Change how you look, any time!',
  settingsButton: 'Change Keeper',
  /** Back in the lobby after a change. */
  changed: 'Looking good, Keeper!',
  /** Choice labels (#289, #372). */
  rows: {
    face: 'Face',
    body: 'Body',
    skin: 'Skin',
    eyes: 'Eyes',
    eyeColor: 'Eye color',
    brows: 'Brows',
    mouth: 'Mouth',
    extras: 'Extras',
    hairstyle: 'Hair style',
    hair: 'Hair',
    outfit: 'Outfit',
  },
  /** Skin tones have no names: "Skin tone 1" (lightest) to "Skin tone 10". */
  skinTone: (n: number) => `Skin tone ${String(n)}`,
  eyeShapes: { round: 'Round', oval: 'Oval', happy: 'Happy', sleepy: 'Sleepy' } satisfies Record<
    KeeperEyes,
    string
  >,
} as const;

const bases = KEEPER_DATA.bases;
const firstBase = bases[0];
if (!firstBase) throw new Error('no Keeper bases');
/** What a new player's picker starts on. */
const starter = (): KeeperConfig => defaultKeeperConfig(firstBase);

/** The style `config` shows: its own pick, else its base's. */
export function styleOf(config: KeeperConfig): string | undefined {
  return config.hairstyle ?? bases.find((b) => b.id === config.base)?.hairstyle;
}

/** `config` wearing hairstyle `id`; the base's own style is stored as none. */
export function withHairstyle(config: KeeperConfig, id: string): KeeperConfig {
  const rest: KeeperConfig = { ...config };
  delete rest.hairstyle;
  const own = bases.find((b) => b.id === config.base)?.hairstyle;
  return id === own ? rest : { ...rest, hairstyle: id };
}

/** The skin tone and outfit top a config's tile drawings wear. */
function tileColors(config: KeeperConfig): { skin: string; top: string } {
  return {
    skin: KEEPER_DATA.skinTones.find((t) => t.id === config.skinTone)?.color ?? '#f6cfae',
    top: KEEPER_DATA.outfits.find((o) => o.id === config.outfit)?.top ?? '#ffd85a',
  };
}

export function createKeeperScreen(options: KeeperScreenOptions): KeeperScreen {
  const api = options.api ?? keeperApi;

  let user: PublicUser | null = null;
  /** Bumped on every login change, so a slow fetch can't land on another player. */
  let session = 0;
  let saved: KeeperConfig | null = null;
  let mode: KeeperPickerMode | null = null;
  let picked: KeeperConfig = starter();
  let preview: KeeperPreview | null = null;
  let frame = 0;
  let lastTier: QualityTier | null = null;
  let step: KeeperStep = 'face';

  const title = el('h1', { class: 'auth-title', id: 'keeper-title' });
  const tabs = el('div', { class: 'keeper-tabs', role: 'tablist', 'aria-label': 'Steps' });
  /** Screen readers: "Step 2 of 6" (the tabs show numbers on a phone). */
  const stepOf = el('span', { class: 'keeper-sr' });
  const prompt = el('p', { class: 'auth-subtitle keeper-subtitle', id: 'keeper-prompt' });
  const rows = el('div', {
    class: 'keeper-rows',
    id: 'keeper-step-panel',
    role: 'tabpanel',
    'data-testid': 'keeper-step',
  });
  /** The picked body's name (#372): body tiles have no names on a phone. */
  const caption = el('span', { class: 'keeper-caption', 'aria-hidden': 'true' });
  // A list that scrolls says so plainly; taps go through to the choices under it.
  const more = el('span', { class: 'keeper-more', 'aria-hidden': 'true' }, KEEPER_TEXT.more);
  const list = el('div', { class: 'keeper-list' }, rows, more);
  const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'keeper-error' });
  const actions = el('div', { class: 'auth-actions keeper-actions' });
  const card = el(
    'div',
    { class: 'auth-card keeper-card' },
    title,
    tabs,
    prompt,
    list,
    error,
    actions,
  );
  const panel = el(
    'section',
    {
      class: 'keeper-picker',
      'data-testid': 'keeper-picker',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'keeper-title',
    },
    card,
  );
  panel.hidden = true;
  options.root.append(panel);

  // ── Preview ───────────────────────────────────────────────────────────
  const build = (scene: Scene): SceneContent => {
    const built = new KeeperPreview(scene, lodFor('closeUp', options.tier()));
    lastTier = options.tier();
    built.show(picked, performance.now(), false);
    preview = built;
    requestAnimationFrame(fitPreview);
    scene.onDisposeObservable.addOnce(() => {
      if (preview === built) preview = null;
      built.dispose();
    });
    return built.content;
  };

  /**
   * Keeps the whole Keeper on screen between the top bar and the card (#372):
   * on a short phone the card would hide its legs.
   */
  const fitPreview = (): void => {
    if (mode === null || !preview) return;
    preview.setBand({
      top: parseFloat(getComputedStyle(panel).paddingTop) || 0,
      bottom: card.getBoundingClientRect().top,
    });
    options.invalidate();
  };
  // The card's own box is watched too: iOS sends `resize` before a turned
  // layout settles and none after (#251), and an iPad card's height follows
  // its step. Window `resize` still covers the top bar's room.
  const refit = (): void => {
    requestAnimationFrame(fitPreview);
  };
  window.addEventListener('resize', refit);
  new ResizeObserver(refit).observe(card);

  /** Draws while the Keeper hops, and follows the quality tier's detail level. */
  const tick = (): void => {
    frame = 0;
    if (mode === null) return;
    const p = preview;
    if (p) {
      const tier = options.tier();
      if (tier !== lastTier) {
        lastTier = tier;
        p.setLod(lodFor('closeUp', tier));
        options.invalidate();
      }
      if (p.update(performance.now())) options.invalidate();
    }
    frame = requestAnimationFrame(tick);
  };

  // ── Card ──────────────────────────────────────────────────────────────
  /** The body tiles' drawings on screen, repainted when the outfit changes. */
  let bodyArt: { node: HTMLElement; body: KeeperBodyType }[] = [];

  /** Every choice on the card and whether it's the one picked now. */
  let choices: { node: HTMLButtonElement; isPicked: () => boolean }[] = [];

  /** Marks the picked choices in place, so a tap never loses its place or focus. */
  const refresh = () => {
    for (const c of choices) c.node.setAttribute('aria-pressed', String(c.isPicked()));
    const body = completeKeeperConfig(picked, KEEPER_DATA).body;
    caption.textContent =
      step === 'body' ? (KEEPER_DATA.bodies.find((b) => b.id === body)?.name ?? '') : '';
  };

  const pick = (next: KeeperConfig) => {
    picked = completeKeeperConfig(next, KEEPER_DATA);
    refresh();
    preview?.show(picked, performance.now(), true);
    options.invalidate();
  };

  const choice = (
    label: string,
    isPicked: () => boolean,
    onPick: () => void,
    className: string,
    ...children: Node[]
  ) => {
    const node = el(
      'button',
      { type: 'button', class: className, 'aria-label': label, title: label },
      ...children,
    );
    node.addEventListener('click', onPick);
    choices.push({ node, isPicked });
    return node;
  };

  const dot = (background: string, extra = '') => {
    const node = el('span', { class: `keeper-dot ${extra}`.trim() });
    node.style.background = background;
    return node;
  };

  /** A tile's drawing (SVG markup this file builds from data, never player text). */
  const drawing = (svg: string) => {
    const node = el('span', { class: 'keeper-tile-art' });
    node.innerHTML = svg;
    return node;
  };

  /** Stops the scroll hints of the step on screen (they're rebuilt with it). */
  let hints = new AbortController();

  /** The step's choices, wrapping onto as many lines as they need. */
  const grid = (...buttons: HTMLElement[]) => el('div', { class: 'keeper-grid' }, ...buttons);
  /** Body tiles: nameless on a phone, so all 14 and the outfits fit (owner, #372). */
  const bodyGrid = (...buttons: HTMLElement[]) =>
    el('div', { class: 'keeper-grid keeper-grid-bodies' }, ...buttons);

  /** One labelled group of choices on the details step: the label above them. */
  const row = (legend: string, ...buttons: HTMLElement[]) => {
    const id = `keeper-row-${legend.toLowerCase().replaceAll(' ', '-')}`;
    return el(
      'div',
      { class: 'keeper-row', role: 'group', 'aria-labelledby': id },
      el('span', { class: 'keeper-legend', id }, legend),
      grid(...buttons),
    );
  };

  const swatches = (
    legend: string,
    rows: readonly KeeperSwatch[],
    field: 'hairColor' | 'eyeColor',
  ) =>
    rows.map((s) =>
      choice(
        `${legend}: ${s.name}`,
        () => picked[field] === s.id,
        () => {
          pick({ ...picked, [field]: s.id });
        },
        'keeper-swatch',
        dot(s.color),
      ),
    );

  /** Named pills (brows, mouths, eyes, extras, hair styles). */
  const pill = (label: string, name: string, isPicked: () => boolean, onPick: () => void) =>
    choice(
      label,
      isPicked,
      onPick,
      'keeper-style',
      el('span', { class: 'keeper-base-name' }, name),
    );

  /** A named drawing (faces and bodies). */
  const tile = (
    label: string,
    name: string,
    svg: string,
    isPicked: () => boolean,
    onPick: () => void,
    body?: KeeperBodyType,
  ) => {
    const art = drawing(svg);
    if (body) bodyArt.push({ node: art, body });
    return choice(
      label,
      isPicked,
      onPick,
      'keeper-tile',
      art,
      el('span', { class: 'keeper-base-name' }, name),
    );
  };

  /** The choices of `on`, built from the picks so far (tiles wear the skin tone). */
  function choicesFor(on: KeeperStep): HTMLElement[] {
    const T = KEEPER_TEXT.rows;
    const full = completeKeeperConfig(picked, KEEPER_DATA);
    const { skin, top } = tileColors(full);
    switch (on) {
      case 'face':
        return [
          grid(
            ...KEEPER_DATA.faces.map((f) =>
              tile(
                `${T.face}: ${f.name}`,
                f.name,
                faceTileSvg(f, skin),
                () => completeKeeperConfig(picked, KEEPER_DATA).face === f.id,
                () => {
                  pick({ ...picked, face: f.id });
                },
              ),
            ),
          ),
        ];
      case 'body':
        return [
          bodyGrid(
            ...KEEPER_DATA.bodies.map((b) =>
              tile(
                `${T.body}: ${b.name}`,
                b.name,
                bodyTileSvg(b, skin, top),
                () => completeKeeperConfig(picked, KEEPER_DATA).body === b.id,
                () => {
                  pick({ ...picked, body: b.id });
                },
                b,
              ),
            ),
          ),
          row(
            T.outfit,
            ...KEEPER_DATA.outfits.map((o) =>
              choice(
                `${T.outfit}: ${o.name}`,
                () => picked.outfit === o.id,
                () => {
                  pick({ ...picked, outfit: o.id });
                  repaintBodies(); // the body tiles wear the outfit's top
                },
                'keeper-swatch',
                dot(`linear-gradient(${o.top} 0 55%, ${o.bottom} 55% 100%)`),
              ),
            ),
          ),
        ];
      case 'skin':
        return [
          grid(
            ...KEEPER_DATA.skinTones.map((tone, i) =>
              choice(
                KEEPER_TEXT.skinTone(i + 1),
                () => picked.skinTone === tone.id,
                () => {
                  pick({ ...picked, skinTone: tone.id });
                },
                'keeper-swatch',
                dot(tone.color),
              ),
            ),
          ),
        ];
      // Any Keeper can wear any style (owner decision 2026-10-06).
      case 'hairstyle':
        return [
          grid(
            ...KEEPER_DATA.hairstyles.map((h) =>
              pill(
                `${T.hairstyle}: ${h.name}`,
                h.name,
                () => styleOf(picked) === h.id,
                () => {
                  pick(withHairstyle(picked, h.id));
                },
              ),
            ),
          ),
        ];
      // Hair and eye colours together (#372), so face details fit a phone.
      case 'hairColor':
        return [
          row(T.hair, ...swatches(T.hair, KEEPER_DATA.hairColors, 'hairColor')),
          row(T.eyeColor, ...swatches(T.eyeColor, KEEPER_DATA.eyeColors, 'eyeColor')),
        ];
      case 'details': {
        /** A group of named line styles (brows or mouths). */
        const lines = (legend: string, list: readonly KeeperFaceLine[], field: 'brows' | 'mouth') =>
          row(
            legend,
            ...list.map((l) =>
              pill(
                `${legend}: ${l.name}`,
                l.name,
                () => picked[field] === l.id,
                () => {
                  pick({ ...picked, [field]: l.id });
                },
              ),
            ),
          );
        return [
          row(
            T.eyes,
            ...KeeperEyesSchema.options.map((eyes) =>
              pill(
                `${T.eyes}: ${KEEPER_TEXT.eyeShapes[eyes]}`,
                KEEPER_TEXT.eyeShapes[eyes],
                () => picked.eyes === eyes,
                () => {
                  pick({ ...picked, eyes });
                },
              ),
            ),
          ),
          lines(T.brows, KEEPER_DATA.brows, 'brows'),
          lines(T.mouth, KEEPER_DATA.mouths, 'mouth'),
          // Any number, all off to start, and every Keeper can pick any.
          row(
            T.extras,
            ...KEEPER_DATA.faceExtras.map((extra) =>
              pill(
                `${T.extras}: ${extra.name}`,
                extra.name,
                () => picked.extras?.includes(extra.id) ?? false,
                () => {
                  const on = picked.extras ?? [];
                  pick({
                    ...picked,
                    extras: on.includes(extra.id)
                      ? on.filter((id) => id !== extra.id)
                      : [...on, extra.id],
                  });
                },
              ),
            ),
          ),
        ];
      }
    }
  }

  const button = (label: string, onClick: () => void, soft = false) => {
    const node = el(
      'button',
      {
        type: 'button',
        class: soft ? 'hp-button hp-button-secondary' : 'hp-button hp-button-primary',
      },
      label,
    );
    node.addEventListener('click', onClick);
    return node;
  };

  /** Repaints the body tiles in the picked skin and outfit, in place (taps keep their focus). */
  function repaintBodies(): void {
    const full = completeKeeperConfig(picked, KEEPER_DATA);
    const { skin, top } = tileColors(full);
    for (const { node, body } of bodyArt) node.innerHTML = bodyTileSvg(body, skin, top);
  }

  // The steps' tabs, made once (#372): a tap moves the selection, not the focus.
  const tabButtons = KEEPER_STEPS.map((s, i) => {
    const name = KEEPER_TEXT.steps[s].tab;
    // On a phone only the step on screen shows its name; the rest are numbers,
    // so the label says both (what Voice Control hears matches what shows).
    const tab = el(
      'button',
      {
        type: 'button',
        class: 'keeper-tab',
        id: `keeper-tab-${s}`,
        role: 'tab',
        'aria-selected': 'false',
        'aria-controls': 'keeper-step-panel',
        'aria-label': `${String(i + 1)} ${name}`,
        'data-step': s,
      },
      el('span', { class: 'keeper-tab-number', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'keeper-tab-name', 'aria-hidden': 'true' }, name),
    );
    tab.addEventListener('click', () => {
      showStep(s);
    });
    return tab;
  });
  tabs.replaceChildren(...tabButtons);
  // Arrow keys, Home and End move between the tabs (the ARIA tabs pattern).
  tabs.addEventListener('keydown', (event) => {
    const here = KEEPER_STEPS.indexOf(step);
    const last = KEEPER_STEPS.length - 1;
    const goTo = { ArrowRight: here + 1, ArrowLeft: here - 1, Home: 0, End: last }[event.key];
    if (goTo === undefined) return;
    const at = (goTo + KEEPER_STEPS.length) % KEEPER_STEPS.length;
    const to = KEEPER_STEPS[at];
    if (!to) return;
    event.preventDefault();
    showStep(to);
    tabButtons[at]?.focus();
  });

  // Back and Next (first time), Back and Save (editing): made once.
  const backButton = button(
    KEEPER_TEXT.back,
    () => {
      const before = previousStep(step);
      if (before) showStep(before);
    },
    true,
  );
  const forwardButton = button(KEEPER_TEXT.next, () => {
    const after = nextStep(step);
    if (after) showStep(after);
    else void submit(forwardButton);
  });
  const leaveButton = button(
    KEEPER_TEXT.back,
    () => {
      close(false);
    },
    true,
  );
  const saveButton = button(KEEPER_TEXT.save.edit, () => void submit(saveButton));

  /** Shows step `next`: its tab, its choices, and its buttons. */
  function showStep(next: KeeperStep): void {
    if (mode === null) return;
    const on = mode;
    step = next;
    choices = [];
    bodyArt = [];
    error.textContent = '';
    const number = KEEPER_STEPS.indexOf(next) + 1;
    stepOf.textContent = `${KEEPER_TEXT.stepOf(number, KEEPER_STEPS.length)}: `;
    prompt.replaceChildren(stepOf, KEEPER_TEXT.steps[next].prompt, caption);
    for (const tab of tabButtons) {
      const on = tab.dataset['step'] === next;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) rows.setAttribute('aria-labelledby', tab.id);
    }
    rows.replaceChildren(...choicesFor(next));
    rows.scrollTop = 0;
    refresh();

    // First time: Back and Next, then "That's me!" on the last step. Editing:
    // the tabs pick the step, and Save is always there. The buttons stay put
    // (only their words change), so the one just pressed keeps the focus.
    if (on === 'first') {
      const before = previousStep(next);
      if (before === null && document.activeElement === backButton) forwardButton.focus();
      backButton.disabled = before === null;
      forwardButton.textContent = nextStep(next) ? KEEPER_TEXT.next : KEEPER_TEXT.save.first;
    }

    hints.abort();
    hints = new AbortController();
    const update = watchScrollHints([{ node: rows, axis: 'y' }], hints.signal);
    // Measured once the card is on screen (it's hidden while it's built).
    requestAnimationFrame(() => {
      update();
      fitPreview();
      // A long step (hair styles) opens on what's picked.
      rows
        .querySelector<HTMLElement>('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function open(next: KeeperPickerMode, at: KeeperStep = 'face'): void {
    mode = next;
    tabs.hidden = false;
    title.textContent = KEEPER_TEXT[next].title;
    panel.dataset['mode'] = next;
    actions.replaceChildren(
      ...(next === 'first' ? [backButton, forwardButton] : [leaveButton, saveButton]),
    );
    showStep(at);
    panel.hidden = false;
    options.showScene(build);
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  /** Unlocks every control a save may have locked, with its own words (a new player). */
  function releaseControls(): void {
    for (const node of [...tabButtons, backButton, leaveButton, forwardButton, saveButton]) {
      node.disabled = false;
    }
    forwardButton.textContent = KEEPER_TEXT.next;
    saveButton.textContent = KEEPER_TEXT.save.edit;
  }

  function close(didSave: boolean): void {
    const was = mode;
    mode = null;
    panel.hidden = true;
    hints.abort();
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (was !== null) options.showScene(null);
    if (was === 'edit') options.onEditClosed(didSave);
  }

  async function submit(save: HTMLButtonElement): Promise<void> {
    const who = user;
    const mine = session;
    if (!who || save.disabled) return;
    const label = save.textContent;
    save.disabled = true;
    save.textContent = KEEPER_TEXT.saving;
    // Nothing else moves while it saves: no second save from another step.
    const lock = [...tabButtons, backButton, leaveButton];
    const wasDisabled = lock.map((node) => node.disabled);
    for (const node of lock) node.disabled = true;
    error.textContent = '';
    try {
      // Null when another player logged in meanwhile: their Keeper stays theirs.
      const kept = await saveForSession(
        (config) => api.save(config),
        picked,
        () => session,
      );
      if (kept === null) return;
      saved = kept;
      const first = mode === 'first';
      close(true);
      if (first) options.onReady(who);
    } catch (err) {
      if (mine === session) error.textContent = messageOf(err);
    } finally {
      // Another player since: the controls were handed back to them when the
      // player changed (`releaseControls`), so this save leaves them alone.
      if (mine === session) {
        save.disabled = false;
        save.textContent = label;
        lock.forEach((node, i) => {
          node.disabled = wasDisabled[i] ?? false;
        });
      }
    }
  }

  /** Couldn't ask the server: say so, with a way to try again (never a dead end). */
  function showLoadFailed(who: PublicUser): void {
    mode = 'first';
    title.textContent = KEEPER_TEXT.first.title;
    tabs.hidden = true;
    prompt.textContent = '';
    rows.replaceChildren();
    error.textContent = KEEPER_TEXT.loadFailed;
    actions.replaceChildren(button(KEEPER_TEXT.retry, () => void check(who)));
    panel.hidden = false;
  }

  async function check(who: PublicUser): Promise<void> {
    const mine = session;
    try {
      const keeper = await api.get();
      if (mine !== session) return;
      saved = keeper && completeKeeperConfig(keeper, KEEPER_DATA);
      if (keeper) {
        close(false);
        options.onReady(who);
      } else {
        picked = starter();
        open('first');
      }
    } catch {
      if (mine === session) showLoadFailed(who);
    }
  }

  const edit = () => {
    if (!user || mode !== null) return;
    picked = saved ?? starter();
    options.onEditOpen();
    open('edit');
  };

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      session += 1;
      user = next;
      saved = null;
      releaseControls();
      close(false);
      if (next) void check(next);
    },
    edit,
    settings: () => {
      if (!user) return [];
      const change = el(
        'button',
        {
          type: 'button',
          class: 'hp-button hp-button-secondary',
          'data-testid': 'keeper-settings',
        },
        KEEPER_TEXT.settingsButton,
      );
      change.addEventListener('click', edit);
      return [el('p', { class: 'auth-subtitle' }, KEEPER_TEXT.settings), change];
    },
    get current() {
      return saved;
    },
    get debug() {
      if (!user) return null;
      const now = performance.now();
      return {
        mode,
        picked: mode === null ? null : picked,
        step: mode === null ? null : step,
        saved,
        preview: preview?.hash ?? null,
        fit: preview?.fitted ?? null,
        hopping: preview?.isPlaying(now) ?? false,
      };
    },
  };
}
