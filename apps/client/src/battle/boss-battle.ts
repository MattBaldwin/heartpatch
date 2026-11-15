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
import { befriendPanel, mountBossHud, type PickerMove } from './boss-hud.js';
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
  /** Heart Charms in the bag (null while counting), and a fresh count. */
  readonly charms: () => number | null;
  readonly refreshCharms: (b: PlayerBattle) => Promise<number>;
  readonly befriend: (battleId: string, ask: number, key: string) => Promise<BossBefriendResponse>;
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
  /** A batch of log steps starts playing. */
  playing: () => void;
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
    readonly misses: number;
  };
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
  let asks = 0;
  let misses = 0;
  let busy = false;
  let problem: string | null = null;
  /** The bag was counted for the ask (the card waits for it once). */
  let counting = false;
  /** One key per ask number, so a retried ask is the same ask. */
  const keys = new Map<number, string>();

  const reset = (id: string) => {
    battleId = id;
    picker = null;
    pickerTurn = -1;
    lastPicks = null;
    bossMoves = 0;
    asks = 0;
    misses = 0;
    busy = false;
    problem = null;
    counting = false;
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
      onSameAgain:
        again && again !== state && state.at < state.steps.length
          ? () => {
              picker = again;
              drawPicker(b, names);
            }
          : null,
    });
    deps.invalidate();
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
    deps
      .befriend(b.id, ask, key)
      .then((res) => {
        if (battleId !== b.id) return;
        busy = false;
        asks = Math.max(asks, ask);
        if (res.outcome === 'not-yet') misses += 1;
        // The ask spent charms: count again, and show the card again only if the count moved.
        const before = deps.charms();
        void deps.refreshCharms(res.battle).then((count) => {
          if (battleId === res.battle.id && count !== before) deps.replace(res.battle);
        });
        deps.replace(res.battle);
      })
      .catch((err: unknown) => {
        if (battleId !== b.id) return;
        busy = false;
        // A 409 says why in kid words (too few charms, already have one, too late).
        problem =
          err instanceof ApiRequestError ? err.message : 'Hmm, that didn’t work. Try again?';
        void deps.refreshCharms(b).then(() => {
          if (battleId === b.id) deps.replace(b);
        });
        deps.replace(b);
      });
  };

  return {
    open: (b) => {
      if (battleId !== b.id) reset(b.id);
      deps.hud.setTeam({
        top: ui.top,
        sheet: ui.picker,
        topEdge: ui.top.querySelector('.boss-plate') ?? ui.top,
        bottomEdge: ui.top.querySelector('.boss-friends') ?? ui.top,
      });
    },
    close: () => {
      deps.hud.setTeam(null);
      ui.hidePicker();
      drawn = null;
      battleId = null;
    },
    plates: (b, shown, names) => {
      ui.setPlates(bossPlates(b, shown, names, (side, slot) => deps.nameOf(b, side, slot)));
      const boss = b.boss;
      ui.setChips({
        tries: boss ? boss.triesLeftToday : null,
        until: boss ? hereUntil(boss, deps.now()) : null,
      });
    },
    controls: (b, names, canPick) => {
      if (!canPick || b.status !== 'active' || b.view.phase.type !== 'turn') {
        ui.hidePicker();
        drawn = null;
        return;
      }
      if (!picker || pickerTurn !== b.view.turn) {
        picker = pickerFor(b, (side, slot) => deps.nameOf(b, side, slot));
        pickerTurn = b.view.turn;
      }
      if (picker !== drawn) drawPicker(b, names);
    },
    playing: () => {
      bossMoves = 0;
      ui.hidePicker();
      drawn = null;
    },
    step: (b, step, names) => {
      const extra = bossCallout(step, b.mySide, bossMoves, names.moves);
      if (step.kind === 'move' && step.side !== b.mySide) bossMoves += 1;
      if (extra) ui.callout('boss', extra);
      else if (step.callout) ui.callout(step.side === b.mySide ? step.slot : 'boss', step.callout);
    },
    result: (b, names) => {
      const boss = b.view.sides[otherSide(b.mySide)].squishies[bossSlot(b)];
      const name = names.speciesName(boss?.speciesId ?? '');
      const card = bossResult(b, name, deps.now());
      if (!card) return null;
      const state = b.boss?.befriend;
      const view = befriendView({
        boss: b.boss,
        name,
        // A resumed "not yet" with asks left was the first ask (`asksPerWin` is 2).
        asksMade: state === 'offer' ? 0 : Math.max(asks, 1),
        misses: Math.max(misses, state === 'not-yet' ? 1 : 0),
        charms: deps.charms(),
      });
      if (view.kind === 'ask' && deps.charms() === null && !counting) {
        // The ask shows the bag's count: count it, then show the card again.
        counting = true;
        void deps.refreshCharms(b).then(() => {
          if (battleId === b.id) deps.replace(b);
        });
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
      return { picker, asks, misses };
    },
  };
}
