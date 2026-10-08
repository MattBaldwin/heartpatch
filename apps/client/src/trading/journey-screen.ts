import {
  GAME_EVENTS,
  hexKey,
  JOURNEY_RULES,
  isTradingPost,
  postReach,
  type HexKey,
  type MapView,
  type PlayerBattle,
  type PublicTile,
  type PublicUser,
  type WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { jobsApi, type JobsApi } from '../squishies/jobs/jobs-api.js';
import { el, messageOf } from '../ui/dom.js';
import { journeyApi, type JourneyApi } from './journey-api.js';
import {
  averageLevel,
  JOURNEY_TEXT,
  journeyChance,
  journeyPreview,
  journeyTeamLevels,
  LANTERNS,
} from './journey-model.js';
import { POST_SOON } from './post-model.js';
import './trading.css';

// Journeys to trading posts in the tile panel (#270; the owner-approved
// mockup, screen b). Tapping a post your land doesn't reach shows the trip:
// how far, how many trail squishies and how strong, a lantern meter, and a
// chance line from your team. "Start journey" asks the server, which builds
// the trail team and plays the battle (CLAUDE.md rule 1). A won journey's
// visit pass shows as a countdown.

export interface JourneyScreenOptions {
  /** A journey started (or one going came back): the battle screen takes over. */
  openBattle: (battle: PlayerBattle) => void;
  api?: JourneyApi;
  jobs?: Pick<JobsApi, 'view'>;
  /** Device wall clock in ms (tests pass a fake). Close enough for a minutes countdown. */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface JourneyDebug {
  /** The post the panel shows a journey for, or null. */
  readonly preview: { q: number; r: number; level: number; teamSize: number } | null;
  /** Posts with a visit pass still open, `q,r`. */
  readonly passes: readonly string[];
}

export interface JourneyScreen {
  setUser: (user: PublicUser | null) => void;
  /** The tile panel's journey preview; it follows the map the panel shows. */
  readonly tileActions: TileActions;
  liveEvent: (event: WsEventMessage) => void;
  /** The post a journey battle set off for (its result card names it), or null. */
  postFor: (battleId: string) => { name: string; q: number; r: number } | null;
  /** A journey battle ended: the team's levels are fetched again, and a win is an arrival. */
  ended: (battleId: string, won: boolean) => void;
  /** The post the player just made it to (once), for the map to show; null otherwise. */
  takeArrival: () => { q: number; r: number } | null;
  readonly debug: JourneyDebug;
}

export function createJourneyScreen(options: JourneyScreenOptions): JourneyScreen {
  const api = options.api ?? journeyApi;
  const jobs = options.jobs ?? jobsApi;
  const now = options.now ?? (() => Date.now());

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let note = '';
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  /** My team's levels on this map (fetched when a journey preview shows). */
  let team: number[] | null = null;
  /** Visit passes heard live since the view (`journey.ended`), by post. */
  const livePasses = new Map<HexKey, string | null>();
  /** Journeys I set off on, by battle id: where to. */
  const started = new Map<string, { name: string; q: number; r: number }>();
  /** A won journey's post, until the map shows it. */
  let arrival: { q: number; r: number } | null = null;
  let ticker: number | undefined;
  let previewShown: JourneyDebug['preview'] = null;

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  /** My visit pass for this post, if it's still open: from a live event, else the view. */
  const passFor = (tile: PublicTile, view: MapView): string | null => {
    const key = hexKey(tile);
    const until = livePasses.has(key)
      ? (livePasses.get(key) ?? null)
      : (view.posts?.find((p) => p.q === tile.q && p.r === tile.r)?.visitUntil ?? null);
    return until !== null && Date.parse(until) > now() ? until : null;
  };

  async function loadTeam(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const view = await jobs.view(id);
      if (at !== generation) return;
      team = journeyTeamLevels(view);
    } catch {
      // The chance line waits; the journey still works.
      return;
    }
    render();
  }

  async function setOff(tile: PublicTile, name: string): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      const battle = await sendCommand(
        sendDeps,
        (key) => api.start(id, { q: tile.q, r: tile.r }, key),
        stillHere,
      );
      if (battle && stillHere()) {
        started.set(battle.id, { name, q: tile.q, r: tile.r });
        options.openBattle(battle);
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  const line = (text: string, testId: string, extra = '') =>
    el('p', { class: `tile-action-note ${extra}`.trim(), 'data-testid': testId }, text);

  function render(): void {
    previewShown = null;
    if (!panel) {
      syncTicker(false);
      return;
    }
    const { container, tile, view } = panel;
    const me = user?.id ?? null;
    if (!isTradingPost(tile) || me === null || mapId === null) {
      container.replaceChildren();
      syncTicker(false);
      return;
    }
    const pass = passFor(tile, view);
    if (pass) {
      container.replaceChildren(
        line(JOURNEY_TEXT.open(Date.parse(pass) - now()), 'journey-open', 'journey-open'),
        line(POST_SOON, 'journey-soon', 'journey-soon'),
      );
      syncTicker(true);
      return;
    }
    syncTicker(false);
    const reach = postReach(tile, view.tiles, me);
    if (reach?.kind !== 'journey') {
      container.replaceChildren();
      return;
    }
    const name = tile.post?.name ?? JOURNEY_TEXT.somePost;
    const trip = journeyPreview(reach.distance);
    previewShown = { q: tile.q, r: tile.r, level: trip.level, teamSize: trip.teamSize };
    if (team === null) void loadTeam();

    const lanterns = el(
      'span',
      {
        class: 'journey-lanterns',
        role: 'img',
        'aria-label': `Tricky: ${String(trip.lanterns)} of ${String(LANTERNS)}`,
        'data-testid': 'journey-lanterns',
      },
      ...Array.from({ length: LANTERNS }, (_, i) =>
        el('span', { class: i < trip.lanterns ? 'journey-lantern' : 'journey-lantern off' }, '🏮'),
      ),
    );
    const chance = team && team.length > 0 ? journeyChance(team, trip) : null;
    // The chip's title names the post and its reach line says how far, so
    // the card keeps to the trail, my team and the chance.
    const card = el(
      'div',
      {
        class: 'journey-card',
        'aria-label': JOURNEY_TEXT.heading(name),
        role: 'group',
        'data-testid': 'journey-preview',
      },
      el(
        'div',
        { class: 'journey-row' },
        el(
          'span',
          { class: 'journey-trail', 'data-testid': 'journey-trail' },
          JOURNEY_TEXT.trail(trip.teamSize, trip.level),
        ),
        lanterns,
      ),
      el(
        'div',
        { class: 'journey-row' },
        el(
          'span',
          { class: 'journey-team', 'data-testid': 'journey-team' },
          team === null
            ? ''
            : team.length === 0
              ? JOURNEY_TEXT.noTeam
              : JOURNEY_TEXT.team(averageLevel(team)),
        ),
        ...(chance
          ? [
              el(
                'span',
                {
                  class: `journey-chance journey-chance-${chance}`,
                  'data-testid': 'journey-chance',
                },
                JOURNEY_TEXT.chance[chance],
              ),
            ]
          : []),
      ),
    );
    const start = el(
      'button',
      { type: 'button', class: 'auth-button bag-action', 'data-testid': 'journey-start' },
      JOURNEY_TEXT.start,
    );
    start.disabled = working;
    start.addEventListener('click', () => void setOff(tile, name));
    // "Start journey" first, so it's on screen in the chip on an iPhone
    // without scrolling (style guide §3); the trip's details follow. The
    // tile panel's reach line already says to claim land toward it.
    container.replaceChildren(
      start,
      card,
      ...(note ? [line(note, 'journey-note')] : []),
      line(JOURNEY_TEXT.stakes(JOURNEY_RULES.visitMinutes), 'journey-stakes', 'journey-stakes'),
    );
  }

  /** Counts the visit pass down once a minute-ish, only while one is on screen. */
  function syncTicker(on: boolean): void {
    if (on && ticker === undefined) {
      ticker = window.setInterval(render, 15_000);
    } else if (!on && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  }

  const reset = () => {
    generation += 1;
    team = null;
    note = '';
    livePasses.clear();
  };

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      mapId = null;
      reset();
      render();
    },
    tileActions: {
      show: (container, tile, view) => {
        if (view.map.id !== mapId) {
          reset();
          mapId = view.map.id;
        }
        const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
        if (!same) note = '';
        panel = { container, tile, view };
        render();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
        note = '';
        render();
      },
    },
    liveEvent: (event) => {
      if (event.mapId !== mapId || event.type !== 'journey.ended') return;
      const parsed = GAME_EVENTS['journey.ended'].public.safeParse(event.data);
      if (!parsed.success || parsed.data.userId !== user?.id) return;
      livePasses.set(hexKey(parsed.data), parsed.data.visitUntil);
      render();
    },
    postFor: (battleId) => started.get(battleId) ?? null,
    ended: (battleId, won) => {
      // Levels may have changed: the next preview asks again.
      team = null;
      const post = started.get(battleId);
      if (won && post) arrival = { q: post.q, r: post.r };
    },
    takeArrival: () => {
      const post = arrival;
      arrival = null;
      return post;
    },
    get debug() {
      const view = panel?.view;
      return {
        preview: previewShown,
        passes: view
          ? view.tiles
              .filter(isTradingPost)
              .filter((t) => passFor(t, view) !== null)
              .map((t) => hexKey(t))
          : [],
      };
    },
  };
}
