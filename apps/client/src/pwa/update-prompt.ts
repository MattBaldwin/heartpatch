import { el } from '../ui/dom.js';
import '../ui/auth/auth.css';

// "New version ready" pill (issue #26). Gentle: it never interrupts play and
// stays until the player taps it. Copy follows docs/STYLE_GUIDE.md.

export interface UpdatePrompt {
  show: (apply: () => void) => void;
}

export function mountUpdatePrompt(root: HTMLElement): UpdatePrompt {
  const button = el('button', { type: 'button', class: 'auth-button auth-button-small' }, 'Update');
  const pill = el(
    'div',
    { class: 'pwa-update', role: 'status', 'data-testid': 'pwa-update' },
    el('span', {}, 'Ooh, a new Heartpatch is ready!'),
    button,
  );
  pill.hidden = true;
  root.append(pill);

  let applyUpdate: (() => void) | null = null;
  button.addEventListener('click', () => {
    if (!applyUpdate) return;
    button.disabled = true;
    applyUpdate();
  });

  return {
    show(apply) {
      applyUpdate = apply;
      button.disabled = false;
      pill.hidden = false;
    },
  };
}
