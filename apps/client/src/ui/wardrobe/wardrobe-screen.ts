import {
  CLOTHING_BY_ID,
  GAME_EVENTS,
  OUTFIT_PRESETS,
  SQUISHY_SLOT,
  type KeeperConfig,
  type PublicUser,
  type Wardrobe,
  type WsEventMessage,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../../engine/config.js';
import type { SceneBuilder, SceneContent } from '../../engine/stage.js';
import { COMMAND_RETRY_MS } from '../../inventory/send-command.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { keeperItems } from '../../procedural/keeper/keeper-items.js';
import { lodFor } from '../../procedural/motion.js';
import type { BoutiqueApi } from '../boutique/boutique-api.js';
import { createBoutiqueCard, type BoutiqueDebug } from '../boutique/boutique-card.js';
import { BOUTIQUE_TEXT, previewWearing } from '../boutique/boutique-view.js';
import type { MilestonesApi } from '../../milestones/milestones-api.js';
import {
  createMilestonesCard,
  type MilestonesCardDebug,
} from '../../milestones/milestones-card.js';
import { MILESTONES_TEXT } from '../../milestones/milestones-view.js';
import { el, messageOf } from '../dom.js';
import { KeeperPreview } from '../keeper/keeper-preview.js';
import { OutfitSync } from './outfit-sync.js';
import { wardrobeApi, type WardrobeApi } from './wardrobe-api.js';
import {
  hiddenByCostume,
  RARITY_FILTERS,
  sameOutfit,
  shownItems,
  tabCounts,
  WARDROBE_TABS,
  type RarityFilter,
  type WardrobeTab,
} from './wardrobe-view.js';
import './wardrobe.css';

// The wardrobe (design doc §23, issue #43): the player's Keeper in 3D up top
// and a bottom card for one thumb: a tab per slot, a rarity filter, the
// pieces they own, and three saved outfits. Tapping a piece tries it on at
// once (optimistic, tech spec §6); the outfit goes to the server once the
// player stops tapping, and the server checks it (CLAUDE.md rule 1). A
// refused outfit rolls back to the last one the server kept.

export interface WardrobeScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the preview, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player's Keeper (#42), to dress in the preview. */
  keeper: () => KeeperConfig | null;
  /** The wardrobe is taking the screen: put the map and lobby away. */
  onOpen: () => void;
  /** It closed: bring the lobby back. */
  onClosed: () => void;
  api?: WardrobeApi;
  /** The Boutique's calls (#45); tests swap them. */
  boutiqueApi?: BoutiqueApi;
  /** The Milestones card's calls (#44); tests swap them. */
  milestonesApi?: MilestonesApi;
  /** Dev builds show a "get clothes" button (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
  /** How long after the last tap the outfit is sent. Tests shorten it. */
  sendAfterMs?: number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface WardrobeDebug {
  readonly open: boolean;
  readonly loaded: boolean;
  readonly tab: WardrobeTab;
  readonly rarity: RarityFilter;
  /** Ids shown in the item list right now. */
  readonly shown: readonly string[];
  /** What the preview wears (tried on). */
  readonly trying: readonly string[];
  /** What the server last said the Keeper wears. */
  readonly wearing: readonly string[];
  readonly owned: readonly string[];
  readonly presets: Wardrobe['presets'];
  /** `keeperHash` of the 3D preview, while it's on screen. */
  readonly preview: string | null;
  readonly turned: boolean;
  /** Outfits sent to the server (taps are batched into one). */
  readonly sends: number;
  /** An outfit waiting to go, or on its way. */
  readonly sending: boolean;
  /** The last piece of clothing found while playing, if any. */
  readonly found: string | null;
  /** The Boutique (#45), which takes the bottom card while it's open. */
  readonly boutique: BoutiqueDebug;
  /** Milestones (#44), which also take the bottom card while open. */
  readonly milestones: MilestonesCardDebug;
}

export interface WardrobeScreen {
  setUser: (user: PublicUser | null) => void;
  open: () => void;
  /** Closes it as "Done" does (the tutorial's wardrobe step moving on, #24). */
  close: () => void;
  /** The lobby's "Wardrobe" button. */
  listActions: () => Node[];
  /** A live event from the map on screen: a find shows a toast. */
  liveEvent: (event: WsEventMessage) => void;
  /** What the player's Keeper wears (battles dress it too). */
  readonly wearing: readonly string[];
  readonly debug: WardrobeDebug | null;
}

// Player-facing text (style guide §2, §6, §9).
export const WARDROBE_TEXT = {
  open: 'Wardrobe',
  title: 'Wardrobe',
  subtitle: 'Tap to try things on!',
  tabs: {
    hat: 'Hats',
    'hair-accessory': 'Hair',
    top: 'Tops',
    bottom: 'Bottoms',
    shoes: 'Shoes',
    back: 'Backs',
    held: 'Hands',
    costume: 'Costumes',
    squishy: 'Squishy',
  } satisfies Record<WardrobeTab, string>,
  rarities: {
    all: 'All',
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
  } satisfies Record<RarityFilter, string>,
  empty: 'Nothing here yet. Keep exploring to find some!',
  emptyRarity: 'None like that yet. Keep exploring!',
  squishyNote: 'Tiny things for your squishy friends.',
  under: 'Under costume',
  outfits: 'My outfits',
  outfit: (n: number) => `Outfit ${String(n)}`,
  emptyOutfit: 'Empty',
  saveLook: 'Save look',
  saveTo: 'Save this look as…',
  nameLabel: 'Name (you can skip this)',
  spot: (n: number) => `Spot ${String(n)}`,
  cancel: 'Never mind',
  saved: 'Saved! Tap it any time to wear it.',
  turn: 'Turn around',
  turnBack: 'Face me',
  done: 'Done',
  loading: 'Opening the wardrobe…',
  loadFailed: 'We couldn’t open your wardrobe. Check your connection and try again!',
  retry: 'Try again',
  found: (name: string) => `Ooh, something new: ${name}! It’s in your wardrobe.`,
  devGrant: 'Get clothes (dev)',
} as const;

/** What a dev build hands out to try on: a Halloween piece for every slot. */
const DEV_ITEMS = [
  'witch-hat',
  'bat-clip',
  'moonlit-sweater',
  'pumpkin-bloomers',
  'curly-witch-boots',
  'ghost-cape',
  'jack-o-lamp',
  'ghost-sheet',
  'tiny-witch-hat',
];

/** How long after the last tap an outfit goes to the server. */
const SEND_AFTER_MS = 700; // TUNE: long enough to flick through hats, short enough to feel saved
/** How long the "you found …" note stays. */
const FOUND_MS = 5000; // TUNE

export function createWardrobeScreen(options: WardrobeScreenOptions): WardrobeScreen {
  const api = options.api ?? wardrobeApi;
  const sendAfterMs = options.sendAfterMs ?? SEND_AFTER_MS;

  let user: PublicUser | null = null;
  /** Bumped on every login change, so a slow reply can't land on another player. */
  let session = 0;
  let isOpen = false;
  let tab: WardrobeTab = 'hat';
  let rarity: RarityFilter = 'all';
  let turned = false;
  let found: string | null = null;
  let preview: KeeperPreview | null = null;
  let frame = 0;
  let lastTier: QualityTier | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const title = el('h1', { class: 'auth-title', id: 'wardrobe-title' }, WARDROBE_TEXT.title);
  const turn = el(
    'button',
    { type: 'button', class: 'wardrobe-chip', 'data-testid': 'wardrobe-turn' },
    WARDROBE_TEXT.turn,
  );
  const done = el(
    'button',
    { type: 'button', class: 'wardrobe-chip wardrobe-done', 'data-testid': 'wardrobe-done' },
    WARDROBE_TEXT.done,
  );
  const shop = el(
    'button',
    { type: 'button', class: 'wardrobe-chip', 'data-testid': 'wardrobe-boutique' },
    BOUTIQUE_TEXT.open,
  );
  const goals = el(
    'button',
    { type: 'button', class: 'wardrobe-chip', 'data-testid': 'wardrobe-milestones' },
    MILESTONES_TEXT.open,
  );
  const header = el('div', { class: 'wardrobe-header' }, title, goals, shop, turn, done);
  const tabs = el('div', { class: 'wardrobe-tabs', role: 'tablist' });
  const rarities = el('div', { class: 'wardrobe-rarities' });
  const list = el('div', { class: 'wardrobe-items', 'data-testid': 'wardrobe-items' });
  const outfits = el('div', { class: 'wardrobe-outfits', 'data-testid': 'wardrobe-outfits' });
  const saveRow = el('div', { class: 'wardrobe-save', 'data-testid': 'wardrobe-save' });
  saveRow.hidden = true;
  const note = el('p', { class: 'wardrobe-note', role: 'status', 'data-testid': 'wardrobe-note' });
  // Grid rows: header, tabs, rarities, the items (all the room left), the
  // outfits or the save row (one shows at a time), and a note line.
  const card = el(
    'div',
    { class: 'auth-card wardrobe-card' },
    header,
    tabs,
    rarities,
    list,
    outfits,
    saveRow,
    note,
  );
  const devGrant = options.devTools
    ? el('button', { type: 'button', class: 'wardrobe-chip' }, WARDROBE_TEXT.devGrant)
    : null;
  const panel = el(
    'section',
    {
      class: 'wardrobe',
      'data-testid': 'wardrobe',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'wardrobe-title',
    },
    card,
  );
  panel.hidden = true;
  // The Boutique (#45) swaps in for this card; the Keeper above tries things on.
  /** The Boutique piece the Keeper is trying on, over their outfit. */
  let shopping: string | null = null;
  const boutique = createBoutiqueCard({
    onPreview: (itemId) => {
      shopping = itemId;
      showLook(itemId !== null);
    },
    onBought: (wardrobe) => {
      outfit.adoptOwned(wardrobe);
    },
    onBack: () => {
      card.hidden = false;
      render();
      showLook(false);
    },
    rarityName: (r) => WARDROBE_TEXT.rarities[r],
    ...(options.boutiqueApi ? { api: options.boutiqueApi } : {}),
    ...(options.devTools ? { devTools: true } : {}),
  });
  panel.append(boutique.node);
  // Milestones (#44) swap in the same way; the Keeper above shows off.
  const milestones = createMilestonesCard({
    onBack: () => {
      card.hidden = false;
      render();
    },
    username: () => user?.username ?? '',
    ...(options.milestonesApi ? { api: options.milestonesApi } : {}),
  });
  panel.append(milestones.node);
  const toast = el('p', {
    class: 'wardrobe-toast',
    role: 'status',
    'data-testid': 'wardrobe-found',
  });
  toast.hidden = true;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  options.root.append(panel, toast);

  /** The line under the card; the hint when there's nothing else to say. */
  const say = (text: string) => {
    note.textContent = text === '' ? WARDROBE_TEXT.subtitle : text;
  };

  // ── Preview ───────────────────────────────────────────────────────────
  const showLook = (hop: boolean) => {
    const keeper = options.keeper();
    if (!preview || !keeper) return;
    const wearing = previewWearing(outfit.trying, shopping, CLOTHING_BY_ID);
    preview.show(keeper, performance.now(), hop, keeperItems(wearing), turned);
    options.invalidate();
  };

  const build = (scene: Scene): SceneContent => {
    const built = new KeeperPreview(scene, lodFor('closeUp', options.tier()));
    lastTier = options.tier();
    preview = built;
    showLook(false);
    scene.onDisposeObservable.addOnce(() => {
      if (preview === built) preview = null;
      built.dispose();
    });
    return built.content;
  };

  /** Draws while the Keeper hops, and follows the quality tier's detail level. */
  const tick = (): void => {
    frame = 0;
    if (!isOpen) return;
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
  const chip = (
    label: string,
    pressed: boolean,
    onTap: () => void,
    extra: Record<string, string> = {},
  ) => {
    const node = el(
      'button',
      { type: 'button', class: 'wardrobe-chip', 'aria-pressed': String(pressed), ...extra },
      label,
    );
    node.addEventListener('click', onTap);
    return node;
  };

  function renderTabs(): void {
    const counts = tabCounts(outfit.server?.owned ?? []);
    tabs.replaceChildren(
      ...WARDROBE_TABS.map((t) => {
        const node = chip(
          WARDROBE_TEXT.tabs[t],
          t === tab,
          () => {
            tab = t;
            render();
          },
          { role: 'tab', 'aria-selected': String(t === tab), 'data-tab': t },
        );
        const count = counts.get(t) ?? 0;
        if (count > 0) node.append(el('span', { class: 'wardrobe-count' }, String(count)));
        return node;
      }),
    );
    rarities.replaceChildren(
      ...RARITY_FILTERS.map((r) =>
        chip(
          WARDROBE_TEXT.rarities[r],
          r === rarity,
          () => {
            rarity = r;
            render();
          },
          { 'data-rarity': r, class: `wardrobe-chip wardrobe-rarity rarity-${r}` },
        ),
      ),
    );
  }

  function renderItems(): void {
    const server = outfit.server;
    if (!server) return;
    const items = shownItems(server.owned, tab, rarity);
    const forSquishies = tab === SQUISHY_SLOT;
    const nodes: Node[] = items.map(({ item, count }) => {
      const worn = outfit.trying.includes(item.id);
      const swatch = el('span', { class: 'wardrobe-swatch' });
      swatch.style.background = item.visual.pieces[0]?.color ?? '#ffffff';
      const parts: Node[] = [
        swatch,
        el('span', { class: 'wardrobe-item-name' }, item.name),
        el(
          'span',
          { class: `wardrobe-rarity-dot rarity-${item.rarity}` },
          WARDROBE_TEXT.rarities[item.rarity],
        ),
      ];
      if (count > 1) parts.push(el('span', { class: 'wardrobe-count' }, `×${String(count)}`));
      if (hiddenByCostume(outfit.trying, item.id)) {
        parts.push(el('span', { class: 'wardrobe-under' }, WARDROBE_TEXT.under));
      }
      if (forSquishies) {
        return el(
          'div',
          { class: 'wardrobe-item', 'data-item': item.id, title: item.description },
          ...parts,
        );
      }
      const node = el(
        'button',
        {
          type: 'button',
          class: 'wardrobe-item',
          'aria-pressed': String(worn),
          'data-item': item.id,
          title: item.description,
        },
        ...parts,
      );
      node.addEventListener('click', () => {
        tryOn(item.id);
      });
      return node;
    });
    if (forSquishies && items.length > 0) {
      nodes.unshift(el('p', { class: 'wardrobe-empty' }, WARDROBE_TEXT.squishyNote));
    }
    if (items.length === 0) {
      nodes.push(
        el(
          'p',
          { class: 'wardrobe-empty' },
          rarity === 'all' ? WARDROBE_TEXT.empty : WARDROBE_TEXT.emptyRarity,
        ),
      );
    }
    list.replaceChildren(...nodes);
  }

  function renderOutfits(): void {
    const server = outfit.server;
    if (!server) return;
    const presets = new Map(server.presets.map((p) => [p.preset, p]));
    const buttons: Node[] = [];
    for (let n = 1; n <= OUTFIT_PRESETS; n++) {
      const saved = presets.get(n);
      const node = el(
        'button',
        {
          type: 'button',
          class: 'wardrobe-chip wardrobe-outfit',
          'data-preset': String(n),
          'aria-pressed': String(saved !== undefined && sameOutfit(saved.wearing, outfit.trying)),
        },
        saved?.name ?? WARDROBE_TEXT.outfit(n),
      );
      if (!saved) {
        node.disabled = true;
        node.append(el('span', { class: 'wardrobe-under' }, WARDROBE_TEXT.emptyOutfit));
      } else {
        node.addEventListener('click', () => void wearPreset(n));
      }
      buttons.push(node);
    }
    const save = chip(WARDROBE_TEXT.saveLook, false, openSave, {
      'data-testid': 'wardrobe-save-look',
    });
    outfits.replaceChildren(
      el('span', { class: 'wardrobe-outfits-title' }, WARDROBE_TEXT.outfits),
      ...buttons,
      save,
      ...(devGrant ? [devGrant] : []),
    );
  }

  function render(): void {
    turn.textContent = turned ? WARDROBE_TEXT.turnBack : WARDROBE_TEXT.turn;
    renderTabs();
    renderItems();
    renderOutfits();
  }

  // ── Trying things on ──────────────────────────────────────────────────
  const outfit = new OutfitSync({
    wear: (wearing, key) => api.wear(wearing, key),
    newKey: newIdempotencyKey,
    wait: delay,
    retryAfterMs: COMMAND_RETRY_MS,
    sendAfterMs,
    onChange: () => {
      if (!isOpen) return;
      render();
      showLook(false);
    },
    onError: say,
  });

  function tryOn(itemId: string): void {
    outfit.tryOn(itemId);
    say('');
    render();
    showLook(true);
  }

  async function wearPreset(preset: number): Promise<void> {
    const mine = session;
    // The preset replaces taps not sent yet (sending them too would race it).
    outfit.cancel();
    say('');
    try {
      const result = await api.wearPreset(preset, newIdempotencyKey());
      if (mine !== session) return;
      outfit.wore(result);
      render();
      showLook(true);
    } catch (err) {
      if (mine === session) say(messageOf(err));
    }
  }

  // ── Saving outfits ────────────────────────────────────────────────────
  function openSave(): void {
    const name = el('input', {
      type: 'text',
      class: 'auth-input wardrobe-name',
      maxlength: '24',
      autocomplete: 'off',
      'aria-label': WARDROBE_TEXT.nameLabel,
      placeholder: WARDROBE_TEXT.nameLabel,
      'data-testid': 'wardrobe-name',
    });
    const spots: Node[] = [];
    for (let n = 1; n <= OUTFIT_PRESETS; n++) {
      spots.push(
        chip(WARDROBE_TEXT.spot(n), false, () => void savePreset(n, name.value), {
          'data-spot': String(n),
        }),
      );
    }
    saveRow.replaceChildren(
      el('p', { class: 'wardrobe-save-title' }, WARDROBE_TEXT.saveTo),
      name,
      el(
        'div',
        { class: 'wardrobe-spots' },
        ...spots,
        chip(WARDROBE_TEXT.cancel, false, closeSave),
      ),
    );
    saveRow.hidden = false;
    outfits.hidden = true;
  }

  function closeSave(): void {
    saveRow.hidden = true;
    saveRow.replaceChildren();
    outfits.hidden = false;
  }

  async function savePreset(preset: number, rawName: string): Promise<void> {
    const mine = session;
    const name = rawName.trim();
    try {
      const result = await api.savePreset(
        preset,
        { name: name === '' ? null : name, wearing: [...outfit.trying] },
        newIdempotencyKey(),
      );
      if (mine !== session) return;
      // Saving never changes what's worn; keep any taps still on their way.
      outfit.adoptOwned(result);
      closeSave();
      render();
      say(WARDROBE_TEXT.saved);
    } catch (err) {
      if (mine === session) say(messageOf(err));
    }
  }

  // ── Open and close ────────────────────────────────────────────────────
  async function load(): Promise<void> {
    const mine = session;
    say(WARDROBE_TEXT.loading);
    try {
      const wardrobe = await api.get();
      if (mine !== session) return;
      outfit.load(wardrobe);
      say('');
      if (isOpen) {
        render();
        showLook(false);
      }
    } catch (err) {
      if (mine !== session || !isOpen) return;
      say(messageOf(err));
      list.replaceChildren(
        el('p', { class: 'wardrobe-empty' }, WARDROBE_TEXT.loadFailed),
        chip(WARDROBE_TEXT.retry, false, () => void load()),
      );
    }
  }

  function open(): void {
    if (!user || isOpen) return;
    isOpen = true;
    turned = false;
    closeSave();
    options.onOpen();
    panel.hidden = false;
    if (outfit.server) render();
    else list.replaceChildren();
    options.showScene(build);
    if (frame === 0) frame = requestAnimationFrame(tick);
    void load();
  }

  function close(): void {
    if (!isOpen) return;
    boutique.close();
    milestones.close();
    card.hidden = false;
    outfit.flush();
    isOpen = false;
    panel.hidden = true;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    options.showScene(null);
    options.onClosed();
  }

  turn.addEventListener('click', () => {
    turned = !turned;
    render();
    showLook(false);
  });
  done.addEventListener('click', close);
  shop.addEventListener('click', () => {
    closeSave();
    card.hidden = true;
    boutique.open();
  });
  goals.addEventListener('click', () => {
    closeSave();
    card.hidden = true;
    milestones.open();
  });

  devGrant?.addEventListener('click', () => {
    const mine = session;
    api.devGrant(DEV_ITEMS).then(
      (wardrobe) => {
        if (mine !== session) return;
        outfit.adoptOwned(wardrobe);
        render();
      },
      (err: unknown) => {
        if (mine === session) say(messageOf(err));
      },
    );
  });

  const showFound = (itemId: string) => {
    const item = CLOTHING_BY_ID.get(itemId);
    if (!item) return;
    found = itemId;
    toast.textContent = WARDROBE_TEXT.found(item.name);
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, FOUND_MS);
    // The next open fetches it; an open wardrobe fetches it now.
    if (isOpen) void load();
  };

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      session += 1;
      close();
      user = next;
      outfit.reset();
      boutique.reset();
      milestones.reset();
      found = null;
      toast.hidden = true;
      // Known early, so battles dress the Keeper before the wardrobe opens.
      if (next) void load();
    },
    open,
    close,
    listActions: () => {
      if (!user) return [];
      const button = el(
        'button',
        { type: 'button', class: 'auth-button auth-button-soft', 'data-testid': 'wardrobe-open' },
        WARDROBE_TEXT.open,
      );
      button.addEventListener('click', open);
      return [button];
    },
    liveEvent: (event) => {
      if (event.type !== 'clothing.found' || !user) return;
      const parsed = GAME_EVENTS['clothing.found'].public.safeParse(event.data);
      if (parsed.success && parsed.data.userId === user.id) showFound(parsed.data.itemId);
    },
    get wearing() {
      return outfit.server?.wearing ?? [];
    },
    get debug() {
      if (!user) return null;
      return {
        open: isOpen,
        loaded: outfit.server !== null,
        tab,
        rarity,
        shown: outfit.server
          ? shownItems(outfit.server.owned, tab, rarity).map((s) => s.item.id)
          : [],
        trying: [...outfit.trying],
        wearing: [...(outfit.server?.wearing ?? [])],
        owned: outfit.server?.owned.map((o) => o.itemId) ?? [],
        presets: outfit.server?.presets ?? [],
        preview: isOpen ? (preview?.hash ?? null) : null,
        turned,
        sends: outfit.sends,
        sending: outfit.sending,
        found,
        boutique: boutique.debug,
        milestones: milestones.debug,
      };
    },
  };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
