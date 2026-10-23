import { describe, expect, it } from 'vitest';
import { BUTTON_TEXT, buttonClass } from './button.js';

describe('the shared button', () => {
  it('builds its classes', () => {
    expect(buttonClass()).toBe('hp-button hp-button-secondary');
    expect(buttonClass({ variant: 'primary', small: true })).toBe(
      'hp-button hp-button-primary hp-button-small',
    );
    expect(BUTTON_TEXT.back).toBe('Back');
  });
});
