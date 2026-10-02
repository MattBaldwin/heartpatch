import { el } from '../ui/dom.js';
import { INSTALL_GUIDE_SEEN_KEY } from './config.js';
import { isIosSafari, shouldShowInstallGuide } from './platform.js';
import '../ui/auth/auth.css';

// Add to Home Screen guide (issue #26). Safari on iPhone and iPad has no
// install prompt, so we show the steps in a small card until the player taps
// "Got it!". It sits under the login card (pwa.css), so a new player signs up
// first and sees it after. Copy follows docs/STYLE_GUIDE.md.

function readSeen(): boolean {
  try {
    return localStorage.getItem(INSTALL_GUIDE_SEEN_KEY) !== null;
  } catch {
    return false; // storage blocked: show it; it's dismissible
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(INSTALL_GUIDE_SEEN_KEY, '1');
  } catch {
    // Storage blocked: it may show again next time, which is harmless.
  }
}

/** Safari's Share icon (a box with an arrow out of the top), drawn inline. */
function shareIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'pwa-guide-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16',
    'M12 15V3',
    'M8.5 6.5 12 3l3.5 3.5',
  ]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function mountInstallGuide(root: HTMLElement): void {
  const show = shouldShowInstallGuide(
    isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
    {
      iosStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
      standaloneDisplay: window.matchMedia('(display-mode: standalone)').matches,
    },
    readSeen(),
  );
  if (!show) return;

  const close = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-small pwa-guide-close' },
    'Got it!',
  );
  const card = el(
    'section',
    {
      class: 'pwa-guide',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': 'pwa-guide-title',
      'data-testid': 'install-guide',
    },
    el('h2', { class: 'pwa-guide-title', id: 'pwa-guide-title' }, 'Make Heartpatch an app!'),
    el(
      'ol',
      { class: 'pwa-guide-steps' },
      el('li', {}, 'Tap Share ', shareIcon(), '. No Share? Tap ••• first.'),
      el('li', {}, 'Pick “Add to Home Screen”.'),
      el('li', {}, 'Open Heartpatch from your home screen!'),
    ),
    close,
  );
  close.addEventListener('click', () => {
    markSeen();
    card.remove();
  });
  root.append(card);
}
