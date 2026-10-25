import {
  HomeNameSchema,
  NAMING_RULES,
  type CommunityView,
  type Hex,
  type MapMember,
  type RestoreTileResponse,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { restoreApi, type RestoreApi } from './restore-api.js';
import {
  giftLine,
  RESTORE_TEXT as T,
  restoreSheetWords,
  villageNameIdeas,
} from './restore-view.js';
import './hollowed.css';
import '../milestones/milestones.css';

// Restoring a grey village (#306 PR 3, the plan's screens): the restore
// sheet for one tile (its pieces, who helped, the next piece's cost against
// my bag, who claims) and, when a piece wins the village, the naming card
// ("The joy is back! 🌈") with tap-to-fill ideas. The server prices and
// decides everything; the sheet only shows its reply. The win's party is the
// milestone card's sparkles (CSS only: no new mesh or shader), and the map's
// redraw that follows (the ring's colour and height, the village's Heart
// Seed: instance data on meshes already built) is announced to the render
// governor first (`expectHitch`), as a find is.

export interface RestoreSheetOptions {
  root: HTMLElement;
  api?: RestoreApi;
  mapId: () => string | null;
  members: () => readonly MapMember[];
  /** A burst of work is about to land: the render governor lets it pass (#501 G). */
  expectHitch: () => void;
  /** The sheet opened: the map's tile panel steps aside. */
  onOpen?: () => void;
  /** Glides the camera so a tile sits above the sheet (the restore sheet's tile, the won ring). */
  reveal?: (at: Hex, wide: boolean) => void;
  /** The sheet closed (PR 2c: a won village's key map card waits for the joy card). */
  onClose?: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface RestoreSheetDebug {
  readonly card: 'restore' | 'won' | 'name' | null;
  readonly piecesDone: number | null;
  readonly blocked: string | null;
  readonly said: string | null;
}

export interface RestoreSheet {
  /** The restore sheet for a grey village tile (the panel's Restore). */
  open: (community: CommunityView, at: Hex) => void;
  /** The naming card for a won village (the square's "Name it"). */
  openName: (community: CommunityView) => void;
  /**
   * The joy card for a village won elsewhere (PR 4: its last tile won in a
   * battle). Skipped when this sheet already showed it for that village.
   */
  openWon: (community: CommunityView) => void;
  close: () => void;
  /** A card is up. */
  readonly isOpen: boolean;
  readonly debug: RestoreSheetDebug;
}

export function createRestoreSheet(options: RestoreSheetOptions): RestoreSheet {
  const api = options.api ?? restoreApi;
  const sheet = el('section', {
    class: 'hollowed-sheet',
    role: 'dialog',
    'aria-labelledby': 'hollowed-sheet-title',
    'data-testid': 'restore-sheet',
  });
  sheet.hidden = true;
  options.root.append(sheet);

  let card: RestoreSheetDebug['card'] = null;
  let generation = 0;
  let working = false;
  let reply: RestoreTileResponse | null = null;
  let said: string | null = null;
  let blocked: string | null = null;
  /** The village the won and naming cards are about, and the naming card's error line. */
  let naming: { community: CommunityView; error: string | null } | null = null;
  /** Villages a piece of mine won here: their live event mustn't show the card again. */
  const wonHere = new Set<string>();
  const input = el('input', {
    type: 'text',
    class: 'hollowed-input',
    id: 'hollowed-name',
    maxlength: String(NAMING_RULES.maxLength),
    placeholder: T.placeholder,
    autocomplete: 'off',
    autocapitalize: 'words',
    enterkeyhint: 'done',
    'data-testid': 'village-name-input',
  });

  const close = (): void => {
    generation += 1;
    card = null;
    reply = null;
    naming = null;
    said = null;
    blocked = null;
    working = false;
    const was = !sheet.hidden;
    sheet.hidden = true;
    sheet.replaceChildren();
    if (was) options.onClose?.();
  };

  const button = (label: string, testId: string, soft: boolean, onTap?: () => void) => {
    const b = el(
      'button',
      {
        type: onTap ? 'button' : 'submit',
        class: soft
          ? 'hp-button hp-button-secondary hollowed-soft'
          : 'hp-button hp-button-primary hollowed-primary',
        'data-testid': testId,
      },
      label,
    );
    if (onTap) b.addEventListener('click', onTap);
    return b;
  };

  const meter = (done: number, total: number) =>
    el(
      'div',
      { class: 'hollowed-meter', role: 'img', 'aria-label': T.pieces(done, total) },
      ...Array.from({ length: total }, (_, i) => el('span', { class: i < done ? 'on' : '' })),
    );

  const renderRestore = (): void => {
    const r = reply;
    if (!r) return;
    const words = restoreSheetWords(r, options.members());
    blocked = words.blocked;
    const go = button(working ? T.working : T.restore, 'restore-piece', false, () => {
      void restore();
    });
    go.disabled = working || words.blocked !== null;
    sheet.replaceChildren(
      el('p', { class: 'hollowed-kicker' }, words.kicker),
      el('h3', { class: 'hollowed-title', id: 'hollowed-sheet-title' }, words.title),
      el('p', { class: 'hollowed-line' }, words.pieces),
      meter(words.done, words.needed),
      el(
        'ul',
        { class: 'hollowed-rows', 'data-testid': 'restore-costs' },
        ...words.helpers.map((line) =>
          el(
            'li',
            { class: 'hollowed-row hollowed-row-done' },
            el('span', {}, line),
            el('span', { 'aria-hidden': 'true' }, '✓'),
          ),
        ),
        ...words.costs.map((row) =>
          el(
            'li',
            { class: `hollowed-row${row.short ? ' hollowed-row-short' : ''}` },
            el('span', {}, row.label),
            el('span', { class: 'hollowed-row-have' }, row.have),
          ),
        ),
      ),
      ...(said !== null
        ? [el('p', { class: 'hollowed-said', role: 'status', 'data-testid': 'restore-said' }, said)]
        : []),
      el(
        'p',
        { class: 'hollowed-note', 'data-testid': 'restore-note' },
        words.blocked ?? words.note,
      ),
      el(
        'div',
        { class: 'hollowed-actions' },
        go,
        button(T.notNow, 'restore-not-now', true, close),
      ),
    );
  };

  const renderName = (): void => {
    const n = naming;
    if (!n) return;
    const c = n.community;
    const chips = villageNameIdeas(c).map((idea) => {
      const b = el(
        'button',
        { type: 'button', class: 'hollowed-chip', 'data-testid': 'village-name-idea' },
        idea,
      );
      b.addEventListener('click', () => {
        input.value = idea;
        input.focus();
      });
      return b;
    });
    const go = button(working ? T.naming : T.nameIt, 'village-name-it', false);
    go.disabled = working;
    const notNow = button(T.notNow, 'village-name-not-now', true, close);
    notNow.disabled = working;
    const form = el(
      'form',
      { class: 'hollowed-form', novalidate: '' },
      el('label', { class: 'hollowed-label', for: 'hollowed-name' }, T.label),
      input,
      el(
        'p',
        { class: 'hollowed-error', role: 'alert', 'data-testid': 'village-name-error' },
        n.error ?? '',
      ),
      el('div', { class: 'hollowed-chips', role: 'group', 'aria-label': T.ideas }, ...chips),
      el('p', { class: 'hollowed-note' }, T.nameNote),
      el('div', { class: 'hollowed-actions' }, go, notNow),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (working) return;
      const parsed = HomeNameSchema.safeParse(input.value);
      if (!parsed.success) {
        n.error = parsed.error.issues[0]?.message ?? T.placeholder;
        renderName();
        return;
      }
      void name(parsed.data);
    });
    sheet.replaceChildren(
      el('p', { class: 'hollowed-kicker' }, T.wonKicker(c.name, c.tiles.length)),
      el('h3', { class: 'hollowed-title', id: 'hollowed-sheet-title' }, T.wonTitle),
      el('p', { class: 'hollowed-line' }, T.wonLine),
      form,
    );
  };

  /**
   * The full-restore moment: a short card under the ring, so the village's
   * new Heart Seed and its ring show above it, with the milestone card's
   * sparkles (CSS only). "Name it" opens the naming card.
   */
  const renderWon = (): void => {
    const n = naming;
    if (!n) return;
    const c = n.community;
    sheet.replaceChildren(
      el(
        'div',
        { class: 'milestone-sparkles milestone-sparkles-on', 'aria-hidden': 'true' },
        ...['✨', '🌈', '⭐', '💖', '✨', '🌱'].map((s) => el('span', {}, s)),
      ),
      el('p', { class: 'hollowed-kicker' }, T.wonKicker(c.name, c.tiles.length)),
      el('h3', { class: 'hollowed-title', id: 'hollowed-sheet-title' }, T.wonTitle),
      el('p', { class: 'hollowed-seed', 'data-testid': 'village-seed-line' }, T.wonSeed),
      el(
        'div',
        { class: 'hollowed-actions' },
        button(T.nameIt, 'village-won-name', false, () => {
          card = 'name';
          renderName();
          input.focus();
        }),
        button(T.later, 'village-won-later', true, close),
      ),
    );
  };

  const show = (): void => {
    sheet.hidden = false;
    options.onOpen?.();
  };

  async function restore(): Promise<void> {
    const r = reply;
    const mapId = options.mapId();
    if (!r || !mapId || working) return;
    const at = generation;
    working = true;
    said = null;
    // This piece may win it: its live event can land before the reply.
    wonHere.add(r.community.id);
    renderRestore();
    try {
      const next = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) =>
          api.restore(
            mapId,
            r.community.id,
            { q: r.tile.q, r: r.tile.r, piecesDone: r.tile.piecesDone },
            key,
          ),
        () => at === generation,
      );
      if (at !== generation || !next) return;
      working = false;
      if (next.outcome !== 'village') wonHere.delete(r.community.id);
      if (next.outcome === 'village') {
        // The map recolours the ring, lifts it home and plants the seed as
        // the live event lands: let that burst pass, then the party, with
        // the camera on the ring above the card.
        options.expectHitch();
        input.value = villageNameIdeas(next.community)[0] ?? next.community.name;
        naming = { community: next.community, error: null };
        card = 'won';
        reply = null;
        renderWon();
        options.reveal?.(next.community.square, true);
        return;
      }
      if (next.outcome === 'tile') options.expectHitch();
      reply = next;
      said = next.outcome === 'tile' ? T.claimed : next.gift ? T.thanks(giftLine(next.gift)) : null;
      renderRestore();
    } catch (err) {
      if (at !== generation) return;
      working = false;
      wonHere.delete(r.community.id);
      said = messageOf(err);
      renderRestore();
    }
  }

  async function name(value: string): Promise<void> {
    const n = naming;
    const mapId = options.mapId();
    if (!n || !mapId || working) return;
    const at = generation;
    working = true;
    n.error = null;
    renderName();
    try {
      const done = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) => api.name(mapId, n.community.id, value, key),
        () => at === generation,
      );
      if (at !== generation || !done) return;
      close();
    } catch (err) {
      if (at !== generation) return;
      working = false;
      n.error = messageOf(err);
      renderName();
    }
  }

  return {
    open: (community, at) => {
      const mapId = options.mapId();
      if (!mapId) return;
      close();
      const g = generation;
      card = 'restore';
      sheet.replaceChildren(el('p', { class: 'hollowed-line' }, T.working));
      show();
      options.reveal?.(at, false);
      void api
        .sheet(mapId, community.id, at)
        .then((next) => {
          if (g !== generation) return;
          reply = next;
          renderRestore();
        })
        .catch((err: unknown) => {
          if (g !== generation) return;
          sheet.replaceChildren(
            el('p', { class: 'hollowed-line' }, messageOf(err)),
            button(T.done, 'restore-not-now', true, close),
          );
        });
    },
    openName: (community) => {
      close();
      card = 'name';
      input.value = villageNameIdeas(community)[0] ?? community.name;
      naming = { community, error: null };
      renderName();
      show();
      options.reveal?.(community.square, true);
    },
    openWon: (community) => {
      if (wonHere.has(community.id)) return;
      wonHere.add(community.id);
      close();
      // The ring recolours and lifts home with the resync: let that burst pass.
      options.expectHitch();
      input.value = villageNameIdeas(community)[0] ?? community.name;
      naming = { community, error: null };
      card = 'won';
      renderWon();
      show();
      options.reveal?.(community.square, true);
    },
    close,
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      return { card, piecesDone: reply?.tile.piecesDone ?? null, blocked, said };
    },
  };
}
