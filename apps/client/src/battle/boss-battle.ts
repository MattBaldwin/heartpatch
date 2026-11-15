import {
  BATTLE_RULES,
  ELEMENTS,
  speciesMoveKinds,
  type BattleSideId,
  type BossBefriendResponse,
  type MoveKind,
  type PlayerBattle,
  type PlayerBattleAction,
} from '@heartpatch/shared';
import { ApiRequestError } from '../net/api.js';
import type { BattleHud } from './battle-hud.js';
import type { PlaybackStep, ShownState } from './battle-playback.js';
import type { BattleScene } from './battle-scene.js';
import { otherSide, type BattleContent } from './battle-view.js';
import {
  befriendPanel,
  type FriendSpot,
  mountBossHud,
  type OrderMover,
  type PickerMove,
} from './boss-hud.js';
import {
  befriendView,
  bossCallout,
  bossPlates,
  bossResult,
  bossSlot,
  goTo,
  hereUntil,
  isAreaMove,
  pickerFor,
  slotsOut,
  pickMove,
  sameAgain,
  teamAction,
  type BossResultCard,
  type PickerState,
} from './boss-view.js';
import { describeMove } from './move-info.js';

// A mini-boss fight's screen parts (#190): the team HUD, the picker's round,
// the playback callouts and the befriend moment, driven by battle-screen.ts.
// Everything shown comes from the server's battle (CLAUDE.md rule 1).

const ELEMENT_NAMES = new Map(ELEMENTS.map((e) => [e.id, e.name]));

export interface BossBattleDeps {
  readonly hud: BattleHud;
  readonly scene: () => BattleScene | null;
  /** A squishy's name on its plate (a nickname on my side). */
  readonly nameOf: (b: PlayerBattle, side: BattleSideId, slot: number) => string;
  /** Sends the round (the screen's REST submit, with its retries). */
  readonly submit: (action: PlayerBattleAction) => void;
  readonly now: () => number;
  /** The patch's time zone for the visit's days, or null for this device's. */
  readonly timeZone: (b: PlayerBattle) => string | null;
  /** Heart Charms in the bag (null while counting), and a fresh count. */
  readonly charms: () => number | null;
  readonly refreshCharms: (b: PlayerBattle) => Promise<number>;
  readonly befriend: (battleId: string, ask: number, key: string) => Promise<BossBefriendResponse>;
  /** The battle as the server has it now (after a 409, the ask's state moved on). */
  readonly fetch: (battleId: string) => Promise<PlayerBattle>;
  readonly newKey: () => string;
  /** The battle after an ask: the screen takes it and shows its card again. */
  readonly replace: (b: PlayerBattle) => void;
  /** "Make Heart Charms 🏠": back to the patch. */
  readonly home: () => void;
  readonly invalidate: () => void;
}

export interface BossBattle {
  /** A battle opened: the team HUD goes up (a new battle starts its counts afresh). */
  open: (b: PlayerBattle) => void;
  close: () => void;
  plates: (b: PlayerBattle, shown: ShownState, names: BattleContent) => void;
  /** The round's picker, while the player can pick; hidden otherwise. */
  controls: (b: PlayerBattle, names: BattleContent, canPick: boolean) => void;
  /** A batch of log steps starts playing (its moves fill the order strip). */
  playing: (b: PlayerBattle, steps: readonly PlaybackStep[]) => void;
  /** A step plays: its callout over the right plate, and the boss's "Stomp again!". */
  step: (b: PlayerBattle, step: PlaybackStep, names: BattleContent) => void;
  /** The card's words and its befriend panel, or null when it isn't a boss card. */
  result: (
    b: PlayerBattle,
    names: BattleContent,
  ) => (BossResultCard & { extra: HTMLElement | null }) | null;
  /** The dev hook (Playwright reads it, not pixels). */
  readonly debug: {
    readonly picker: PickerState | null;
    readonly asks: number;
    /** The server's warmth step on the card now (0–4). */
    readonly warmth: number;
    /** Heart Charm recounts for the finished fight (once on arrival, once per ask). */
    readonly recounts: number;
  };
}

/** True when two rounds' picks are the same moves for the same squishies. */
function samePicks(a: Readonly<Record<number, string>>, b: Readonly<Record<number, string>>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[Number(k)] === b[Number(k)]);
}

export function createBossBattle(deps: BossBattleDeps): BossBattle {
  const ui = mountBossHud();
  let battleId: string | null = null;
  let picker: PickerState | null = null;
  /** The picker state on screen, so a refresh with nothing new leaves its buttons be. */
  let drawn: PickerState | null = null;
  let pickerTurn = -1;
  let lastPicks: Readonly<Record<number, string>> | null = null;
  let bossMoves = 0;
  /** The round playing now (its number), or null while picking. */
  let playingRound: number | null = null;
  /** The order strip: this round's movers from the log, and the one moving now. */
  let movers: OrderMover[] = [];
  let moving = -1;
  let asks = 0;
  let warmth = 0;
  let busy = false;
  let problem: string | null = null;
  /**
   * The finished fight's bag was recounted: once when it arrives (the win's
   * bundle just put Heart Charms in it), then after each ask spends some.
   */
  let counted = false;
  let recounts = 0;
  /** The battle the card was last drawn from: a late count redraws this, never an older one. */
  let latest: PlayerBattle | null = null;
  /** Frames left to wait for the arena's first picture before the plates line up. */
  let placing = 0;
  let placeFrame = 0;
  /** The battle the plates were last lined up for, and the arena told when its camera moves. */
  let placed: PlayerBattle | null = null;
  let watching: BattleScene | null = null;
  let unwatch: (() => void) | null = null;
  const stopWatching = () => {
    unwatch?.();
    unwatch = null;
    watching = null;
  };
  /** One key per ask number, so a retried ask is the same ask. */
  const keys = new Map<number, string>();

  const reset = (id: string) => {
    battleId = id;
    picker = null;
    pickerTurn = -1;
    lastPicks = null;
    bossMoves = 0;
    playingRound = null;
    movers = [];
    moving = -1;
    asks = 0;
    warmth = 0;
    busy = false;
    problem = null;
    counted = false;
    recounts = 0;
    latest = null;
    keys.clear();
  };

  const movesFor = (b: PlayerBattle, names: BattleContent, slot: number): PickerMove[] => {
    const me = b.view.sides[b.mySide].squishies[slot];
    const them = b.view.sides[otherSide(b.mySide)].squishies[bossSlot(b)];
    if (!me || !them) return [];
    const rules = BATTLE_RULES.moveKinds;
    const styles = rules
      ? speciesMoveKinds({ id: me.speciesId, moves: me.moves }, names.moves, rules)
      : new Map<string, MoveKind>();
    return me.moves.map((id) => {
      const move = names.moves.get(id);
      const tags: string[] = [];
      if (move) {
        const element = ELEMENT_NAMES.get(move.element);
        if (element) tags.push(element);
        const info = describeMove(move, me, them, { style: styles.get(id) });
        tags.push(`${info.look.icon} ${info.look.label}`);
      }
      return { id, name: names.moveName(id), tags, area: isAreaMove(move) };
    });
  };

  const drawPicker = (b: PlayerBattle, names: BattleContent) => {
    const state = picker;
    if (!state) return;
    drawn = state;
    const current = state.steps[state.at];
    // The camera nudges to the squishy picking (plan §10), back to all once ready.
    deps.scene()?.focusOn(current ? b.mySide : null, current?.slot ?? null);
    const again = sameAgain(state, lastPicks);
    ui.showPicker(state, (slot) => movesFor(b, names, slot), {
      onPick: (move) => {
        picker = pickMove(state, move);
        drawPicker(b, names);
      },
      onChip: (slot) => {
        picker = goTo(state, slot);
        drawPicker(b, names);
      },
      onGo: () => {
        const action = teamAction(state);
        if (!action || action.type !== 'team') return;
        lastPicks = { ...state.picks };
        ui.hidePicker();
        drawn = null;
        deps.scene()?.focusOn(null);
        deps.submit(action);
      },
      onChange: () => {
        picker = { ...state, at: 0 };
        drawPicker(b, names);
      },
      // On any step, Ready included (mockup A2), unless it would change nothing.
      onSameAgain:
        again && !samePicks(again.picks, state.picks)
          ? () => {
              picker = again;
              drawPicker(b, names);
            }
          : null,
    });
    deps.invalidate();
  };

  /** Lines each friend's plate up under its body, once the arena has drawn it. */
  const place = (b: PlayerBattle) => {
    const scene = deps.scene();
    const spots = new Map<number, FriendSpot>();
    for (const slot of slotsOut(b, b.mySide)) {
      const spot = scene?.screenSpot(b.mySide, slot, true);
      // `r` is half the body's height on screen, so its feet are `r` below its middle.
      if (spot) spots.set(slot, { x: spot.x, feet: spot.y + spot.r });
    }
    if (spots.size > 0) {
      ui.placeFriends(spots);
      placing = 0;
      placed = b;
      // The camera leans and pushes in as steps play: line them up again each
      // time it moves, so a plate stays under its body (#190).
      if (scene && watching !== scene) {
        stopWatching();
        watching = scene;
        unwatch = scene.onCameraMoved(() => {
          if (placed && battleId === placed.id) place(placed);
        });
      }
      return;
    }
    if (placing <= 0) return;
    placing -= 1;
    placeFrame = requestAnimationFrame(() => {
      if (battleId === b.id) place(b);
    });
  };

  /** Counts the bag again, then shows the card again with the new count. */
  const recount = (b: PlayerBattle) => {
    recounts += 1;
    void deps.refreshCharms(b).then(() => {
      if (battleId === b.id && latest?.id === b.id) deps.replace(latest);
    });
  };

  const showAsk = (b: PlayerBattle, ask: number) => {
    if (busy || battleId !== b.id) return;
    busy = true;
    problem = null;
    deps.replace(b);
    let key = keys.get(ask);
    if (!key) {
      key = deps.newKey();
      keys.set(ask, key);
    }
    // The card is drawn once per answer, after the bag is counted again (the
    // ask spent charms): a second redraw a moment later could eat a tap.
    // "Asking…" stays on the button until then.
    const counted = (battle: PlayerBattle) =>
      deps.refreshCharms(battle).then(
        () => undefined,
        () => undefined,
      );
    deps
      .befriend(b.id, ask, key)
      .then(async (res) => {
        if (battleId !== b.id) return;
        recounts += 1;
        await counted(res.battle);
        if (battleId !== b.id) return;
        busy = false;
        asks = Math.max(asks, ask);
        deps.replace(res.battle);
      })
      .catch(async (err: unknown) => {
        if (battleId !== b.id) return;
        // A 409 says why in kid words (too few charms, already have one, too
        // late), and the ask moved on without us (closed, answered, joined):
        // the card shows it as the server has it, so the same ask isn't
        // offered again. The words stay up until the next ask.
        problem =
          err instanceof ApiRequestError ? err.message : 'Hmm, that didn’t work. Try again?';
        const conflict = err instanceof ApiRequestError && err.code === 'CONFLICT';
        recounts += 1;
        const [fresh] = await Promise.all([
          conflict ? deps.fetch(b.id).catch(() => b) : Promise.resolve(b),
          counted(b),
        ]);
        if (battleId !== b.id) return;
        busy = false;
        deps.replace(fresh);
      });
  };

  return {
    open: (b) => {
      if (battleId !== b.id) reset(b.id);
      // The arena takes a few frames to build: try for up to a second or so.
      placing = 90;
      deps.hud.setTeam({
        top: ui.top,
        sheet: ui.picker,
        topEdge: ui.top.querySelector('.boss-head') ?? ui.top,
        bottomEdge: ui.top.querySelector('.boss-friends') ?? ui.top,
      });
    },
    close: () => {
      cancelAnimationFrame(placeFrame);
      placing = 0;
      placed = null;
      stopWatching();
      deps.hud.setTeam(null);
      ui.hidePicker();
      drawn = null;
      battleId = null;
    },
    plates: (b, shown, names) => {
      ui.setPlates(bossPlates(b, shown, names, (side, slot) => deps.nameOf(b, side, slot)));
      cancelAnimationFrame(placeFrame);
      place(b);
      // "Round 1" while the first is picked; the round's own number while it plays.
      ui.setRound(playingRound ?? (b.status === 'active' ? b.view.turn + 1 : null));
      const boss = b.boss;
      ui.setChips({
        tries: boss ? boss.triesLeftToday : null,
        until: boss ? hereUntil(boss, deps.now(), deps.timeZone(b)) : null,
      });
    },
    controls: (b, names, canPick) => {
      if (!canPick || b.status !== 'active' || b.view.phase.type !== 'turn') {
        ui.hidePicker();
        drawn = null;
        return;
      }
      // Picking again: the round that played is done.
      if (playingRound !== null) {
        playingRound = null;
        ui.setOrder(null);
        ui.setRound(b.view.turn + 1);
      }
      if (!picker || pickerTurn !== b.view.turn) {
        picker = pickerFor(b, (side, slot) => deps.nameOf(b, side, slot));
        pickerTurn = b.view.turn;
      }
      if (picker !== drawn) drawPicker(b, names);
    },
    playing: (b, steps) => {
      bossMoves = 0;
      ui.hidePicker();
      drawn = null;
      playingRound = Math.max(1, b.view.turn);
      ui.setRound(playingRound);
      movers = steps
        .filter((s) => s.kind === 'move')
        .map((s) => ({
          who: s.side === b.mySide ? s.slot : ('boss' as const),
          name: deps.nameOf(b, s.side, s.slot),
        }));
      moving = -1;
      ui.setOrder({ movers, current: moving });
    },
    step: (b, step, names) => {
      if (step.kind === 'move' && movers.length > 0) {
        moving = Math.min(movers.length - 1, moving + 1);
        ui.setOrder({ movers, current: moving });
      }
      const extra = bossCallout(step, b.mySide, bossMoves, names.moves);
      if (step.kind === 'move' && step.side !== b.mySide) bossMoves += 1;
      if (extra) ui.callout('boss', extra);
      else if (step.callout) ui.callout(step.side === b.mySide ? step.slot : 'boss', step.callout);
    },
    result: (b, names) => {
      const boss = b.view.sides[otherSide(b.mySide)].squishies[bossSlot(b)];
      const name = names.speciesName(boss?.speciesId ?? '');
      const card = bossResult(b, name, deps.now(), deps.timeZone(b));
      if (!card) return null;
      latest = b;
      const state = b.boss?.befriend;
      warmth = b.boss?.warmth ?? 0;
      const view = befriendView({
        boss: b.boss,
        name,
        // A resumed "not yet" with asks left was the first ask (`asksPerWin` is 2).
        asksMade: state === 'offer' ? 0 : Math.max(asks, 1),
        charms: deps.charms(),
      });
      if (!counted && view.kind === 'ask') {
        // Counted when the fight opened, before the win's bundle landed: a kid
        // with no charms before the fight has the bundle's 3 now.
        counted = true;
        recount(b);
      }
      const panel = befriendPanel(view, {
        busy,
        onAsk: (ask) => {
          showAsk(b, ask);
        },
        onHome: deps.home,
      });
      if (panel && problem) {
        const note = document.createElement('p');
        note.className = 'auth-error';
        note.setAttribute('role', 'alert');
        note.textContent = problem;
        panel.append(note);
      }
      return { ...card, extra: panel };
    },
    get debug() {
      return { picker, asks, warmth, recounts };
    },
  };
}
