import type { Scene } from '@babylonjs/core/scene';
import {
  BattleTimeOfDaySchema,
  CAPTURABLE_BATTLE_KINDS,
  TILE_BATTLE_KINDS,
  GAME_DATA,
  visualRegistry,
  type BattleSideId,
  type BattleTimeOfDay,
  type Hex,
  type KeeperConfig,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import { careApi } from '../care/care-api.js';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { inventoryApi } from '../inventory/inventory-api.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { formatWait } from '../inventory/game-clock.js';
import { el, messageOf } from '../ui/dom.js';
import { battleApi } from './battle-api.js';
import { nearbyNote, tilesToMark } from './wild-pick.js';
import { ManualClock, realClock, type BattleClock } from './battle-clock.js';
import { BREATHING_FRAME_MS, PLAYBACK, RETRY_AFTER_MS } from './battle-config.js';
import { mountBattleHud, plateSideOf, type BattleHud, type ControlMode } from './battle-hud.js';
import {
  applyStep,
  playbackSteps,
  shownFrom,
  type PlaybackStep,
  type ShownState,
} from './battle-playback.js';
import { BattleScene, type BattleSceneStats } from './battle-scene.js';
import { sendAction, type SubmitDeps } from './battle-submit.js';
import {
  activeOf,
  BattleContent,
  benchOf,
  energyPercent,
  otherSide,
  plateName,
} from './battle-view.js';
import type { SafeRegion } from './camera-director.js';
import { BEFRIEND_NUDGE, HEART_CHARM, noCharmsLine } from './heart-charm.js';
import {
  NO_CHIPS,
  noPotionLine,
  potionTiles,
  potionTotal,
  usedLine,
  type PotionTile,
} from './potions.js';
import { keeperReaction } from './keeper-reaction.js';
import { fenceResult, resultLine } from './result-line.js';
import { JOURNEY_TEXT, journeyResult } from '../trading/journey-model.js';

// The battle screen (#13): starts or resumes a PvE battle, draws it, plays the
// server's log back step by step, and sends the player's taps as intents. The
// server runs the engine; this file only shows what it sent (CLAUDE.md rule 1).

export interface BattleScreenOptions {
  root: HTMLElement;
  /** Where the "Find a squishy" / "Catalog" entry box goes (a tray hosts it); `root` by default. */
  entryRoot?: HTMLElement;
  /** Puts a scene on screen: the arena, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  /** Draws one frame (`Stage.requestFrame`): breathing paces itself with this. */
  requestFrame: () => void;
  /** The quality tier now (the squishies' detail level follows it). */
  tier: () => QualityTier;
  /** A battle is about to take the screen: the caller hides the map. */
  onOpen: (mapId: string) => void;
  /** The battle screen closed: the caller shows the map again. */
  onClosed: (mapId: string) => void;
  api?: typeof battleApi;
  /** The battle clock (tests pass a manual one). */
  clock?: BattleClock;
  /** Dev builds show the dev grant buttons (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
  /** Opens the squishy catalog for the map on screen ("Catalog" button). */
  onCatalog?: (mapId: string) => void;
  /**
   * False while another screen sits over the map (the lobby's panel, the
   * catalog): a battle reply landing then is dropped instead of opening.
   */
  canOpen?: () => boolean;
  /** The player's Keeper (#42), to stand behind their squishy; null if not known. */
  keeper?: () => KeeperConfig | null;
  /** What the player's Keeper wears (#43), clothing ids. */
  keeperWearing?: () => readonly string[];
  /** A step of the log starts playing (sound, #25). */
  onStep?: (step: PlaybackStep) => void;
  /** Heart Charms in the player's bag on a map (the wild battle's button shows it). */
  charms?: (mapId: string) => Promise<number>;
  /** The player's bag on a map, item id → count (the potion picker shows it, #214). */
  items?: (mapId: string) => Promise<Readonly<Record<string, number>>>;
  /** The player's squishies' nicknames on a map, by squishy id (#141). */
  nicknames?: (mapId: string) => Promise<ReadonlyMap<string, string>>;
  /** True for the Tutorial Glade, where a wild squishy never wanders off (#24). */
  isGlade?: (mapId: string) => boolean;
  /**
   * Journeys to trading posts (#270): the post a journey battle heads for (its
   * result card names it), and word that one has ended, won or not.
   */
  journey?: {
    postName: (battleId: string) => string | null;
    ended: (battleId: string, won: boolean) => void;
  };
  /** Fresh wild hints for the map on screen (#209): the map draws a tuft on each. */
  onWildHints?: (mapId: string, tiles: readonly Hex[]) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface BattleDebug {
  readonly id: string;
  readonly status: PlayerBattle['status'];
  readonly turn: number;
  readonly phase: PlayerBattle['view']['phase']['type'];
  /** Energy shown on the bars right now (follows the log as it plays). */
  readonly shown: { mine: number; theirs: number };
  /** Steps of the log still to play. */
  readonly pending: number;
  readonly waiting: boolean;
  readonly winner: BattleSideId | 'draw' | null;
  /** Why it ended (`captured` for a new friend), or null while it's on. */
  readonly reason: string | null;
  readonly scene: BattleSceneStats | null;
  /** Reactions the Keeper has played in this battle (cheers, winces). */
  readonly keeperReactions: number;
  /** A raid replay (#16) is playing, not a battle to play. */
  readonly replay: boolean;
  /** Heart Charms the wild battle's button shows (null until counted, or not a wild battle). */
  readonly charms: number | null;
  /** Potions in the bag, by id (#214); null until counted, or in a replay. */
  readonly potions: Readonly<Record<string, number>> | null;
  /** The battle clock now, ms (a manual clock in dev captures). */
  readonly clock: number;
  /** The band the camera fits the fight into (`BattleHud.safe`), as the camera reads it now. */
  readonly safe: SafeRegion;
}

/** Dev-only controls over the battle clock (`?battle-clock=manual`), for frame-exact captures. */
export interface BattleDevControls {
  readonly manual: boolean;
  set: (t: number) => void;
  advance: (ms: number) => void;
}

export interface BattleScreen {
  /** The map the player is on (null when none): shows the entry button and resumes a battle going. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** Shows a battle (fetched or just started). */
  open: (battle: PlayerBattle) => void;
  /**
   * Plays a finished battle back from its first turn (a raid on my land,
   * #16): shows `start`, then plays `end`'s log the way a live turn plays.
   * Nothing can be tapped but Leave and Done.
   */
  watch: (start: PlayerBattle, end: PlayerBattle) => void;
  close: () => void;
  /**
   * Meets the wild squishy on `tile` of map `mapId` (#209, Meet it in the
   * tile panel), the way Find a squishy meets the nearest. Rejects with a
   * player-safe message (a stale tuft: "too far", or nobody there any more),
   * and fetches fresh hints so the tufts catch up.
   */
  meetWild: (mapId: string, tile: Hex) => Promise<void>;
  readonly debug: BattleDebug | null;
  /** Dev builds only: the clock controls, or null on the real clock. */
  readonly dev: BattleDevControls | null;
}

const MESSAGES = {
  resultWon: 'You won! Hooray!',
  resultLand: 'This land is yours!',
  resultLost: 'Aw, tuckered out.',
  resultScooted: 'You scooted home.',
  resultDraw: "It's a tie!",
  resultFriend: 'A new friend!',
  resultNoContest: 'No contest!',
  gentleNote: (percent: number) =>
    `Gentle patch: ${percent === 50 ? 'half' : `${String(percent)}%`} XP for playing a smaller Keeper.`,
  // Past today's full-XP wins (#201, `battleXpFalloff`): relative, never a clock time.
  fullXpNote: (wait: string) => `Full XP again in ${wait}.`,
  drawSub: 'Everyone needs a nap.',
  noContestSub: 'The squishies got distracted. Nobody won or lost.',
  noXp: 'No XP this time.',
  wildStart: 'A wild squishy wants to play!',
  guardiansStart: 'The guardians want to play!',
  rivalStart: 'Squishies on watch want to play!',
  shadowsStart: 'Shadows from the Hollow want to play!',
  resultRescued: 'Welcome home!',
  rescuedSub: 'Your friend is back from the Hollow!',
  done: 'Back to patch',
  replayStart: 'Replay! Someone challenged your land.',
  replayHeld: 'Your squishies held on!',
  replayScooted: 'They scooted home!',
  replayLost: 'They won this one.',
  replayHeldSub: 'Your land is safe.',
  replayLostSub: 'Everyone came home safe for a nap.',
  replayNote: 'Just a replay. Nothing changed.',
} as const;

/**
 * Dev builds only: `?battle-slowmo=8` plays battles 8× slower, to judge the
 * choreography frame by frame; `?battle-clock=manual` stops the clock so a
 * capture script can step it (`BattleScreen.dev`). Ignored in production.
 */
function devClock(): { clock: BattleClock; manual: ManualClock | null } {
  if (!import.meta.env.DEV) return { clock: realClock(), manual: null };
  const params = new URLSearchParams(window.location.search);
  if (params.get('battle-clock') === 'manual') {
    const manual = new ManualClock();
    return { clock: manual, manual };
  }
  const value = Number(params.get('battle-slowmo'));
  const slowmo = Number.isFinite(value) && value >= 1 ? Math.min(value, 50) : 1;
  return { clock: realClock(slowmo), manual: null };
}

/**
 * Dev builds only: `?battle-arena=forest/dusk` draws every battle on that
 * terrain at that time of day (captures and tuning). The server still says
 * where a battle really happens; this only changes the picture, in dev.
 */
function devArena(): { terrain: string; timeOfDay: BattleTimeOfDay } | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get('battle-arena');
  if (!value) return null;
  const [terrain, time] = value.split('/');
  const timeOfDay = BattleTimeOfDaySchema.safeParse(time);
  return terrain ? { terrain, timeOfDay: timeOfDay.success ? timeOfDay.data : 'day' } : null;
}

/** "Moonpuff joined your patch!": the squishy the player just befriended. */
function friendLine(b: PlayerBattle, names: BattleContent): string {
  const wild = b.view.sides[otherSide(b.mySide)];
  const friend = wild.squishies[wild.active];
  return `${friend ? names.speciesName(friend.speciesId) : 'Your new squishy'} joined your patch!`;
}

export function createBattleScreen(options: BattleScreenOptions): BattleScreen {
  const api = options.api ?? battleApi;
  const dev = options.clock ? { clock: options.clock, manual: null } : devClock();
  const clock = dev.clock;
  const now = () => clock.now();
  const registry = visualRegistry(GAME_DATA);
  /** `prefers-reduced-motion`: no shake or flashes, gentler moves (read when a battle opens). */
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const arenaOverride = devArena();
  const countCharms =
    options.charms ??
    ((id: string) => inventoryApi.get(id).then((bag) => bag.items[HEART_CHARM] ?? 0));
  const countItems =
    options.items ?? ((id: string) => inventoryApi.get(id).then((bag) => bag.items));
  const listNicknames =
    options.nicknames ??
    (async (id: string): Promise<ReadonlyMap<string, string>> => {
      const { squishies } = await careApi.list(id);
      return new Map(squishies.flatMap((s) => (s.nickname ? [[s.id, s.nickname] as const] : [])));
    });

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let battle: PlayerBattle | null = null;
  /** Keeper reactions played in the battle on screen (the dev hook counts them). */
  let keeperReactions = 0;
  let content: BattleContent | null = null;
  let scene3d: BattleScene | null = null;
  let shown: ShownState | null = null;
  /** Log entries already played. */
  let shownLog = 0;
  let queue: PlaybackStep[] = [];
  let waiting = false;
  let frame = 0;
  let lastBreathDraw = 0;
  let lastTier: QualityTier | null = null;
  /** A raid replay is on screen (`watch`): no controls, replay words. */
  let replaying = false;
  /** Heart Charms in the bag for the battle on screen (wild battles); null until known. */
  let charms: number | null = null;
  /** The bag's potions for the battle on screen (#214); null until known. */
  let potions: Readonly<Record<string, number>> | null = null;
  /** The player's squishies' nicknames on this map (#141). */
  let nicknames: ReadonlyMap<string, string> = new Map();

  // ── Entry button (shown over the map) ─────────────────────────────────
  const note = el('p', { class: 'battle-entry-note', role: 'status' });
  const enter = el(
    'button',
    { type: 'button', class: 'auth-button battle-entry', 'data-testid': 'battle-entry' },
    'Find a squishy',
  );
  const entry = el('div', { class: 'battle-entry-box' }, enter, note);
  entry.hidden = true;
  (options.entryRoot ?? options.root).append(entry);
  const { onCatalog } = options;
  if (onCatalog) {
    const catalog = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'catalog-open',
      },
      'Catalog',
    );
    catalog.addEventListener('click', () => {
      if (mapId) onCatalog(mapId);
    });
    entry.insertBefore(catalog, enter);
  }
  const mayOpen = () => options.canOpen?.() !== false;

  /**
   * "6 nearby! Or tap a rustle to pick.": the tiles in reach with a wild
   * squishy (tiles only, no species, this spawn window only), counted under
   * the button and handed on for the map's tufts (#209). A late reply for
   * another map is dropped.
   */
  const refreshNearby = (): void => {
    const id = mapId;
    const who = user;
    if (!id) return;
    api
      .wildHints(id)
      .then((tiles) => {
        if (mapId !== id || user !== who) return;
        const glade = options.isGlade?.(id) ?? false;
        options.onWildHints?.(id, tilesToMark(tiles, glade));
        if (enter.disabled || note.textContent) return;
        note.textContent = nearbyNote(tiles.length, !glade);
      })
      .catch(() => {
        // Only a hint: the button still works without it.
      });
  };

  /**
   * Runs an entry action for the map on screen now, and opens the battle it
   * starts. A reply that lands after the player moved on (another map, the
   * Glade, logout, a battle opened another way) is dropped, so it can never
   * open a battle over the wrong screen. Rejects with what went wrong (unless
   * the player moved on); resolves at once while another start is going.
   */
  const run = async (start: (id: string) => Promise<PlayerBattle | null>): Promise<void> => {
    const id = mapId;
    const who = user;
    if (!id || enter.disabled) return;
    enter.disabled = true;
    note.textContent = '';
    // Not over another screen either (the lobby's panel, the catalog).
    const stillHere = () => mapId === id && user === who && battle === null && mayOpen();
    try {
      const next = await start(id);
      if (next && stillHere()) open(next);
    } catch (err) {
      if (stillHere()) throw err;
    } finally {
      enter.disabled = false;
    }
  };
  /** `run`, with what went wrong under the button. */
  const busy = (start: (id: string) => Promise<PlayerBattle | null>) => {
    run(start).catch((err: unknown) => {
      note.textContent = messageOf(err);
    });
  };
  enter.addEventListener('click', () => {
    busy((id) => api.startWild(id));
  });
  // Back from the background (hours, maybe a new spawn window): fresh tufts.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && battle === null) refreshNearby();
  });
  if (options.devTools) {
    const grant = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'battle-dev-grant',
      },
      'Dev: new squishy',
    );
    grant.addEventListener('click', () => {
      busy(async (id) => {
        const squishy = await api.dev.grantSquishy(id);
        note.textContent = `A ${content?.speciesName(squishy.speciesId) ?? 'squishy'} joined you! (dev)`;
        return null;
      });
    });
    const fight = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'battle-dev-fight',
      },
      'Dev: pick a fight',
    );
    fight.addEventListener('click', () => {
      busy((id) => api.dev.pickFight(id));
    });
    entry.append(el('div', { class: 'battle-row' }, grant, fight));
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  const hud: BattleHud = mountBattleHud(options.root, {
    onAction: (action) => void submit(action),
    onNoCharms: () => {
      // The bag may have filled since (a craft, a gift): look again first.
      // Busy while it looks, like a submit: no double taps, and the dev hook
      // never reports a settled turn before the capture has gone out.
      const current = battle;
      if (!current || waiting || queue.length > 0) return;
      waiting = true;
      hud.setControls({ type: 'waiting' });
      void refreshCharms(current).then((count) => {
        if (battle?.id !== current.id) return;
        waiting = false;
        if (count > 0) {
          void submit({ type: 'capture' });
        } else {
          hud.setControls(controlsFor(current));
          hud.setProblem(noCharmsLine());
        }
      });
    },
    onNoItem: (tile: PotionTile) => {
      const current = battle;
      if (!current || waiting || queue.length > 0) return;
      if (tile.state === 'used') {
        hud.setProblem(usedLine(tile.id));
        return;
      }
      // None in the bag as far as we know: look again first, like the Heart Charm.
      waiting = true;
      hud.setControls({ type: 'waiting' });
      void refreshPotions(current).then((bag) => {
        if (battle?.id !== current.id) return;
        waiting = false;
        if ((bag?.[tile.id] ?? 0) > 0) {
          void submit({ type: 'item', item: tile.id });
        } else {
          hud.setControls(controlsFor(current));
          hud.setProblem(noPotionLine(tile.id));
        }
      });
    },
    onDone: () => {
      close();
    },
    onLeave: () => {
      // Leaving mid-battle keeps the battle: it resumes on the next visit.
      close();
    },
  });

  const later = (ms: number, fn: () => void): void => {
    clock.later(ms, fn);
  };

  /** Fills a side's plate from the view, with the energy currently shown. */
  const plate = (side: BattleSideId): void => {
    if (!battle || !content || !shown) return;
    const { squishies } = battle.view.sides[side];
    const slot = shown[side].active;
    const squishy = squishies[slot];
    if (!squishy) return;
    const energy = shown[side].energy[slot] ?? squishy.energy;
    const status = squishy.status
      ? squishy.status.id === 'dizzy'
        ? 'Dizzy'
        : 'Sleepy'
      : energy === 0
        ? 'Tuckered out'
        : null;
    const chips = shown[side].chips[slot] ?? NO_CHIPS;
    scene3d?.setShield(side, chips.shield && energy > 0);
    hud.setPlate(plateSideOf(battle.mySide, side), {
      chips,
      name: plateName(content, squishy, side === battle.mySide ? nicknames : undefined),
      level: squishy.level,
      element: squishy.element,
      feeling: squishy.feeling,
      percent: energyPercent({ energy, stats: squishy.stats }),
      energyText: `${String(energy)}/${String(squishy.stats.hp)}`,
      status,
    });
  };

  const controlsFor = (b: PlayerBattle): ControlMode => {
    const names = content;
    if (!names || b.status !== 'active' || replaying) return { type: 'hidden' };
    const bench = benchOf(b, b.mySide).map(({ slot, squishy }) => ({
      slot,
      name: plateName(names, squishy, nicknames),
    }));
    switch (b.view.phase.type) {
      case 'turn':
        return {
          type: 'choose',
          moves: activeOf(b, b.mySide).moves.map((id) => ({ id, name: names.moveName(id) })),
          bench,
          capture: CAPTURABLE_BATTLE_KINDS.has(b.kind) ? { charms } : null,
          items: {
            total: potionTotal(potions),
            tiles: potionTiles(potions, b.view.sides[b.mySide].itemsUsed),
            who: plateName(names, activeOf(b, b.mySide), nicknames),
          },
          // Breaking a fence (#203): how long it can last.
          fence:
            b.view.turnLimit !== undefined && activeOf(b, otherSide(b.mySide)).fence !== undefined
              ? { turn: b.view.turn + 1, limit: b.view.turnLimit }
              : null,
        };
      case 'replace':
        return b.view.phase.sides.includes(b.mySide)
          ? { type: 'replace', bench }
          : { type: 'waiting' };
      case 'over':
        return { type: 'hidden' };
    }
  };

  const showResult = (b: PlayerBattle): void => {
    const names = content;
    if (!names) return;
    const result = b.view.phase.type === 'over' ? b.view.phase.result : null;
    // A fence battle (#203): its own words, whoever's watching.
    const fenceSide = (['a', 'b'] as const).find((side) =>
      b.view.sides[side].squishies.some((s) => s.fence !== undefined),
    );
    if (fenceSide && result && result.winner !== 'draw' && b.status !== 'no-contest') {
      const card = fenceResult(
        result.winner === b.mySide ? 'mine' : 'theirs',
        result.reason,
        replaying,
      );
      hud.setCaption(null);
      if (replaying) {
        hud.showResult({ ...card, xp: [MESSAGES.replayNote], done: MESSAGES.done });
        return;
      }
      const fenceXp = (b.rewards?.xp ?? []).filter((award) => award.xp > 0);
      hud.showResult({
        ...card,
        xp:
          fenceXp.length > 0
            ? fenceXp.map((award) => {
                const squishy = b.view.sides[b.mySide].squishies.find(
                  (s) => s.id === award.squishyId,
                );
                const name = squishy ? plateName(names, squishy, nicknames) : 'Your squishy';
                return `${name} earned ${String(award.xp)} XP!`;
              })
            : [MESSAGES.noXp],
        evolving: [],
        done: MESSAGES.done,
      });
      return;
    }
    if (replaying) {
      // The defender's side of a challenge: kind either way, and no XP (#16).
      const outcome = !result
        ? { title: MESSAGES.resultNoContest, subtitle: MESSAGES.noContestSub }
        : result.winner === 'draw'
          ? { title: MESSAGES.resultDraw, subtitle: MESSAGES.replayHeldSub }
          : result.winner === b.mySide
            ? {
                title: result.reason === 'forfeit' ? MESSAGES.replayScooted : MESSAGES.replayHeld,
                subtitle: MESSAGES.replayHeldSub,
              }
            : { title: MESSAGES.replayLost, subtitle: MESSAGES.replayLostSub };
      hud.setCaption(null);
      hud.showResult({ ...outcome, xp: [MESSAGES.replayNote], done: MESSAGES.done });
      return;
    }
    const mine = b.view.sides[b.mySide];
    // What the server granted (Gentle's share, care and habitat included);
    // a battle from before rewards were stored has only the engine's base XP.
    const awards = b.rewards?.xp ?? (result?.xp ?? []).filter((award) => award.side === b.mySide);
    const earned = awards.filter((award) => award.xp > 0);
    const xp = earned.map((award) => {
      const squishy = mine.squishies.find((s) => s.id === award.squishyId);
      const name = squishy ? plateName(names, squishy, nicknames) : 'Your squishy';
      return `${name} earned ${String(award.xp)} XP!`;
    });
    // Each one's evolving meter, before and after (#205), from the server.
    const evolving = earned.map((award) =>
      'evolvingBefore' in award && award.evolvingBefore !== null && award.evolvingAfter !== null
        ? { before: award.evolvingBefore, after: award.evolvingAfter }
        : null,
    );
    const glade = options.isGlade?.(b.mapId) ?? false;
    const outcome =
      b.status === 'no-contest' || !result
        ? { title: MESSAGES.resultNoContest, subtitle: MESSAGES.noContestSub }
        : result.winner === 'draw'
          ? { title: MESSAGES.resultDraw, subtitle: MESSAGES.drawSub }
          : result.winner === b.mySide
            ? result.reason === 'captured'
              ? { title: MESSAGES.resultFriend, subtitle: friendLine(b, names) }
              : b.kind === 'rescue'
                ? { title: MESSAGES.resultRescued, subtitle: MESSAGES.rescuedSub }
                : {
                    title: TILE_BATTLE_KINDS.has(b.kind) ? MESSAGES.resultLand : MESSAGES.resultWon,
                    subtitle: resultLine(b.kind, 'won', glade),
                  }
            : result.reason === 'forfeit'
              ? { title: MESSAGES.resultScooted, subtitle: resultLine(b.kind, 'scooted', glade) }
              : { title: MESSAGES.resultLost, subtitle: resultLine(b.kind, 'lost', glade) };
    // A journey (#270, the mockup's screen c): made it, or nothing lost.
    const journey =
      b.kind === 'journey' && b.status !== 'no-contest' && result && result.winner !== 'draw'
        ? journeyResult(
            result.winner === b.mySide ? 'won' : result.reason === 'forfeit' ? 'scooted' : 'lost',
            options.journey?.postName(b.id) ?? null,
          )
        : null;
    if (b.kind === 'journey') options.journey?.ended(b.id, result?.winner === b.mySide);
    hud.setCaption(null);
    const lines = xp.length > 0 ? xp : [MESSAGES.noXp];
    if (b.rewards && b.rewards.percent < 100) lines.push(MESSAGES.gentleNote(b.rewards.percent));
    // The device clock is close enough for an hours-and-minutes note.
    const fullXpAt = b.rewards?.fullXpResetAt;
    const fullXpLeft = fullXpAt ? Date.parse(fullXpAt) - Date.now() : 0;
    if (fullXpLeft > 0) lines.push(MESSAGES.fullXpNote(formatWait(fullXpLeft)));
    // Won a wild battle without befriending it: say how (owner decision 2026-10-04).
    const nudge =
      b.kind === 'wild' && result?.winner === b.mySide && result.reason !== 'captured'
        ? BEFRIEND_NUDGE
        : undefined;
    hud.showResult({
      ...outcome,
      ...(journey ? { title: journey.title, subtitle: journey.subtitle } : {}),
      xp: lines,
      evolving,
      done: journey?.done ?? MESSAGES.done,
      ...(nudge ? { nudge } : {}),
    });
  };

  /**
   * Counts the bag's Heart Charms for a wild battle, then redraws the
   * buttons if the player can act. A failed count leaves it unknown (the
   * button still works; the server has the final say).
   */
  const refreshCharms = async (b: PlayerBattle): Promise<number> => {
    if (!CAPTURABLE_BATTLE_KINDS.has(b.kind) || replaying) return charms ?? 0;
    try {
      const count = await countCharms(b.mapId);
      if (battle?.id === b.id) {
        charms = count;
        if (!waiting && queue.length === 0 && b.status === 'active') {
          hud.setControls(controlsFor(battle));
        }
      }
      return count;
    } catch {
      return charms ?? 0;
    }
  };

  /**
   * Counts the bag's potions (#214), then redraws the buttons if the player
   * can act. A failed count leaves them unknown (the server has the final say).
   */
  const refreshPotions = async (
    b: PlayerBattle,
  ): Promise<Readonly<Record<string, number>> | null> => {
    if (replaying) return potions;
    try {
      const bag = await countItems(b.mapId);
      if (battle?.id === b.id) {
        potions = bag;
        if (!waiting && queue.length === 0 && b.status === 'active') {
          hud.setControls(controlsFor(battle));
        }
      }
      return bag;
    } catch {
      return potions;
    }
  };

  /** The player's nicknames for this map (#141); the plates redraw once they arrive. */
  const refreshNicknames = (b: PlayerBattle): void => {
    void listNicknames(b.mapId)
      .then((names) => {
        if (battle?.id !== b.id) return;
        nicknames = names;
        plate('a');
        plate('b');
        if (!waiting && queue.length === 0 && battle.status === 'active') {
          hud.setControls(controlsFor(battle));
        }
      })
      .catch(() => {
        // Species names will do.
      });
  };

  /** Everything the log has played: the view is the truth now. */
  const settle = (): void => {
    if (!battle) return;
    shown = shownFrom(battle);
    shownLog = battle.view.log.length;
    scene3d?.restCamera();
    plate('a');
    plate('b');
    if (replaying && battle.view.phase.type !== 'over') {
      // A replay's first turn: the log plays next (`watch`).
      hud.setControls({ type: 'hidden' });
      hud.setCaption(MESSAGES.replayStart);
    } else if (battle.status === 'active') {
      hud.setControls(controlsFor(battle));
      if (battle.view.phase.type === 'replace' && battle.view.phase.sides.includes(battle.mySide)) {
        hud.setCaption('Your squishy is tuckered out. Who comes out next?');
      } else if (battle.view.log.length === 0) {
        hud.setCaption(
          battle.kind === 'tile'
            ? MESSAGES.guardiansStart
            : battle.kind === 'rival-tile'
              ? MESSAGES.rivalStart
              : battle.kind === 'rescue'
                ? MESSAGES.shadowsStart
                : battle.kind === 'journey'
                  ? JOURNEY_TEXT.startCaption
                  : MESSAGES.wildStart,
        );
      }
    } else {
      showResult(battle);
    }
    options.invalidate();
  };

  /** Plays the next queued step, then the next, until the queue is empty. */
  const playNext = (): void => {
    const step = queue.shift();
    if (!step || !battle || !scene3d || !shown || !content) {
      queue = [];
      settle();
      return;
    }
    const t = now();
    hud.setCaption(step.text);
    options.onStep?.(step);
    shown = applyStep(shown, step);
    // The arena acts it out (choreography.ts): a swap brings out `to` once
    // the old squishy has hopped away; a new friend bounces along at the end.
    const incoming =
      step.kind === 'swap' && step.to !== null
        ? battle.view.sides[step.side].squishies[step.to]
        : undefined;
    scene3d.perform(step, t, {
      ...(incoming ? { incoming: { speciesId: incoming.speciesId, instanceId: incoming.id } } : {}),
      captured: battle.view.phase.type === 'over' && battle.view.phase.result.reason === 'captured',
    });
    const reaction = keeperReaction(step, battle.mySide);
    if (reaction && scene3d.hasKeeper) {
      scene3d.cheer(reaction.move, t, reaction.strength);
      keeperReactions += 1;
    }
    if (step.callout) hud.callout(plateSideOf(battle.mySide, step.side), step.callout);
    plate(step.side);
    options.invalidate();
    later(step.ms, playNext);
  };

  /** A new view from the server: play what's new, then settle on it. */
  const receive = (next: PlayerBattle): void => {
    if (!battle || !content || next.id !== battle.id) {
      open(next);
      return;
    }
    const from = Math.min(shownLog, next.view.log.length);
    battle = next;
    content = new BattleContent(next);
    queue = playbackSteps(next, content, from);
    // A capture try spends a charm: count again.
    if (next.view.log.slice(from).some((e) => e.type === 'capture')) void refreshCharms(next);
    // A potion (#214) came out of the bag: count again.
    if (next.view.log.slice(from).some((e) => e.type === 'item' && e.side === next.mySide)) {
      void refreshPotions(next);
    }
    hud.setControls(replaying ? { type: 'hidden' } : { type: 'waiting' });
    if (queue.length === 0) settle();
    else playNext();
  };

  const submitDeps: SubmitDeps = {
    act: api.act,
    newKey: newIdempotencyKey,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: RETRY_AFTER_MS,
  };

  async function submit(action: PlayerBattleAction): Promise<void> {
    const current = battle;
    if (!current || waiting || queue.length > 0) return;
    // Replies and errors are for this battle only: once the player has left
    // it (Back, logout, the map closing), nothing here touches the screen.
    const stillOpen = () => battle?.id === current.id;
    waiting = true;
    hud.setControls({ type: 'waiting' });
    try {
      const reply = await sendAction(submitDeps, current, action, stillOpen);
      if (reply && stillOpen()) receive(reply);
    } catch (err) {
      if (!stillOpen()) return;
      hud.setProblem(messageOf(err));
      // The battle moved on without us (another tab, a retry): show where it is.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        try {
          const fresh = await api.get(current.id);
          if (stillOpen()) receive(fresh);
        } catch {
          if (stillOpen()) hud.setControls(controlsFor(current));
        }
      } else {
        hud.setControls(controlsFor(current));
      }
    } finally {
      // Only this battle's submit may clear the flag: a late reply from one
      // the player left must not unlock another battle's controls.
      if (stillOpen()) waiting = false;
    }
  }

  // ── Scene ─────────────────────────────────────────────────────────────
  const build = (scene: Scene): SceneContent => {
    if (!battle || !content || !shown) throw new Error('no battle to build');
    const tier = options.tier();
    const built = new BattleScene(scene, {
      registry,
      lod: lodFor('closeUp', tier),
      tier,
      content,
      mySide: battle.mySide,
      keeper: options.keeper?.() ?? null,
      keeperWearing: options.keeperWearing?.() ?? [],
      opponentLook: battle.kind === 'rescue' ? 'shadow' : 'normal',
      terrain: arenaOverride?.terrain ?? battle.terrain,
      timeOfDay: arenaOverride?.timeOfDay ?? battle.timeOfDay,
      battleId: battle.id,
      reducedMotion: reducedMotion.matches,
      safe: () => hud.safe(),
    });
    lastTier = tier;
    for (const side of ['a', 'b'] as const) {
      // Every squishy that might come out later is built now, not mid-turn.
      built.prewarm(
        side,
        battle.view.sides[side].squishies.map((s) => ({
          speciesId: s.speciesId,
          instanceId: s.id,
          level: s.level,
        })),
      );
      const slot = shown[side].active;
      const squishy = battle.view.sides[side].squishies[slot];
      if (squishy) {
        built.sendOut(side, squishy.speciesId, squishy.id, squishy.level);
        if ((shown[side].energy[slot] ?? 1) === 0) built.knockedOut(side);
        built.setShield(side, (shown[side].chips[slot] ?? NO_CHIPS).shield);
      }
    }
    built.update(now());
    scene3d = built;
    return built.content;
  };

  /**
   * Drives motion (render on demand, tech spec §6): every frame while a step
   * plays or the camera moves, at most 30 fps while the squishies only
   * breathe and bob, nothing at all when everything is still (reduced
   * motion), and follows the quality governor's tier with the detail level.
   */
  const tick = (): void => {
    frame = 0;
    const s = scene3d;
    if (!s || !hud.visible) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      s.setLod(lodFor('closeUp', tier));
      options.invalidate();
    }
    const t = now();
    if (s.isPlaying(t)) {
      s.update(t);
      options.invalidate();
    } else if (t - lastBreathDraw >= BREATHING_FRAME_MS) {
      // Breathing and bobbing only: move and draw once per ask, about 30 a second.
      lastBreathDraw = t;
      if (s.update(t)) options.requestFrame();
    }
    frame = requestAnimationFrame(tick);
  };

  function open(next: PlayerBattle, replay = false): void {
    const wasOpen = battle !== null;
    clock.clearAll();
    queue = [];
    waiting = false;
    replaying = replay;
    battle = next;
    content = new BattleContent(next);
    shown = shownFrom(next);
    shownLog = next.view.log.length;
    scene3d = null;
    keeperReactions = 0;
    charms = null;
    potions = null;
    nicknames = new Map();
    if (!replay) {
      void refreshCharms(next);
      void refreshPotions(next);
    }
    refreshNicknames(next);
    if (!wasOpen) options.onOpen(next.mapId);
    entry.hidden = true;
    hud.hideResult();
    hud.setProblem('');
    hud.show();
    options.showScene(build);
    settle();
    if (next.view.log.length > 0 && next.status === 'active') {
      hud.setCaption('Welcome back! The showdown is still on.');
    }
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  /** Takes the battle off screen; `returnToMap` hands the screen back to the map. */
  function close(returnToMap = true): void {
    const closedMap = returnToMap ? (battle?.mapId ?? null) : null;
    clock.clearAll();
    queue = [];
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    battle = null;
    replaying = false;
    content = null;
    shown = null;
    scene3d = null;
    hud.hide();
    options.showScene(null);
    entry.hidden = mapId === null;
    note.textContent = '';
    if (closedMap !== null) options.onClosed(closedMap);
    refreshNearby();
  }

  return {
    setMap: async (next) => {
      mapId = next;
      if (next === null) {
        if (battle) close(false);
        entry.hidden = true;
        return;
      }
      entry.hidden = battle !== null;
      note.textContent = '';
      // Refreshing mid-battle resumes it (unless the player moved on meanwhile).
      const who = user;
      try {
        const going = await api.current(next);
        if (going && mapId === next && user === who && !battle && mayOpen()) open(going);
        else if (!going) refreshNearby();
      } catch (err) {
        note.textContent = messageOf(err);
      }
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      // Another player on this device never sees the last one's tufts.
      if (mapId !== null) options.onWildHints?.(mapId, []);
      user = next;
      if (battle) close(false);
      mapId = null;
      entry.hidden = true;
    },
    open: (next) => {
      open(next);
    },
    watch: (start, end) => {
      open(start, true);
      // A breath on the first turn, then the showdown plays out.
      later(PLAYBACK.replayLeadMs, () => {
        if (battle?.id === start.id && replaying) receive(end);
      });
    },
    close,
    meetWild: async (id, tile) => {
      if (id !== mapId) return;
      try {
        await run((current) => api.startWild(current, tile));
      } catch (err) {
        refreshNearby();
        throw err;
      }
    },
    get debug() {
      if (!battle || !shown) return null;
      const mine = shown[battle.mySide];
      const theirs = shown[otherSide(battle.mySide)];
      return {
        id: battle.id,
        status: battle.status,
        turn: battle.view.turn,
        phase: battle.view.phase.type,
        shown: {
          mine: mine.energy[mine.active] ?? 0,
          theirs: theirs.energy[theirs.active] ?? 0,
        },
        pending: queue.length,
        waiting,
        winner: battle.view.phase.type === 'over' ? battle.view.phase.result.winner : null,
        reason:
          battle.status === 'no-contest'
            ? 'no-contest'
            : battle.view.phase.type === 'over'
              ? battle.view.phase.result.reason
              : null,
        scene: scene3d?.stats ?? null,
        keeperReactions,
        replay: replaying,
        charms,
        potions,
        clock: now(),
        safe: hud.safe(),
      };
    },
    get dev(): BattleDevControls | null {
      const manual = dev.manual;
      if (!manual) return null;
      return {
        manual: true,
        set: (t) => {
          manual.set(t);
          scene3d?.update(manual.now());
          options.invalidate();
        },
        advance: (ms) => {
          manual.advance(ms);
          scene3d?.update(manual.now());
          options.invalidate();
        },
      };
    },
  };
}
