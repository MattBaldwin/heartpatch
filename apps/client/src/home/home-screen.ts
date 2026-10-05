import {
  GAME_DATA,
  visualRegistry,
  type HomeResponse,
  type KeeperConfig,
  type MyBuilding,
  type PublicTile,
  type PublicUser,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { describeItems } from '../inventory/bag-view.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { listenForTaps } from '../map/tap-detector.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { el, messageOf } from '../ui/dom.js';
import { WANDER } from './home-config.js';
import { homeApi, type HomeApi } from './home-api.js';
import { HomeScene, type HomeSceneStats } from './home-scene.js';
import {
  buildingIcon,
  buildingName,
  buildingNote,
  buildRows,
  costText,
  fireStatus,
  freeHomeSpots,
  likesHabitat,
  refundPreview,
  speciesMap,
  squishyName,
  type HomeSpot,
} from './home-view.js';
import { homeTileLines } from './home-tile-info.js';
import './home.css';

// The home base (#18, design doc §13–14): a Home button over the map opens
// the player's seven home tiles up close. They build Hearthfires and
// habitats on the spots there, fuel their fire, and move squishies in; the
// squishies wander about their habitat. Every change is a command the server
// checks (CLAUDE.md rule 1); the screen redraws from its reply.

export interface HomeScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player's Keeper, idling by the Heart Seed. */
  keeper: () => KeeperConfig | null;
  /** What the Keeper wears (#43), clothing ids. */
  keeperWearing?: () => readonly string[];
  /** The home opened: the map, the bag and the lobby step out. */
  onOpen: (mapId: string) => void;
  /** Back to the map. */
  onClosed: (mapId: string) => void;
  /** The home couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  /** A squishy chip was tapped: open its care sheet (#19). */
  onCare?: (mapId: string, squishyId: string) => void;
  /** A squishy itself was tapped: open it up close (#20). */
  onCloseUp?: (mapId: string, squishyId: string) => void;
  /** "Jobs & team": opens the squishy job board (temporary entry; the trays move it). */
  onJobs?: (mapId: string) => void;
  api?: HomeApi;
}

type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'menu' }
  | { readonly kind: 'placing'; readonly buildingId: string }
  | { readonly kind: 'moving'; readonly id: string }
  | { readonly kind: 'selected'; readonly id: string }
  | { readonly kind: 'confirm-remove'; readonly id: string };

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface HomeDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly mode: Mode['kind'];
  readonly items: Readonly<Record<string, number>>;
  readonly buildings: readonly Pick<
    MyBuilding,
    'id' | 'buildingId' | 'q' | 'r' | 'spot' | 'lit' | 'nightsLeft' | 'residents'
  >[];
  readonly squishies: number;
  readonly scene: HomeSceneStats | null;
  /** Wander hops started since the home opened. */
  readonly hops: number;
}

export interface HomeScreen {
  /** The map on screen (null: none): shows the Home button. */
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Opens the home base of the map on screen. */
  open: () => Promise<void>;
  /** Tile-panel lines and the "Go home" button for home tiles. */
  readonly tileActions: TileActions;
  readonly debug: HomeDebug | null;
}

// Player-facing text (style guide §6, §9).
export const HOME_TEXT = {
  home: 'Home',
  title: 'Your home base',
  build: 'Build',
  back: 'Back to map',
  buildTitle: 'What shall we build?',
  pick: 'Tap a glowing spot!',
  anywhere: 'Put it anywhere',
  cancel: 'Cancel',
  move: 'Move',
  takeDown: 'Take down',
  done: 'Done',
  addFuel: 'Add fuel',
  moveIn: 'Move in',
  moveOut: 'Move out',
  livesHere: 'Lives here',
  cozy: 'Loves it here!',
  full: 'Full',
  yours: 'Your buildings',
  friends: 'Your squishies',
  jobs: '🧺 Jobs & team',
  none: 'Nothing built yet. Tap Build!',
  noSquishies: 'No squishies yet. Befriend one on the map!',
  confirm: (name: string, back: string) =>
    back ? `Take down the ${name}? You get back ${back}.` : `Take down the ${name}?`,
  keep: 'Keep it',
  yes: 'Yes, take it down',
  built: (name: string) => `Ta-da! Your ${name} is ready.`,
  fuelled: 'Crackle crackle! The fire is cozy and warm.',
  moved: 'All moved!',
  removed: (back: string) => (back ? `Taken down. You got back ${back}.` : 'Taken down.'),
  movedIn: (name: string, where: string) => `${name} moved into the ${where}!`,
  movedOut: (name: string) => `${name} moved out.`,
  goHome: 'Go home',
} as const;

/** One night of fuel per tap: easy to count, quick to top up. */
const FUEL_NIGHTS = 1;

export function createHomeScreen(options: HomeScreenOptions): HomeScreen {
  const api = options.api ?? homeApi;
  const registry = visualRegistry(GAME_DATA);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let home: HomeResponse | null = null;
  let isOpen = false;
  let mode: Mode = { kind: 'idle' };
  let working = false;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let scene3d: HomeScene | null = null;
  let wanderTimer: number | undefined;
  let frame = 0;
  let wanderTurn = 0;
  let lastTier: QualityTier | null = null;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const entry = el(
    'button',
    {
      type: 'button',
      class: 'home-open',
      'data-testid': 'home-open',
      'aria-label': HOME_TEXT.home,
    },
    el('span', { class: 'home-open-icon', 'aria-hidden': 'true' }, '🏡'),
    el('span', { class: 'home-open-label' }, HOME_TEXT.home),
  );
  entry.hidden = true;
  entry.addEventListener('click', () => {
    void open();
  });

  const status = el('p', { class: 'home-fire', 'data-testid': 'home-fire' });
  const top = el(
    'header',
    { class: 'home-top' },
    el('h2', { class: 'home-title', id: 'home-title' }, HOME_TEXT.title),
    status,
  );
  const note = el('p', { class: 'home-note', role: 'status', 'data-testid': 'home-note' });
  const body = el('div', { class: 'home-body' });
  const sheet = el(
    'section',
    { class: 'home-sheet', 'data-testid': 'home', role: 'dialog', 'aria-labelledby': 'home-title' },
    note,
    body,
  );
  const overlay = el('div', { class: 'home' }, top, sheet);
  overlay.hidden = true;
  options.root.append(entry, overlay);

  const say = (text: string) => {
    note.textContent = text;
  };

  const button = (
    label: string,
    onTap: () => void,
    extra: Record<string, string> = {},
    soft = false,
  ) => {
    const { class: more = '', ...attrs } = extra;
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button home-button${soft ? ' auth-button-soft' : ''} ${more}`.trim(),
        ...attrs,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  // ── Server calls ──────────────────────────────────────────────────────
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      show(fresh);
    } catch (err) {
      if (at === generation) say(messageOf(err));
    }
  }

  /**
   * Runs one command for the home on screen, one at a time. A `CONFLICT`
   * (the spot was taken, the bag changed) refetches, so the screen matches
   * the server again.
   */
  async function act(
    run: (
      mapId: string,
      send: <T>(command: (key: string) => Promise<T>) => Promise<T | null>,
    ) => Promise<HomeResponse | null>,
    done: (next: HomeResponse) => { mode: Mode; say: string },
  ): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    render();
    try {
      const next = await run(id, (command) =>
        sendCommand(sendDeps, command, () => at === generation),
      );
      if (!next || at !== generation) return;
      const after = done(next);
      mode = after.mode;
      show(next);
      say(after.say);
    } catch (err) {
      if (at === generation) {
        say(messageOf(err));
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') await refresh();
      }
    } finally {
      working = false;
      if (at === generation) render();
    }
  }

  const place = (buildingId: string, spot: HomeSpot) =>
    act(
      (id, send) => send((key) => api.place(id, { buildingId, ...spot }, key)),
      (next) => {
        const built = next.buildings.find(
          (b) => b.q === spot.q && b.r === spot.r && b.spot === spot.spot,
        );
        return {
          mode: built ? { kind: 'selected', id: built.id } : { kind: 'idle' },
          say: HOME_TEXT.built(buildingName(buildingId)),
        };
      },
    );

  const move = (buildingId: string, spot: HomeSpot) =>
    act(
      (id, send) => send((key) => api.move(id, buildingId, spot, key)),
      () => ({ mode: { kind: 'selected', id: buildingId }, say: HOME_TEXT.moved }),
    );

  const fuel = (buildingId: string) =>
    act(
      (id, send) => send((key) => api.fuel(id, buildingId, FUEL_NIGHTS, key)),
      () => ({ mode: { kind: 'selected', id: buildingId }, say: HOME_TEXT.fuelled }),
    );

  const remove = (buildingId: string) => {
    let back = '';
    return act(
      async (id, send) => {
        const res = await send((key) => api.remove(id, buildingId, key));
        if (!res) return null;
        back = describeItems(res.refund);
        return res.home;
      },
      () => ({ mode: { kind: 'idle' }, say: HOME_TEXT.removed(back) }),
    );
  };

  const house = (squishyId: string, habitatId: string | null, name: string, where: string) =>
    act(
      (id, send) => send((key) => api.house(id, squishyId, habitatId, key)),
      () => ({
        mode,
        say: habitatId ? HOME_TEXT.movedIn(name, where) : HOME_TEXT.movedOut(name),
      }),
    );

  /** A spot was chosen (tapped, or "Put it anywhere") while placing or moving. */
  const chooseSpot = (spot: HomeSpot) => {
    if (mode.kind === 'placing') void place(mode.buildingId, spot);
    else if (mode.kind === 'moving') void move(mode.id, spot);
  };

  // ── Drawing ───────────────────────────────────────────────────────────

  /** The spots to light up for the current mode. */
  const spotsFor = (current: HomeResponse): HomeSpot[] => {
    const m = mode;
    if (m.kind === 'placing') return freeHomeSpots(current);
    if (m.kind === 'moving') {
      const moving = current.buildings.find((b) => b.id === m.id);
      return freeHomeSpots(current, m.id).filter(
        (s) => !(moving && s.q === moving.q && s.r === moving.r && s.spot === moving.spot),
      );
    }
    return [];
  };

  function show(next: HomeResponse): void {
    home = next;
    // A building that's gone can't stay selected.
    const m = mode;
    if ('id' in m && !next.buildings.some((b) => b.id === m.id)) mode = { kind: 'idle' };
    scene3d?.update(next);
    syncScene();
    render();
    syncWander();
  }

  function syncScene(): void {
    if (!scene3d || !home) return;
    scene3d.showSpots(spotsFor(home));
    scene3d.select('id' in mode && mode.kind !== 'moving' ? mode.id : null);
    options.invalidate();
  }

  const setMode = (next: Mode) => {
    mode = next;
    say('');
    syncScene();
    render();
  };

  function render(): void {
    entry.hidden = mapId === null || isOpen || panel !== null;
    overlay.hidden = !isOpen;
    if (!isOpen || !home) {
      body.replaceChildren();
      return;
    }
    const current = home;
    status.textContent = fireStatus(current.buildings);
    const row = (...children: Node[]) => el('div', { class: 'home-row' }, ...children);

    switch (mode.kind) {
      case 'idle': {
        const chips = current.buildings.map((b) =>
          button(
            `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`,
            () => {
              setMode({ kind: 'selected', id: b.id });
            },
            { 'data-building': b.id, class: 'home-chip' },
            true,
          ),
        );
        const species = speciesMap(current);
        const friends = current.squishies.map((s) =>
          button(
            `💗 ${squishyName(s, species)}`,
            () => {
              if (mapId) options.onCare?.(mapId, s.id);
            },
            { 'data-care-squishy': s.id, class: 'home-chip' },
            true,
          ),
        );
        body.replaceChildren(
          el('h3', { class: 'home-section-title' }, HOME_TEXT.yours),
          chips.length > 0
            ? el('div', { class: 'home-chips' }, ...chips)
            : el('p', { class: 'home-empty' }, HOME_TEXT.none),
          ...(friends.length > 0 && options.onCare
            ? [
                el('h3', { class: 'home-section-title' }, HOME_TEXT.friends),
                el('div', { class: 'home-chips', 'data-testid': 'home-friends' }, ...friends),
              ]
            : []),
          ...(friends.length > 0 && options.onJobs
            ? [
                row(
                  button(
                    HOME_TEXT.jobs,
                    () => {
                      if (mapId) options.onJobs?.(mapId);
                    },
                    { 'data-testid': 'home-jobs' },
                  ),
                ),
              ]
            : []),
          row(
            button(
              HOME_TEXT.build,
              () => {
                setMode({ kind: 'menu' });
              },
              { 'data-testid': 'home-build' },
            ),
            button(HOME_TEXT.back, close, { 'data-testid': 'home-back' }, true),
          ),
        );
        break;
      }
      case 'menu': {
        body.replaceChildren(
          el('h3', { class: 'home-section-title' }, HOME_TEXT.buildTitle),
          el(
            'ul',
            { class: 'home-list', 'data-testid': 'home-build-list' },
            ...buildRows(current).map(({ building, icon, cost, option }) =>
              el(
                'li',
                { class: 'home-list-row' },
                el(
                  'span',
                  { class: 'home-list-name' },
                  `${icon} ${building.name}`,
                  el('span', { class: 'home-list-sub' }, cost),
                ),
                option.kind === 'ready'
                  ? button(
                      HOME_TEXT.build,
                      () => {
                        setMode({ kind: 'placing', buildingId: building.id });
                      },
                      { 'data-build': building.id },
                    )
                  : el('span', { class: 'home-list-note' }, option.note),
              ),
            ),
          ),
          row(
            button(
              HOME_TEXT.cancel,
              () => {
                setMode({ kind: 'idle' });
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
      case 'placing':
      case 'moving': {
        const spots = spotsFor(current);
        const first = spots[0];
        body.replaceChildren(
          el('p', { class: 'home-pick' }, HOME_TEXT.pick),
          row(
            button(
              HOME_TEXT.anywhere,
              () => {
                if (first) chooseSpot(first);
              },
              { 'data-testid': 'home-anywhere' },
            ),
            button(
              HOME_TEXT.cancel,
              () => {
                setMode(
                  mode.kind === 'moving' ? { kind: 'selected', id: mode.id } : { kind: 'idle' },
                );
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
      case 'selected': {
        const { id } = mode;
        const b = current.buildings.find((x) => x.id === id);
        if (!b) break;
        body.replaceChildren(...buildingCard(current, b));
        break;
      }
      case 'confirm-remove': {
        const { id } = mode;
        const b = current.buildings.find((x) => x.id === id);
        if (!b) break;
        const back = costText(refundPreview(b));
        body.replaceChildren(
          el('p', { class: 'home-pick' }, HOME_TEXT.confirm(buildingName(b.buildingId), back)),
          row(
            button(HOME_TEXT.yes, () => void remove(b.id), {
              'data-testid': 'home-confirm-remove',
            }),
            button(
              HOME_TEXT.keep,
              () => {
                setMode({ kind: 'selected', id: b.id });
              },
              {},
              true,
            ),
          ),
        );
        break;
      }
    }
  }

  function buildingCard(current: HomeResponse, b: MyBuilding): Node[] {
    const card: Node[] = [
      el(
        'h3',
        { class: 'home-section-title' },
        `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}`,
      ),
      el('p', { class: 'home-card-note', 'data-testid': 'home-card-note' }, buildingNote(b)),
    ];
    const actions: Node[] = [];
    if (b.kind === 'hearthfire') {
      const data = GAME_DATA.buildings.find((x) => x.id === b.buildingId);
      const cost =
        data?.kind === 'hearthfire'
          ? costText({ [data.fuelResource]: data.fuelPerNight * FUEL_NIGHTS })
          : '';
      const fuelButton = button(`${HOME_TEXT.addFuel} (${cost})`, () => void fuel(b.id), {
        'data-testid': 'home-fuel',
      });
      if ((b.fuelSpace ?? 0) === 0) fuelButton.disabled = true;
      actions.push(fuelButton);
    }
    if (b.kind === 'habitat') {
      const species = speciesMap(current);
      const full = (b.residents ?? 0) >= (b.capacity ?? 0);
      const where = buildingName(b.buildingId);
      card.push(
        current.squishies.length === 0
          ? el('p', { class: 'home-empty' }, HOME_TEXT.noSquishies)
          : el(
              'ul',
              { class: 'home-list', 'data-testid': 'home-residents' },
              ...current.squishies.map((s) => {
                const name = squishyName(s, species);
                const here = s.habitatId === b.id;
                const action = here
                  ? button(
                      HOME_TEXT.moveOut,
                      () => void house(s.id, null, name, where),
                      {
                        'data-squishy': s.id,
                      },
                      true,
                    )
                  : full
                    ? el('span', { class: 'home-list-note' }, HOME_TEXT.full)
                    : button(HOME_TEXT.moveIn, () => void house(s.id, b.id, name, where), {
                        'data-squishy': s.id,
                      });
                return el(
                  'li',
                  { class: 'home-list-row' },
                  el(
                    'span',
                    { class: 'home-list-name' },
                    name,
                    el(
                      'span',
                      { class: 'home-list-sub' },
                      here
                        ? HOME_TEXT.livesHere
                        : likesHabitat(s, b.buildingId)
                          ? HOME_TEXT.cozy
                          : '',
                    ),
                  ),
                  action,
                );
              }),
            ),
      );
    }
    actions.push(
      button(
        HOME_TEXT.move,
        () => {
          setMode({ kind: 'moving', id: b.id });
        },
        {},
        true,
      ),
      button(
        HOME_TEXT.takeDown,
        () => {
          setMode({ kind: 'confirm-remove', id: b.id });
        },
        {
          'data-testid': 'home-remove',
        },
        true,
      ),
    );
    card.push(
      el('div', { class: 'home-row home-row-wrap' }, ...actions),
      el(
        'div',
        { class: 'home-row' },
        button(
          HOME_TEXT.done,
          () => {
            setMode({ kind: 'idle' });
          },
          { 'data-testid': 'home-done' },
          true,
        ),
      ),
    );
    return card;
  }

  // ── Scene, taps and wandering ─────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!home) throw new Error('no home to build');
    lastTier = options.tier();
    const built = new HomeScene(scene, home, {
      registry,
      lod: lodFor('closeUp', lastTier),
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
    });
    scene3d = built;
    syncScene();
    const canvas = scene.getEngine().getRenderingCanvas();
    if (canvas) {
      const stop = new AbortController();
      scene.onDisposeObservable.addOnce(() => {
        stop.abort();
        if (scene3d === built) scene3d = null;
      });
      listenForTaps(
        canvas,
        (x, y) => {
          const hit = built.pick(x, y);
          if (hit?.kind === 'spot') chooseSpot(hit.spot);
          else if (hit?.kind === 'squishy' && mapId && !working) options.onCloseUp?.(mapId, hit.id);
          else if (hit?.kind === 'building' && mode.kind !== 'placing' && mode.kind !== 'moving') {
            setMode({ kind: 'selected', id: hit.id });
          }
        },
        stop.signal,
      );
    }
    return built.content;
  };

  /**
   * Hops one housed squishy every few seconds while the home is open. With
   * `prefers-reduced-motion` they stay put (and the home draws nothing).
   */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', () => {
    syncWander();
  });

  function syncWander(): void {
    const wanted = isOpen && !reducedMotion.matches && (scene3d?.wanderers.length ?? 0) > 0;
    if (wanted && wanderTimer === undefined) scheduleHop();
    if (!wanted && wanderTimer !== undefined) {
      window.clearTimeout(wanderTimer);
      wanderTimer = undefined;
    }
  }

  function scheduleHop(): void {
    const delay = WANDER.everyMs + (Math.random() * 2 - 1) * WANDER.jitterMs;
    wanderTimer = window.setTimeout(() => {
      wanderTimer = undefined;
      const s = scene3d;
      const ids = s?.wanderers ?? [];
      const id = ids[wanderTurn % Math.max(1, ids.length)];
      wanderTurn += 1;
      if (s && id) {
        s.hop(id, performance.now());
        if (frame === 0) frame = requestAnimationFrame(tick);
      }
      syncWander();
    }, delay);
  }

  /** Draws every frame while a hop plays, then stops (render on demand). */
  function tick(): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      s.setLod(lodFor('closeUp', tier));
    }
    const moving = s.step(performance.now());
    options.invalidate();
    if (moving) frame = requestAnimationFrame(tick);
  }

  async function open(): Promise<void> {
    const id = mapId;
    if (!id || isOpen) return;
    const at = generation;
    try {
      const fresh = await api.get(id);
      if (at !== generation) return;
      home = fresh;
    } catch (err) {
      // The home isn't on screen yet, so its own note can't show this.
      if (at === generation) options.onProblem(messageOf(err));
      return;
    }
    isOpen = true;
    mode = { kind: 'idle' };
    say('');
    options.onOpen(id);
    options.showScene(build);
    render();
    syncWander();
  }

  function hide(): void {
    isOpen = false;
    mode = { kind: 'idle' };
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    syncWander();
    scene3d = null;
    render();
  }

  function close(): void {
    const id = mapId;
    hide();
    options.showScene(null);
    if (id) options.onClosed(id);
  }

  // ── Tile panel (home tiles on the map) ────────────────────────────────
  function renderTile(): void {
    if (!panel) return;
    const { container, tile } = panel;
    const lines = homeTileLines(tile, user?.id ?? null);
    const nodes: Node[] = lines.map((line) => el('p', { class: 'tile-action-note' }, line));
    if (tile.homeSlot !== null && tile.ownerUserId !== null && tile.ownerUserId === user?.id) {
      nodes.push(
        el(
          'button',
          { type: 'button', class: 'auth-button bag-action', 'data-testid': 'tile-home' },
          `🏡 ${HOME_TEXT.goHome}`,
        ),
      );
      nodes.at(-1)?.addEventListener('click', () => void open());
    }
    container.replaceChildren(...nodes);
  }

  return {
    setMap: (next) => {
      if (next === mapId) return;
      generation += 1;
      mapId = next;
      home = null;
      if (isOpen) hide();
      render();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      mapId = null;
      home = null;
      if (isOpen) hide();
      render();
    },
    open,
    tileActions: {
      show: (container, tile) => {
        panel = { container, tile };
        renderTile();
        render();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
        render();
      },
    },
    get debug() {
      if (!mapId) return null;
      return {
        mapId,
        open: isOpen,
        mode: mode.kind,
        items: { ...(home?.items ?? {}) },
        buildings: (home?.buildings ?? []).map((b) => ({
          id: b.id,
          buildingId: b.buildingId,
          q: b.q,
          r: b.r,
          spot: b.spot,
          lit: b.lit,
          nightsLeft: b.nightsLeft,
          residents: b.residents,
        })),
        squishies: home?.squishies.length ?? 0,
        scene: scene3d?.stats ?? null,
        hops: scene3d?.hops ?? 0,
      };
    },
  };
}
