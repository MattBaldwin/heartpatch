import {
  defaultKeeperConfig,
  KEEPER_DATA,
  type KeeperConfig,
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
import { watchScrollHints } from './scroll-hint.js';
import './keeper.css';

// Picking your Keeper (design doc §23, issue #42): right after signup and
// before the opening cinematic (#46) and the tutorial, and again
// any time from Settings, for free. A bottom card for one thumb, with the
// Keeper in 3D above it. Colours are tried on the device; only "That's me!"
// talks to the server, which checks every id.

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
  /** The player's saved Keeper, once known. */
  readonly saved: KeeperConfig | null;
  /** `keeperHash` of the 3D preview, while it's on screen. */
  readonly preview: string | null;
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
  first: { title: 'Pick your Keeper!', subtitle: 'This is you in Heartpatch. Change it any time!' },
  edit: { title: 'Your Keeper', subtitle: 'Try a new look. It’s free!' },
  save: { first: 'That’s me!', edit: 'Save' },
  saving: 'One moment…',
  back: 'Back',
  loadFailed: 'We couldn’t find your Keeper. Check your connection and try again!',
  retry: 'Try again',
  settings: 'Change how you look, any time!',
  settingsButton: 'Change Keeper',
  /** Back in the lobby after a change. */
  changed: 'Looking good, Keeper!',
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
  const rest: KeeperConfig = {
    base: config.base,
    hairColor: config.hairColor,
    eyeColor: config.eyeColor,
    outfit: config.outfit,
  };
  const own = bases.find((b) => b.id === config.base)?.hairstyle;
  return id === own ? rest : { ...rest, hairstyle: id };
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

  const title = el('h1', { class: 'auth-title', id: 'keeper-title' });
  const subtitle = el('p', { class: 'auth-subtitle keeper-subtitle' });
  const rows = el('div', { class: 'keeper-rows' });
  const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'keeper-error' });
  const actions = el('div', { class: 'auth-actions keeper-actions' });
  const card = el('div', { class: 'auth-card keeper-card' }, title, subtitle, rows, error, actions);
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
    scene.onDisposeObservable.addOnce(() => {
      if (preview === built) preview = null;
      built.dispose();
    });
    return built.content;
  };

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
  /** Every choice on the card and whether it's the one picked now. */
  let choices: { node: HTMLButtonElement; isPicked: () => boolean }[] = [];

  /** Marks the picked choices (no rebuild, so a tap never loses its place). */
  const refresh = () => {
    for (const c of choices) c.node.setAttribute('aria-pressed', String(c.isPicked()));
  };

  const pick = (next: KeeperConfig) => {
    picked = next;
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

  /** Stops the scroll hints of the rows on screen (they're rebuilt on open). */
  let hints = new AbortController();

  /**
   * One labelled line of choices (#130): the label sits beside the choices,
   * not above them, so all five rows fit the card with no scrolling on a
   * phone or iPad.
   */
  const row = (legend: string, ...buttons: HTMLElement[]) => {
    const id = `keeper-row-${legend.toLowerCase().replaceAll(' ', '-')}`;
    return el(
      'div',
      { class: 'keeper-row', role: 'group', 'aria-labelledby': id },
      el('span', { class: 'keeper-legend', id }, legend),
      el('div', { class: 'keeper-choices' }, ...buttons),
    );
  };

  const swatchRow = (
    legend: string,
    swatches: readonly KeeperSwatch[],
    field: 'hairColor' | 'eyeColor',
  ) =>
    row(
      legend,
      ...swatches.map((s) =>
        choice(
          `${legend}: ${s.name}`,
          () => picked[field] === s.id,
          () => {
            pick({ ...picked, [field]: s.id });
          },
          'keeper-swatch',
          dot(s.color),
        ),
      ),
    );

  function renderRows(): void {
    choices = [];
    const hairOf = (id: string) => KEEPER_DATA.hairColors.find((c) => c.id === id)?.color ?? '';
    rows.replaceChildren(
      row(
        'Keeper',
        ...bases.map((b) =>
          choice(
            b.name,
            () => picked.base === b.id,
            () => {
              // A new Keeper comes with its own colours; tweak from there.
              pick(defaultKeeperConfig(b));
            },
            'keeper-base',
            el(
              'span',
              { class: 'keeper-faces' },
              dot(b.skin),
              dot(hairOf(b.hairColor), 'keeper-hair-dot'),
            ),
            el('span', { class: 'keeper-base-name' }, b.name),
          ),
        ),
      ),
      // Any Keeper can wear any style (owner decision 2026-10-06); picking a
      // Keeper above goes back to its own.
      row(
        'Hair style',
        ...KEEPER_DATA.hairstyles.map((h) =>
          choice(
            `Hair style: ${h.name}`,
            () => styleOf(picked) === h.id,
            () => {
              pick(withHairstyle(picked, h.id));
            },
            'keeper-style',
            el('span', { class: 'keeper-base-name' }, h.name),
          ),
        ),
      ),
      swatchRow('Hair', KEEPER_DATA.hairColors, 'hairColor'),
      swatchRow('Eyes', KEEPER_DATA.eyeColors, 'eyeColor'),
      row(
        'Outfit',
        ...KEEPER_DATA.outfits.map((o) =>
          choice(
            `Outfit: ${o.name}`,
            () => picked.outfit === o.id,
            () => {
              pick({ ...picked, outfit: o.id });
            },
            'keeper-swatch',
            dot(`linear-gradient(${o.top} 0 55%, ${o.bottom} 55% 100%)`),
          ),
        ),
      ),
    );
    refresh();
    hints.abort();
    hints = new AbortController();
    const update = watchScrollHints(
      [
        { node: rows, axis: 'y' },
        ...[...rows.querySelectorAll<HTMLElement>('.keeper-choices')].map((node) => ({
          node,
          axis: 'x' as const,
        })),
      ],
      hints.signal,
    );
    // Measured once the card is on screen (it's hidden while it's built).
    requestAnimationFrame(update);
  }

  const button = (label: string, onClick: () => void, soft = false) => {
    const node = el(
      'button',
      { type: 'button', class: soft ? 'auth-button auth-button-soft' : 'auth-button' },
      label,
    );
    node.addEventListener('click', onClick);
    return node;
  };

  function open(next: KeeperPickerMode): void {
    mode = next;
    title.textContent = KEEPER_TEXT[next].title;
    subtitle.textContent = KEEPER_TEXT[next].subtitle;
    error.textContent = '';
    renderRows();
    const save = button(KEEPER_TEXT.save[next], () => void submit(save));
    actions.replaceChildren(
      save,
      ...(next === 'edit'
        ? [
            button(
              KEEPER_TEXT.back,
              () => {
                close(false);
              },
              true,
            ),
          ]
        : []),
    );
    panel.hidden = false;
    options.showScene(build);
    if (frame === 0) frame = requestAnimationFrame(tick);
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
    error.textContent = '';
    try {
      saved = await api.save(picked);
      if (mine !== session) return;
      const first = mode === 'first';
      close(true);
      if (first) options.onReady(who);
    } catch (err) {
      if (mine === session) error.textContent = messageOf(err);
    } finally {
      save.disabled = false;
      save.textContent = label;
    }
  }

  /** Couldn't ask the server: say so, with a way to try again (never a dead end). */
  function showLoadFailed(who: PublicUser): void {
    mode = 'first';
    title.textContent = KEEPER_TEXT.first.title;
    subtitle.textContent = '';
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
      saved = keeper;
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
          class: 'auth-button auth-button-soft',
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
        saved,
        preview: preview?.hash ?? null,
        hopping: preview?.isPlaying(now) ?? false,
      };
    },
  };
}
