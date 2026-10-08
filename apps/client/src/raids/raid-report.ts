import type { DefenseStance, PublicUser, RaidReplay, RaidReport } from '@heartpatch/shared';
import { describeItems } from '../inventory/bag-view.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import type { TerritoryScreen } from '../territory/territory-screen.js';
import { el, messageOf } from '../ui/dom.js';
import {
  RAID_TEXT,
  raidFencesLine,
  raidFireLine,
  raidLine,
  raidStyleLine,
  STANCES,
  stanceName,
} from './raid-words.js';
import { raidsApi, type RaidsApi } from './raids-api.js';
import './raids.css';

// The raid report (#16, design doc §3 "offline defense", style guide §6
// "Morning report"; titled "Challenge report" so it never reads like the Hollow's
// morning report): challenges on my land while I was away, opened by itself
// when there's something new, plus my defense style. A raid's replay plays in
// the battle screen (#13), from my side. The server decides everything
// (CLAUDE.md rule 1); this only shows what it says and sends taps.

export interface RaidReportOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  /** Plays a raid's replay in the battle screen. */
  watch: (replay: RaidReplay) => void;
  api?: RaidsApi;
  /**
   * The sheet opened or closed (by the player or on its own), so other
   * morning news (the Hollow Man's report, #21) can wait its turn.
   */
  onOpenChange?: (open: boolean) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface RaidReportDebug {
  readonly mapId: string;
  readonly stance: DefenseStance;
  readonly raids: number;
  readonly unseen: number;
  readonly open: boolean;
}

export interface RaidReportScreen {
  /** The map on screen (null: none): shows the Report button and opens it if there's news. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  readonly debug: RaidReportDebug | null;
}

export function createRaidReport(options: RaidReportOptions): RaidReportScreen {
  const api = options.api ?? raidsApi;

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let report: RaidReport | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let note = '';

  // ── Report button and sheet ───────────────────────────────────────────
  // Unseen raids glow on the Adventure handle (ui/trays) instead of opening over the map.
  const badge = el('span', {
    class: 'raid-open-badge',
    'aria-hidden': 'true',
    'data-tray-alert': RAID_TEXT.news,
  });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'raid-open',
      'data-testid': 'raid-open',
      'aria-label': RAID_TEXT.open,
    },
    el('span', { class: 'raid-open-icon', 'aria-hidden': 'true' }, '📜'),
    el('span', { class: 'raid-open-label' }, RAID_TEXT.open),
    badge,
  );
  button.hidden = true;
  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': RAID_TEXT.close },
    '×',
  );
  const body = el('div', { class: 'raid-body' });
  const sheet = el(
    'section',
    {
      class: 'bag raid-sheet',
      'data-testid': 'raid-report',
      role: 'dialog',
      'aria-labelledby': 'raid-title',
    },
    el('div', { class: 'tile-panel-head' }, el('h2', { id: 'raid-title' }, RAID_TEXT.title), close),
    body,
  );
  sheet.hidden = true;
  if (options.onOpenChange) {
    const changed = options.onOpenChange;
    new MutationObserver(() => {
      changed(!sheet.hidden);
    }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
  }
  (options.entryRoot ?? options.root).append(button);
  options.root.append(sheet);

  button.addEventListener('click', () => {
    show();
    void refresh(false);
  });
  close.addEventListener('click', () => {
    void dismiss();
  });

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  function show(): void {
    note = '';
    sheet.hidden = false;
    render();
  }

  /** Fetches the report; `openIfNew` opens the sheet when there's something unseen. */
  async function refresh(openIfNew: boolean): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.report(id);
      if (at !== generation) return;
      report = fresh;
      if (openIfNew && fresh.unseen > 0 && !options.entryRoot) show();
    } catch (err) {
      if (at === generation) note = messageOf(err);
    }
    if (at === generation) render();
  }

  /** One command at a time, for the map still on screen. */
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
      if (stillHere()) note = messageOf(err);
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  /** Marks what the sheet showed as seen. */
  async function markShown(id: string, stillHere: () => boolean): Promise<void> {
    const unseen = (report?.raids ?? []).filter((r) => r.seenAt === null).map((r) => r.id);
    if (unseen.length === 0) return;
    const fresh = await sendCommand(sendDeps, (key) => api.markSeen(id, unseen, key), stillHere);
    if (fresh && stillHere()) report = fresh;
  }

  /** Closing the sheet marks what it showed as seen. */
  async function dismiss(): Promise<void> {
    sheet.hidden = true;
    render();
    await act(markShown);
  }

  const setStyle = (stance: DefenseStance) =>
    act(async (id, stillHere) => {
      const fresh = await sendCommand(sendDeps, (key) => api.setStyle(id, stance, key), stillHere);
      if (!fresh || !stillHere()) return;
      report = fresh;
      note = RAID_TEXT.styleSaved(stanceName(stance));
    });

  const watch = (raidId: string) =>
    act(async (id, stillHere) => {
      const replay = await api.replay(id, raidId);
      if (!stillHere()) return;
      // Seen first: the battle screen takes the screen from the map (and us).
      sheet.hidden = true;
      try {
        await markShown(id, stillHere);
      } catch {
        // Still new next time; the replay matters more right now.
      }
      if (stillHere()) options.watch(replay);
    });

  // ── Drawing ───────────────────────────────────────────────────────────

  function render(): void {
    button.hidden = mapId === null || report === null;
    const unseen = report?.unseen ?? 0;
    badge.textContent = unseen > 0 ? String(unseen) : '';
    badge.hidden = unseen === 0;
    if (sheet.hidden || !report) {
      body.replaceChildren();
      return;
    }
    const raids = report.raids;
    const list =
      raids.length === 0
        ? [el('p', { class: 'raid-quiet', 'data-testid': 'raid-quiet' }, RAID_TEXT.quiet)]
        : [
            el('p', { class: 'raid-lead' }, RAID_TEXT.challenged),
            el(
              'ul',
              { class: 'bag-rows', 'data-testid': 'raid-list' },
              ...raids.map((raid) => {
                const style = raidStyleLine(raid);
                const watchButton = el(
                  'button',
                  {
                    type: 'button',
                    class: 'auth-button auth-button-soft auth-button-small',
                    'data-testid': 'raid-watch',
                  },
                  RAID_TEXT.watch,
                );
                watchButton.disabled = working;
                watchButton.addEventListener('click', () => void watch(raid.id));
                return el(
                  'li',
                  { class: `raid-row${raid.seenAt === null ? ' raid-row-new' : ''}` },
                  el(
                    'div',
                    { class: 'raid-row-text' },
                    ...(raid.seenAt === null
                      ? [el('span', { class: 'raid-new' }, RAID_TEXT.fresh)]
                      : []),
                    el('p', { class: 'raid-line' }, raidLine(raid)),
                    ...(raid.lostFire
                      ? [
                          el('p', { class: 'raid-line' }, raidFireLine(raid) ?? ''),
                          el('p', { class: 'raid-style-line' }, describeItems(raid.lostFire)),
                        ]
                      : []),
                    ...(raid.lostFences
                      ? [el('p', { class: 'raid-line' }, raidFencesLine(raid) ?? '')]
                      : []),
                    ...(style && !raid.fence ? [el('p', { class: 'raid-style-line' }, style)] : []),
                  ),
                  ...(raid.replayable ? [watchButton] : []),
                );
              }),
            ),
          ];
    const styles = el(
      'div',
      { class: 'raid-styles', role: 'group', 'aria-label': RAID_TEXT.styleTitle },
      ...STANCES.map(({ stance, name, hint }) => {
        const on = report?.stance === stance;
        const pick = el(
          'button',
          {
            type: 'button',
            class: 'raid-style',
            'aria-pressed': on ? 'true' : 'false',
            'data-stance': stance,
          },
          el('span', { class: 'raid-style-name' }, name),
          el('span', { class: 'raid-style-hint' }, hint),
        );
        pick.disabled = working;
        pick.addEventListener('click', () => {
          if (!on) void setStyle(stance);
        });
        return pick;
      }),
    );
    const gotIt = el(
      'button',
      { type: 'button', class: 'auth-button', 'data-testid': 'raid-done' },
      RAID_TEXT.gotIt,
    );
    gotIt.addEventListener('click', () => void dismiss());
    body.replaceChildren(
      ...list,
      el('h3', { class: 'bag-section-title' }, RAID_TEXT.styleTitle),
      el('p', { class: 'raid-style-note' }, RAID_TEXT.styleNote),
      styles,
      el('p', { class: 'bag-note', role: 'status', 'data-testid': 'raid-note' }, note),
      gotIt,
    );
  }

  const reset = () => {
    generation += 1;
    report = null;
    note = '';
    sheet.hidden = true;
  };

  return {
    setMap: async (next) => {
      // A new map (or the same one again: a battle or the home base steps the
      // map out with null first) opens the sheet if there's news; a repeat
      // call for the map on screen only refreshes.
      const same = next === mapId;
      if (!same) reset();
      mapId = next;
      render();
      if (next) await refresh(!same);
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      mapId = null;
      reset();
      render();
    },
    get debug() {
      if (!mapId || !report) return null;
      return {
        mapId,
        stance: report.stance,
        raids: report.raids.length,
        unseen: report.unseen,
        open: !sheet.hidden,
      };
    },
  };
}

/**
 * The raid report follows the territory screen onto and off every map
 * (main.ts calls `territory.setMap` wherever a map opens or closes), so the
 * entry point needs only this one wrap.
 */
export function withRaidReport(
  territory: TerritoryScreen,
  raids: RaidReportScreen,
): TerritoryScreen {
  return {
    setMap: async (mapId) => {
      void raids.setMap(mapId);
      await territory.setMap(mapId);
    },
    setUser: (next) => {
      raids.setUser(next);
      territory.setUser(next);
    },
    tileActions: territory.tileActions,
    get debug() {
      return territory.debug;
    },
  };
}
