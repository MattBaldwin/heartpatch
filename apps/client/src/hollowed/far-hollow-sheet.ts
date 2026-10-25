import { COMMUNITY_RULES, type FarHollowView, type PlayerBattle } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { farHollowApi, type FarHollowApi } from './far-hollow-api.js';
import {
  FAR_HOLLOW_TEXT as T,
  farHollowState,
  freshLine,
  type FarHollowState,
} from './far-hollow-model.js';
import './hollowed.css';

// The far Hollow's sheet (#306 PR 6, plan Q7): my own far Hollow this
// season, opened from a trading post's panel. Away: the far road's trail and
// "Take the far road". There: the Crooked House and "Go inside" (the house
// screen is #306 6c). Both at any hour (owner decisions of 2026-10-23).
// Done: when a fresh one comes. The server decides everything (rule 1).

export interface FarHollowSheetOptions {
  root: HTMLElement;
  api?: Pick<FarHollowApi, 'view' | 'road'>;
  mapId: () => string | null;
  /** The far road started (or one going came back): the battle screen takes over. */
  openBattle: (battle: PlayerBattle) => void;
  /** "Go inside" tapped: the house screen (#306 6c). Until there is one, the door's stuck. */
  goInside?: () => void;
  /** The sheet opened: the map's tile panel steps aside. */
  onOpen?: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface FarHollowSheetDebug {
  readonly open: boolean;
  readonly state: FarHollowState | null;
}

export interface FarHollowSheet {
  /** Opens the sheet; `post` is the trading post it was opened from (the far road starts there). */
  open: (post: { q: number; r: number } | null) => Promise<void>;
  /** Reads it again if it's open (the season turned). */
  refresh: () => Promise<void>;
  close: () => void;
  /** The far road battle a tap here started: its result card says where to. */
  isRoad: (battleId: string) => boolean;
  readonly isOpen: boolean;
  readonly debug: FarHollowSheetDebug;
}

export function createFarHollowSheet(options: FarHollowSheetOptions): FarHollowSheet {
  const api = options.api ?? farHollowApi;
  const sheet = el('section', {
    class: 'hollowed-sheet far-hollow-sheet',
    role: 'dialog',
    'aria-labelledby': 'far-hollow-title',
    'data-testid': 'far-hollow-sheet',
  });
  sheet.hidden = true;
  options.root.append(sheet);

  let view: FarHollowView | null = null;
  let post: { q: number; r: number } | null = null;
  let generation = 0;
  let working = false;
  let note: string | null = null;
  /** Far road battles started here. */
  const roads = new Set<string>();

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const close = (): void => {
    generation += 1;
    view = null;
    note = null;
    working = false;
    sheet.hidden = true;
    sheet.replaceChildren();
  };

  const button = (label: string, testId: string, soft: boolean, onTap: () => void) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: soft
          ? 'hp-button hp-button-secondary hollowed-soft'
          : 'hp-button hp-button-primary hollowed-primary',
        'data-testid': testId,
      },
      label,
    );
    b.addEventListener('click', onTap);
    return b;
  };

  async function setOff(): Promise<void> {
    const id = options.mapId();
    const from = post;
    if (!id || !from || working) return;
    const at = generation;
    const stillHere = () => at === generation && options.mapId() === id;
    working = true;
    note = null;
    render();
    try {
      const reply = await sendCommand(sendDeps, (key) => api.road(id, from, key), stillHere);
      if (reply && stillHere()) {
        // A battle already going comes back instead (one at a time; even a
        // post's journey): only one this tap started is the far road.
        if (reply.created && reply.battle.kind === 'journey') roads.add(reply.battle.id);
        close();
        options.openBattle(reply.battle);
        return;
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      if (stillHere()) {
        working = false;
        render();
      }
    }
  }

  function render(): void {
    const v = view;
    if (!v) return;
    const state = farHollowState(v);
    const kicker = el('p', { class: 'hollowed-kicker' }, T.kicker(v.season.name));
    const title = el(
      'h3',
      { class: 'hollowed-title', id: 'far-hollow-title' },
      state === 'complete' ? T.doneTitle : T.title(v.name),
    );
    const said = note
      ? [
          el(
            'p',
            { class: 'hollowed-said', role: 'status', 'data-testid': 'far-hollow-note' },
            note,
          ),
        ]
      : [];
    const closeButton = button(T.close, 'far-hollow-close', true, close);
    if (state === 'away') {
      const go = button(working ? '…' : T.start, 'far-hollow-road', false, () => {
        void setOff();
      });
      go.disabled = working;
      sheet.replaceChildren(
        kicker,
        title,
        el('p', { class: 'hollowed-line' }, T.awayLead),
        el(
          'p',
          { class: 'hollowed-seed', 'data-testid': 'far-hollow-trail' },
          `🧭 ${T.road(v.road.teamSize, v.road.level)}`,
        ),
        ...said,
        el('p', { class: 'hollowed-note' }, post ? T.roadStakes : T.fromPost),
        el('div', { class: 'hollowed-actions' }, ...(post ? [go] : []), closeButton),
      );
    } else if (state === 'arrived') {
      const inside = options.goInside;
      const go = button(T.goInside, 'far-hollow-inside', false, () => {
        if (!inside) return;
        close();
        inside();
      });
      go.disabled = !inside;
      sheet.replaceChildren(
        kicker,
        title,
        el('p', { class: 'hollowed-line' }, T.arrivedLead),
        ...said,
        ...(inside
          ? []
          : [el('p', { class: 'hollowed-note', 'data-testid': 'far-hollow-next' }, T.stuck)]),
        el('div', { class: 'hollowed-actions' }, go, closeButton),
      );
    } else {
      sheet.replaceChildren(
        kicker,
        title,
        el('p', { class: 'hollowed-line' }, T.doneLead),
        ...said,
        el(
          'p',
          { class: 'hollowed-note', 'data-testid': 'far-hollow-next' },
          freshLine(v.nextSeason),
        ),
        el('div', { class: 'hollowed-actions' }, closeButton),
      );
    }
    sheet.hidden = false;
  }

  async function load(): Promise<void> {
    const id = options.mapId();
    if (!id) return;
    const at = generation;
    try {
      const fresh = await api.view(id);
      if (at !== generation) return;
      view = fresh;
      render();
    } catch (err) {
      if (at !== generation) return;
      note = messageOf(err);
      if (view) {
        render();
        return;
      }
      // Nothing to show yet (offline, say): the sheet still opens and says why.
      sheet.replaceChildren(
        el(
          'h3',
          { class: 'hollowed-title', id: 'far-hollow-title' },
          T.title(COMMUNITY_RULES.farHollow.name),
        ),
        el('p', { class: 'hollowed-said', role: 'status', 'data-testid': 'far-hollow-note' }, note),
        el('div', { class: 'hollowed-actions' }, button(T.close, 'far-hollow-close', true, close)),
      );
      sheet.hidden = false;
    }
  }

  return {
    open: async (from) => {
      close();
      post = from;
      options.onOpen?.();
      await load();
    },
    refresh: async () => {
      if (!sheet.hidden) await load();
    },
    close,
    isRoad: (battleId) => roads.has(battleId),
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      return { open: !sheet.hidden, state: view ? farHollowState(view) : null };
    },
  };
}
