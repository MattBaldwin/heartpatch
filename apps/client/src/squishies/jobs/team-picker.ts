import type { JobsView } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { el, messageOf } from '../../ui/dom.js';
import { blobFor } from './job-board.js';
import { jobsApi, type JobsApi } from './jobs-api.js';
import { hintLines, JOBS_TEXT, nameOf, teamCost, teamSlots, toggleTeam } from './jobs-view.js';
import './jobs.css';

// The team picker (owner decisions 2026-10-04): three slots for the squishies
// that come along to battles, filled by tapping (or dragging) a squishy, in
// slot order. Picking a guard or a gatherer takes it off that job, and the
// picker says so first. A self-contained DOM sheet anything can open.

export interface TeamPickerOptions {
  root: HTMLElement;
  api?: JobsApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TeamPickerDebug {
  readonly open: boolean;
  /** The team being picked (not saved yet). */
  readonly picked: readonly string[];
  /** The team the server has. */
  readonly saved: readonly string[];
  readonly note: string;
}

export interface TeamPicker {
  open: (mapId: string) => Promise<void>;
  close: () => void;
  readonly isOpen: boolean;
  readonly debug: TeamPickerDebug;
}

const DRAG_TYPE = 'text/x-squishy-id';

export function createTeamPicker(options: TeamPickerOptions): TeamPicker {
  const api = options.api ?? jobsApi;
  let mapId: string | null = null;
  let view: JobsView | null = null;
  let picked: string[] = [];
  let working = false;
  let ticket = 0;

  const close = el(
    'button',
    { type: 'button', class: 'tile-panel-close', 'aria-label': JOBS_TEXT.close },
    '×',
  );
  const note = el('p', { class: 'jobs-note', role: 'status', 'data-testid': 'team-note' });
  const slots = el('ol', { class: 'team-slots', 'data-testid': 'team-slots' });
  const list = el('ul', { class: 'team-list', 'data-testid': 'team-list' });
  const save = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'team-save' },
    JOBS_TEXT.save,
  );
  const sheet = el(
    'section',
    { class: 'jobs-sheet', role: 'dialog', 'aria-labelledby': 'team-title', 'data-testid': 'team' },
    el(
      'div',
      { class: 'tile-panel-head' },
      el('h2', { id: 'team-title' }, JOBS_TEXT.teamTitle),
      close,
    ),
    el('p', { class: 'jobs-small' }, JOBS_TEXT.teamHint),
    slots,
    note,
    save,
    list,
  );
  sheet.hidden = true;
  options.root.append(sheet);

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  close.addEventListener('click', () => {
    closePicker();
  });
  save.addEventListener('click', () => {
    const id = mapId;
    if (!id || working) return;
    const mine = ticket;
    working = true;
    render();
    sendCommand(
      sendDeps,
      (key) => api.setTeam(id, picked, key),
      () => mine === ticket,
    )
      .then((res) => {
        if (!res || mine !== ticket) return;
        view = res;
        picked = [...res.team];
        note.textContent = JOBS_TEXT.saved;
      })
      .catch((err: unknown) => {
        if (mine === ticket) note.textContent = messageOf(err);
      })
      .finally(() => {
        working = false;
        if (mine === ticket) render();
      });
  });

  const size = () => view?.rules.teamSize ?? 3;
  const pick = (id: string) => {
    picked = toggleTeam(picked, id, size());
    note.textContent = '';
    render();
  };

  function render(): void {
    const current = view;
    save.disabled = working || !current;
    if (!current) {
      slots.replaceChildren();
      list.replaceChildren();
      return;
    }
    const byId = new Map(current.squishies.map((s) => [s.squishy.id, s]));
    slots.replaceChildren(
      ...teamSlots(picked, size()).map((id, i) => {
        const squishy = id ? byId.get(id) : undefined;
        const slot = el(
          'button',
          {
            type: 'button',
            class: 'team-slot',
            'data-testid': 'team-slot',
            'data-slot': String(i),
          },
          ...(squishy
            ? [blobFor(squishy), el('span', {}, nameOf(current, squishy))]
            : [el('span', { class: 'jobs-small' }, JOBS_TEXT.emptySlot)]),
        );
        slot.disabled = working;
        slot.addEventListener('click', () => {
          if (id) pick(id);
        });
        // Drag a squishy onto a slot (desktop, iPad with a pointer); tapping works everywhere.
        slot.addEventListener('dragover', (event) => {
          event.preventDefault();
        });
        slot.addEventListener('drop', (event) => {
          event.preventDefault();
          const dropped = event.dataTransfer?.getData(DRAG_TYPE);
          if (!dropped || !byId.has(dropped)) return;
          const without = picked.filter((p) => p !== dropped);
          without.splice(Math.min(i, without.length), 0, dropped);
          picked = without.slice(0, size());
          render();
        });
        return el('li', {}, slot);
      }),
    );
    // With nobody picked, battles take the strongest resting squishies: say so.
    if (picked.length === 0 && !note.textContent) note.textContent = JOBS_TEXT.emptyTeamNote;
    if (picked.length > 0 && note.textContent === JOBS_TEXT.emptyTeamNote) note.textContent = '';
    list.replaceChildren(
      ...current.squishies.map((s) => {
        const cost = teamCost(s);
        const chosen = picked.includes(s.squishy.id);
        const away = s.squishy.state !== 'active' && !current.team.includes(s.squishy.id);
        const row = el(
          'button',
          {
            type: 'button',
            class: `team-candidate${chosen ? ' team-chosen' : ''}`,
            'data-testid': 'team-candidate',
            'data-squishy': s.squishy.id,
            draggable: 'true',
            'aria-pressed': String(chosen),
          },
          blobFor(s),
          el(
            'span',
            { class: 'team-candidate-text' },
            el('strong', {}, nameOf(current, s)),
            el('span', { class: 'jobs-small' }, hintLines(s).join(' · ')),
            ...(cost && !chosen ? [el('span', { class: 'jobs-dark' }, cost)] : []),
          ),
        );
        row.disabled = working || away;
        row.addEventListener('click', () => {
          pick(s.squishy.id);
        });
        row.addEventListener('dragstart', (event) => {
          event.dataTransfer?.setData(DRAG_TYPE, s.squishy.id);
        });
        return el('li', {}, row);
      }),
    );
  }

  function closePicker(): void {
    ticket += 1;
    sheet.hidden = true;
    mapId = null;
    view = null;
    picked = [];
    note.textContent = '';
  }

  return {
    open: async (id) => {
      ticket += 1;
      const mine = ticket;
      mapId = id;
      sheet.hidden = false;
      note.textContent = '';
      render();
      try {
        const fresh = await api.view(id);
        if (mine !== ticket) return;
        view = fresh;
        picked = [...fresh.team];
        render();
      } catch (err) {
        if (mine === ticket) note.textContent = messageOf(err);
      }
    },
    close: closePicker,
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      return {
        open: !sheet.hidden,
        picked: [...picked],
        saved: view?.team ?? [],
        note: note.textContent,
      };
    },
  };
}
