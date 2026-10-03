import {
  CLOTHING_BY_ID,
  GAME_DATA,
  type Boutique,
  type ClothingRarity,
  type Wardrobe,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { createCoinPill } from '../coins/coin-counter.js';
import { el, messageOf } from '../dom.js';
import { boutiqueApi, type BoutiqueApi } from './boutique-api.js';
import { BOUTIQUE_TEXT, buyState, racksOf } from './boutique-view.js';
import './boutique.css';

// The Boutique (design doc §23, #45): reached from the Wardrobe, it takes the
// wardrobe's bottom card while the Keeper stays on show above it. Tapping a
// piece tries it on (preview only, nothing sent) and asks whether to get it,
// or says kindly there aren't enough coins yet. Coins are earned in play and
// never bought: there are no real-money prompts, ads or links (CLAUDE.md
// rule 9). The server prices and checks every purchase (rule 1).

export interface BoutiqueCardOptions {
  /** The piece the Keeper should try on (null: back to their own outfit). */
  onPreview: (itemId: string | null) => void;
  /** A purchase went through: the wardrobe with the new piece in it. */
  onBought: (wardrobe: Wardrobe) => void;
  /** "Back": the wardrobe card again. */
  onBack: () => void;
  /** A rarity's player-facing name (the wardrobe's words). */
  rarityName: (rarity: ClothingRarity) => string;
  api?: BoutiqueApi;
  /** Dev builds show a "get coins" button (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface BoutiqueDebug {
  readonly open: boolean;
  readonly loaded: boolean;
  readonly balance: number | null;
  readonly daily: readonly string[];
  readonly seasonal: readonly string[];
  readonly owned: readonly string[];
  /** The piece being tried on. */
  readonly previewing: string | null;
  /** What the sheet over the card asks: get a piece, or "not enough yet". */
  readonly sheet: { kind: 'confirm' | 'short'; itemId: string } | null;
  readonly buying: boolean;
}

export interface BoutiqueCard {
  readonly node: HTMLElement;
  open: () => void;
  close: () => void;
  /** Forget everything (a new login). */
  reset: () => void;
  readonly isOpen: boolean;
  readonly debug: BoutiqueDebug;
}

const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));
const nameOf = (itemId: string) => CLOTHING_BY_ID.get(itemId)?.name ?? itemId;

export function createBoutiqueCard(options: BoutiqueCardOptions): BoutiqueCard {
  const api = options.api ?? boutiqueApi;
  let isOpen = false;
  let boutique: Boutique | null = null;
  let previewing: string | null = null;
  let sheet: BoutiqueDebug['sheet'] = null;
  let buying = false;
  /** Bumped on open, close and reset, so a slow reply can't land on a newer screen. */
  let session = 0;

  // ── DOM ───────────────────────────────────────────────────────────────
  const coins = createCoinPill('boutique-coins');
  const back = el(
    'button',
    { type: 'button', class: 'wardrobe-chip', 'data-testid': 'boutique-back' },
    BOUTIQUE_TEXT.back,
  );
  const header = el(
    'div',
    { class: 'wardrobe-header' },
    el('h2', { class: 'auth-title', id: 'boutique-title' }, BOUTIQUE_TEXT.title),
    coins.node,
    back,
  );
  const racks = el('div', { class: 'boutique-racks', 'data-testid': 'boutique-racks' });
  const note = el('p', { class: 'wardrobe-note', role: 'status', 'data-testid': 'boutique-note' });
  const devGrant = options.devTools
    ? el('button', { type: 'button', class: 'wardrobe-chip' }, BOUTIQUE_TEXT.devGrant)
    : null;
  const ask = el('div', {
    class: 'boutique-sheet',
    role: 'alertdialog',
    'aria-labelledby': 'boutique-ask',
    'data-testid': 'boutique-sheet',
  });
  ask.hidden = true;
  const node = el(
    'div',
    {
      class: 'auth-card wardrobe-card boutique-card',
      'data-testid': 'boutique',
      'aria-labelledby': 'boutique-title',
    },
    header,
    el('p', { class: 'boutique-restock' }, BOUTIQUE_TEXT.restock),
    racks,
    el('div', { class: 'boutique-footer' }, note, ...(devGrant ? [devGrant] : [])),
    ask,
  );
  node.hidden = true;

  const say = (text: string) => {
    note.textContent = text === '' ? BOUTIQUE_TEXT.subtitle : text;
  };

  const button = (label: string, onTap: () => void, extra: Record<string, string> = {}) => {
    const b = el('button', { type: 'button', class: 'wardrobe-chip', ...extra }, label);
    b.addEventListener('click', onTap);
    return b;
  };

  // ── Racks ─────────────────────────────────────────────────────────────
  function render(): void {
    coins.set(boutique?.coins.balance ?? null);
    if (!boutique) return;
    const balance = boutique.coins.balance;
    const sections = racksOf(boutique, (id) => SEASON_NAMES.get(id) ?? id).map((rack) => {
      const cards = rack.items.map((entry) => {
        const item = CLOTHING_BY_ID.get(entry.itemId);
        const state = buyState(entry, balance);
        const swatch = el('span', { class: 'wardrobe-swatch' });
        swatch.style.background = item?.visual.pieces[0]?.color ?? '#ffffff';
        const tag =
          state.kind === 'owned'
            ? el('span', { class: 'boutique-tag boutique-owned' }, BOUTIQUE_TEXT.owned)
            : el(
                'span',
                { class: `boutique-tag${state.kind === 'short' ? ' boutique-short' : ''}` },
                el('span', { class: 'coin-icon', 'aria-hidden': 'true' }),
                BOUTIQUE_TEXT.price(entry.price),
              );
        const parts: Node[] = [
          swatch,
          el('span', { class: 'wardrobe-item-name' }, item?.name ?? entry.itemId),
          el(
            'span',
            { class: `wardrobe-rarity-dot rarity-${item?.rarity ?? 'common'}` },
            item?.slot === 'squishy'
              ? BOUTIQUE_TEXT.forSquishies
              : options.rarityName(item?.rarity ?? 'common'),
          ),
          tag,
        ];
        const card = el(
          'button',
          {
            type: 'button',
            class: 'wardrobe-item boutique-item',
            'aria-pressed': String(previewing === entry.itemId),
            'data-item': entry.itemId,
            'data-state': state.kind,
            title: item?.description ?? '',
          },
          ...parts,
        );
        card.addEventListener('click', () => {
          pick(entry.itemId);
        });
        return card;
      });
      return el(
        'section',
        { class: 'boutique-rack', 'data-rack': rack.id },
        el('h3', { class: 'boutique-rack-title' }, rack.title),
        el('div', { class: 'wardrobe-items boutique-items' }, ...cards),
      );
    });
    racks.replaceChildren(...sections);
    renderSheet();
  }

  function renderSheet(): void {
    const entry = sheet && boutique ? findEntry(boutique, sheet.itemId) : null;
    if (!sheet || !entry || !boutique) {
      ask.hidden = true;
      ask.replaceChildren();
      return;
    }
    const name = nameOf(entry.itemId);
    if (sheet.kind === 'confirm') {
      const yes = button(BOUTIQUE_TEXT.buy, () => void buy(entry.itemId), {
        class: 'wardrobe-chip wardrobe-done',
        'data-testid': 'boutique-buy',
      });
      yes.disabled = buying;
      ask.replaceChildren(
        el(
          'p',
          { class: 'boutique-ask', id: 'boutique-ask' },
          BOUTIQUE_TEXT.confirm(name, entry.price),
        ),
        el(
          'p',
          { class: 'boutique-ask-hint' },
          BOUTIQUE_TEXT.left(boutique.coins.balance - entry.price),
        ),
        el('div', { class: 'boutique-ask-actions' }, yes, button(BOUTIQUE_TEXT.notNow, dismiss)),
      );
    } else {
      ask.replaceChildren(
        el('p', { class: 'boutique-ask', id: 'boutique-ask' }, BOUTIQUE_TEXT.notEnough),
        el(
          'p',
          { class: 'boutique-ask-hint' },
          `${BOUTIQUE_TEXT.need(entry.price - boutique.coins.balance)} ${BOUTIQUE_TEXT.earnHint}`,
        ),
        el(
          'div',
          { class: 'boutique-ask-actions' },
          button(BOUTIQUE_TEXT.okay, dismiss, { 'data-testid': 'boutique-okay' }),
        ),
      );
    }
    ask.hidden = false;
  }

  // ── Trying on and buying ──────────────────────────────────────────────
  function pick(itemId: string): void {
    if (!boutique || buying) return;
    const entry = findEntry(boutique, itemId);
    if (!entry) return;
    previewing = itemId;
    options.onPreview(itemId);
    const state = buyState(entry, boutique.coins.balance);
    sheet =
      state.kind === 'owned' ? null : { kind: state.kind === 'buy' ? 'confirm' : 'short', itemId };
    say(state.kind === 'owned' ? BOUTIQUE_TEXT.owned : '');
    render();
  }

  function dismiss(): void {
    sheet = null;
    renderSheet();
  }

  async function buy(itemId: string): Promise<void> {
    if (buying) return;
    const mine = session;
    buying = true;
    renderSheet();
    try {
      const result = await sendCommand(
        { newKey: newIdempotencyKey, wait: delay, retryAfterMs: COMMAND_RETRY_MS },
        (key) => api.buy(itemId, key),
        () => mine === session,
      );
      if (!result || mine !== session) return;
      boutique = result.boutique;
      sheet = null;
      options.onBought(result.wardrobe);
      say(BOUTIQUE_TEXT.bought(nameOf(itemId)));
    } catch (err) {
      if (mine !== session) return;
      sheet = null;
      say(messageOf(err));
      // The racks or the balance may have changed (midnight, another device).
      void load(false);
    } finally {
      if (mine === session) {
        buying = false;
        render();
      }
    }
  }

  // ── Open and close ────────────────────────────────────────────────────
  async function load(clearNote = true): Promise<void> {
    const mine = session;
    if (clearNote) say(BOUTIQUE_TEXT.loading);
    try {
      const next = await api.get();
      if (mine !== session) return;
      boutique = next;
      if (clearNote) say('');
      render();
    } catch (err) {
      if (mine !== session) return;
      say(messageOf(err));
      if (!boutique) {
        racks.replaceChildren(
          el('p', { class: 'wardrobe-empty' }, BOUTIQUE_TEXT.loadFailed),
          button(BOUTIQUE_TEXT.retry, () => void load()),
        );
      }
    }
  }

  function close(): void {
    if (!isOpen) return;
    session += 1;
    isOpen = false;
    node.hidden = true;
    sheet = null;
    buying = false;
    previewing = null;
    options.onPreview(null);
  }

  back.addEventListener('click', () => {
    close();
    options.onBack();
  });

  devGrant?.addEventListener('click', () => {
    const mine = session;
    api.devGrant(100).then(
      () => {
        if (mine === session) void load(false);
      },
      (err: unknown) => {
        if (mine === session) say(messageOf(err));
      },
    );
  });

  return {
    node,
    open: () => {
      if (isOpen) return;
      session += 1;
      isOpen = true;
      node.hidden = false;
      sheet = null;
      previewing = null;
      if (boutique) render();
      else racks.replaceChildren();
      void load();
    },
    close,
    reset: () => {
      close();
      session += 1;
      boutique = null;
      coins.set(null);
      racks.replaceChildren();
    },
    get isOpen() {
      return isOpen;
    },
    get debug() {
      const all = boutique ? [...boutique.daily, ...boutique.seasonal.flatMap((r) => r.items)] : [];
      return {
        open: isOpen,
        loaded: boutique !== null,
        balance: boutique?.coins.balance ?? null,
        daily: boutique?.daily.map((i) => i.itemId) ?? [],
        seasonal: boutique?.seasonal.flatMap((r) => r.items.map((i) => i.itemId)) ?? [],
        owned: all.filter((i) => i.owned).map((i) => i.itemId),
        previewing,
        sheet,
        buying,
      };
    },
  };
}

function findEntry(boutique: Boutique, itemId: string) {
  return [...boutique.daily, ...boutique.seasonal.flatMap((r) => r.items)].find(
    (i) => i.itemId === itemId,
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
