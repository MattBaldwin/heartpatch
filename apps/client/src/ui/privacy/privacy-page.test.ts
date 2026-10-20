import { QUICK_MESSAGES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import page from '../../../privacy.html?raw';
import { PRIVACY_TEXT } from './privacy-link.js';

// The privacy page (#593) makes promises to parents: the numbers on it must
// follow the data they describe.
const text = page.replace(/\s+/g, ' ');

describe('the privacy page', () => {
  it('names the quick-message feed limit the chat shows', () => {
    expect(text).toContain(
      `The chat shows each patch's latest ${String(QUICK_MESSAGES.feedLimit)}.`,
    );
  });

  it('names the operator as the contact, with no email address', () => {
    expect(text).toContain('Ask Matt, the grown-up who gave you your family code.');
    expect(text).not.toMatch(/@|mailto:/);
  });

  it('is the page the sign-up tick box names', () => {
    expect(PRIVACY_TEXT.grownUpOk).toMatch(/privacy page/);
  });

  it('runs no script, so it loads anywhere without logging in', () => {
    expect(text).not.toMatch(/<script/);
  });
});
