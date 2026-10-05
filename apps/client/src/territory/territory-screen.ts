import {
  GAME_DATA,
  TERRITORY_RULES,
  type MapView,
  type OwnedSquishy,
  type PlayerBattle,
  type PublicTile,
  type PublicUser,
  type Species,
  type TerritoryStatus,
} from '@heartpatch/shared';
import { formatTimeLeft, GameClock } from '../inventory/game-clock.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { territoryApi, type TerritoryApi } from './territory-api.js';
import { territoryAction, type TerritoryAction } from './territory-action.js';
import './territory.css';

// Territory in the tile panel (#15, design doc §11): "Claim" wild land next
// to yours, "Challenge" a neighbour's (style guide §9), and pick who stands
// watch on your own land. The server checks every raid rule and runs the
// battle (CLAUDE.md rule 1); this only shows what it says and sends taps.

export interface TerritoryScreenOptions {
  api?: TerritoryApi;
  /** A tile battle started (or one going came back): the battle screen takes over. */
  openBattle: (battle: PlayerBattle) => void;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TerritoryDebug {
  readonly mapId: string;
  readonly attemptsLeft: number;
  /** Squishies on watch across my land. */
  readonly onWatch: number;
  /** The tile panel's land action right now, if any. */
  readonly tileAction: TerritoryAction['kind'] | null;
  readonly picking: boolean;
}

export interface TerritoryScreen {
  /** The map on screen (null: none); fetches tries left and who's on watch. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  readonly tileActions: TileActions;
  readonly debug: TerritoryDebug | null;
}

// Player-facing text (style guide §2, §6, §9: Claim, Challenge, never "attack").
export const TERRITORY_TEXT = {
  claim: 'Claim',
  challenge: 'Challenge',
  claimNote: 'Wild land! Win a showdown with its guardians to make it yours.',
  challengeNote: (owner: string) => `${owner}'s land. Win a showdown to make it yours!`,
  someone: 'Someone',
  onWatchThere: (n: number) =>
    n === 1 ? '1 squishy stands watch here.' : `${String(n)} squishies stand watch here.`,
  triesLeft: (n: number) => (n === 1 ? '1 try left today.' : `${String(n)} tries left today.`),
  resting: (left: string) => `This land is resting. Ready in ${left}.`,
  noTries: 'No tries left today. Come back tomorrow!',
  pvpOff: 'Challenges are off on this patch.',
  // The server's own words for a shielded Keeper (territory service), so a tap
  // here reads the same as a refused challenge would.
  rivalShielded: 'This Keeper is new here. Their land is safe for now. Try wild land!',
  tooFar: 'Too far away! Try land next to yours.',
  watchCount: (n: number, max: number) => `On watch: ${String(n)} of ${String(max)}`,
  watchNone: 'Nobody stands watch here yet.',
  pick: 'Pick guards',
  save: 'Save',
  cancel: 'Never mind',
  pickTitle: (max: number) => `Who stands watch? Pick up to ${String(max)}.`,
  noSquishies: 'No squishy friends yet. Befriend one first!',
  elsewhere: 'on watch elsewhere',
  saved: 'Your guards are in place!',
  shielded: "You're new here, so nobody can challenge your land yet.",
  mystery: 'Mystery squishy',
} as const;

export function createTerritoryScreen(options: TerritoryScreenOptions): TerritoryScreen {
  const api = options.api ?? territoryApi;
  const clock = new GameClock(options.now);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let status: TerritoryStatus | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let shown: TerritoryAction | null = null;
  /** The defender picker's choice while it's open. */
  let picking: string[] | null = null;
  let note = '';
  let ticker: number | undefined;
  let countdown: { node: HTMLElement; until: string } | null = null;

  const speciesName = (squishy: OwnedSquishy): string => {
    const species: Species | undefined =
      GAME_DATA.species.find((s) => s.id === squishy.speciesId) ??
      status?.speciesDefs.find((s) => s.id === squishy.speciesId);
    return squishy.nickname ?? species?.name ?? TERRITORY_TEXT.mystery;
  };

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.status(id);
      if (at !== generation) return;
      clock.sync(fresh.now);
      status = fresh;
    } catch (err) {
      if (at === generation) note = messageOf(err);
    }
    if (at === generation) render();
  }

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  /** One command at a time; a `CONFLICT` (a rule said no, something changed) refetches. */
  async function act(run: (id: string, stillHere: () => boolean) => Promise<void>): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      await run(id, stillHere);
    } catch (err) {
      if (stillHere()) {
        note = messageOf(err);
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') await refresh();
      }
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  const battleFor = (tile: PublicTile) =>
    act(async (id, stillHere) => {
      const battle = await sendCommand(
        sendDeps,
        (key) => api.attack(id, { q: tile.q, r: tile.r }, key),
        stillHere,
      );
      if (battle && stillHere()) options.openBattle(battle);
    });

  const saveGuards = (tile: PublicTile, squishyIds: string[]) =>
    act(async (id, stillHere) => {
      const fresh = await sendCommand(
        sendDeps,
        (key) => api.setDefenders(id, { q: tile.q, r: tile.r, squishyIds }, key),
        stillHere,
      );
      if (!fresh || !stillHere()) return;
      clock.sync(fresh.now);
      status = fresh;
      picking = null;
      note = TERRITORY_TEXT.saved;
    });

  // ── Drawing ───────────────────────────────────────────────────────────

  const line = (text: string, testId?: string) =>
    el('p', { class: 'tile-action-note', ...(testId ? { 'data-testid': testId } : {}) }, text);

  const button = (
    label: string,
    onTap: () => void,
    extra: Record<string, string> = {},
    soft = false,
  ) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button bag-action${soft ? ' auth-button-soft' : ''}`,
        ...extra,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  /** The defender picker: the player's squishies as big toggles, up to the max. */
  function picker(tile: PublicTile, chosen: string[]): HTMLElement[] {
    const max = TERRITORY_RULES.maxDefenders;
    const squishies = (status?.squishies ?? []).filter((s) => s.state === 'active');
    if (squishies.length === 0) {
      return [
        line(TERRITORY_TEXT.noSquishies),
        button(TERRITORY_TEXT.cancel, cancelPick, {}, true),
      ];
    }
    const elsewhere = new Set(
      (status?.defenders ?? [])
        .filter((d) => d.q !== tile.q || d.r !== tile.r)
        .flatMap((d) => d.squishyIds),
    );
    const list = el(
      'ul',
      { class: 'territory-picker', 'data-testid': 'territory-picker' },
      ...squishies.map((s) => {
        const on = chosen.includes(s.id);
        const toggle = el(
          'button',
          {
            type: 'button',
            class: 'territory-pick',
            'aria-pressed': on ? 'true' : 'false',
            'data-squishy': s.id,
          },
          el('span', { class: 'territory-pick-name' }, `${speciesName(s)} · Lv ${String(s.level)}`),
          ...(elsewhere.has(s.id)
            ? [el('span', { class: 'territory-pick-hint' }, TERRITORY_TEXT.elsewhere)]
            : []),
        );
        toggle.disabled = working || (!on && chosen.length >= max);
        toggle.addEventListener('click', () => {
          picking = on ? chosen.filter((id) => id !== s.id) : [...chosen, s.id];
          render();
        });
        return el('li', {}, toggle);
      }),
    );
    return [
      line(TERRITORY_TEXT.pickTitle(max)),
      list,
      el(
        'div',
        { class: 'territory-row' },
        button(TERRITORY_TEXT.save, () => void saveGuards(tile, chosen), {
          'data-testid': 'territory-save',
        }),
        button(TERRITORY_TEXT.cancel, cancelPick, {}, true),
      ),
    ];
  }

  function cancelPick(): void {
    picking = null;
    render();
  }

  function render(): void {
    shown = null;
    countdown = null;
    if (!panel) {
      syncTicker();
      return;
    }
    const { container, tile, view } = panel;
    const action = territoryAction(tile, view, user?.id ?? null, status, clock.now());
    shown = action;
    const children: HTMLElement[] = [];
    const owner = view.members.find((m) => m.user.id === tile.ownerUserId)?.user.username;
    switch (action.kind) {
      case 'none':
        if (tile.ownerUserId !== user?.id && tile.defenders > 0) {
          children.push(line(TERRITORY_TEXT.onWatchThere(tile.defenders)));
        }
        break;
      case 'claim':
        children.push(
          line(TERRITORY_TEXT.claimNote),
          line(TERRITORY_TEXT.triesLeft(action.attemptsLeft)),
          button(TERRITORY_TEXT.claim, () => void battleFor(tile), { 'data-testid': 'tile-claim' }),
        );
        break;
      case 'challenge':
        children.push(
          line(TERRITORY_TEXT.challengeNote(owner ?? TERRITORY_TEXT.someone)),
          ...(tile.defenders > 0 ? [line(TERRITORY_TEXT.onWatchThere(tile.defenders))] : []),
          line(TERRITORY_TEXT.triesLeft(action.attemptsLeft)),
          button(TERRITORY_TEXT.challenge, () => void battleFor(tile), {
            'data-testid': 'tile-challenge',
          }),
        );
        break;
      case 'resting': {
        const node = line(TERRITORY_TEXT.resting(formatTimeLeft(clock.msUntil(action.until))));
        countdown = { node, until: action.until };
        children.push(node);
        break;
      }
      case 'no-tries':
        children.push(line(TERRITORY_TEXT.noTries));
        break;
      case 'pvp-off':
        children.push(line(TERRITORY_TEXT.pvpOff));
        break;
      case 'shielded':
        children.push(
          ...(tile.defenders > 0 ? [line(TERRITORY_TEXT.onWatchThere(tile.defenders))] : []),
          line(TERRITORY_TEXT.rivalShielded, 'territory-shielded'),
        );
        break;
      case 'too-far':
        children.push(
          ...(tile.ownerUserId !== null && tile.defenders > 0
            ? [line(TERRITORY_TEXT.onWatchThere(tile.defenders))]
            : []),
          line(TERRITORY_TEXT.tooFar, 'territory-too-far'),
        );
        break;
      case 'watch':
        if (picking) {
          children.push(...picker(tile, picking));
        } else {
          const ids = [...action.squishyIds];
          if (status?.shieldUntil && clock.msUntil(status.shieldUntil) > 0) {
            children.push(line(TERRITORY_TEXT.shielded));
          }
          children.push(
            line(
              ids.length > 0
                ? TERRITORY_TEXT.watchCount(ids.length, TERRITORY_RULES.maxDefenders)
                : TERRITORY_TEXT.watchNone,
              'territory-watch',
            ),
            button(
              TERRITORY_TEXT.pick,
              () => {
                picking = ids;
                note = '';
                render();
              },
              { 'data-testid': 'territory-pick' },
              true,
            ),
          );
        }
        break;
    }
    if (note && action.kind !== 'none') children.push(line(note, 'territory-note'));
    container.replaceChildren(...children);
    syncTicker();
  }

  /** Ticks once a second only while a resting countdown is on screen. */
  function syncTicker(): void {
    if (countdown && ticker === undefined) {
      ticker = window.setInterval(() => {
        if (!countdown) return;
        const left = clock.msUntil(countdown.until);
        if (left <= 0) render();
        else countdown.node.textContent = TERRITORY_TEXT.resting(formatTimeLeft(left));
      }, 1000);
    } else if (!countdown && ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  }

  const reset = () => {
    generation += 1;
    status = null;
    picking = null;
    note = '';
  };

  return {
    setMap: async (next) => {
      // The same map again (back from a battle): fetch fresh tries and guards.
      if (next !== mapId) reset();
      mapId = next;
      render();
      if (next) await refresh();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      mapId = null;
      reset();
      render();
    },
    tileActions: {
      show: (container, tile, view) => {
        const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
        if (!same) {
          picking = null;
          note = '';
        }
        panel = { container, tile, view };
        render();
      },
      hide: () => {
        panel?.container.replaceChildren();
        panel = null;
        picking = null;
        note = '';
        render();
      },
    },
    get debug() {
      if (!mapId || !status) return null;
      return {
        mapId,
        attemptsLeft: status.attemptsLeft,
        onWatch: status.defenders.reduce((n, d) => n + d.squishyIds.length, 0),
        tileAction: shown?.kind ?? null,
        picking: picking !== null,
      };
    },
  };
}
