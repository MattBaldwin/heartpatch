import { el } from '../dom.js';

// The privacy page for grown-ups (#593): `privacy.html`, served at /privacy
// without logging in. The game opens it in its own window (an in-app browser
// sheet in the installed iPhone app), so a half-filled sign-up or a running
// patch stays just as it was underneath.

export const PRIVACY_URL = '/privacy';

export const PRIVACY_TEXT = {
  /** The sign-up tick box; sign up sleeps until it's on. */
  grownUpOk: 'A grown-up helped me and read the privacy page.',
  link: 'Read the privacy page',
  menuRow: 'Privacy page',
} as const;

/** Opens the privacy page in its own window, from a tap. */
export function openPrivacy(): void {
  window.open(PRIVACY_URL, '_blank', 'noopener');
}

/** A link to the privacy page that opens in its own window. */
export function privacyLink(testId: string): HTMLAnchorElement {
  return el(
    'a',
    {
      class: 'auth-link',
      href: PRIVACY_URL,
      target: '_blank',
      rel: 'noopener',
      'data-testid': testId,
    },
    PRIVACY_TEXT.link,
  );
}
