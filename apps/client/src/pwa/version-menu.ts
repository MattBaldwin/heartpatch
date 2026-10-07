import type { BuildInfo } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { versionView, type AppUpdates, type ServerBuild } from './app-updates.js';
import '../ui/auth/auth.css';

// The version in the profile menu (#198): a quiet line under the name, which
// opens What's new (#220, where a Copy chip copies it for bug reports), and
// an "Update now" row when a newer version is ready. Both are made once and
// refreshed each time the menu opens.

export const VERSION_TEXT = {
  updateNow: 'Update now',
  label: (version: string) => `Version ${version}. Tap to see what's new.`,
} as const;

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
  /** The line was tapped: What's new opens (#220; copying lives in that sheet). */
  onOpen: () => void;
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
    VERSION_TEXT.updateNow,
  );

  let server: ServerBuild | null = null;
  const render = () => {
    const view = versionView(deps.client, server, deps.updates.workerWaiting);
    line.textContent = view.text;
    line.setAttribute('aria-label', VERSION_TEXT.label(view.text));
    updateRow.hidden = !view.updateReady;
    updateRow.disabled = deps.updates.applying;
  };

  line.addEventListener('click', deps.onOpen);
  updateRow.addEventListener('click', () => {
    deps.updates.apply();
    render();
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
