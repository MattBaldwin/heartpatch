import type { MilestonesResponse } from '@heartpatch/shared';
import { el, messageOf } from '../ui/dom.js';
import { milestonesApi, type MilestonesApi } from './milestones-api.js';
import {
  barPercent,
  earnedCount,
  MILESTONES_TEXT,
  nextTier,
  progressLabel,
  rewardLine,
  seasonLabel,
  type ShownTrack,
} from './milestones-view.js';
import './milestones.css';

// The Milestones screen (design doc §24, #44): reached from the Wardrobe, it
// takes the wardrobe's bottom card while the Keeper stays on show above it,
// like the Boutique. A profile card with the title you wear, then a bar per
// track towards its next tier, and "???" for secrets not found yet. The
// server counts everything (CLAUDE.md rule 1); this only shows it.

export interface MilestonesCardOptions {
  /** "Back": the wardrobe card again. */
  onBack: () => void;
  /** The player's name for the profile card. */
  username: () => string;
  api?: MilestonesApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface MilestonesCardDebug {
  readonly open: boolean;
  readonly loaded: boolean;
  /** Track ids shown, with `???` for each secret not found yet. */
  readonly tracks: readonly string[];
  /** Tiers earned per shown track. */
  readonly earned: Readonly<Record<string, number>>;
  readonly titles: readonly string[];
  readonly equippedTitleId: string | null;
  readonly picking: boolean;
}

export interface MilestonesCard {
  readonly node: HTMLElement;
  open: () => void;
  close: () => void;
  /** Forget everything (a new login). */
  reset: () => void;
  readonly isOpen: boolean;
  readonly debug: MilestonesCardDebug;
}

export function createMilestonesCard(options: MilestonesCardOptions): MilestonesCard {
  const api = options.api ?? milestonesApi;
  let isOpen = false;
  let data: MilestonesResponse | null = null;
  let picking = false;
  let saving = false;
  /** Bumped on open, close and reset, so a slow reply can't land on a newer screen. */
  let session = 0;

  // ── DOM ───────────────────────────────────────────────────────────────
  const back = el(
    'button',
    { type: 'button', class: 'wardrobe-chip', 'data-testid': 'milestones-back' },
    MILESTONES_TEXT.back,
  );
  const header = el(
    'div',
    { class: 'wardrobe-header' },
    el('h2', { class: 'auth-title', id: 'milestones-title' }, MILESTONES_TEXT.title),
    back,
  );
  const profile = el('div', { class: 'milestones-profile', 'data-testid': 'milestones-profile' });
  const list = el('div', { class: 'milestones-list', 'data-testid': 'milestones-list' });
  const note = el('p', {
    class: 'wardrobe-note',
    role: 'status',
    'data-testid': 'milestones-note',
  });
  const node = el(
    'div',
    {
      class: 'auth-card wardrobe-card milestones-card',
      'data-testid': 'milestones',
      'aria-labelledby': 'milestones-title',
    },
    header,
    profile,
    list,
    note,
  );
  node.hidden = true;

  const say = (text: string) => {
    note.textContent = text === '' ? MILESTONES_TEXT.subtitle : text;
  };

  const chip = (label: string, onTap: () => void, extra: Record<string, string> = {}) => {
    const b = el('button', { type: 'button', class: 'wardrobe-chip', ...extra }, label);
    b.addEventListener('click', onTap);
    return b;
  };

  // ── Profile card and titles ───────────────────────────────────────────
  function renderProfile(): void {
    if (!data) {
      profile.replaceChildren();
      return;
    }
    const worn = data.titles.find((t) => t.id === data?.equippedTitleId) ?? null;
    const rows: Node[] = [
      el(
        'div',
        { class: 'milestones-who' },
        el('span', { class: 'milestones-name' }, options.username()),
        el(
          'span',
          {
            class: `milestones-worn${worn ? '' : ' milestones-worn-none'}`,
            'data-testid': 'milestones-worn',
          },
          worn?.name ?? MILESTONES_TEXT.noTitle,
        ),
      ),
    ];
    if (data.titles.length > 0) {
      const toggle = chip(
        worn ? MILESTONES_TEXT.changeTitle : MILESTONES_TEXT.wearTitle,
        () => {
          picking = !picking;
          renderProfile();
        },
        { 'data-testid': 'milestones-pick-title', 'aria-expanded': String(picking) },
      );
      rows.push(toggle);
    }
    if (picking && data.titles.length > 0) {
      const options_ = [
        ...data.titles.map((t) => ({ id: t.id, name: t.name })),
        { id: null, name: MILESTONES_TEXT.noneOption },
      ];
      rows.push(
        el(
          'div',
          { class: 'milestones-titles', role: 'group', 'aria-label': MILESTONES_TEXT.pickTitle },
          el('p', { class: 'milestones-titles-hint' }, MILESTONES_TEXT.pickTitle),
          ...options_.map((t) => {
            const b = chip(t.name, () => void wear(t.id, t.name), {
              'aria-pressed': String(t.id === data?.equippedTitleId),
              'data-title': t.id ?? 'none',
            });
            b.disabled = saving;
            return b;
          }),
        ),
      );
    }
    profile.replaceChildren(...rows);
  }

  async function wear(titleId: string | null, name: string): Promise<void> {
    if (saving) return;
    const mine = session;
    saving = true;
    renderProfile();
    try {
      const next = await api.equipTitle(titleId);
      if (mine !== session) return;
      data = next;
      picking = false;
      say(titleId === null ? MILESTONES_TEXT.titleOff : MILESTONES_TEXT.titleWorn(name));
    } catch (err) {
      if (mine === session) say(messageOf(err));
    } finally {
      if (mine === session) {
        saving = false;
        render();
      }
    }
  }

  // ── Tracks ────────────────────────────────────────────────────────────
  function trackRow(track: ShownTrack): HTMLElement {
    const next = nextTier(track);
    const fill = el('span', { class: 'milestones-bar-fill' });
    fill.style.width = `${String(barPercent(track))}%`;
    const season = seasonLabel(track);
    const dots = track.tiers.map((t) =>
      el('span', {
        class: `milestones-dot${t.earnedAt === null ? '' : ' milestones-dot-earned'}`,
        'aria-hidden': 'true',
      }),
    );
    return el(
      'section',
      {
        class: `milestones-track${next ? '' : ' milestones-track-done'}`,
        'data-track': track.id,
        'data-earned': String(earnedCount(track)),
      },
      el(
        'div',
        { class: 'milestones-track-head' },
        el('h3', { class: 'milestones-track-name' }, track.name),
        ...(season ? [el('span', { class: 'milestones-season' }, season)] : []),
        el('span', { class: 'milestones-dots' }, ...dots),
      ),
      el(
        'div',
        {
          class: 'milestones-bar',
          role: 'progressbar',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': String(barPercent(track)),
          'aria-label': track.name,
        },
        fill,
      ),
      el('p', { class: 'milestones-goal' }, progressLabel(track), next ? ` · ${next.goal}` : ''),
      ...(next
        ? [
            el(
              'p',
              { class: 'milestones-prize' },
              el('strong', {}, MILESTONES_TEXT.prize),
              ` ${rewardLine(next.reward)}`,
            ),
          ]
        : []),
    );
  }

  const secretRow = () =>
    el(
      'section',
      { class: 'milestones-track milestones-secret', 'data-track': '???' },
      el(
        'div',
        { class: 'milestones-track-head' },
        el('h3', { class: 'milestones-track-name' }, MILESTONES_TEXT.secretName),
      ),
      el('p', { class: 'milestones-goal' }, MILESTONES_TEXT.secretGoal),
    );

  function render(): void {
    renderProfile();
    if (!data) return;
    list.replaceChildren(...data.tracks.map((t) => (t.hidden ? secretRow() : trackRow(t))));
  }

  // ── Open and close ────────────────────────────────────────────────────
  async function load(): Promise<void> {
    const mine = session;
    say(MILESTONES_TEXT.loading);
    try {
      const next = await api.get();
      if (mine !== session) return;
      data = next;
      say('');
      render();
    } catch (err) {
      if (mine !== session) return;
      say(messageOf(err));
      if (!data) {
        list.replaceChildren(
          el('p', { class: 'wardrobe-empty' }, MILESTONES_TEXT.loadFailed),
          chip(MILESTONES_TEXT.retry, () => void load()),
        );
      }
    }
  }

  function close(): void {
    if (!isOpen) return;
    session += 1;
    isOpen = false;
    node.hidden = true;
    picking = false;
    saving = false;
  }

  back.addEventListener('click', () => {
    close();
    options.onBack();
  });

  return {
    node,
    open: () => {
      if (isOpen) return;
      session += 1;
      isOpen = true;
      node.hidden = false;
      picking = false;
      if (data) render();
      else list.replaceChildren();
      void load();
    },
    close,
    reset: () => {
      close();
      session += 1;
      data = null;
      list.replaceChildren();
      profile.replaceChildren();
    },
    get isOpen() {
      return isOpen;
    },
    get debug() {
      const shown = data?.tracks ?? [];
      return {
        open: isOpen,
        loaded: data !== null,
        tracks: shown.map((t) => (t.hidden ? '???' : t.id)),
        earned: Object.fromEntries(
          shown.flatMap((t) => (t.hidden ? [] : [[t.id, earnedCount(t)] as const])),
        ),
        titles: data?.titles.map((t) => t.id) ?? [],
        equippedTitleId: data?.equippedTitleId ?? null,
        picking,
      };
    },
  };
}
