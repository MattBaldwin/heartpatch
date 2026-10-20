import { QUICK_MESSAGES } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import page from '../../../privacy.html?raw';
import { PRIVACY_TEXT } from './privacy-link.js';

// The privacy page (#593) makes promises to parents: the numbers on it must
// follow the data they describe.
const text = page.replace(/\s+/g, ' ');

describe('the privacy page', () => {
  it('names the quick-message feed limit each patch keeps', () => {
    expect(text).toContain(`Each patch keeps only its latest ${String(QUICK_MESSAGES.feedLimit)}.`);
  });

  it('names the operator as the contact, with no email address', () => {
    expect(text).toContain('Ask Matt, the grown-up who gave you your family code.');
    expect(text).not.toMatch(/@|mailto:/);
  });

  it('is what the sign-up tick box says the grown-up read', () => {
    expect(PRIVACY_TEXT.grownUpOk).toMatch(/privacy page/);
    expect(text).not.toMatch(/<script/);
  });
});
