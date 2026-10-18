import {
  GAME_EVENTS,
  type KeeperConfig,
  type MapView,
  type PublicTile,
  type PublicUser,
  type Species,
  type TrickOrTreatView,
  type TrickOrTreatVisit,
  type WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import type { KeeperPortraits, Portraits } from '../procedural/portraits.js';
import { el, messageOf } from '../ui/dom.js';
import { toggleWorn } from '../ui/wardrobe/wardrobe-view.js';
import { createDoorScene, type DoorSceneOptions } from './door-scene.js';
import { beatsFor, cardFor, type DoorScene } from './door-view.js';
import { createTreatCard } from './treat-card.js';
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
// Heart Seed. The server rolls and grants the treat (CLAUDE.md rules 1, 6).
// The button opens the drawn door (part C): Knock! sends the knock, the door
// opens (a rare silly trick first), and the prize card says what the treat
// was. The plain toast stays for anything the card can't draw (a costume this
// build doesn't know) and for errors.

/** How long the treat's toast stays. */
const TOAST_MS = 5000; // TUNE: long enough to read a costume's name

/** The door's pictures, in CSS px: the Keeper and Partner on the porch, and a costume on its card. */
const KEEPER_DOOR_PX = 120; // TUNE
const PARTNER_DOOR_PX = 100; // TUNE
const CARD_PICTURE_PX = 200; // TUNE

export interface TrickOrTreatOptions {
  root: HTMLElement;
  /** The Tutorial Glade has no patch-mates to visit: nothing is read or shown there. */
  isGlade?: (mapId: string) => boolean;
  /** Draws the porch lanterns for map `mapId` (`MapScreen.setPorchLanterns`). */
  light: (mapId: string, userIds: ReadonlySet<string>) => void;
  /** A treat landed: Heartdust is in the bag, or a costume in the Wardrobe. */
  onTreat?: (visit: TrickOrTreatVisit) => void;
  /** The real 3D Keeper and squishy pictures; without them the porch shows empty. */
  portraits?: Portraits & KeeperPortraits;
  /** My Keeper's look and what they wear, for the porch and a Keeper costume's card. */
  keeper?: () => { config: KeeperConfig; wearing: readonly string[] } | null;
  /** My Partner on this patch (its look), or null: the porch has just the Keeper. */
  partner?: (mapId: string) => Promise<{
    species: Species;
    instanceId: string;
    accessory: string | null;
  } | null>;
  /** The bag's Heartdust now (after the treat), for "Save 3 for a Heart Snack!". */
  heartdust?: () => number | null;
  /** "Wear it!" on a Keeper costume's card: puts it on (the Wardrobe sends it). */
  wear?: (itemId: string) => void;
  /** "Dress up!" on a squishy costume's card: opens the squishy picker. */
  dressUp?: (mapId: string) => void;
  /** Sounds for the door's beats (the game's cue set). */
  cue?: DoorSceneOptions['cue'];
  /** Reduce Motion is on (tests pass a fake). */
  reducedMotion?: () => boolean;
  /** A door or card opened or closed (so other cards wait their turn). */
  onChange?: () => void;
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
  /** Which beat the door shows now, or null while it's closed. */
  readonly door: DoorScene | null;
  /** The prize card's treat, or null while it's closed. */
  readonly card: string | null;
}

export interface TrickOrTreat {
  setUser: (user: PublicUser | null) => void;
  /** The button in a patch-mate's home tile panel. */
  readonly tileActions: TileActions;
  /** Follows the map on screen: reads its doors and lights the porch lanterns. */
  readonly layer: MapLayer;
  /** The door or its prize card is on screen. */
  readonly isOpen: boolean;
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
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  /** The door on screen: whose, and the map it was opened on. */
  let doorOpen: { mapId: string; hostUserId: string } | null = null;
  let cardOpen: string | null = null;
  let toastText: string | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let midnight: ReturnType<typeof setTimeout> | undefined;

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const still = (): boolean =>
    options.reducedMotion?.() ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const door = createDoorScene({
    root: options.root,
    ...(options.cue ? { cue: options.cue } : {}),
  });
  const card = createTreatCard({
    root: options.root,
    onChange: () => options.onChange?.(),
  });

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
      shut();
    }
    if (options.isGlade?.(id)) return;
    if (readDue({ at: readAt, trick }, now())) void read();
  }

  /** Another map or player: the door and any card go, with no prize left behind on screen. */
  function shut(): void {
    if (doorOpen) closeDoor();
    if (cardOpen !== null) {
      card.hide();
      cardOpen = null;
    }
  }

  /** The door and its pictures come down (a prize card, an error, another map). */
  function closeDoor(): void {
    door.hide();
    doorOpen = null;
    options.onChange?.();
  }

  /** The Keeper and the Partner on the porch: pictures that arrive when they're drawn. */
  function porchPictures(id: string): {
    keeper: Promise<string | null>;
    partner: Promise<string | null>;
  } {
    const portraits = options.portraits;
    const mine = options.keeper?.();
    const keeper =
      portraits && mine
        ? portraits
            .keeper({ config: mine.config, wearing: mine.wearing, size: KEEPER_DOOR_PX })
            .catch(() => null)
        : Promise.resolve(null);
    const partner =
      portraits && options.partner
        ? options
            .partner(id)
            .then((p) =>
              p
                ? portraits.get({
                    species: p.species,
                    instanceId: p.instanceId,
                    accessory: p.accessory,
                    size: PARTNER_DOOR_PX,
                  })
                : null,
            )
            .catch(() => null)
        : Promise.resolve(null);
    return { keeper, partner };
  }

  /** The costume's card picture: my Keeper or my Partner wearing it. */
  function costumePicture(id: string, kind: string, itemId: string): Promise<string | null> {
    const portraits = options.portraits;
    if (!portraits) return Promise.resolve(null);
    if (kind === 'keeper-costume') {
      const mine = options.keeper?.();
      if (!mine) return Promise.resolve(null);
      const wearing = mine.wearing.includes(itemId)
        ? mine.wearing
        : toggleWorn(mine.wearing, itemId);
      return portraits
        .keeper({ config: mine.config, wearing, size: CARD_PICTURE_PX })
        .catch(() => null);
    }
    return (
      options
        .partner?.(id)
        .then((p) =>
          p
            ? portraits.get({
                species: p.species,
                instanceId: p.instanceId,
                accessory: itemId,
                size: CARD_PICTURE_PX,
              })
            : null,
        )
        .catch(() => null) ?? Promise.resolve(null)
    );
  }

  /** The door has opened: the card says what the treat was (or, if it can't, the toast does). */
  function reveal(id: string, visit: TrickOrTreatVisit): void {
    const model = cardFor(visit, options.heartdust?.() ?? null);
    closeDoor();
    if (!model) {
      say(prizeToast(visit));
      return;
    }
    cardOpen = model.title;
    card.show({
      model,
      picture:
        model.kind === 'heartdust'
          ? Promise.resolve(null)
          : costumePicture(id, model.kind, model.itemId),
      onWear: (itemId) => options.wear?.(itemId),
      onDressUp: () => options.dressUp?.(id),
      onClose: () => {
        cardOpen = null;
        options.onChange?.();
      },
    });
  }

  /** The tile's button: the porch, ready for a knock. */
  function openDoor(hostUserId: string): void {
    const id = mapId;
    if (!id || working || doorOpen) return;
    const name =
      panel?.view.members.find((m) => m.user.id === hostUserId)?.user.username ??
      TRICK_TEXT.someone;
    doorOpen = { mapId: id, hostUserId };
    door.show({
      hostName: name,
      lit: trick?.hosts.find((h) => h.userId === hostUserId)?.lit ?? false,
      pictures: porchPictures(id),
      onKnock: () => void knock(hostUserId),
      onClose: closeDoor,
    });
    options.onChange?.();
  }

  async function knock(hostUserId: string): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    working = true;
    renderPanel();
    door.waiting();
    try {
      const result = await sendCommand(
        sendDeps,
        (key) => api.visit(id, hostUserId, key),
        () => at === generation,
      );
      if (!result || at !== generation) return;
      knocks += 1;
      apply(result.trickOrTreat);
      options.onTreat?.(result.visit);
      door.play(beatsFor(result.visit.trick, still()), () => {
        reveal(id, result.visit);
      });
    } catch (err) {
      if (at !== generation) return;
      closeDoor();
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
    button.addEventListener('click', () => {
      openDoor(host);
    });
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
      shut();
      // Signed out (or someone else): the last treat's toast goes too.
      clearTimeout(toastTimer);
      toast.hidden = true;
      toastText = null;
      renderPanel();
    },
    tileActions: {
      show: (container, tile, view) => {
        panel = { container, tile, view };
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
    get isOpen() {
      return doorOpen !== null || cardOpen !== null;
    },
    get debug() {
      return {
        mapId,
        open: trick?.open ?? null,
        hosts: (trick?.hosts ?? []).map((h) => ({ ...h })),
        toast: toastText,
        door: door.scene,
        card: cardOpen,
      };
    },
  };
}
