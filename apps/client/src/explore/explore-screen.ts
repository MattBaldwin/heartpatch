import {
  EXPLORE_RULES,
  GAME_DATA,
  isExplorable,
  visualRegistry,
  type ExploreTileResponse,
  type ItemCounts,
  type KeeperConfig,
  type PublicSearchSpot,
  type PublicTile,
  type PublicUser,
  type SearchSpotResponse,
  type Species,
  type SpotInteraction,
  type ToolId,
  type WorldPoint,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { inventoryApi } from '../inventory/inventory-api.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { jobsApi, type JobsApi } from '../squishies/jobs/jobs-api.js';
import { el, messageOf } from '../ui/dom.js';
import { EXPLORE_VIEW, INTERACTION } from './explore-config.js';
import { exploreApi, type ExploreApi } from './explore-api.js';
import { ExploreScene, type ExploreSceneStats } from './explore-scene.js';
import {
  actionFor,
  afterSearch,
  clampToTile,
  EXPLORE_TEXT,
  findLines,
  foundHeadline,
  joystickVector,
  missingTool,
  nearestSpot,
  needLine,
  progressLine,
  restLine,
  standBeside,
  stepToward,
  terrainName,
  toolName,
  toolRecipeRows,
  TOOL_WORDS,
  usesLine,
  xpLines,
} from './explore-view.js';
import {
  interactionProgress,
  lit,
  startInteraction,
  stepInteraction,
  type InteractionInput,
  type InteractionState,
} from './interactions.js';
import './explore.css';

// Exploring your land (#199, owner design 2026-10-07): "Explore" on one of
// my tiles opens it up close. My Keeper walks it (drag for a floating
// joystick, or tap the ground) with my team trailing behind, and searches
// its sparkling spots: a short touch mini-interaction per tool, each with an
// easy way. The server rolls every find (CLAUDE.md rule 1); this screen only
// asks, then shows the find card it answers with.

export interface ExploreScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  keeper: () => KeeperConfig | null;
  keeperWearing?: () => readonly string[];
  /** The tile as the map has it (its buildings), or null. */
  mapTile: (at: { q: number; r: number }) => PublicTile | null;
  /** Exploring is for patches: never on the Tutorial Glade. */
  isGlade: (mapId: string) => boolean;
  /** The explore view opened: the map, the bag and the lobby step out. */
  onOpen: (mapId: string) => void;
  /** Back to the map. */
  onClosed: (mapId: string) => void;
  /** It couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  /** A search landed things in the bag (the bag, recipe book, lore and milestones look again). */
  onFound?: (mapId: string) => void;
  /** "Open recipe book" on the missing-tool card: leaves exploring and opens it. */
  onRecipeBook?: () => void;
  api?: ExploreApi;
  jobs?: Pick<JobsApi, 'view'>;
  bag?: (mapId: string) => Promise<ItemCounts>;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface ExploreDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly tile: { readonly q: number; readonly r: number; readonly terrain: string } | null;
  readonly progress: { readonly searched: number; readonly total: number } | null;
  readonly spots: readonly Pick<PublicSearchSpot, 'index' | 'kind' | 'tool' | 'done'>[];
  readonly keeper: WorldPoint;
  /** The spot in reach (the action button's), or null. */
  readonly near: number | null;
  readonly playing: SpotInteraction | null;
  readonly card: 'find' | 'missing' | null;
  readonly scene: ExploreSceneStats | null;
  /** Screen point (CSS pixels) of each spot, to tap in tests. */
  spotOnScreen: (index: number) => { x: number; y: number } | null;
}

export interface ExploreScreen {
  /** The map on screen (null: none). */
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Opens one of my tiles up close. */
  open: (at: { q: number; r: number }) => Promise<void>;
  /** The tile panel's "Explore" on my land. */
  readonly tileActions: TileActions;
  readonly debug: ExploreDebug | null;
}

type Card =
  | {
      readonly kind: 'find';
      readonly found: SearchSpotResponse;
      readonly interaction: SpotInteraction;
      /** A net swiped while the water glowed: just for fun, the find is the same. */
      readonly bigSplash: boolean;
    }
  | { readonly kind: 'missing'; readonly tool: ToolId; readonly bag: ItemCounts | null };

/** What each mini-interaction says (style guide §6). */
const PLAY_TEXT: Readonly<
  Record<
    SpotInteraction,
    { title: string; hint: string; easy: string; easyNote: string; art: string }
  >
> = {
  dig: {
    title: 'Dig the mound!',
    hint: 'Swipe down to dig!',
    easy: 'Tap to dig',
    easyNote: 'Each tap is one scoop. Both ways find the same thing!',
    art: '🟤',
  },
  climb: {
    title: 'Climb to the ledge!',
    hint: 'Left, right, left, right!',
    easy: 'Hold to climb',
    easyNote: "Any tap works too. You can't fall!",
    art: '🧗',
  },
  light: {
    title: 'Cozy cave',
    hint: 'Walk around with your light. Look for a glint! ✨',
    easy: 'Light up the whole cave',
    easyNote: 'Every secret glows so you can tap it.',
    art: '',
  },
  scoop: {
    title: 'Scoop the pond!',
    hint: 'Swipe through the water when it glows!',
    easy: 'Scoop!',
    easyNote: 'Scoop any time. Good timing just makes a bigger splash!',
    art: '💧',
  },
  lift: {
    title: 'Lift it up!',
    hint: 'Hold to lift!',
    easy: 'Tap to lift',
    easyNote: 'Both ways find the same thing!',
    art: '🪨',
  },
  shake: {
    title: 'Give it a shake!',
    hint: 'Swipe left and right to shake!',
    easy: 'Tap to shake',
    easyNote: 'Both ways find the same thing!',
    art: '🌳',
  },
};

/** What the mini-interaction shows for each kind of spot (the cave stays dark). */
const SPOT_ART: Readonly<Record<string, string>> = {
  rock: '🪨',
  tree: '🌳',
  'hollow-log': '🪵',
  'flower-bed': '🌷',
  'pumpkin-row': '🎃',
  mound: '🟤',
  pond: '💧',
  reeds: '🌾',
  ledge: '🧗',
};

export function createExploreScreen(options: ExploreScreenOptions): ExploreScreen {
  const api = options.api ?? exploreApi;
  const jobs = options.jobs ?? jobsApi;
  const bagOf = options.bag ?? (async (mapId: string) => (await inventoryApi.get(mapId)).items);
  const registry = visualRegistry(GAME_DATA);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let isOpen = false;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let tile: ExploreTileResponse | null = null;
  let teamNames: Record<string, string> = {};
  let team: string[] = [];
  /** My team's squishies that follow the Keeper, in team order. */
  let teamMembers: { id: string; speciesId: string }[] = [];
  let scene3d: ExploreScene | null = null;
  let lastTier: QualityTier | null = null;
  let keeperAt: WorldPoint = EXPLORE_VIEW.start;
  let yaw = 0;
  /** Where a tap sent the Keeper (beside a spot, if it tapped one). */
  let walkTo: WorldPoint | null = null;
  let stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  let near: PublicSearchSpot | null = null;
  let playing: { spot: PublicSearchSpot; state: InteractionState } | null = null;
  let card: Card | null = null;
  let working = false;
  let opening = false;
  let frame = 0;
  let lastFrame = 0;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const back = el(
    'button',
    {
      type: 'button',
      class: 'explore-back',
      'data-testid': 'explore-back',
      'aria-label': EXPLORE_TEXT.back,
    },
    '‹',
  );
  back.addEventListener('click', () => {
    close();
  });
  const title = el('h2', { class: 'explore-title', id: 'explore-title' });
  const withLine = el('p', { class: 'explore-with', 'data-testid': 'explore-with' });
  const progress = el('p', { class: 'explore-progress', 'data-testid': 'explore-progress' });
  const tools = el('div', { class: 'explore-tools', 'data-testid': 'explore-tools' });
  const top = el(
    'header',
    { class: 'explore-top' },
    back,
    el('div', { class: 'explore-names' }, title, withLine),
    progress,
    tools,
  );

  // The whole screen under the HUD takes the touches (the camera stays put).
  const ground = el('div', { class: 'explore-ground', 'data-testid': 'explore-ground' });
  const stickBase = el('div', { class: 'explore-stick', 'aria-hidden': 'true' });
  const stickKnob = el('div', { class: 'explore-stick-knob' });
  stickBase.append(stickKnob);
  stickBase.hidden = true;
  ground.append(stickBase);

  const note = el('p', { class: 'explore-note', role: 'status', 'data-testid': 'explore-note' });
  const actionIcon = el('span', { class: 'explore-action-icon', 'aria-hidden': 'true' });
  const actionLabel = el('span', { class: 'explore-action-label' });
  const action = el(
    'button',
    { type: 'button', class: 'explore-action', 'data-testid': 'explore-action' },
    actionIcon,
    actionLabel,
  );
  action.addEventListener('click', () => {
    if (near) begin(near);
  });

  const sheet = el('section', {
    class: 'explore-sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'explore-sheet-title',
    'data-testid': 'explore-sheet',
  });
  sheet.hidden = true;

  const overlay = el('div', { class: 'explore' }, ground, top, note, action, sheet);
  overlay.hidden = true;
  options.root.append(overlay);

  const say = (text: string) => {
    note.textContent = text;
  };

  // ── Walking ───────────────────────────────────────────────────────────

  const local = (e: PointerEvent) => {
    const rect = ground.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;

  ground.addEventListener('pointerdown', (e) => {
    if (!isOpen || playing || card || press) return;
    const p = local(e);
    press = { id: e.pointerId, x: p.x, y: p.y, moved: false };
    try {
      ground.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; their moves still arrive.
    }
  });
  ground.addEventListener('pointermove', (e) => {
    if (press?.id !== e.pointerId) return;
    const p = local(e);
    const dx = p.x - press.x;
    const dy = p.y - press.y;
    if (!press.moved && dx * dx + dy * dy < EXPLORE_VIEW.tapSlop ** 2) return;
    press.moved = true;
    // A drag is the floating joystick, wherever it started (left half on a
    // phone held in one hand; anywhere is easier for small thumbs).
    stick = { id: e.pointerId, x0: press.x, y0: press.y, x: p.x, y: p.y };
    walkTo = null;
    showStick();
    wake();
  });
  const release = (e: PointerEvent) => {
    if (press?.id !== e.pointerId) return;
    const tapped = !press.moved;
    const at = { x: press.x, y: press.y };
    press = null;
    stick = null;
    showStick();
    if (tapped) tapGround(at.x, at.y);
  };
  ground.addEventListener('pointerup', release);
  ground.addEventListener('pointercancel', (e) => {
    if (press?.id !== e.pointerId) return;
    press = null;
    stick = null;
    showStick();
  });

  function showStick(): void {
    stickBase.hidden = stick === null;
    if (!stick) return;
    const r = EXPLORE_VIEW.joystick.radius;
    const dx = stick.x - stick.x0;
    const dy = stick.y - stick.y0;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = d > r ? r / d : 1;
    stickBase.style.left = `${String(stick.x0)}px`;
    stickBase.style.top = `${String(stick.y0)}px`;
    stickKnob.style.transform = `translate(${String(dx * k)}px, ${String(dy * k)}px)`;
  }

  /** A tap on the ground walks there; a tap on a spot walks up beside it. */
  function tapGround(x: number, y: number): void {
    const point = scene3d?.groundAt(x, y);
    if (!point || !tile) return;
    const spot = nearestSpot(point, tile.spots, EXPLORE_VIEW.reach * 1.4);
    walkTo = spot ? standBeside(keeperAt, spot) : clampToTile(point);
    wake();
  }

  /** Draws every frame while the Keeper walks or something plays, then stops. */
  function wake(): void {
    if (frame === 0 && isOpen) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      s.setLod(lodFor('closeUp', tier));
    }
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    let walking = false;
    const step = EXPLORE_VIEW.walkSpeed * dt;
    let next = keeperAt;
    if (stick) {
      const v = joystickVector(stick.x - stick.x0, stick.y - stick.y0);
      if (v.x !== 0 || v.z !== 0) {
        next = clampToTile({ x: keeperAt.x + v.x * step, z: keeperAt.z + v.z * step });
        yaw = Math.atan2(v.x, -v.z);
      }
      walking = true; // keep reading the stick while it's held
    } else if (walkTo) {
      next = stepToward(keeperAt, walkTo, step);
      if (next.x !== keeperAt.x || next.z !== keeperAt.z) {
        yaw = Math.atan2(next.x - keeperAt.x, -(next.z - keeperAt.z));
      }
      if (next.x === walkTo.x && next.z === walkTo.z) walkTo = null;
      else walking = true;
    }
    if (next !== keeperAt) {
      keeperAt = next;
      s.moveKeeper(keeperAt, yaw);
    }
    findNear();
    if (playing) feed({ type: 'tick', t: now });
    const animating = s.step(now);
    options.invalidate();
    const holding = playing !== null && playing.state.holdSince !== null;
    if (walking || animating || holding) frame = requestAnimationFrame(tick);
  }

  /** The spot in reach drives the action button and the ring. */
  function findNear(): void {
    const next = tile ? nearestSpot(keeperAt, tile.spots) : null;
    if (next?.index === near?.index) return;
    near = next;
    scene3d?.highlight(near?.index ?? null);
    renderAction();
  }

  // ── Searching ─────────────────────────────────────────────────────────

  /** The action button: the spot in reach, or a hint to walk up to one. */
  function renderAction(): void {
    const t = tile;
    if (!t) return;
    const done = t.progress.total > 0 && t.progress.searched >= t.progress.total;
    if (!near) {
      action.disabled = true;
      action.classList.remove('explore-action-ready');
      actionIcon.textContent = done ? '✨' : '👣';
      actionLabel.textContent = done ? EXPLORE_TEXT.allDone : EXPLORE_TEXT.nothingNear;
      return;
    }
    const what = actionFor(near);
    action.disabled = working;
    action.classList.add('explore-action-ready');
    actionIcon.textContent = what.icon;
    actionLabel.textContent = what.label;
  }

  /** The action button: the right mini-interaction, or the missing-tool card. */
  function begin(spot: PublicSearchSpot): void {
    if (!tile || working || playing || card) return;
    const tool = missingTool(spot, tile.tools);
    if (tool) {
      void showMissing(tool);
      return;
    }
    const kind = actionFor(spot).interaction;
    const rect = { width: 300, height: 220 };
    playing = {
      spot,
      state: startInteraction(kind, rect, performance.now(), seedOf(spot)),
    };
    renderSheet();
    wake();
  }

  function feed(input: InteractionInput): void {
    if (!playing) return;
    const before = playing.state;
    const state = stepInteraction(before, input);
    if (state === before && input.type === 'tick') return;
    playing = { ...playing, state };
    if (state.done) {
      const { spot } = playing;
      playing = null;
      void search(spot, state.kind, state.bigSplash);
      return;
    }
    renderPlay();
    if (state.holdSince !== null) wake();
  }

  async function search(
    spot: PublicSearchSpot,
    interaction: SpotInteraction,
    bigSplash = false,
  ): Promise<void> {
    const id = mapId;
    const t = tile;
    if (!id || !t || working) return;
    const at = generation;
    working = true;
    say(EXPLORE_TEXT.searching);
    renderSheet();
    renderAction();
    scene3d?.cheer(performance.now());
    wake();
    try {
      const found = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) => api.search(id, { q: t.q, r: t.r, spot: spot.index }, key),
        () => at === generation,
      );
      if (at !== generation || !found || tile?.q !== t.q || tile.r !== t.r) return;
      tile = afterSearch(tile, found);
      scene3d?.update(tile);
      card = { kind: 'find', found, interaction, bigSplash };
      say('');
      options.onFound?.(id);
    } catch (err) {
      if (at !== generation) return;
      say(messageOf(err));
      // Searched on another device, or the tool ran out: look again.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') await reload();
    } finally {
      if (at === generation) {
        working = false;
        near = null;
        findNear();
        render();
        wake();
      }
    }
  }

  async function reload(): Promise<void> {
    const id = mapId;
    const t = tile;
    if (!id || !t) return;
    const at = generation;
    try {
      const fresh = await api.tile(id, t);
      if (at !== generation) return;
      tile = fresh;
      scene3d?.update(fresh);
    } catch {
      // The note already says what went wrong.
    }
  }

  async function showMissing(tool: ToolId): Promise<void> {
    const id = mapId;
    if (!id) return;
    const at = generation;
    const asked: Card = { kind: 'missing', tool, bag: null };
    card = asked;
    renderSheet();
    try {
      const bag = await bagOf(id);
      // Still this card on this map (not closed or swapped meanwhile).
      if (at !== generation || !sameCard(asked)) return;
      card = { kind: 'missing', tool, bag };
      renderSheet();
    } catch {
      // The recipe still shows, without counts.
    }
  }

  /** The card on screen is still `asked` (read through a call, so it isn't narrowed). */
  function sameCard(asked: Card): boolean {
    return card === asked;
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  function render(): void {
    overlay.hidden = !isOpen;
    if (!isOpen || !tile) return;
    title.textContent = terrainName(tile.terrain);
    const names = team.map((sid) => teamNames[sid] ?? '').filter((n) => n.length > 0);
    withLine.textContent = EXPLORE_TEXT.withTeam(names);
    progress.textContent = progressLine(tile.progress);
    tools.replaceChildren(
      ...tile.needs.map((tool) => {
        const uses = tile?.tools[tool] ?? 0;
        return el(
          'span',
          {
            class: `explore-tool${uses > 0 ? '' : ' explore-tool-out'}`,
            'data-testid': `explore-tool-${tool}`,
          },
          `${TOOL_WORDS[tool].icon} ${toolName(tool)} · ${usesLine(tool, uses)}`,
        );
      }),
    );
    renderAction();
    renderSheet();
  }

  /** The sheet: a mini-interaction, the find card, or the missing-tool card. */
  function renderSheet(): void {
    if (playing) {
      renderPlay();
      return;
    }
    if (!card) {
      sheet.hidden = true;
      sheet.replaceChildren();
      return;
    }
    sheet.hidden = false;
    sheet.dataset['card'] = card.kind;
    sheet.replaceChildren(...(card.kind === 'find' ? findCard(card) : missingCard(card)));
  }

  let playStage: HTMLElement | null = null;
  let playBar: HTMLElement | null = null;
  let playGlint: HTMLElement | null = null;

  /** Builds the mini-interaction once, then only updates its fill and light. */
  function renderPlay(): void {
    const p = playing;
    if (!p) return;
    if (sheet.dataset['card'] !== `play-${p.state.kind}`) buildPlay(p.state.kind);
    const s = p.state;
    if (playBar) playBar.style.width = `${String(Math.round(interactionProgress(s) * 100))}%`;
    if (playStage) {
      if (s.kind === 'light') {
        const lightAt = s.light;
        // The light's radius on screen matches the rule `lit` uses.
        const r = INTERACTION.lightRadius * playStage.clientWidth;
        playStage.style.setProperty(
          '--light',
          s.revealed && lightAt === null
            ? 'none'
            : lightAt
              ? `radial-gradient(circle ${String(Math.round(r))}px at ${pct(lightAt.x, s.stage.width)} ${pct(lightAt.y, s.stage.height)}, transparent 60%, rgb(28 20 40 / 92%) 100%)`
              : 'linear-gradient(rgb(28 20 40 / 92%), rgb(28 20 40 / 92%))',
        );
        if (playGlint) {
          playGlint.hidden = !s.revealed && !lit(s, s.glint.x, s.glint.y);
          playGlint.style.left = pct(s.glint.x, s.stage.width);
          playGlint.style.top = pct(s.glint.y, s.stage.height);
        }
      }
      if (s.kind === 'dig' || s.kind === 'shake') {
        playStage.style.setProperty('--wiggle', String(s.count));
      }
    }
  }

  function buildPlay(kind: SpotInteraction): void {
    const text = PLAY_TEXT[kind];
    sheet.hidden = false;
    sheet.dataset['card'] = `play-${kind}`;
    playStage = el('div', {
      class: `explore-stage explore-stage-${kind}`,
      'data-testid': 'explore-stage',
    });
    const art = SPOT_ART[playing?.spot.kind ?? ''] ?? text.art;
    if (art) {
      playStage.append(el('span', { class: 'explore-stage-art', 'aria-hidden': 'true' }, art));
    }
    playGlint = null;
    if (kind === 'light') {
      playGlint = el(
        'button',
        {
          type: 'button',
          class: 'explore-glint',
          'data-testid': 'explore-glint',
          'aria-label': 'A glint!',
        },
        '✨',
      );
      playGlint.hidden = true;
      // A keyboard or switch control clicks it without a pointer.
      playGlint.addEventListener('click', () => {
        const g = playing?.state.glint;
        if (g) feed({ type: 'down', x: g.x, y: g.y, t: performance.now() });
      });
      playStage.append(playGlint);
    }
    const stagePoint = (e: PointerEvent) => {
      const rect = playStage?.getBoundingClientRect();
      const s = playing?.state.stage;
      if (!rect || !s || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
      // The reducer works in its own stage units; the drawn stage may differ.
      return {
        x: ((e.clientX - rect.left) / rect.width) * s.width,
        y: ((e.clientY - rect.top) / rect.height) * s.height,
      };
    };
    const send = (type: 'down' | 'move' | 'up') => (e: PointerEvent) => {
      if (type === 'move' && e.buttons === 0 && e.pointerType === 'mouse') return;
      const p = stagePoint(e);
      feed({ type, x: p.x, y: p.y, t: performance.now() });
    };
    playStage.addEventListener('pointerdown', (e) => {
      try {
        playStage?.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers can't be captured.
      }
      send('down')(e);
    });
    playStage.addEventListener('pointermove', send('move'));
    playStage.addEventListener('pointerup', send('up'));
    playStage.addEventListener('pointercancel', send('up'));

    playBar = el('div', { class: 'explore-bar-fill' });
    const nodes: Node[] = [
      el('h3', { class: 'explore-sheet-title', id: 'explore-sheet-title' }, text.title),
      el('p', { class: 'explore-hint' }, text.hint),
      playStage,
      el('div', { class: 'explore-bar', 'aria-hidden': 'true' }, playBar),
    ];
    if (kind === 'climb') {
      const hand = (side: 'left' | 'right', label: string) => {
        const b = el(
          'button',
          { type: 'button', class: 'auth-button explore-hand', 'data-testid': `explore-${side}` },
          label,
        );
        b.addEventListener('click', () => {
          feed({ type: 'side', side, t: performance.now() });
        });
        return b;
      };
      nodes.push(
        el('div', { class: 'explore-hands' }, hand('left', '✋ Left'), hand('right', 'Right 🤚')),
      );
    }
    const easy = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft explore-easy',
        'data-testid': 'explore-easy',
      },
      `${EXPLORE_TEXT.easy}: ${text.easy}`,
    );
    easy.addEventListener('click', () => {
      feed({ type: 'easy', t: performance.now() });
    });
    if (kind === 'climb') {
      easy.addEventListener('pointerdown', () => {
        feed({ type: 'easy-down', t: performance.now() });
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        easy.addEventListener(type, () => {
          feed({ type: 'easy-up', t: performance.now() });
        });
      }
    }
    const notNow = el(
      'button',
      { type: 'button', class: 'explore-not-now', 'data-testid': 'explore-not-now' },
      'Not now',
    );
    notNow.addEventListener('click', () => {
      playing = null;
      renderSheet();
    });
    nodes.push(easy, el('p', { class: 'explore-easy-note' }, text.easyNote), notNow);
    sheet.replaceChildren(...nodes);
  }

  function findCard(c: Extract<Card, { kind: 'find' }>): Node[] {
    const { found } = c;
    const nodes: Node[] = [
      el('p', { class: 'explore-card-progress' }, progressLine(found.progress)),
      el('h3', { class: 'explore-sheet-title', id: 'explore-sheet-title' }, EXPLORE_TEXT.ta),
      el(
        'p',
        { class: 'explore-headline' },
        c.bigSplash
          ? `${EXPLORE_TEXT.bigSplash} ${foundHeadline(c.interaction)}`
          : foundHeadline(c.interaction),
      ),
      el(
        'ul',
        { class: 'explore-finds', 'data-testid': 'explore-finds' },
        ...findLines(found).map((line) =>
          el('li', { class: `explore-find explore-find-${line.kind}` }, line.text),
        ),
      ),
    ];
    const xp = xpLines(found.xp, teamNames);
    if (xp.length > 0) {
      nodes.push(
        el('p', { class: 'explore-team' }, EXPLORE_TEXT.teamLearned),
        el('ul', { class: 'explore-xp' }, ...xp.map((line) => el('li', {}, line))),
      );
    }
    if (found.explored && tile) {
      nodes.push(
        el(
          'p',
          { class: 'explore-big-news' },
          EXPLORE_TEXT.tileExplored(terrainName(tile.terrain)),
        ),
      );
    }
    if (found.explored && found.homestead === 'joined') {
      nodes.push(el('p', { class: 'explore-big-news' }, EXPLORE_TEXT.joinedHome));
    }
    if (found.tool && found.tool.usesLeft === 0) {
      nodes.push(
        el('p', { class: 'explore-rest', 'data-testid': 'explore-rest' }, restLine(found.tool.id)),
      );
      if (options.onRecipeBook) nodes.push(recipeButton());
    }
    const keepGoing = el(
      'button',
      {
        type: 'button',
        class: 'auth-button explore-keep-going',
        'data-testid': 'explore-keep-going',
      },
      EXPLORE_TEXT.keepGoing,
    );
    keepGoing.addEventListener('click', () => {
      card = null;
      renderSheet();
    });
    nodes.push(keepGoing);
    return nodes;
  }

  function missingCard(c: Extract<Card, { kind: 'missing' }>): Node[] {
    const rows = toolRecipeRows(c.tool, c.bag ?? {});
    const nodes: Node[] = [
      el('h3', { class: 'explore-sheet-title', id: 'explore-sheet-title' }, needLine(c.tool)),
      el('p', { class: 'explore-hint' }, EXPLORE_TEXT.makeOne),
      el(
        'div',
        { class: 'explore-recipe', 'data-testid': 'explore-recipe' },
        el('p', { class: 'explore-recipe-name' }, `${TOOL_WORDS[c.tool].icon} ${toolName(c.tool)}`),
        el(
          'ul',
          { class: 'explore-recipe-rows' },
          ...rows.map((row) =>
            el(
              'li',
              { class: c.bag === null ? '' : row.enough ? 'explore-have' : 'explore-short' },
              c.bag === null ? row.text.replace(/ \d+\/(\d+)$/, ' ×$1') : row.text,
            ),
          ),
        ),
      ),
    ];
    if (options.onRecipeBook) nodes.push(recipeButton());
    const other = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft',
        'data-testid': 'explore-something-else',
      },
      EXPLORE_TEXT.somethingElse,
    );
    other.addEventListener('click', () => {
      card = null;
      renderSheet();
    });
    nodes.push(other);
    return nodes;
  }

  function recipeButton(): HTMLElement {
    const b = el(
      'button',
      { type: 'button', class: 'auth-button', 'data-testid': 'explore-recipe-book' },
      `📖 ${EXPLORE_TEXT.recipeBook}`,
    );
    b.addEventListener('click', () => {
      close();
      options.onRecipeBook?.();
    });
    return b;
  }

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!tile) throw new Error('no tile to explore');
    lastTier = options.tier();
    const species = new Map<string, Species>(GAME_DATA.species.map((s) => [s.id, s]));
    const built = new ExploreScene(scene, tile, {
      registry,
      lod: lodFor('closeUp', lastTier),
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      team: teamMembers.flatMap((m) => {
        const kind = species.get(m.speciesId);
        return kind ? [{ id: m.id, species: kind }] : [];
      }),
      mapTile: options.mapTile(tile),
    });
    built.moveKeeper(keeperAt, yaw);
    scene3d = built;
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) scene3d = null;
    });
    near = null;
    findNear();
    return built.content;
  };

  async function open(at: { q: number; r: number }): Promise<void> {
    const id = mapId;
    // A second quick tap on Explore waits for the first.
    if (!id || isOpen || opening) return;
    opening = true;
    try {
      await openTile(id, at);
    } finally {
      opening = false;
    }
  }

  async function openTile(id: string, at: { q: number; r: number }): Promise<void> {
    const ask = generation;
    let fresh: ExploreTileResponse;
    try {
      const [view, board] = await Promise.all([
        api.tile(id, at),
        // The team only decorates the view: exploring works without it.
        jobs.view(id).catch(() => null),
      ]);
      if (ask !== generation) return;
      fresh = view;
      teamNames = board?.names ?? {};
      team = board?.team ?? [];
      teamMembers = (board?.squishies ?? [])
        .filter((s) => team.includes(s.squishy.id))
        .sort((a, b) => (a.teamSlot ?? 0) - (b.teamSlot ?? 0))
        .map((s) => ({ id: s.squishy.id, speciesId: s.squishy.speciesId }));
    } catch (err) {
      if (ask === generation) options.onProblem(messageOf(err));
      return;
    }
    tile = fresh;
    keeperAt = EXPLORE_VIEW.start;
    yaw = 0;
    walkTo = null;
    stick = null;
    playing = null;
    card = null;
    near = null;
    isOpen = true;
    say(EXPLORE_TEXT.walkHint);
    options.onOpen(id);
    options.showScene(build);
    render();
  }

  function hide(): void {
    isOpen = false;
    // A reply still on its way (a search, a bag read) belongs to this visit:
    // it must never land on the next tile opened.
    generation += 1;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    press = null;
    stick = null;
    walkTo = null;
    playing = null;
    card = null;
    // A search left behind (another map, logout) never blocks the next visit.
    working = false;
    scene3d = null;
    render();
  }

  function close(): void {
    const id = mapId;
    if (!isOpen) return;
    hide();
    options.showScene(null);
    if (id) options.onClosed(id);
  }

  // ── Tile panel ────────────────────────────────────────────────────────

  function renderTile(): void {
    if (!panel) return;
    const { container, tile: t } = panel;
    const mine = user !== null && t.ownerUserId === user.id;
    if (!mine || !mapId || options.isGlade(mapId) || !isExplorable(t.terrain, EXPLORE_RULES)) {
      container.replaceChildren();
      return;
    }
    const nodes: Node[] = [];
    if (t.homestead === 'joined') {
      nodes.push(el('p', { class: 'tile-action-note' }, EXPLORE_TEXT.homestead));
    } else if (t.homestead === 'paused') {
      nodes.push(el('p', { class: 'tile-action-note' }, `zZ ${EXPLORE_TEXT.pausedHome}`));
    }
    if (t.explored) nodes.push(el('p', { class: 'tile-action-note' }, EXPLORE_TEXT.explored));
    const go = el(
      'button',
      { type: 'button', class: 'auth-button bag-action', 'data-testid': 'tile-explore' },
      `🔍 ${EXPLORE_TEXT.explore}`,
    );
    go.addEventListener('click', () => {
      void open(t);
    });
    nodes.push(go);
    container.replaceChildren(...nodes);
  }

  return {
    setMap: (next) => {
      if (next === mapId) return;
      generation += 1;
      mapId = next;
      tile = null;
      if (isOpen) hide();
      renderTile();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      mapId = null;
      tile = null;
      if (isOpen) hide();
      renderTile();
    },
    open,
    tileActions: {
      show: (container, t) => {
        panel = { container, tile: t };
        renderTile();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
      },
    },
    get debug() {
      if (!mapId) return null;
      const s = scene3d;
      return {
        mapId,
        open: isOpen,
        tile: tile ? { q: tile.q, r: tile.r, terrain: tile.terrain } : null,
        progress: tile ? { ...tile.progress } : null,
        spots: (tile?.spots ?? []).map(({ index, kind, tool, done }) => ({
          index,
          kind,
          tool,
          done,
        })),
        keeper: { ...keeperAt },
        near: near?.index ?? null,
        playing: playing?.state.kind ?? null,
        card: card?.kind ?? null,
        scene: s?.stats ?? null,
        spotOnScreen: (index: number) => {
          const spot = tile?.spots.find((x) => x.index === index);
          return spot && s ? s.screenOf(spot) : null;
        },
      };
    },
  };
}

/** Stable 0–1 per spot, so the lantern's glint hides in the same place each time. */
function seedOf(spot: PublicSearchSpot): number {
  return (((spot.index * 2654435761) >>> 0) % 1000) / 1000;
}

function pct(v: number, of: number): string {
  return `${String(of === 0 ? 50 : Math.round((v / of) * 1000) / 10)}%`;
}
