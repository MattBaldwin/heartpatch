import {
  GAME_EVENTS,
  type PublicTile,
  type PublicUser,
  type TrickOrTreatView,
  type TrickOrTreatVisit,
  type WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { trickOrTreatApi, type TrickOrTreatApi } from './trick-or-treat-api.js';
import {
  doorLines,
  doorOf,
  litHosts,
  prizeToast,
  readDue,
  TRICK_TEXT,
} from './trick-or-treat-text.js';
import './trick-or-treat.css';

// Trick-or-treat on the map (#515 part B, the approved plan's map screens).
// A patch-mate's home tile gets a "Trick or treat!" button in its panel: the
// lantern's promise when theirs is lit, or "Visited today" once I've had my
// treat there (the patch's day). A lit home also glows a porch lantern by its
// Heart Seed. The server rolls and grants the treat (CLAUDE.md rules 1, 6);
// until the door scene (part C), a plain toast says what it was.

/** How long the treat's toast stays. */
const TOAST_MS = 5000; // TUNE: long enough to read a costume's name

export interface TrickOrTreatOptions {
  root: HTMLElement;
  /** The Tutorial Glade has no patch-mates to visit: nothing is read or shown there. */
  isGlade?: (mapId: string) => boolean;
  /** Draws the porch lanterns for map `mapId` (`MapScreen.setPorchLanterns`). */
  light: (mapId: string, userIds: ReadonlySet<string>) => void;
  /** A treat landed: Heartdust is in the bag, or a costume in the Wardrobe. */
  onTreat?: (visit: TrickOrTreatVisit) => void;
  api?: TrickOrTreatApi;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TrickOrTreatDebug {
  readonly mapId: string | null;
  /** It's on today (the Halloween season, the map's date); null until heard. */
  readonly open: boolean | null;
  readonly hosts: readonly { userId: string; lit: boolean; visited: boolean }[];
  /** The last treat's toast, or null. */
  readonly toast: string | null;
}

export interface TrickOrTreat {
  setUser: (user: PublicUser | null) => void;
  /** The button in a patch-mate's home tile panel. */
  readonly tileActions: TileActions;
  /** Follows the map on screen: reads its doors and lights the porch lanterns. */
  readonly layer: MapLayer;
  /** My knock from another device: the doors are read again. */
  liveEvent: (event: WsEventMessage) => void;
  readonly debug: TrickOrTreatDebug;
}

export function createTrickOrTreat(options: TrickOrTreatOptions): TrickOrTreat {
  const api = options.api ?? trickOrTreatApi;
  const now = options.now ?? (() => Date.now());

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let trick: TrickOrTreatView | null = null;
  /** When the doors were last asked for (a failed read counts), or null: never on this map. */
  let readAt: number | null = null;
  /** The generation a read is going for, or null: one read at a time per map and player. */
  let reading: number | null = null;
  /** Bumped by each knock's reply, so a read begun before it can't undo "Visited today". */
  let knocks = 0;
  let working = false;
  let panel: { container: HTMLElement; tile: PublicTile } | null = null;
  let toastText: string | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let midnight: ReturnType<typeof setTimeout> | undefined;

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const toast = el('div', { class: 'trick-toast', role: 'status', 'data-testid': 'trick-toast' });
  toast.hidden = true;
  options.root.append(toast);

  function say(text: string): void {
    toastText = text;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  }

  /** Takes a fresh read of the doors: lanterns, the panel, and a wake-up at the day's end. */
  function apply(next: TrickOrTreatView): void {
    trick = next;
    if (mapId) options.light(mapId, litHosts(next));
    // At the patch's midnight every door opens again.
    clearTimeout(midnight);
    const wait = Date.parse(next.resetsAt) - now();
    if (next.open && wait > 0 && wait < 2 ** 31 - 1) {
      midnight = setTimeout(() => void read(), wait + 1000);
    }
    renderPanel();
  }

  async function read(): Promise<void> {
    const id = mapId;
    if (!id || !user || reading === generation) return;
    const at = generation;
    const since = knocks;
    reading = at;
    readAt = now();
    try {
      const next = await api.view(id);
      if (at === generation && since === knocks) apply(next);
    } catch {
      // The next redraw or panel asks again.
    } finally {
      if (reading === at) reading = null;
    }
  }

  function follow(id: string): void {
    if (id !== mapId) {
      generation += 1;
      mapId = id;
      trick = null;
      readAt = null;
      working = false;
      clearTimeout(midnight);
    }
    if (options.isGlade?.(id)) return;
    if (readDue({ at: readAt, trick }, now())) void read();
  }

  async function knock(hostUserId: string): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    renderPanel();
    try {
      const result = await sendCommand(
        sendDeps,
        (key) => api.visit(id, hostUserId, key),
        () => at === generation,
      );
      if (!result || at !== generation) return;
      knocks += 1;
      say(prizeToast(result.visit));
      apply(result.trickOrTreat);
      options.onTreat?.(result.visit);
    } catch (err) {
      if (at !== generation) return;
      say(messageOf(err));
      // Already had one today, or Halloween ended: read the doors again.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') void read();
    } finally {
      if (at === generation) {
        working = false;
        renderPanel();
      }
    }
  }

  function renderPanel(): void {
    if (!panel) return;
    const { container, tile } = panel;
    const door = doorOf(tile, trick, user?.id ?? null);
    if (door.kind === 'none') {
      container.replaceChildren();
      return;
    }
    const lines = doorLines(door).map(({ icon, text }) =>
      el(
        'p',
        { class: 'tile-action-note trick-line', 'data-testid': 'trick-line' },
        ...(icon ? [el('span', { class: 'trick-line-icon', 'aria-hidden': 'true' }, icon)] : []),
        text,
      ),
    );
    const visited = door.kind === 'visited';
    const button = el(
      'button',
      {
        type: 'button',
        class: `auth-button bag-action trick-knock${visited ? ' trick-visited' : ''}`,
        'data-testid': 'trick-or-treat',
      },
      visited ? TRICK_TEXT.visited : working ? TRICK_TEXT.knocking : TRICK_TEXT.knock,
    );
    button.disabled = visited || working;
    const host = door.host.userId;
    button.addEventListener('click', () => void knock(host));
    container.replaceChildren(...lines, button);
  }

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      mapId = null;
      trick = null;
      readAt = null;
      working = false;
      clearTimeout(midnight);
      // Signed out (or someone else): the last treat's toast goes too.
      clearTimeout(toastTimer);
      toast.hidden = true;
      toastText = null;
      renderPanel();
    },
    tileActions: {
      show: (container, tile, view) => {
        panel = { container, tile };
        follow(view.map.id);
        renderPanel();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
      },
    },
    layer: {
      attach: (_scene, view) => {
        follow(view.map.id);
        // A rebuilt scene (GPU loss, back from a battle) draws what we know.
        if (trick && mapId) options.light(mapId, litHosts(trick));
      },
      update: (view) => {
        follow(view.map.id);
      },
    },
    liveEvent: (event) => {
      if (event.type !== 'trick.visited' || event.mapId !== mapId || !user) return;
      const parsed = GAME_EVENTS['trick.visited'].public.safeParse(event.data);
      // My own knock (maybe on another device): that door says "Visited today" now.
      if (parsed.success && parsed.data.visitorUserId === user.id && !working) void read();
    },
    get debug() {
      return {
        mapId,
        open: trick?.open ?? null,
        hosts: (trick?.hosts ?? []).map((h) => ({ ...h })),
        toast: toastText,
      };
    },
  };
}
