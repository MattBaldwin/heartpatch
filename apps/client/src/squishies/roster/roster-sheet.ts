import type {
  CareListResponse,
  HomeResponse,
  JobSquishy,
  JobsView,
  MyBuilding,
  SetJobRequest,
} from '@heartpatch/shared';
import { careApi, type CareApi } from '../../care/care-api.js';
import { CARE_TEXT } from '../../care/care-view.js';
import { moodHeartsEl } from '../../care/mood-hearts.js';
import { homeApi, type HomeApi } from '../../home/home-api.js';
import { houseApi, type HouseApi } from '../../house/house-api.js';
import {
  MOVE_BACK_IN_HOURS,
  hoursUntil,
  residentRooms,
  roomNameOf,
} from '../../house/house-residents-view.js';
import { RESIDENT_TEXT } from '../../house/house-view.js';
import { atHome, buildingIcon, buildingName } from '../../home/home-view.js';
import { GameClock } from '../../inventory/game-clock.js';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { ApiRequestError } from '../../net/api.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { el, messageOf } from '../../ui/dom.js';
import { rarityChip } from '../../ui/rarity/rarity.js';
import {
  groundsPicker,
  jobActions,
  spotPicker,
  type JobActionsContext,
} from '../jobs/job-actions.js';
import { jobsApi, type JobsApi } from '../jobs/jobs-api.js';
import { blobFor } from '../jobs/job-board.js';
import {
  filterCounts,
  mergeRoster,
  ROSTER_FILTERS,
  ROSTER_SORTS,
  ROSTER_TEXT,
  statusLine,
  visibleRows,
  type EvolutionStage,
  type MoodTag,
  type RosterFilter,
  type RosterRow,
  type RosterSort,
} from './roster-view.js';
import type { Portraits } from '../../procedural/portraits.js';
import './roster.css';

// The Squishies roster (#375): one sheet at home listing every squishy with
// its mood, rarity, level and status, a sort and a quick filter, and, one tap
// on a row, the actions that used to be three screens away. Client-only: it
// merges the home, care and jobs reads the client already makes. The job
// buttons and pickers are the job board's own (`job-actions.ts`).

export interface RosterOptions {
  root: HTMLElement;
  api?: {
    home?: Pick<HomeApi, 'get' | 'house'>;
    care?: Pick<CareApi, 'list'>;
    jobs?: JobsApi;
    keeperHouse?: Pick<HouseApi, 'moveResident'>;
  };
  /** Opens the care sheet (a row's Care button: two taps from the home panel). */
  onCare?: (mapId: string, squishyId: string) => void;
  /** Opens the squishy in the close-up view. */
  onCloseUp?: (mapId: string, squishyId: string) => void;
  /** Opens the close-up with Dress up already showing. */
  onDressUp?: (mapId: string, squishyId: string) => void;
  /**
   * The Keeper's house (#381): "Move into the house" opens the house's
   * move-in picker on this squishy. Offered only while the house is on for
   * the player (`HomeResponse.house`) and `canMoveIntoHouse` says the
   * house can open from here (home open on this patch).
   */
  onMoveIntoHouse?: (mapId: string, home: HomeResponse, squishyId: string) => void;
  canMoveIntoHouse?: (mapId: string) => boolean;
  /** Jobs exist on this map (not on the Tutorial Glade); without, rows go by home's job. */
  hasJobs?: (mapId: string) => boolean;
  /** The real squishy pictures (the game's 3D renderer); without them, plain blobs. */
  portraits?: Portraits;
  /**
   * What the screen behind keeps on show at the top (CSS px from the top:
   * home's banner, the account chip). The sheet never grows over it, so a
   * long detail scrolls inside the sheet instead of cutting through a line.
   */
  coveredTop?: () => number;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface RosterDebug {
  readonly open: boolean;
  readonly mapId: string | null;
  readonly rows: number;
  readonly shown: readonly string[];
  readonly sort: RosterSort;
  readonly filter: RosterFilter;
  readonly expanded: string | null;
  readonly note: string;
}

export interface RosterSheet {
  /** Opens the roster for my squishies on this map. */
  open: (mapId: string) => Promise<void>;
  /** Reads the three views again (care or Dress up changed something). */
  refresh: () => Promise<void>;
  close: () => void;
  /** Steps out of sight under another sheet (a care sheet) and back, keeping its place. */
  setCovered: (covered: boolean) => void;
  readonly isOpen: boolean;
  readonly debug: RosterDebug;
}

const SORT_LABELS = ROSTER_TEXT.sort;
/** While reads fail, a landed countdown asks again at most this often. */
const ASK_AGAIN_MS = 5_000; // TUNE

/** Sets a bar's fill (0–1) as its width. */
function fillTo(node: HTMLElement, fill: number): HTMLElement {
  node.style.width = `${String(Math.round(fill * 100))}%`;
  return node;
}
const FILTER_LABELS = ROSTER_TEXT.filter;

export function createRosterSheet(options: RosterOptions): RosterSheet {
  const homeCalls = options.api?.home ?? homeApi;
  const careCalls = options.api?.care ?? careApi;
  const jobCalls = options.api?.jobs ?? jobsApi;
  const houseCalls = options.api?.keeperHouse ?? houseApi;
  const clock = new GameClock(options.now);
  let mapId: string | null = null;
  let home: HomeResponse | null = null;
  let care: CareListResponse | null = null;
  let jobs: JobsView | null = null;
  let rows: RosterRow[] = [];
  let sort: RosterSort = 'mood';
  let filter: RosterFilter = 'all';
  let expanded: string | null = null;
  /** The picker whose choices are open, or null. */
  let menu: 'sort' | 'filter' | null = null;
  /** The squishy picking a spot or Training Grounds in its detail, or null. */
  let picking: { id: string; what: 'spot' | 'grounds' } | null = null;
  /** The resident whose "Move out of the house" is asking to confirm (#381), or null. */
  let confirmOut: string | null = null;
  /** When each squishy that moved out may move back in (from the house's last reply, B5). */
  const moveBackAt = new Map<string, string>();

  /** Scrolls the sheet so the row holding `inside` shows to its bottom edge, with room under it. */
  function revealRowEnd(inside: HTMLElement | null): void {
    const row = inside?.closest('.roster-row');
    if (!row) return;
    const gap = row.getBoundingClientRect().bottom - sheet.getBoundingClientRect().bottom;
    // The sheet's own bottom padding and a little air under the card's edge.
    const room = 14 + 8; // TUNE
    if (gap + room > 0) sheet.scrollTop += gap + room;
  }
  /** How long after the confirm opens its card keeps itself in view while the row settles. */
  const REVEAL_SETTLE_MS = 1500; // TUNE
  /**
   * The move-out confirm just opened: its whole card comes into view, and
   * stays there while the row settles (pictures and text finish laying out),
   * then the player scrolls freely.
   */
  function revealConfirm(): void {
    stopRevealing();
    const yes = () => sheet.querySelector<HTMLElement>('[data-testid="roster-house-out-yes"]');
    revealRowEnd(yes());
    const row = yes()?.closest('.roster-row');
    if (!row || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      revealRowEnd(yes());
    });
    watch.observe(row);
    watch.observe(sheet);
    watch.observe(list);
    revealing = { watch, timer: window.setTimeout(stopRevealing, REVEAL_SETTLE_MS) };
  }

  /** The one confirm watcher, while a card settles; a new Move out tap or closing stops it. */
  let revealing: { watch: ResizeObserver; timer: number } | null = null;
  function stopRevealing(): void {
    if (!revealing) return;
    revealing.watch.disconnect();
    window.clearTimeout(revealing.timer);
    revealing = null;
  }
  let working = false;
  let ticker: number | undefined;
  /** When a landed countdown last asked for fresh views (device ms), 0 for never. */
  let askedAt = 0;
  /** Bumped by every open and close, so a late reply is dropped. */
  let ticket = 0;
  /** Each working row's status chip, so the countdown updates its text and nothing else. */
  let chips = new Map<string, { row: RosterRow; node: HTMLElement }>();

  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': ROSTER_TEXT.close },
    '×',
  );
  // Focus moves here when the roster opens (#433), so VoiceOver starts at the top.
  const title = el('h2', { id: 'roster-title', tabindex: '-1' }, ROSTER_TEXT.title);
  /** What had focus before the roster opened; it gets it back on close. */
  let returnFocus: HTMLElement | null = null;
  const count = el('p', { class: 'roster-count', 'data-testid': 'roster-count' });
  const note = el('p', { class: 'roster-note', role: 'status', 'data-testid': 'roster-note' });
  // Sort and Show are one compact row of two pickers; tapping one opens its
  // choices under it (no second scroll area), and a choice closes it.
  const pickers = el('div', { class: 'roster-pickers', 'data-testid': 'roster-pickers' });
  const menuBox = el('div', { class: 'roster-chips roster-menu', role: 'group' });
  const list = el('ul', { class: 'roster-list', 'data-testid': 'roster-list' });
  const sheet = el(
    'section',
    {
      class: 'roster-sheet',
      role: 'dialog',
      'aria-labelledby': 'roster-title',
      'data-testid': 'roster',
    },
    // The title and × stay pinned while the chips and the list scroll under.
    el('div', { class: 'tile-panel-head roster-head-bar' }, title, count, close),
    el('div', { class: 'roster-controls' }, pickers, menuBox),
    note,
    list,
  );
  sheet.hidden = true;
  options.root.append(sheet);

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };
  const say = (text: string) => {
    note.textContent = text;
  };

  /** The reads, merged into rows. Home's squishies are the roster; the others add tags. */
  function remerge(): void {
    rows = home ? mergeRoster({ home, care, jobs }) : [];
    if (expanded && !rows.some((r) => r.id === expanded)) expanded = null;
  }

  async function load(id: string, mine: number): Promise<void> {
    const withJobs = options.hasJobs?.(id) ?? true;
    const [h, c, j] = await Promise.allSettled([
      homeCalls.get(id),
      careCalls.list(id),
      withJobs ? jobCalls.view(id) : Promise.resolve(null),
    ]);
    if (mine !== ticket) return;
    if (h.status === 'fulfilled') home = h.value;
    if (c.status === 'fulfilled') care = c.value;
    if (j.status === 'fulfilled') {
      jobs = j.value;
      if (j.value) clock.sync(j.value.now);
    }
    if (h.status === 'rejected') say(messageOf(h.reason));
    else if (c.status === 'rejected' || j.status === 'rejected') say(ROSTER_TEXT.partial);
    else say('');
    remerge();
    render();
  }

  /** Runs one command from a row's detail, one at a time; a CONFLICT reads everything again. */
  async function act(run: (id: string, send: Send) => Promise<void>): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const mine = ticket;
    working = true;
    render();
    try {
      await run(id, (command) => sendCommand(sendDeps, command, () => mine === ticket));
    } catch (err) {
      if (mine !== ticket) return;
      say(messageOf(err));
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        working = false;
        await load(id, mine);
        return;
      }
    } finally {
      working = false;
      if (mine === ticket) {
        remerge();
        render();
      }
    }
  }

  type Send = <T>(command: (key: string) => Promise<T>) => Promise<T | null>;

  const assign = (squishy: JobSquishy, job: SetJobRequest, done: string) =>
    act(async (id, send) => {
      const res = await send((key) => jobCalls.setJob(id, squishy.squishy.id, job, key));
      if (!res) return;
      jobs = res;
      clock.sync(res.now);
      picking = null;
      say(done);
    });

  const house = (squishyId: string, habitatId: string | null, done: string) =>
    act(async (id, send) => {
      const res = await send((key) => homeCalls.house(id, squishyId, habitatId, key));
      if (!res) return;
      home = res;
      say(done);
    });

  /** Moves a resident out of the Keeper's house (#381); home's tags follow the reply. */
  const leaveHouse = (squishyId: string, name: string) =>
    act(async (id, send) => {
      const res = await send((key) => houseCalls.moveResident(id, squishyId, null, key));
      if (!res) return;
      const rooms = residentRooms(res);
      moveBackAt.clear();
      for (const c of res.cooldowns) moveBackAt.set(c.squishyId, c.moveBackInAt);
      if (home) {
        home = {
          ...home,
          squishies: home.squishies.map((s) => ({
            ...s,
            houseRoomId: rooms.get(s.id)?.roomId ?? null,
          })),
        };
      }
      confirmOut = null;
      say(RESIDENT_TEXT.movedOut(name));
    });

  const actionContext = (current: JobsView): JobActionsContext => ({
    view: current,
    working,
    wantSpot: null,
    assign: (squishy, job, done) => {
      void assign(squishy, job, done);
    },
    pickSpot: (squishy) => {
      picking = { id: squishy.squishy.id, what: 'spot' };
      render();
    },
    pickGrounds: (squishy) => {
      picking = { id: squishy.squishy.id, what: 'grounds' };
      render();
    },
    cancel: () => {
      picking = null;
      render();
    },
  });

  const tapButton = (
    label: string,
    onTap: () => void,
    attrs: Record<string, string> = {},
    soft = false,
  ) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button roster-action${soft ? ' auth-button-soft' : ''}`,
        ...attrs,
      },
      label,
    );
    b.addEventListener('click', onTap);
    return b;
  };

  /** A row's Care: 💗 and the word (on the narrowest phones, just 💗; the word stays for VoiceOver). */
  function careButton(onTap: () => void, squishyId: string): HTMLButtonElement {
    const b = el(
      'button',
      {
        type: 'button',
        class: 'roster-care',
        'aria-label': ROSTER_TEXT.careWord,
        'data-testid': 'roster-care',
        'data-care-squishy': squishyId,
      },
      el('span', { 'aria-hidden': 'true' }, '💗'),
      el('span', { class: 'roster-care-word' }, ROSTER_TEXT.careWord),
    );
    b.addEventListener('click', onTap);
    return b;
  }

  /** The habitats at home, numbered when there's more than one of a kind. */
  function habitats(current: HomeResponse): { b: MyBuilding; label: string }[] {
    const mine = atHome(current).buildings.filter((b) => b.kind === 'habitat');
    const seen = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const b of mine) totals.set(b.buildingId, (totals.get(b.buildingId) ?? 0) + 1);
    return mine.map((b) => {
      const n = (seen.get(b.buildingId) ?? 0) + 1;
      seen.set(b.buildingId, n);
      const many = (totals.get(b.buildingId) ?? 0) > 1;
      return {
        b,
        label: `${buildingIcon(b.buildingId)} ${buildingName(b.buildingId)}${many ? ` ${String(n)}` : ''}`,
      };
    });
  }

  function habitatActions(row: RosterRow, current: HomeResponse): HTMLElement {
    const options = habitats(current);
    const name = row.name;
    const buttons = options.map(({ b, label }) => {
      const here = row.habitatId === b.id;
      const full = (b.residents ?? 0) >= (b.capacity ?? 0);
      const text = here
        ? `${label} · here`
        : `${label} (${String(b.residents ?? 0)}/${String(b.capacity ?? 0)})`;
      const button = tapButton(
        text,
        () => void house(row.id, b.id, `${name} moved in!`),
        { 'data-testid': 'roster-habitat', 'data-habitat': b.id },
        true,
      );
      button.disabled = working || here || full;
      return button;
    });
    const out = tapButton(
      ROSTER_TEXT.moveOut,
      () => void house(row.id, null, `${name} moved out.`),
      { 'data-testid': 'roster-move-out' },
      true,
    );
    out.disabled = working;
    return el(
      'div',
      { class: 'roster-habitats', 'data-testid': 'roster-habitats' },
      el('p', { class: 'jobs-small' }, ROSTER_TEXT.moveIn),
      el('div', { class: 'roster-habitat-buttons' }, ...buttons, ...(row.habitatId ? [out] : [])),
    );
  }

  /**
   * The Keeper's house in a row's detail (#381 plan §10.7): where a resident
   * lives with Move out (and its confirm, style guide §3.6), or Move into
   * the house, which opens the house's picker on this squishy.
   */
  function houseActions(row: RosterRow, current: HomeResponse, id: string): HTMLElement | null {
    if (!current.house) return null;
    if (row.houseRoomId !== null) {
      const asking = confirmOut === row.id;
      const parts: HTMLElement[] = [
        el(
          'p',
          { class: 'jobs-small roster-house-line', 'data-testid': 'roster-house-line' },
          RESIDENT_TEXT.rosterLivesIn(roomNameOf(row.houseRoomId)),
        ),
      ];
      if (asking) {
        const yes = tapButton(RESIDENT_TEXT.moveOut, () => void leaveHouse(row.id, row.name), {
          'data-testid': 'roster-house-out-yes',
        });
        const no = tapButton(
          RESIDENT_TEXT.notNow,
          () => {
            confirmOut = null;
            render();
          },
          { 'data-testid': 'roster-house-out-no' },
          true,
        );
        yes.disabled = working;
        parts.push(
          el(
            'p',
            { class: 'roster-house-ask', 'data-testid': 'roster-house-ask' },
            RESIDENT_TEXT.moveOutAsk(row.name, MOVE_BACK_IN_HOURS),
          ),
          el('div', { class: 'roster-habitat-buttons' }, yes, no),
        );
      } else {
        const out = tapButton(
          RESIDENT_TEXT.rosterMoveOut,
          () => {
            confirmOut = row.id;
            render();
            // Just opened: the whole card, its buttons and its edge, comes into view
            // (the sheet scrolls; it never grows over home). Once, as it opens.
            revealConfirm();
          },
          { 'data-testid': 'roster-house-out' },
          true,
        );
        out.disabled = working;
        parts.push(el('div', { class: 'roster-habitat-buttons' }, out));
      }
      return el('div', { class: 'roster-house', 'data-testid': 'roster-house' }, ...parts);
    }
    const onMove = options.onMoveIntoHouse;
    if (!onMove || options.canMoveIntoHouse?.(id) === false) return null;
    // Just moved out: say when it can come back, not a Move in the server would refuse (B5).
    const backIn = moveBackAt.get(row.id);
    const wait = backIn ? hoursUntil(backIn, clock.now()) : null;
    if (wait !== null) {
      return el(
        'div',
        { class: 'roster-house', 'data-testid': 'roster-house' },
        el(
          'p',
          { class: 'jobs-small roster-house-line', 'data-testid': 'roster-house-wait' },
          RESIDENT_TEXT.cantCooldown(wait),
        ),
      );
    }
    const go = tapButton(
      RESIDENT_TEXT.rosterMoveIn,
      () => {
        onMove(id, current, row.id);
      },
      { 'data-testid': 'roster-house-in' },
      true,
    );
    go.disabled = working;
    return el(
      'div',
      { class: 'roster-house', 'data-testid': 'roster-house' },
      el('div', { class: 'roster-habitat-buttons' }, go),
    );
  }

  /** The detail under a tapped row: the meters in words, then every action. */
  function detail(row: RosterRow): HTMLElement {
    const id = mapId;
    const parts: HTMLElement[] = [];
    if (row.mood) {
      parts.push(el('p', { class: 'roster-mood-line' }, row.mood.line));
      if (row.mood.drift !== null) {
        parts.push(el('p', { class: 'roster-drift-line' }, CARE_TEXT.drift[row.mood.drift]));
      }
    }
    // The row's own Stage bar is the one evolving meter (no second bar here).
    // Branch hints live here, never on the row (owner, 2026-10-11): the
    // server's whisper names no form and no chance (CLAUDE.md rule 6).
    if (row.whisper) {
      parts.push(
        el(
          'div',
          { class: 'roster-whisper', 'data-testid': 'roster-whisper' },
          el('p', {}, `${row.whisper.icon} ${row.whisper.text}`),
          ...(row.whisper.sub ? [el('p', { class: 'jobs-small' }, row.whisper.sub)] : []),
        ),
      );
    }
    if (!row.away && id) {
      const view = el('div', { class: 'roster-view-actions' });
      view.append(
        tapButton(
          ROSTER_TEXT.upClose,
          () => options.onCloseUp?.(id, row.id),
          {
            'data-testid': 'roster-up-close',
          },
          true,
        ),
        tapButton(
          ROSTER_TEXT.dressUp,
          () => options.onDressUp?.(id, row.id),
          {
            'data-testid': 'roster-dress-up',
          },
          true,
        ),
      );
      parts.push(view);
      if (row.job && jobs) {
        const ctx = actionContext(jobs);
        parts.push(
          picking?.id === row.id
            ? picking.what === 'spot'
              ? spotPicker(row.job, ctx)
              : groundsPicker(row.job, ctx)
            : jobActions(row.job, ctx),
        );
      }
      if (home && habitats(home).length > 0) parts.push(habitatActions(row, home));
      const inHouse = home ? houseActions(row, home, id) : null;
      if (inHouse) parts.push(inHouse);
    }
    return el('div', { class: 'roster-detail', 'data-testid': 'roster-detail' }, ...parts);
  }

  /** Five hearts filled to its contentment, the mood word, and a needs-care badge. */
  function moodLineEl(mood: MoodTag): HTMLElement {
    const hearts = moodHeartsEl('roster-mood');
    hearts.update(mood.contentment, mood.mood, mood.drift !== null && mood.drift !== 'steady');
    return el(
      'div',
      { class: 'roster-mood-row' },
      hearts.root,
      ...(mood.needsCare
        ? [
            el(
              'span',
              { class: 'roster-tag roster-needs', 'data-testid': 'roster-needs-care' },
              `💗 ${ROSTER_TEXT.needsCare}`,
            ),
          ]
        : []),
    );
  }

  /** "Stage 2 of 3", a little bar, and when it evolves (public lines only). */
  function stageLineEl(stage: EvolutionStage): HTMLElement {
    const words = stage.ready
      ? ROSTER_TEXT.readyToEvolve
      : stage.evolvesAt !== null
        ? ROSTER_TEXT.evolvesAt(stage.evolvesAt)
        : stage.stage >= stage.of
          ? ROSTER_TEXT.fullyEvolved
          : '';
    return el(
      'div',
      {
        class: `roster-stage${stage.ready ? ' roster-stage-ready' : ''}`,
        'data-testid': 'roster-stage',
      },
      el('span', { class: 'roster-stage-n' }, ROSTER_TEXT.stage(stage.stage, stage.of)),
      ...(stage.fill !== null
        ? [
            el(
              'span',
              { class: 'roster-stage-bar', 'aria-hidden': 'true' },
              fillTo(el('span', { class: 'roster-stage-fill' }), stage.fill),
            ),
          ]
        : []),
      ...(words ? [el('span', { class: 'roster-stage-words' }, words)] : []),
    );
  }

  function rowEl(row: RosterRow, nowMs: number): HTMLElement {
    const open = expanded === row.id;
    const status = el(
      'span',
      {
        class: `roster-tag roster-status roster-status-${row.status.kind}`,
        'data-testid': 'roster-status',
        'data-status': row.status.kind,
      },
      statusLine(row.status, nowMs),
    );
    if (row.status.readyAt !== null) chips.set(row.id, { row, node: status });
    // What it's doing, and (#376) why its happiness drifts, side by side.
    const drift = row.mood?.drift === 'steady' ? null : (row.mood?.drift ?? null);
    const statusRow = el(
      'div',
      { class: 'roster-status-row' },
      ...(row.rarity ? [rarityChip(row.rarity)] : []),
      status,
      ...(row.houseRoomId !== null
        ? [
            el(
              'span',
              {
                class: 'roster-tag roster-resident',
                role: 'img',
                'aria-label': ROSTER_TEXT.residentLabel,
                title: ROSTER_TEXT.residentLabel,
                'data-testid': 'roster-resident',
                'data-room': row.houseRoomId,
              },
              ROSTER_TEXT.resident,
            ),
          ]
        : []),
      ...(drift !== null
        ? [
            el(
              'span',
              { class: 'roster-drift', 'data-testid': 'roster-drift', 'data-drift': drift },
              ROSTER_TEXT.drift[drift],
            ),
          ]
        : []),
    );

    const head = el(
      'button',
      {
        type: 'button',
        class: 'roster-head',
        'aria-expanded': String(open),
        'data-testid': 'roster-head',
      },
      portraitEl(row),
      el(
        'span',
        { class: 'roster-names' },
        el('strong', { class: 'roster-name' }, row.name),
        el(
          'span',
          { class: 'roster-sub' },
          // The species only when a nickname hides it.
          row.name === row.speciesName
            ? ROSTER_TEXT.level(row.level)
            : `${ROSTER_TEXT.level(row.level)} · ${row.speciesName}`,
        ),
      ),
    );
    head.addEventListener('click', () => {
      expanded = open ? null : row.id;
      picking = null;
      confirmOut = null;
      render();
    });
    const id = mapId;
    const topRow = el('div', { class: 'roster-top-row' }, head);
    if (!row.away && id && options.onCare) {
      topRow.append(careButton(() => options.onCare?.(id, row.id), row.id));
    }
    return el(
      'li',
      {
        class: `roster-row${open ? ' roster-open' : ''}${row.away ? ' roster-away' : ''}${
          row.status.kind === 'hollowed' ? ' roster-hollowed' : ''
        }`,
        'data-testid': 'roster-row',
        'data-squishy': row.id,
      },
      topRow,
      ...(row.mood ? [moodLineEl(row.mood)] : []),
      ...(row.stage ? [stageLineEl(row.stage)] : []),
      statusRow,
      ...(open ? [detail(row)] : []),
    );
  }

  /** The squishy's real picture, a blob until it's drawn (or with no renderer). */
  function portraitEl(row: RosterRow): HTMLElement {
    const wrap = el(
      'span',
      { class: 'roster-portrait', 'data-testid': 'roster-portrait' },
      row.job ? blobFor(row.job) : plainBlob(row),
    );
    const portraits = options.portraits;
    if (portraits && row.species) {
      void portraits
        .get({ species: row.species, instanceId: row.id, accessory: row.accessory })
        .then((url) => {
          if (!url) return;
          const img = el('img', { src: url, alt: '', class: 'roster-portrait-img' });
          img.decoding = 'async';
          wrap.replaceChildren(img);
          wrap.dataset['ready'] = 'true';
        });
    }
    return wrap;
  }

  function plainBlob(row: RosterRow): HTMLElement {
    const blob = el('span', { class: 'jobs-blob', 'aria-hidden': 'true' });
    blob.style.background = row.color;
    return blob;
  }

  function renderChips(): void {
    const counts = filterCounts(rows);
    const picker = (which: 'sort' | 'filter', label: string, value: string) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: `roster-picker${menu === which ? ' roster-picker-open' : ''}`,
          'aria-expanded': String(menu === which),
          'aria-label': `${label}: ${value}`,
          'data-testid': `roster-pick-${which}`,
        },
        el('span', { class: 'roster-picker-label' }, label),
        el('strong', {}, value),
        el('span', { class: 'roster-picker-caret', 'aria-hidden': 'true' }, '▾'),
      );
      b.addEventListener('click', () => {
        menu = menu === which ? null : which;
        render();
      });
      return b;
    };
    pickers.replaceChildren(
      picker('sort', ROSTER_TEXT.sortBy, SORT_LABELS[sort]),
      picker('filter', ROSTER_TEXT.show, `${FILTER_LABELS[filter]} ${String(counts[filter])}`),
    );
    const option = (
      on: boolean,
      label: string,
      attrs: Record<string, string>,
      pick: () => void,
    ) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: `roster-chip${on ? ' roster-chip-on' : ''}`,
          'aria-pressed': String(on),
          ...attrs,
        },
        label,
      );
      b.addEventListener('click', () => {
        pick();
        menu = null;
        render();
      });
      return b;
    };
    menuBox.hidden = menu === null;
    menuBox.setAttribute('aria-label', menu === 'filter' ? ROSTER_TEXT.show : ROSTER_TEXT.sortBy);
    menuBox.dataset['testid'] = menu === 'filter' ? 'roster-filters' : 'roster-sorts';
    menuBox.replaceChildren(
      ...(menu === 'sort'
        ? ROSTER_SORTS.map((s) =>
            option(sort === s, SORT_LABELS[s], { 'data-sort': s }, () => {
              sort = s;
            }),
          )
        : menu === 'filter'
          ? ROSTER_FILTERS.map((f) =>
              option(
                filter === f,
                `${FILTER_LABELS[f]} ${String(counts[f])}`,
                { 'data-filter': f },
                () => {
                  filter = f;
                },
              ),
            )
          : []),
    );
  }

  function render(): void {
    window.clearTimeout(ticker);
    ticker = undefined;
    chips = new Map();
    if (sheet.hidden) return;
    const keep = Math.max(0, options.coveredTop?.() ?? 0);
    sheet.style.maxHeight =
      keep > 0
        ? `calc(100dvh - ${String(Math.ceil(keep) + 8)}px - env(safe-area-inset-bottom) - 12px)`
        : '';
    renderChips();
    const shown = visibleRows(rows, sort, filter);
    count.textContent =
      filter === 'all'
        ? ROSTER_TEXT.count(rows.length)
        : ROSTER_TEXT.countOf(shown.length, rows.length);
    const nowMs = clock.now();
    if (shown.length === 0) {
      list.replaceChildren(
        el(
          'li',
          { class: 'roster-empty' },
          rows.length === 0 ? ROSTER_TEXT.empty : ROSTER_TEXT.noMatch,
        ),
      );
    } else {
      list.replaceChildren(...shown.map((row) => rowEl(row, nowMs)));
    }
    tick();
  }

  /** Countdowns move by themselves, once a second, changing only their text. */
  function tick(): void {
    window.clearTimeout(ticker);
    ticker = undefined;
    if (chips.size === 0 || sheet.hidden) return;
    const nowMs = clock.now();
    let finished = false;
    for (const { row, node } of chips.values()) {
      if (row.status.readyAt !== null && Date.parse(row.status.readyAt) <= nowMs) finished = true;
      const text = statusLine(row.status, nowMs);
      if (node.textContent !== text) node.textContent = text;
    }
    // A cycle landed: ask for fresh views, which redraws with the next
    // countdown. At most every few seconds, so a failing read (offline) or a
    // reply that still says "landed" never loops.
    if (finished && mapId && Date.now() - askedAt >= ASK_AGAIN_MS) {
      askedAt = Date.now();
      void load(mapId, ticket);
      return;
    }
    ticker = window.setTimeout(tick, 1000);
  }

  function closeSheet(): void {
    stopRevealing();
    sheet.classList.remove('roster-covered');
    askedAt = 0;
    ticket += 1;
    window.clearTimeout(ticker);
    sheet.hidden = true;
    mapId = null;
    home = null;
    care = null;
    jobs = null;
    rows = [];
    expanded = null;
    picking = null;
    confirmOut = null;
    menu = null;
    say('');
    returnFocus = null;
  }

  // The player shut it: focus goes back to the button that opened it, if it's
  // still on screen. A hand-off (care, close-up, a battle) leaves focus to the
  // next screen.
  close.addEventListener('click', () => {
    const back = returnFocus;
    closeSheet();
    if (back?.isConnected && !back.closest('[inert], [hidden]'))
      back.focus({ preventScroll: true });
  });

  return {
    open: async (id) => {
      ticket += 1;
      const mine = ticket;
      mapId = id;
      expanded = null;
      picking = null;
      if (sheet.hidden) {
        const active = document.activeElement;
        returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
      }
      sheet.hidden = false;
      say('');
      remerge();
      render();
      await load(id, mine);
      // Focus starts at the title once the list is there (#433), unless the
      // player has already moved into the roster.
      if (mine === ticket && !sheet.contains(document.activeElement)) {
        title.focus({ preventScroll: true });
      }
    },
    refresh: async () => {
      if (mapId && !sheet.hidden) await load(mapId, ticket);
    },
    close: closeSheet,
    setCovered: (covered) => {
      sheet.classList.toggle('roster-covered', covered && !sheet.hidden);
    },
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      return {
        open: !sheet.hidden,
        mapId,
        rows: rows.length,
        shown: visibleRows(rows, sort, filter).map((r) => r.id),
        sort,
        filter,
        expanded,
        note: note.textContent,
      };
    },
  };
}
