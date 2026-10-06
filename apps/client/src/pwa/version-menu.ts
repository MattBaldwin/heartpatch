import type { BuildInfo } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { versionView, type AppUpdates, type ServerBuild } from './app-updates.js';
import '../ui/auth/auth.css';

// The version in the profile menu (#198): a quiet line under the name, which
// copies itself for bug reports, and an "Update now" row when a newer version
// is ready. Both are made once and refreshed each time the menu opens.

/** TUNE: how long the line says "Copied!". */
const COPIED_MS = 1500;

export interface VersionMenu {
  line: HTMLButtonElement;
  updateRow: HTMLButtonElement;
  /** Re-reads the waiting worker and asks the server for its build. */
  refresh: () => void;
}

export function mountVersionMenu(deps: {
  client: BuildInfo | null;
  updates: AppUpdates;
  fetchServer: () => Promise<ServerBuild>;
  copy: (text: string) => Promise<void>;
}): VersionMenu {
  const line = el('button', {
    type: 'button',
    class: 'auth-chip-version',
    'data-testid': 'app-version',
  });
  const updateRow = el(
    'button',
    { type: 'button', 'data-testid': 'app-update-now' },
    el('span', { 'aria-hidden': 'true' }, '✨'),
    'Update now',
  );

  let server: ServerBuild | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const render = () => {
    const view = versionView(deps.client, server, deps.updates.workerWaiting);
    if (copiedTimer === undefined) line.textContent = view.text;
    line.setAttribute('aria-label', `Version ${view.text}. Tap to copy.`);
    updateRow.hidden = !view.updateReady;
  };

  line.addEventListener('click', () => {
    const text = versionView(deps.client, server, deps.updates.workerWaiting).text;
    deps
      .copy(text)
      .then(() => {
        clearTimeout(copiedTimer);
        line.textContent = 'Copied!';
        copiedTimer = setTimeout(() => {
          copiedTimer = undefined;
          render();
        }, COPIED_MS);
      })
      .catch(() => undefined);
  });
  updateRow.addEventListener('click', () => {
    updateRow.disabled = true;
    deps.updates.apply();
  });

  return {
    line,
    updateRow,
    refresh: () => {
      render();
      // An older or unreachable server just leaves the line as it is.
      deps
        .fetchServer()
        .then((health) => {
          server = health;
          render();
        })
        .catch(() => undefined);
    },
  };
}
