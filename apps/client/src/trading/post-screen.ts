import type {
  MapView,
  PublicUser,
  TradeKind,
  TradeLine,
  TradeLineView,
  TradeOfferView,
  TradeShelf,
  TradesView,
  WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { tradeApi, type TradeApi } from './trade-api.js';
import {
  fitName,
  lineKey,
  lineLook,
  linesInWords,
  mailboxTitle,
  NOTE_IDS,
  noteText,
  offerRequest,
  offersFromMe,
  offersToMe,
  POST_TABS,
  postChip,
  sendProblem,
  stepItem,
  tabBadges,
  togglePick,
  TRADE_TEXT,
  tradeEventForMe,
  waiting,
  type PostTab,
} from './trade-model.js';
import './trading.css';

// The trading post's screen (#271; the owner-approved mockup, screens d, e
// and f, and the iPad side panel). Trade, Gift and Mailbox tabs. Picks are
// only a request: the server checks the post, the things and the rules, holds
// the sender's side and swaps in one go (CLAUDE.md rules 1 and 7). The
// fairness meter, bonuses, take-back and the Shop come later (#272, #273).

export interface PostScreenOptions {
  root: HTMLElement;
  api?: TradeApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** The post the screen is open at: where, its name, and my visit pass (null when connected). */
export interface OpenPost {
  readonly q: number;
  readonly r: number;
  readonly name: string;
  readonly passUntil: string | null;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface PostDebug {
  readonly open: boolean;
  readonly post: { q: number; r: number } | null;
  readonly tab: PostTab;
  readonly mate: string | null;
  readonly give: number;
  readonly want: number;
  readonly offersToMe: number;
  readonly offersFromMe: number;
  readonly mailbox: number;
  readonly working: boolean;
}

export interface PostScreen {
  setUser: (user: PublicUser | null) => void;
  /** Opens the post's screen over the map (from the tile panel's "Visit post"). */
  open: (post: OpenPost, view: MapView) => void;
  close: () => void;
  /** Trade events for me refresh what's shown. */
  liveEvent: (event: WsEventMessage) => void;
  readonly isOpen: boolean;
  readonly debug: PostDebug;
}

export function createPostScreen(options: PostScreenOptions): PostScreen {
  const api = options.api ?? tradeApi;
  const now = options.now ?? (() => Date.now());

  let user: PublicUser | null = null;
  let post: OpenPost | null = null;
  let mapView: MapView | null = null;
  let tab: PostTab = 'trade';
  let trades: TradesView | null = null;
  const shelves = new Map<string, TradeShelf>();
  let mate: string | null = null;
  let give: TradeLine[] = [];
  let want: TradeLine[] = [];
  let noteId: string | null = null;
  let working = false;
  let note = '';
  /** Bumped by every open, close and user change, so a late reply is dropped. */
  let generation = 0;
  let ticker: number | undefined;
  let canvas: CanvasRenderingContext2D | null | undefined;
  /** A 2D context to measure words with (made once). */
  const measure = () => (canvas ??= document.createElement('canvas').getContext('2d'));

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const closeButton = el(
    'button',
    {
      type: 'button',
      class: 'tile-panel-close',
      'aria-label': TRADE_TEXT.close,
      'data-testid': 'post-close',
    },
    '✕',
  );
  closeButton.addEventListener('click', () => {
    close();
  });
  const title = el('h2', { id: 'post-title', class: 'post-title' });
  const chip = el('span', { class: 'post-chip', 'data-testid': 'post-chip' });
  const tabs = el('div', { class: 'post-tabs', role: 'tablist' });
  const status = el('p', { class: 'post-note', role: 'status', 'data-testid': 'post-note' });
  const body = el('div', { class: 'post-body', 'data-testid': 'post-body' });
  const sheet = el(
    'div',
    { class: 'post-sheet', role: 'dialog', 'aria-labelledby': 'post-title', 'data-testid': 'post' },
    el('div', { class: 'post-head' }, title, chip, closeButton),
    tabs,
    status,
    body,
  );
  sheet.hidden = true;
  options.root.append(sheet);

  const me = () => user?.id ?? null;
  const mates = () => (mapView?.members ?? []).filter((m) => m.user.id !== me()).map((m) => m.user);
  const nameOf = (id: string) =>
    mapView?.members.find((m) => m.user.id === id)?.user.username ?? TRADE_TEXT.someone;
  const passOver = () => post !== null && postChip(post.passUntil, now()) === null;

  // ---- loading -------------------------------------------------------------

  async function load(what: { view?: boolean; shelves?: readonly string[] }): Promise<void> {
    const mapId = mapView?.map.id;
    const at = generation;
    if (!mapId) return;
    try {
      const [view, ...loaded] = await Promise.all([
        what.view ? api.view(mapId) : Promise.resolve(null),
        ...(what.shelves ?? []).map((id) => api.shelf(mapId, id)),
      ]);
      if (at !== generation) return;
      if (view) trades = view;
      for (const shelf of loaded) shelves.set(shelf.userId, shelf);
    } catch (err) {
      if (at !== generation) return;
      note = messageOf(err);
    }
    render();
  }

  /** Everything again: after a command, or when a live event says something changed. */
  const reload = () => {
    shelves.clear();
    const ids = [me(), mate].filter((id): id is string => id !== null);
    void load({ view: true, shelves: ids });
  };

  async function command(
    send: (key: string) => Promise<TradesView>,
    done: string | null,
  ): Promise<void> {
    if (working || !post) return;
    const at = generation;
    const stillHere = () => at === generation;
    working = true;
    note = '';
    render();
    try {
      const view = await sendCommand(sendDeps, send, stillHere);
      if (view && stillHere()) {
        trades = view;
        give = [];
        want = [];
        noteId = null;
        note = done ?? '';
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      working = false;
      if (stillHere()) reload();
    }
  }

  const mapId = () => mapView?.map.id ?? '';
  const at = () => ({ q: post?.q ?? 0, r: post?.r ?? 0 });

  // ---- pieces --------------------------------------------------------------

  const button = (
    label: string,
    testId: string,
    kind: 'primary' | 'secondary' | 'gold',
    onClick: () => void,
    disabled = false,
  ) => {
    const b = el(
      'button',
      { type: 'button', class: `post-button post-button-${kind}`, 'data-testid': testId },
      label,
    );
    b.disabled = disabled || working;
    b.addEventListener('click', onClick);
    return b;
  };

  /** A squishy's colour blob or a little picture. */
  function picture(line: TradeLineView, big = false): HTMLElement {
    const look = lineLook(line);
    if (look.color !== null) {
      const blob = el('span', { class: `post-blob${big ? ' big' : ''}`, 'aria-hidden': 'true' });
      blob.style.background = look.color;
      return blob;
    }
    return el('span', { class: 'post-icon', 'aria-hidden': 'true' }, look.icon);
  }

  /** One thing as a tile; tappable when `onTap` is given. */
  function slot(
    line: TradeLineView,
    opts: { picked?: boolean; onTap?: () => void; testId?: string; extra?: Node[] } = {},
  ): HTMLElement {
    const look = lineLook(line);
    const attrs: Record<string, string> = {
      class: `post-slot${opts.picked ? ' picked' : ''}`,
      'data-key': lineKey(line),
    };
    if (opts.testId) attrs['data-testid'] = opts.testId;
    const parts: Node[] = [
      picture(line),
      el('span', { class: 'post-slot-name post-fit' }, look.name),
      ...(look.sub ? [el('span', { class: 'post-tiny' }, look.sub)] : []),
    ];
    if (!opts.onTap) return el('div', attrs, ...parts, ...(opts.extra ?? []));
    const tap = el(
      'button',
      { type: 'button', ...attrs, 'aria-pressed': opts.picked ? 'true' : 'false' },
      ...parts,
    );
    tap.disabled = working;
    const onTap = opts.onTap;
    tap.addEventListener('click', () => {
      onTap();
    });
    return opts.extra?.length ? el('div', { class: 'post-slot-wrap' }, tap, ...opts.extra) : tap;
  }

  /** A shelf to pick from; picked items get a − / + stepper. */
  function shelfGrid(
    shelf: TradeShelf | undefined,
    picks: readonly TradeLine[],
    setPicks: (next: TradeLine[]) => void,
    testId: string,
    empty: string,
  ): HTMLElement {
    if (!shelf) return el('p', { class: 'post-tiny' }, '…');
    const lines: TradeLineView[] = [...shelf.squishies, ...shelf.items, ...shelf.clothing];
    if (lines.length === 0) return el('p', { class: 'post-tiny', 'data-testid': testId }, empty);
    return el(
      'div',
      { class: 'post-grid', 'data-testid': testId },
      ...lines.map((line) => {
        const pick = picks.find((p) => lineKey(p) === lineKey(line));
        const extra: Node[] = [];
        if (pick?.kind === 'item' && line.kind === 'item' && line.quantity > 1) {
          const step = (delta: 1 | -1) => () => {
            setPicks(stepItem(picks, line.itemId, delta, line.quantity));
            render();
          };
          extra.push(
            el(
              'div',
              { class: 'post-stepper' },
              button('−', `step-down-${line.itemId}`, 'secondary', step(-1), pick.quantity <= 1),
              el('span', { class: 'post-tiny' }, `×${String(pick.quantity)}`),
              button(
                '+',
                `step-up-${line.itemId}`,
                'secondary',
                step(1),
                pick.quantity >= line.quantity,
              ),
            ),
          );
        }
        return slot(line, {
          picked: pick !== undefined,
          onTap: () => {
            setPicks(togglePick(picks, line));
            render();
          },
          extra,
        });
      }),
    );
  }

  function mateRow(label: string): HTMLElement {
    const list = mates();
    if (list.length === 0) return el('p', { class: 'post-tiny' }, TRADE_TEXT.noMates);
    return el(
      'div',
      { class: 'post-section' },
      el('b', { class: 'post-small' }, label),
      el(
        'div',
        { class: 'post-mates', role: 'radiogroup', 'aria-label': label },
        ...list.map((u) => {
          const on = u.id === mate;
          const b = el(
            'button',
            {
              type: 'button',
              class: `post-mate${on ? ' on' : ''}`,
              role: 'radio',
              'aria-checked': on ? 'true' : 'false',
              'data-testid': 'post-mate',
              'data-user': u.id,
            },
            el('span', { class: 'post-face', 'aria-hidden': 'true' }, u.username.slice(0, 1)),
            el('span', { class: 'post-mate-name' }, u.username),
          );
          b.addEventListener('click', () => {
            if (mate === u.id) return;
            mate = u.id;
            want = [];
            render();
            if (!shelves.has(u.id)) void load({ shelves: [u.id] });
          });
          return b;
        }),
      ),
    );
  }

  function notes(): HTMLElement {
    return el(
      'div',
      { class: 'post-notes' },
      el('span', { class: 'post-tiny' }, TRADE_TEXT.addNote),
      ...NOTE_IDS.map((id) => {
        const on = noteId === id;
        const b = el(
          'button',
          {
            type: 'button',
            class: `post-note-chip${on ? ' on' : ''}`,
            'aria-pressed': on ? 'true' : 'false',
            'data-testid': `post-note-${id}`,
          },
          noteText(id) ?? id,
        );
        b.addEventListener('click', () => {
          noteId = on ? null : id;
          render();
        });
        return b;
      }),
    );
  }

  /** An offer to me: what I'd get, what they'd get, and the two answers. */
  function incoming(offer: TradeOfferView): HTMLElement {
    const from = nameOf(offer.fromUserId);
    const said = noteText(offer.noteId);
    const side = (lines: readonly TradeLineView[], who: string) =>
      el(
        'div',
        { class: 'post-side' },
        ...lines.map((l) => slot(l)),
        el('span', { class: 'post-tiny' }, who),
      );
    return el(
      'div',
      { class: 'post-card', 'data-testid': 'post-offer-in', 'data-offer': offer.id },
      el(
        'div',
        { class: 'post-row' },
        el('span', { class: 'post-face', 'aria-hidden': 'true' }, from.slice(0, 1)),
        el(
          'div',
          {},
          el('b', {}, TRADE_TEXT.wantsToTrade(from)),
          ...(said ? [el('div', { class: 'post-small' }, `“${said}”`)] : []),
        ),
      ),
      el(
        'div',
        { class: 'post-swap' },
        side(offer.give, TRADE_TEXT.youGet),
        el('span', { class: 'post-swap-arrow', 'aria-hidden': 'true' }, '⇄'),
        side(offer.want, TRADE_TEXT.theyGet(from)),
      ),
      el(
        'div',
        { class: 'post-row' },
        button(TRADE_TEXT.noThanks, 'post-decline', 'secondary', () => {
          void command((key) => api.decline(mapId(), offer.id, key), TRADE_TEXT.declined);
        }),
        button(
          TRADE_TEXT.sayYes,
          'post-accept',
          'primary',
          () => {
            void command((key) => api.accept(mapId(), offer.id, at(), key), TRADE_TEXT.traded);
          },
          passOver(),
        ),
      ),
    );
  }

  /** One of mine waiting on someone, with "Call it off". */
  function outgoing(offer: TradeOfferView): HTMLElement {
    return el(
      'div',
      { class: 'post-card post-card-cream', 'data-testid': 'post-offer-out' },
      el('b', {}, TRADE_TEXT.waitingFor(nameOf(offer.toUserId))),
      el('div', { class: 'post-small post-fit' }, linesInWords(offer.give)),
      button(TRADE_TEXT.callOff, 'post-cancel', 'secondary', () => {
        void command((key) => api.cancel(mapId(), offer.id, key), TRADE_TEXT.calledOff);
      }),
    );
  }

  function sendButton(kind: TradeKind): HTMLElement {
    const to = mate;
    const problem = sendProblem(kind, give, want);
    const name = to === null ? '' : nameOf(to);
    const b = button(
      kind === 'gift' ? TRADE_TEXT.sendGift : TRADE_TEXT.sendOffer,
      kind === 'gift' ? 'post-send-gift' : 'post-send',
      'primary',
      () => {
        if (to === null) return;
        const request = offerRequest(at(), kind, to, give, want, noteId);
        void command(
          (key) => api.send(mapId(), request, key),
          kind === 'gift' ? TRADE_TEXT.giftSent(name) : TRADE_TEXT.sent(name),
        );
      },
      to === null || problem !== null || passOver(),
    );
    b.classList.add('wide');
    const hint =
      to === null
        ? ''
        : problem && (give.length > 0 || want.length > 0)
          ? problem
          : kind === 'gift'
            ? TRADE_TEXT.giftWaits(name)
            : TRADE_TEXT.waitsSafely(name);
    // Stuck to the sheet's bottom, so "Send" is on screen while picking (style guide §3).
    return el(
      'div',
      { class: 'post-send-bar' },
      b,
      el('p', { class: 'post-tiny center', 'data-testid': 'post-send-hint' }, hint),
    );
  }

  // ---- tabs ----------------------------------------------------------------

  function tradeTab(view: TradesView, my: string): Node[] {
    const mine = shelves.get(my);
    const theirs = mate === null ? undefined : shelves.get(mate);
    return [
      ...offersToMe(view, my).map(incoming),
      mateRow(TRADE_TEXT.tradeWith),
      el(
        'div',
        { class: 'post-columns' },
        el(
          'div',
          { class: 'post-section' },
          el('b', { class: 'post-small' }, TRADE_TEXT.youGive),
          shelfGrid(mine, give, (next) => (give = next), 'post-give', TRADE_TEXT.nothingToGive),
        ),
        el(
          'div',
          { class: 'post-section' },
          el('b', { class: 'post-small' }, TRADE_TEXT.youWant),
          mate === null
            ? el('span', {})
            : shelfGrid(
                theirs,
                want,
                (next) => (want = next),
                'post-want',
                TRADE_TEXT.nothingTheyHave,
              ),
        ),
      ),
      notes(),
      sendButton('trade'),
      ...offersFromMe(view, my, 'trade').map(outgoing),
    ];
  }

  function giftTab(view: TradesView, my: string): Node[] {
    return [
      mateRow(TRADE_TEXT.giftTo),
      el(
        'div',
        { class: 'post-section' },
        el('b', { class: 'post-small' }, TRADE_TEXT.pickGift),
        shelfGrid(
          shelves.get(my),
          give,
          (next) => (give = next),
          'post-gift-pick',
          TRADE_TEXT.nothingToGive,
        ),
      ),
      notes(),
      sendButton('gift'),
      ...offersFromMe(view, my, 'gift').map(outgoing),
    ];
  }

  function mailboxTab(view: TradesView): Node[] {
    const entries = waiting(view);
    const cards = entries.map((entry) => {
      const [first] = entry.lines;
      return el(
        'div',
        { class: 'post-card post-row', 'data-testid': 'post-mail', 'data-entry': entry.id },
        first ? picture(first, true) : el('span', {}),
        el(
          'div',
          { class: 'post-grow' },
          el('b', { class: 'post-fit' }, mailboxTitle(entry, nameOf)),
          el('div', { class: 'post-small post-fit' }, linesInWords(entry.lines)),
        ),
        el(
          'div',
          { class: 'post-stack' },
          button(
            TRADE_TEXT.pickUp,
            'post-pickup',
            'primary',
            () => {
              void command(
                (key) => api.pickup(mapId(), { ...at(), ids: [entry.id] }, key),
                TRADE_TEXT.pickedUp,
              );
            },
            passOver(),
          ),
          ...(entry.kind === 'gift'
            ? [
                button(TRADE_TEXT.noThanks, 'post-gift-decline', 'secondary', () => {
                  void command(
                    (key) => api.decline(mapId(), entry.offerId, key),
                    TRADE_TEXT.declined,
                  );
                }),
              ]
            : []),
        ),
      );
    });
    const all =
      entries.length > 1
        ? [
            button(
              TRADE_TEXT.pickUpAll,
              'post-pickup-all',
              'gold',
              () => {
                void command((key) => api.pickup(mapId(), at(), key), TRADE_TEXT.pickedUp);
              },
              passOver(),
            ),
          ]
        : [];
    for (const b of all) b.classList.add('wide');
    return [
      ...(entries.length === 0
        ? [
            el(
              'p',
              { class: 'post-small', 'data-testid': 'post-mail-empty' },
              TRADE_TEXT.emptyMailbox,
            ),
          ]
        : cards),
      ...all,
      el('p', { class: 'post-tiny center' }, TRADE_TEXT.mailboxEverywhere),
      ...view.returns.map((entry) =>
        el(
          'div',
          { class: 'post-card post-card-cream post-small', 'data-testid': 'post-return' },
          TRADE_TEXT.cameBack(linesInWords(entry.lines)),
        ),
      ),
    ];
  }

  // ---- render --------------------------------------------------------------

  function render(): void {
    const my = me();
    if (!post || my === null) {
      sheet.hidden = true;
      syncTicker(false);
      return;
    }
    sheet.hidden = false;
    title.textContent = post.name;
    const chipText = postChip(post.passUntil, now());
    chip.textContent = chipText ?? '';
    chip.hidden = chipText === null;
    chip.className = `post-chip ${post.passUntil === null ? 'mint' : 'gold'}`;
    syncTicker(post.passUntil !== null);

    const badges = tabBadges(trades, my);
    tabs.replaceChildren(
      ...POST_TABS.map((t) => {
        const on = t === tab;
        const b = el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `post-tab${on ? ' on' : ''}`,
            'aria-selected': on ? 'true' : 'false',
            'data-testid': `post-tab-${t}`,
          },
          TRADE_TEXT.tabs[t],
          ...(badges[t] > 0
            ? [
                el(
                  'i',
                  { class: 'post-badge', 'data-testid': `post-badge-${t}` },
                  String(badges[t]),
                ),
              ]
            : []),
        );
        b.addEventListener('click', () => {
          if (tab === t) return;
          tab = t;
          give = [];
          want = [];
          noteId = null;
          note = '';
          render();
        });
        return b;
      }),
    );

    const banner = passOver()
      ? TRADE_TEXT.closed
      : trades?.tradingEnabled === false
        ? TRADE_TEXT.tradingOff
        : '';
    status.textContent = note || banner;
    status.hidden = status.textContent === '';

    if (!trades) {
      body.replaceChildren(el('p', { class: 'post-tiny' }, '…'));
      return;
    }
    const parts =
      tab === 'trade'
        ? tradeTab(trades, my)
        : tab === 'gift'
          ? giftTab(trades, my)
          : mailboxTab(trades);
    body.replaceChildren(...parts);
    fitNames(body);
  }

  /** Shrinks each name until its longest word fits its box whole (owner, #271). */
  function fitNames(root: HTMLElement): void {
    const ctx = measure();
    if (!ctx) return;
    for (const node of root.querySelectorAll<HTMLElement>('.post-fit')) {
      node.style.fontSize = '';
      node.classList.remove('post-ellipsis');
      const box = node.clientWidth;
      const style = getComputedStyle(node);
      const fontPx = parseFloat(style.fontSize);
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const words = node.textContent.split(/\s+/);
      const widest = Math.max(0, ...words.map((w) => ctx.measureText(w).width));
      const fit = fitName(widest, box, fontPx);
      if (fit.px !== fontPx) node.style.fontSize = `${String(fit.px)}px`;
      node.classList.toggle('post-ellipsis', fit.ellipsis);
    }
  }

  /** Counts the visit pass down, only while a pass's post is open. */
  function syncTicker(on: boolean): void {
    if (on && ticker === undefined) {
      ticker = window.setInterval(render, 15_000);
    } else if (!on && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  }

  function reset(): void {
    generation += 1;
    trades = null;
    shelves.clear();
    give = [];
    want = [];
    noteId = null;
    note = '';
    working = false;
  }

  function close(): void {
    if (!post) return;
    post = null;
    reset();
    render();
  }

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      post = null;
      reset();
      render();
    },
    open: (next, view) => {
      reset();
      post = next;
      mapView = view;
      tab = 'trade';
      const list = mates();
      mate = list[0]?.id ?? null;
      render();
      const ids = [me(), mate].filter((id): id is string => id !== null);
      void load({ view: true, shelves: ids });
    },
    close,
    liveEvent: (event) => {
      const my = me();
      if (!post || my === null || event.mapId !== mapView?.map.id) return;
      if (tradeEventForMe(event, my) && !working) reload();
    },
    get isOpen() {
      return post !== null;
    },
    get debug() {
      const my = me();
      return {
        open: post !== null,
        post: post ? { q: post.q, r: post.r } : null,
        tab,
        mate,
        give: give.length,
        want: want.length,
        offersToMe: trades && my ? offersToMe(trades, my).length : 0,
        offersFromMe:
          trades && my
            ? offersFromMe(trades, my, 'trade').length + offersFromMe(trades, my, 'gift').length
            : 0,
        mailbox: trades ? waiting(trades).length : 0,
        working,
      };
    },
  };
}
